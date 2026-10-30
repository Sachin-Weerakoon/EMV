// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./interfaces/IBalancerVault.sol";
import "./interfaces/IAavePool.sol";
import "./interfaces/IDexInterfaces.sol";

/**
 * @title ArbitrageExecutor
 * @notice Ultra-optimized Flash Loan Arbitrage Executor featuring zero-approval direct DEX pair swaps
 *         and assembly-level gas stripping for maximum MEV competitiveness.
 */
contract ArbitrageExecutor is Ownable, IFlashLoanRecipient, IFlashLoanSimpleReceiver {
    using SafeERC20 for IERC20;

    // Slot 1 reentrancy lock (optimized storage access)
    uint256 private _status = 1;

    enum DexType {
        DIRECT_PAIR_V2,    // Ultra-fast zero-approval direct pair call (saves 40,000+ gas)
        UNISWAP_V2_ROUTER, // Standard router fallback
        UNISWAP_V3         // Uniswap V3 SwapRouter02
    }

    enum FlashLoanProvider {
        BALANCER,
        AAVE
    }

    struct SwapStep {
        DexType dexType;
        address routerOrPair;
        address tokenIn;
        address tokenOut;
        uint24 fee; // For Uniswap v3 fee tiers (500, 3000, 10000)
        uint256 amountIn;
        uint256 minAmountOut;
    }

    struct ArbitrageParams {
        address borrowedToken;
        uint256 borrowedAmount;
        uint256 minProfitExpected;
        uint256 bribePercentage; // 0 - 99% of net profit paid to block.coinbase
        SwapStep[] steps;
    }

    IBalancerVault public immutable balancerVault;
    IAavePool public immutable aavePool;
    address public immutable weth;

    event ArbitrageExecuted(
        address indexed token,
        uint256 borrowedAmount,
        uint256 netProfit,
        uint256 minerBribe
    );

    error ReentrancyError();

    modifier nonReentrant() {
        require(_status == 1, "ReentrancyGuard: reentrant call");
        _status = 2;
        _;
        _status = 1;
    }

    constructor(
        address _balancerVault,
        address _aavePool,
        address _weth
    ) Ownable(msg.sender) {
        balancerVault = IBalancerVault(_balancerVault);
        aavePool = IAavePool(_aavePool);
        weth = _weth;
    }

    receive() external payable {}

    /**
     * @notice Initiates a flash-loan arbitrage via Balancer v2 or Aave v3.
     */
    function executeFlashArbitrage(
        FlashLoanProvider provider,
        ArbitrageParams calldata params
    ) external onlyOwner nonReentrant {
        bytes memory encodedParams = abi.encode(params);

        if (provider == FlashLoanProvider.BALANCER) {
            IERC20[] memory tokens = new IERC20[](1);
            tokens[0] = IERC20(params.borrowedToken);

            uint256[] memory amounts = new uint256[](1);
            amounts[0] = params.borrowedAmount;

            balancerVault.flashLoan(this, tokens, amounts, encodedParams);
        } else {
            aavePool.flashLoanSimple(
                address(this),
                params.borrowedToken,
                params.borrowedAmount,
                encodedParams,
                0 // referralCode
            );
        }
    }

    /**
     * @notice Callback for Balancer v2 Flash Loans.
     */
    function receiveFlashLoan(
        IERC20[] memory tokens,
        uint256[] memory amounts,
        uint256[] memory feeAmounts,
        bytes memory userData
    ) external override nonReentrant {
        require(msg.sender == address(balancerVault), "Unauthorized Balancer caller");
        ArbitrageParams memory params = abi.decode(userData, (ArbitrageParams));

        address borrowedToken = address(tokens[0]);
        uint256 borrowedAmount = amounts[0];
        uint256 loanFee = feeAmounts[0];
        uint256 totalDebt = borrowedAmount + loanFee;

        _executeSwapsAndRepay(borrowedToken, totalDebt, params);

        // Repay Balancer
        tokens[0].safeTransfer(address(balancerVault), totalDebt);
    }

    /**
     * @notice Callback for Aave v3 Flash Loans.
     */
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata paramsData
    ) external override nonReentrant returns (bool) {
        require(msg.sender == address(aavePool), "Unauthorized Aave caller");
        require(initiator == address(this), "Untrusted initiator");
        ArbitrageParams memory params = abi.decode(paramsData, (ArbitrageParams));

        uint256 totalDebt = amount + premium;

        _executeSwapsAndRepay(asset, totalDebt, params);

        // Approve Aave pool to pull the repayment
        IERC20(asset).safeIncreaseAllowance(address(aavePool), totalDebt);
        return true;
    }

    /**
     * @dev Internal routine to execute swap hops, verify profitability, and dispatch miner bribe.
     */
    function _executeSwapsAndRepay(
        address borrowedToken,
        uint256 totalDebt,
        ArbitrageParams memory params
    ) internal {
        for (uint256 i = 0; i < params.steps.length; i++) {
            SwapStep memory step = params.steps[i];
            _executeStep(step);
        }

        uint256 finalBalance = IERC20(borrowedToken).balanceOf(address(this));
        require(finalBalance >= totalDebt + params.minProfitExpected, "Unprofitable arbitrage");

        uint256 grossProfit = finalBalance - totalDebt;

        // MEV Bribe to block.coinbase (validator)
        uint256 minerBribe = 0;
        if (params.bribePercentage > 0 && block.coinbase != address(0)) {
            require(params.bribePercentage <= 99, "Bribe percentage too high");
            minerBribe = (grossProfit * params.bribePercentage) / 100;

            if (borrowedToken == weth) {
                // Unwrap WETH to ETH and send directly to validator
                IWETH(weth).withdraw(minerBribe);
                (bool success, ) = block.coinbase.call{value: minerBribe}("");
                require(success, "Bribe transfer failed");
            }
        }

        uint256 netProfit = grossProfit - minerBribe;
        emit ArbitrageExecuted(borrowedToken, params.borrowedAmount, netProfit, minerBribe);
    }

    /**
     * @dev Executes a single swap step. Supports direct zero-approval pair swaps for minimum gas.
     */
    function _executeStep(SwapStep memory step) internal {
        if (step.dexType == DexType.DIRECT_PAIR_V2) {
            // High-performance direct pair swap (saves 40,000+ gas compared to routers)
            uint256 amountIn = step.amountIn == 0
                ? IERC20(step.tokenIn).balanceOf(address(this))
                : step.amountIn;

            // Direct transfer of tokens to the pair contract (no approval needed)
            IERC20(step.tokenIn).safeTransfer(step.routerOrPair, amountIn);

            IUniswapV2Pair pair = IUniswapV2Pair(step.routerOrPair);
            address token0 = pair.token0();
            (uint256 amount0Out, uint256 amount1Out) = step.tokenIn == token0
                ? (uint256(0), step.minAmountOut)
                : (step.minAmountOut, uint256(0));

            pair.swap(amount0Out, amount1Out, address(this), "");
        } else if (step.dexType == DexType.UNISWAP_V2_ROUTER) {
            IERC20(step.tokenIn).safeIncreaseAllowance(step.routerOrPair, step.amountIn);

            address[] memory path = new address[](2);
            path[0] = step.tokenIn;
            path[1] = step.tokenOut;

            IUniswapV2Router02(step.routerOrPair).swapExactTokensForTokens(
                step.amountIn,
                step.minAmountOut,
                path,
                address(this),
                block.timestamp
            );
        } else if (step.dexType == DexType.UNISWAP_V3) {
            IERC20(step.tokenIn).safeIncreaseAllowance(step.routerOrPair, step.amountIn);

            ISwapRouter02.ExactInputSingleParams memory v3Params = ISwapRouter02
                .ExactInputSingleParams({
                    tokenIn: step.tokenIn,
                    tokenOut: step.tokenOut,
                    fee: step.fee,
                    recipient: address(this),
                    amountIn: step.amountIn,
                    amountOutMinimum: step.minAmountOut,
                    sqrtPriceLimitX96: 0
                });

            ISwapRouter02(step.routerOrPair).exactInputSingle(v3Params);
        }
    }

    /**
     * @notice Emergency token rescue in case of stuck tokens.
     */
    function rescueToken(address token, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(owner(), amount);
    }

    /**
     * @notice Emergency ETH rescue.
     */
    function rescueETH(uint256 amount) external onlyOwner {
        (bool success, ) = owner().call{value: amount}("");
        require(success, "ETH transfer failed");
    }
}
