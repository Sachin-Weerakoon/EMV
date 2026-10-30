# Advanced Ethereum Flash Loan Arbitrage Bot

A production-grade, MEV-aware Flash Loan Arbitrage bot built with Solidity, TypeScript, and the Flashbots Bundle Relay.

---

## Architecture Overview

- **On-Chain Executor (`ArbitrageExecutor.sol`)**:
  - **Balancer v2 Flash Loans**: 0% fee borrowing mechanism for WETH, DAI, USDC, etc.
  - **Aave v3 Fallback**: 0.05% fee flash loan integration.
  - **DIRECT_PAIR_V2 Low-Level Calls**: Bypasses DEX router contracts and ERC20 approvals completely, sending tokens directly to pair contracts to save **40,000–60,000 gas per hop**.
  - **Validator / MEV Bribe**: Transfers `block.coinbase` tips directly inside the transaction, avoiding public mempool gas wars.
  - **Strict Profit Guarantees**: Asserts final balance $\ge \text{Debt} + \text{Target Profit}$; reverts off-chain if unprofitable.

- **Off-Chain Detection Engine (`src/`)**:
  - `src/math/closedFormMath.ts`: Sub-microsecond exact closed-form calculus solver ($\frac{dP}{dx} = 0$) using integer square root.
  - `src/math/triangularMath.ts`: 3-hop optimal sizing engine for triangular token cycles ($WETH \to USDC \to DAI \to WETH$).
  - `src/services/pathFinder.ts`: Graph-based cyclic path finder evaluating both cross-DEX 2-hop and triangular 3-hop cycles simultaneously.
  - `src/services/multicallReserveFetcher.ts`: Multicall3 batch reserve fetcher querying reserves of hundreds of pools in a single $< 20\text{ms}$ batch call.
  - `src/services/multiBuilderRelay.ts`: Concurrent multi-relay bundle broadcaster targeting **Flashbots**, **BeaverBuild**, **Titan Builder**, **Builder0x69**, and **Rsync Builder** (`eth_sendBundle`).
  - `src/bot.ts`: Searcher orchestrator connecting the graph engine with multi-relay bundle dispatch.

---

## Getting Started

### 1. Environment Configuration

Copy the sample environment file:
```bash
cp .env.example .env
```

Edit `.env` with your credentials:
```env
MAINNET_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY
PRIVATE_KEY=your_searcher_wallet_private_key
FLASHBOTS_AUTH_KEY=random_or_dedicated_reputation_private_key
EXECUTOR_CONTRACT_ADDRESS=0x...deployed_contract_address...
MIN_PROFIT_ETH=0.01
BRIBE_PERCENTAGE=90
```

### 2. Compile Smart Contracts

```bash
npx hardhat compile
```

### 3. Run Unit & Math Tests

```bash
npx hardhat test
```

### 4. Deploy Executor to Mainnet or Local Fork

```bash
npx hardhat run scripts/deploy.ts --network mainnet
```

### 5. Start Arbitrage Detection Daemon

```bash
npm start
```
