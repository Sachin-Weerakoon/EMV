import { computeOptimalInputAmount } from "../math/uniswapV2Math";
import { computeOptimalInputClosedForm } from "../math/closedFormMath";
import { computeOptimalTriangularInput, PoolHop } from "../math/triangularMath";

export interface PoolEdge {
  poolAddress: string;
  dexName: string;
  token0: string;
  token1: string;
  reserve0: bigint;
  reserve1: bigint;
}

export interface ArbitrageCycle {
  type: "CROSS_DEX" | "TRIANGULAR";
  borrowToken: string;
  optimalInput: bigint;
  expectedGrossProfit: bigint;
  hops: {
    dex: string;
    poolAddress: string;
    tokenIn: string;
    tokenOut: string;
    amountIn: bigint;
    minAmountOut: bigint;
  }[];
}

export class ArbitragePathFinder {
  private pools: Map<string, PoolEdge> = new Map();
  // token -> list of pool addresses
  private tokenGraph: Map<string, string[]> = new Map();

  public registerPool(edge: PoolEdge) {
    this.pools.set(edge.poolAddress.toLowerCase(), edge);

    const t0 = edge.token0.toLowerCase();
    const t1 = edge.token1.toLowerCase();

    if (!this.tokenGraph.has(t0)) this.tokenGraph.set(t0, []);
    if (!this.tokenGraph.has(t1)) this.tokenGraph.set(t1, []);

    this.tokenGraph.get(t0)!.push(edge.poolAddress.toLowerCase());
    this.tokenGraph.get(t1)!.push(edge.poolAddress.toLowerCase());
  }

  public updateReserves(poolAddress: string, reserve0: bigint, reserve1: bigint) {
    const pool = this.pools.get(poolAddress.toLowerCase());
    if (pool) {
      pool.reserve0 = reserve0;
      pool.reserve1 = reserve1;
    }
  }

  /**
   * Scans for both Cross-DEX (2-hop) and Triangular (3-hop) opportunities starting and ending in baseToken (e.g. WETH).
   */
  public findBestCycle(baseToken: string): ArbitrageCycle | null {
    const base = baseToken.toLowerCase();
    const connectedPools = this.tokenGraph.get(base) || [];
    let bestCycle: ArbitrageCycle | null = null;
    let highestProfit = 0n;

    // 1. Check Cross-DEX 2-hop cycles (Two pools for the same pair TokenA <-> TokenB)
    for (let i = 0; i < connectedPools.length; i++) {
      for (let j = i + 1; j < connectedPools.length; j++) {
        const poolA = this.pools.get(connectedPools[i])!;
        const poolB = this.pools.get(connectedPools[j])!;

        const otherTokenA = poolA.token0.toLowerCase() === base ? poolA.token1.toLowerCase() : poolA.token0.toLowerCase();
        const otherTokenB = poolB.token0.toLowerCase() === base ? poolB.token1.toLowerCase() : poolB.token0.toLowerCase();

        // Same pair on different pools/DEXes
        if (otherTokenA === otherTokenB) {
          const resA = this.getReservesForTrade(poolA, base, otherTokenA);
          const resB = this.getReservesForTrade(poolB, otherTokenA, base);

          if (resA && resB) {
            const result = computeOptimalInputClosedForm(resA.reserveIn, resA.reserveOut, resB.reserveIn, resB.reserveOut);
            if (result.maxProfit > highestProfit) {
              highestProfit = result.maxProfit;
              bestCycle = {
                type: "CROSS_DEX",
                borrowToken: baseToken,
                optimalInput: result.optimalInput,
                expectedGrossProfit: result.maxProfit,
                hops: [
                  {
                    dex: poolA.dexName,
                    poolAddress: poolA.poolAddress,
                    tokenIn: baseToken,
                    tokenOut: otherTokenA,
                    amountIn: result.optimalInput,
                    minAmountOut: 0n,
                  },
                  {
                    dex: poolB.dexName,
                    poolAddress: poolB.poolAddress,
                    tokenIn: otherTokenA,
                    tokenOut: baseToken,
                    amountIn: 0n,
                    minAmountOut: result.optimalInput + result.maxProfit,
                  },
                ],
              };
            }
          }
        }
      }
    }

    // 2. Check 3-Hop Triangular cycles: Base -> TokenB -> TokenC -> Base
    for (const pool1Address of connectedPools) {
      const pool1 = this.pools.get(pool1Address)!;
      const tokenB = pool1.token0.toLowerCase() === base ? pool1.token1.toLowerCase() : pool1.token0.toLowerCase();

      const poolsFromB = this.tokenGraph.get(tokenB) || [];
      for (const pool2Address of poolsFromB) {
        if (pool2Address === pool1Address) continue;
        const pool2 = this.pools.get(pool2Address)!;
        const tokenC = pool2.token0.toLowerCase() === tokenB ? pool2.token1.toLowerCase() : pool2.token0.toLowerCase();
        if (tokenC === base) continue; // That would be a 2-hop

        const poolsFromC = this.tokenGraph.get(tokenC) || [];
        for (const pool3Address of poolsFromC) {
          if (pool3Address === pool2Address || pool3Address === pool1Address) continue;
          const pool3 = this.pools.get(pool3Address)!;
          const endToken = pool3.token0.toLowerCase() === tokenC ? pool3.token1.toLowerCase() : pool3.token0.toLowerCase();

          // Must close the cycle back to Base
          if (endToken === base) {
            const h1Res = this.getReservesForTrade(pool1, base, tokenB);
            const h2Res = this.getReservesForTrade(pool2, tokenB, tokenC);
            const h3Res = this.getReservesForTrade(pool3, tokenC, base);

            if (h1Res && h2Res && h3Res) {
              const hop1: PoolHop = { poolAddress: pool1.poolAddress, reserveIn: h1Res.reserveIn, reserveOut: h1Res.reserveOut };
              const hop2: PoolHop = { poolAddress: pool2.poolAddress, reserveIn: h2Res.reserveIn, reserveOut: h2Res.reserveOut };
              const hop3: PoolHop = { poolAddress: pool3.poolAddress, reserveIn: h3Res.reserveIn, reserveOut: h3Res.reserveOut };

              const triRes = computeOptimalTriangularInput(hop1, hop2, hop3);
              if (triRes.grossProfit > highestProfit) {
                highestProfit = triRes.grossProfit;
                bestCycle = {
                  type: "TRIANGULAR",
                  borrowToken: baseToken,
                  optimalInput: triRes.optimalInput,
                  expectedGrossProfit: triRes.grossProfit,
                  hops: [
                    {
                      dex: pool1.dexName,
                      poolAddress: pool1.poolAddress,
                      tokenIn: baseToken,
                      tokenOut: tokenB,
                      amountIn: triRes.optimalInput,
                      minAmountOut: 0n,
                    },
                    {
                      dex: pool2.dexName,
                      poolAddress: pool2.poolAddress,
                      tokenIn: tokenB,
                      tokenOut: tokenC,
                      amountIn: 0n,
                      minAmountOut: 0n,
                    },
                    {
                      dex: pool3.dexName,
                      poolAddress: pool3.poolAddress,
                      tokenIn: tokenC,
                      tokenOut: baseToken,
                      amountIn: 0n,
                      minAmountOut: triRes.optimalInput + triRes.grossProfit,
                    },
                  ],
                };
              }
            }
          }
        }
      }
    }

    return bestCycle;
  }

  private getReservesForTrade(pool: PoolEdge, tokenIn: string, tokenOut: string) {
    if (pool.reserve0 === 0n || pool.reserve1 === 0n) return null;
    if (pool.token0.toLowerCase() === tokenIn && pool.token1.toLowerCase() === tokenOut) {
      return { reserveIn: pool.reserve0, reserveOut: pool.reserve1 };
    } else if (pool.token1.toLowerCase() === tokenIn && pool.token0.toLowerCase() === tokenOut) {
      return { reserveIn: pool.reserve1, reserveOut: pool.reserve0 };
    }
    return null;
  }
}
