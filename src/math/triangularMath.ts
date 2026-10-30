import { getAmountOut } from "./uniswapV2Math";

export interface PoolHop {
  poolAddress: string;
  reserveIn: bigint;
  reserveOut: bigint;
  feeNumerator?: bigint;   // default 997n
  feeDenominator?: bigint; // default 1000n
}

export interface TriangularArbitrageOpportunity {
  optimalInput: bigint;
  finalAmountOut: bigint;
  grossProfit: bigint;
  hop1AmountOut: bigint;
  hop2AmountOut: bigint;
}

/**
 * Simulates a 3-hop cyclic (triangular) swap:
 * Hop 1: Token A -> Token B
 * Hop 2: Token B -> Token C
 * Hop 3: Token C -> Token A
 */
export function simulateTriangularCycle(
  amountIn: bigint,
  hop1: PoolHop,
  hop2: PoolHop,
  hop3: PoolHop
): { finalAmountOut: bigint; hop1Out: bigint; hop2Out: bigint; grossProfit: bigint } {
  if (amountIn <= 0n) {
    return { finalAmountOut: 0n, hop1Out: 0n, hop2Out: 0n, grossProfit: 0n };
  }

  const hop1Out = getAmountOut(
    amountIn,
    hop1.reserveIn,
    hop1.reserveOut,
    hop1.feeNumerator ?? 997n,
    hop1.feeDenominator ?? 1000n
  );
  if (hop1Out <= 0n) return { finalAmountOut: 0n, hop1Out: 0n, hop2Out: 0n, grossProfit: -amountIn };

  const hop2Out = getAmountOut(
    hop1Out,
    hop2.reserveIn,
    hop2.reserveOut,
    hop2.feeNumerator ?? 997n,
    hop2.feeDenominator ?? 1000n
  );
  if (hop2Out <= 0n) return { finalAmountOut: 0n, hop1Out, hop2Out: 0n, grossProfit: -amountIn };

  const finalAmountOut = getAmountOut(
    hop2Out,
    hop3.reserveIn,
    hop3.reserveOut,
    hop3.feeNumerator ?? 997n,
    hop3.feeDenominator ?? 1000n
  );

  const grossProfit = finalAmountOut - amountIn;
  return { finalAmountOut, hop1Out, hop2Out, grossProfit };
}

/**
 * Calculates the optimal input amount for a 3-hop triangular cycle using Ternary Search.
 * Quickly isolates the global profit maximum in ~64 iterations (<0.1ms).
 */
export function computeOptimalTriangularInput(
  hop1: PoolHop,
  hop2: PoolHop,
  hop3: PoolHop,
  maxSearchCap?: bigint
): TriangularArbitrageOpportunity {
  // Check if initial marginal rate > 1.0 (accounting for fees: (997/1000)^3 ~ 0.991)
  // product of exchange rates = (r1Out * r2Out * r3Out * 997^3) / (r1In * r2In * r3In * 1000^3)
  const fee3 = 997n * 997n * 997n;
  const den3 = 1000n * 1000n * 1000n;

  const num = hop1.reserveOut * hop2.reserveOut * hop3.reserveOut * fee3;
  const den = hop1.reserveIn * hop2.reserveIn * hop3.reserveIn * den3;

  if (num <= den) {
    // No arbitrage profit possible on this cycle
    return {
      optimalInput: 0n,
      finalAmountOut: 0n,
      grossProfit: 0n,
      hop1AmountOut: 0n,
      hop2AmountOut: 0n,
    };
  }

  // Bound search between 1 wei and 30% of pool 1 reserve
  let low = 1n;
  let high = maxSearchCap ? maxSearchCap : hop1.reserveIn / 3n;

  if (high <= low) {
    return {
      optimalInput: 0n,
      finalAmountOut: 0n,
      grossProfit: 0n,
      hop1AmountOut: 0n,
      hop2AmountOut: 0n,
    };
  }

  for (let i = 0; i < 64; i++) {
    if (high - low < 3n) break;

    const m1 = low + (high - low) / 3n;
    const m2 = high - (high - low) / 3n;

    const res1 = simulateTriangularCycle(m1, hop1, hop2, hop3);
    const res2 = simulateTriangularCycle(m2, hop1, hop2, hop3);

    if (res1.grossProfit < res2.grossProfit) {
      low = m1;
    } else {
      high = m2;
    }
  }

  const bestInput = (low + high) / 2n;
  const outcome = simulateTriangularCycle(bestInput, hop1, hop2, hop3);

  if (outcome.grossProfit <= 0n) {
    return {
      optimalInput: 0n,
      finalAmountOut: 0n,
      grossProfit: 0n,
      hop1AmountOut: 0n,
      hop2AmountOut: 0n,
    };
  }

  return {
    optimalInput: bestInput,
    finalAmountOut: outcome.finalAmountOut,
    grossProfit: outcome.grossProfit,
    hop1AmountOut: outcome.hop1Out,
    hop2AmountOut: outcome.hop2Out,
  };
}
