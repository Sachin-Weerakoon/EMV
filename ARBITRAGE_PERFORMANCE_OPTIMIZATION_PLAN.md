# Ultimate Latency & Efficiency Refactoring Plan for Flash Loan Arbitrage

In Ethereum MEV (Maximal Extractable Value), the difference between winning and losing an arbitrage opportunity is measured in **microseconds (µs)** and **gas efficiency (units of gas saved)**.

---

## 1. Latency Breakdown: Current vs. Theoretical Limit

| Pipeline Stage | Current Implementation (Node.js/TS) | Optimized TypeScript Engine | Production Rust Core (`alloy` + `revm`) | The Theoretical Limit (Bare Metal) |
| :--- | :--- | :--- | :--- | :--- |
| **1. Event Ingestion** | 50 – 120 ms (Remote HTTP/WSS) | 5 – 15 ms (Local IPC / Fiber BDN) | **< 1 ms** (Direct Reth IPC / Shared Memory) | **~100 µs** (Kernel-bypass DPDK / Solarflare NIC) |
| **2. Optimal Sizing Math** | ~100 µs (BigInt JS Ternary Search) | ~15 µs (TypedFloat64 / Lookup Tables) | **< 2 µs** (SIMD AVX-512 Integer Vector Math) | **< 500 ns** (FPGA / Pre-computed tick matrices) |
| **3. EVM Simulation** | 40 – 90 ms (RPC `eth_callBundle`) | 2 – 5 ms (In-process `@ethereumjs/vm`) | **50 – 150 µs** (In-process `revm` fork) | **< 20 µs** (JIT-compiled EVM state transition) |
| **4. Tx Signing & Assembly** | 1 – 3 ms (Ethers.js JS Crypto) | 200 – 400 µs (`@noble/secp256k1` WASM) | **15 – 30 µs** (Rust `k256` / `secp256k1`) | **< 5 µs** (Pre-computed nonces & signatures) |
| **5. Relay Transmission** | 40 – 80 ms (Sequential HTTPS POST) | 5 – 12 ms (HTTP/2 Multiplexing / Persistent Pool) | **1 – 4 ms** (Direct AWS us-east-1 TCP keepalive) | **< 1 ms** (Direct cross-connect to block builder) |
| **6. On-Chain Execution** | ~280,000 gas (Solidity + OZ) | ~180,000 gas (Packed Calldata + Custom Router) | **~100,000 gas** (Hand-tuned Yul / Transient Storage) | **~85,000 gas** (Custom bytecode / 0-byte selectors) |

---

## 2. The 4 Dimensions of Optimization

### Dimension A: On-Chain Gas Optimization (Yul & Bytecode Level)
Every 1,000 gas saved allows you to increase your validator bribe percentage without sacrificing profit margin.

1. **EIP-1153 Transient Storage (`TSTORE` / `TLOAD`)**:
   - Replace standard storage slots (`SSTORE` costs 20,000 gas) with transient storage (costs only **100 gas**).
   - Use transient storage for reentrancy locks and passing flash loan parameters between callbacks.
2. **Bypass Standard DEX Routers**:
   - Standard routers (`UniswapV2Router02`, `SwapRouter02`) execute unnecessary sanity checks, safe transfers, deadline verifications, and event emissions, wasting 60,000–100,000 gas.
   - Call pair contracts directly using low-level assembly: `pair.swap(amount0Out, amount1Out, to, "")`.
3. **4-Byte Function Selector Mining**:
   - Function selector dispatch in the EVM executes `if (msg.sig == 0x...)` sequentially.
   - Mine a function selector with leading zero bytes (e.g. `0x00000000` or `0x00000001`) by varying the function name (e.g., `execute_003f()`).
   - This saves 16 gas per non-zero calldata byte and ensures immediate first-jump execution.
4. **Assembly Approval Elimination**:
   - Eliminate all ERC20 `approve()` calls during trades. Instead, send tokens directly to the target pair address before invoking `pair.swap()`.

---

### Dimension B: Math & Sizing Engine Refactoring
1. **Analytical Closed-Form Calculus vs. Ternary Search**:
   - Ternary search takes ~64 loop iterations.
   - For constant-product AMMs ($x \cdot y = k$), the profit function has an exact closed-form algebraic derivative:
     $$\Delta x^* = \frac{\sqrt{\gamma_1 \gamma_2 r_{1,\text{in}} r_{2,\text{in}} r_{1,\text{out}} r_{2,\text{out}}} - r_{1,\text{in}} r_{2,\text{in}}}{\gamma_1 r_{2,\text{in}} + \gamma_1 \gamma_2 r_{1,\text{out}}}$$
   - Solving this algebraically requires **1 square root operation** instead of 64 iterations, dropping execution time from 100 microseconds to **under 1 microsecond**.
2. **Fixed-Point Arithmetic**:
   - Avoid JavaScript's generic `BigInt` heap allocations.
   - Use fixed-point representation (e.g. 128.128 fixed point) with pre-allocated TypedArrays (`BigInt64Array` or Rust `U256`).

---

### Dimension C: Network & Ingestion Latency
1. **Co-Located Node via Local IPC (Inter-Process Communication)**:
   - Remote HTTP/WebSocket RPCs traverse external internet backbones (50–100ms latency).
   - Running a local [Reth](https://github.com/paradigmxyz/reth) node communicating via a UNIX Domain Socket (`/tmp/reth.ipc`) cuts event delivery to **< 500 microseconds**.
2. **Direct Fiber Mempool Streams**:
   - Subscribe to Bloxroute BDN (Blockchain Distribution Network) or Eden Network fiber streams to receive new pending transactions 20–50ms before public nodes.
3. **Geographic Proximity (Ashburn, VA)**:
   - 90% of Ethereum block builders (Titan, Beaver, Flashbots) host their relay infrastructure in **AWS us-east-1 (Northern Virginia)**.
   - Hosting the bot on an AWS EC2 instance in `us-east-1` reduces bundle submission network ping from 70ms to **1–3ms**.

---

### Dimension D: In-Process EVM Simulation
1. **The Problem with Remote Simulation**:
   - Calling `eth_callBundle` sends an HTTP payload to Flashbots, waits for their server to simulate, and sends the response back (taking 50–150ms). By then, another bot has already won the block.
2. **In-Process Fork Simulator**:
   - In TypeScript: Cache recent account storage slots and execute local state changes with `@ethereumjs/vm`.
   - In Rust: Use **`revm`** (the fastest EVM in the world, built by Paradigm). It runs the exact EVM bytecode in the same thread in **under 100 microseconds**, with zero network overhead.

---

## 3. Step-by-Step Refactoring Implementation Plan

```mermaid
flowchart TD
    subgraph Phase 1: High-Impact TypeScript Refactoring
        A1[Upgrade Math to Closed-Form Algebraic Calculus] --> A2[Bypass DEX Routers for Direct Pair Swaps in Solidity]
        A2 --> A3[Implement Persistent HTTP/2 & Builder Connection Pooling]
    end

    subgraph Phase 2: On-Chain Gas Stripping (Yul)
        B1[Write Inline Assembly Swap Loops] --> B2[Introduce EIP-1153 Transient Storage]
        B2 --> B3[Mine Zero-Byte Function Selectors]
    end

    subgraph Phase 3: Infrastructure & Co-Location
        C1[Deploy AWS us-east-1 Ashburn Dedicated VPS] --> C2[Setup Local Reth Node with IPC Stream]
        C2 --> C3[Bloxroute / Fiber BDN Stream Integration]
    end

    subgraph Phase 4: The Apex - Rust Engine Migration
        D1[Port Sizing & Graph Finder to Rust] --> D2[Integrate in-process revm Simulator]
        D2 --> D3[Sub-millisecond End-to-End Pipeline]
    end
```

### Phase 1: High-Impact TypeScript Upgrades (Immediate)
- [x] Replace iterative ternary search with exact closed-form calculus solver in `src/math/closedFormMath.ts`.
- [x] Optimize `ArbitrageExecutor.sol` to perform direct pair calls (`pair.swap`) without approvals.
- [x] Add HTTP/2 connection pooling with persistent TCP keep-alive for block builder relays.

### Phase 2: On-Chain Gas Optimization (Solidity -> Yul)
- [ ] Implement transient storage (`TSTORE`/`TLOAD`) to replace `ReentrancyGuard` and memory copies.
- [ ] Pack calldata into a compact binary format (custom abi-decoder in Yul).
- [ ] Target gas consumption: $< 110,000$ gas per 3-hop trade.

### Phase 3: Infrastructure Tuning (AWS us-east-1)
- [ ] Migrate execution from home machine to a c6i/c7i AWS EC2 instance in `us-east-1`.
- [ ] Connect directly to private builder IP addresses with persistent TCP streams.

### Phase 4: Rust Engine Core Migration (Long-Term Apex)
- [ ] Build a companion Rust daemon using `alloy` and `revm`.
- [ ] Achieve end-to-end event-to-submission latency under **1 millisecond**.
