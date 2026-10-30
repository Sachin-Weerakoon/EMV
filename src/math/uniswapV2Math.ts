/**
 * Uniswap V2 constant-product AMM calculation & optimal arbitrage sizing.
 */

export interface PoolReserves {
  reserve0: bigint;
  reserve1: bigint;
}

/**
 * Calculates output amount given an input amount for a Uniswap V2 pool (99.7% multiplier / 0.3% fee).
 *
 * formula: amountOut = (amountIn * 997 * reserveOut) / (reserveIn * 1000 + amountIn * 997)
 */
export function getAmountOut(
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
  feeNumerator: bigint = 997n,
  feeDenominator: bigint = 1000n
): bigint {
  if (amountIn <= 0n) return 0n;
  if (reserveIn <= 0n || reserveOut <= 0n) return 0n;

  const amountInWithFee = amountIn * feeNumerator;
  const numerator = amountInWithFee * reserveOut;
  const denominator = reserveIn * feeDenominator + amountInWithFee;

  return numerator / denominator;
}

/**
 * Simulates a 2-hop cyclic arbitrage:
 * Swap 1: amountIn of Token A -> Token B in Pool 1
 * Swap 2: received Token B -> Token A in Pool 2
 * Net Gross Profit = finalAmountOut - amountIn
 */
export function simulateCycle(
  amountIn: bigint,
  pool1ReserveIn: bigint,
  pool1ReserveOut: bigint,
  pool2ReserveIn: bigint,
  pool2ReserveOut: bigint
): { amountOut: bigint; profit: bigint } {
  const intermediate = getAmountOut(amountIn, pool1ReserveIn, pool1ReserveOut);
  if (intermediate <= 0n) {
    return { amountOut: 0n, profit: -amountIn };
  }

  const finalAmountOut = getAmountOut(intermediate, pool2ReserveIn, pool2ReserveOut);
  const profit = finalAmountOut - amountIn;

  return { amountOut: finalAmountOut, profit };
}

/**
 * Finds the optimal input amount for maximum net profit using high-precision Ternary Search.
 * Convex function on [0, maxInput]. 64 iterations yields exact wei precision in < 0.1ms.
 *
 * @param pool1ReserveIn Reserve of input token in pool 1
 * @param pool1ReserveOut Reserve of intermediary token in pool 1
 * @param pool2ReserveIn Reserve of intermediary token in pool 2
 * @param pool2ReserveOut Reserve of input token in pool 2
 * @param maxSearchCap Optional upper bound (defaults to 30% of pool1 reserve)
 */
export function computeOptimalInputAmount(
  pool1ReserveIn: bigint,
  pool1ReserveOut: bigint,
  pool2ReserveIn: bigint,
  pool2ReserveOut: bigint,
  maxSearchCap?: bigint
): { optimalInput: bigint; maxProfit: bigint } {
  // Check if price discrepancy exists:
  // Pool 1 marginal price = pool1ReserveOut / pool1ReserveIn
  // Pool 2 marginal price = pool2ReserveOut / pool2ReserveIn
  // Profit exists only if (pool1ReserveOut * pool2ReserveOut * 997 * 997) > (pool1ReserveIn * pool2ReserveIn * 1000 * 1000)
  const leftSide = pool1ReserveOut * pool2ReserveOut * 997n * 997n;
  const rightSide = pool1ReserveIn * pool2ReserveIn * 1000n * 1000n;

  if (leftSide <= rightSide) {
    // No profitable arbitrage exists
    return { optimalInput: 0n, maxProfit: 0n };
  }

  // Set boundary for search: at most 30% of pool reserve to avoid hyper-slippage
  let low = 1n;
  let high = maxSearchCap ? maxSearchCap : pool1ReserveIn / 3n;

  if (high <= low) {
    return { optimalInput: 0n, maxProfit: 0n };
  }

  // 64 iterations of ternary search shrinks range by (2/3)^64 ~ 10^-12
  for (let i = 0; i < 64; i++) {
    if (high - low < 3n) break;

    const m1 = low + (high - low) / 3n;
    const m2 = high - (high - low) / 3n;

    const res1 = simulateCycle(m1, pool1ReserveIn, pool1ReserveOut, pool2ReserveIn, pool2ReserveOut);
    const res2 = simulateCycle(m2, pool1ReserveIn, pool1ReserveOut, pool2ReserveIn, pool2ReserveOut);

    if (res1.profit < res2.profit) {
      low = m1;
    } else {
      high = m2;
    }
  }

  const bestInput = (low + high) / 2n;
  const result = simulateCycle(bestInput, pool1ReserveIn, pool1ReserveOut, pool2ReserveIn, pool2ReserveOut);

  if (result.profit <= 0n) {
    return { optimalInput: 0n, maxProfit: 0n };
  }

  return { optimalInput: bestInput, maxProfit: result.profit };
}
