import { ethers } from "ethers";
import * as dotenv from "dotenv";
import { MAINNET_ADDRESSES, CORE_TOKENS } from "./config/addresses";
import { ArbitragePathFinder, PoolEdge, ArbitrageCycle } from "./services/pathFinder";
import { MultiBuilderRelayService } from "./services/multiBuilderRelay";

dotenv.config();

const RPC_URL = process.env.MAINNET_RPC_URL || "https://rpc.ankr.com/eth";
const EXECUTOR_CONTRACT_ADDRESS = process.env.EXECUTOR_CONTRACT_ADDRESS || ethers.ZeroAddress;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const FLASHBOTS_AUTH_KEY = process.env.FLASHBOTS_AUTH_KEY;
const MIN_PROFIT_THRESHOLD_WEI = ethers.parseEther(process.env.MIN_PROFIT_ETH || "0.01");
const BRIBE_PERCENTAGE = parseInt(process.env.BRIBE_PERCENTAGE || "90");

const UNISWAP_V2_PAIR_ABI = [
  "event Sync(uint112 reserve0, uint112 reserve1)",
  "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function token0() external view returns (address)",
  "function token1() external view returns (address)",
];

async function main() {
  console.log("==================================================================");
  console.log("   ADVANCED FLASH LOAN ARBITRAGE BOT: MULTI-RELAY & TRIANGULAR    ");
  console.log("==================================================================");
  console.log(`[Config] Node RPC: ${RPC_URL.replace(/(key=|\/)[a-zA-Z0-9_-]{20,}/, "$1***")}`);
  console.log(`[Config] Executor Contract: ${EXECUTOR_CONTRACT_ADDRESS}`);
  console.log(`[Config] Min Profit Threshold: ${ethers.formatEther(MIN_PROFIT_THRESHOLD_WEI)} ETH`);
  console.log(`[Config] Validator Bribe: ${BRIBE_PERCENTAGE}% of net profit`);

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const multiRelay = new MultiBuilderRelayService(provider, FLASHBOTS_AUTH_KEY);

  let wallet: ethers.Wallet | null = null;
  if (PRIVATE_KEY) {
    wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    console.log(`[Wallet] Loaded Searcher Wallet: ${wallet.address}`);
    await multiRelay.initialize();
  } else {
    console.warn(`[Wallet] No PRIVATE_KEY provided. Running in Simulation / Dry-Run Mode.`);
  }

  // Pre-configured high-volume pools for Cross-DEX & Triangular Arbitrage
  const trackedPools: PoolEdge[] = [
    // 1. Uniswap V2 WETH / USDC
    {
      poolAddress: "0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc",
      dexName: "UniswapV2",
      token0: CORE_TOKENS.WETH.address,
      token1: CORE_TOKENS.USDC.address,
      reserve0: 0n,
      reserve1: 0n,
    },
    // 2. SushiSwap WETH / USDC
    {
      poolAddress: "0x397FF1542f962076d0BFE58eA045FfA2d347ACa0",
      dexName: "SushiSwap",
      token0: CORE_TOKENS.USDC.address,
      token1: CORE_TOKENS.WETH.address,
      reserve0: 0n,
      reserve1: 0n,
    },
    // 3. Uniswap V2 USDC / DAI
    {
      poolAddress: "0xAE461Ca67B15dc8dc81CE7615e0320dA1A9aB8D5",
      dexName: "UniswapV2",
      token0: CORE_TOKENS.DAI.address,
      token1: CORE_TOKENS.USDC.address,
      reserve0: 0n,
      reserve1: 0n,
    },
    // 4. Uniswap V2 WETH / DAI
    {
      poolAddress: "0xA478c2975Ab1Ea89e8196811F51A7B7Ade33eB11",
      dexName: "UniswapV2",
      token0: CORE_TOKENS.DAI.address,
      token1: CORE_TOKENS.WETH.address,
      reserve0: 0n,
      reserve1: 0n,
    },
  ];

  const pathFinder = new ArbitragePathFinder();
  for (const pool of trackedPools) {
    pathFinder.registerPool(pool);
  }

  console.log(`[Init] Registered ${trackedPools.length} pools into graph engine. Subscribing to Sync events...`);

  for (const pool of trackedPools) {
    const contract = new ethers.Contract(pool.poolAddress, UNISWAP_V2_PAIR_ABI, provider);

    contract.on("Sync", async (reserve0: bigint, reserve1: bigint) => {
      pathFinder.updateReserves(pool.poolAddress, reserve0, reserve1);

      // Check for cycles starting and ending with WETH
      const bestCycle = pathFinder.findBestCycle(CORE_TOKENS.WETH.address);
      if (bestCycle && bestCycle.expectedGrossProfit >= MIN_PROFIT_THRESHOLD_WEI) {
        await handleOpportunity(bestCycle, wallet, provider, multiRelay);
      }
    });
  }
}

async function handleOpportunity(
  cycle: ArbitrageCycle,
  wallet: ethers.Wallet | null,
  provider: ethers.JsonRpcProvider,
  multiRelay: MultiBuilderRelayService
) {
  console.log("\n==============================================================");
  console.log(`[Opportunity Detected] Type: ${cycle.type}`);
  console.log(`Optimal Borrow: ${ethers.formatEther(cycle.optimalInput)} WETH`);
  console.log(`Expected Gross Profit: ${ethers.formatEther(cycle.expectedGrossProfit)} WETH`);
  console.log(`Cycle Path: ${cycle.hops.map((h) => `${h.dex} (${h.tokenIn.slice(0, 6)}->${h.tokenOut.slice(0, 6)})`).join(" -> ")}`);

  if (!wallet || EXECUTOR_CONTRACT_ADDRESS === ethers.ZeroAddress) {
    console.log(`[Simulation Mode] Contract not deployed or wallet absent. Skipping live bundle dispatch.`);
    return;
  }

  try {
    const currentBlock = await provider.getBlockNumber();
    const targetBlock = currentBlock + 1;

    const executorAbi = [
      "function executeFlashArbitrage(uint8 provider, tuple(address borrowedToken, uint256 borrowedAmount, uint256 minProfitExpected, uint256 bribePercentage, tuple(uint8 dexType, address routerOrPair, address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint256 minAmountOut)[] steps) params)",
    ];
    const executorContract = new ethers.Contract(EXECUTOR_CONTRACT_ADDRESS, executorAbi, wallet);

    // Prepare steps matching ArbitrageExecutor.sol struct with DIRECT_PAIR_V2
    const steps = cycle.hops.map((h) => ({
      dexType: 0, // DIRECT_PAIR_V2 (saves ~40,000 gas per hop by bypassing router and approvals)
      routerOrPair: h.poolAddress,
      tokenIn: h.tokenIn,
      tokenOut: h.tokenOut,
      fee: 0,
      amountIn: h.amountIn,
      minAmountOut: h.minAmountOut,
    }));

    const tx = await executorContract.executeFlashArbitrage.populateTransaction(
      0, // Balancer v2 (0% fee flash loan)
      {
        borrowedToken: cycle.borrowToken,
        borrowedAmount: cycle.optimalInput,
        minProfitExpected: MIN_PROFIT_THRESHOLD_WEI,
        bribePercentage: BRIBE_PERCENTAGE,
        steps: steps,
      }
    );

    tx.chainId = 1n;
    tx.type = 2; // EIP-1559
    tx.maxFeePerGas = ethers.parseUnits("35", "gwei");
    tx.maxPriorityFeePerGas = ethers.parseUnits("2", "gwei");
    tx.gasLimit = 400000n;
    tx.nonce = await wallet.getNonce();

    const signedTx = await wallet.signTransaction(tx);

    // 1. Simulate on Flashbots
    const sim = await multiRelay.simulateOnFlashbots([signedTx], targetBlock);
    if (sim.success) {
      console.log(`[MultiRelay] Simulation succeeded! Gas: ${sim.gasUsed}, Bribe: ${sim.coinbaseDiff} wei`);
      // 2. Broadcast concurrently to all block builders
      await multiRelay.broadcastBundleToAll([signedTx], targetBlock);
    } else {
      console.warn(`[MultiRelay] Simulation failed, dropped with $0 gas lost: ${sim.error}`);
    }
  } catch (err: any) {
    console.error(`[Execution Error]:`, err?.message || err);
  }
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
