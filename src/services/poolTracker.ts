import { ethers } from "ethers";
import { computeOptimalInputAmount } from "../math/uniswapV2Math";

export interface TrackedPair {
  name: string;
  token0: string;
  token1: string;
  symbol0: string;
  symbol1: string;
  dexA: {
    name: string;
    pairAddress: string;
    reserve0: bigint;
    reserve1: bigint;
  };
  dexB: {
    name: string;
    pairAddress: string;
    reserve0: bigint;
    reserve1: bigint;
  };
}

const UNISWAP_V2_PAIR_ABI = [
  "event Sync(uint112 reserve0, uint112 reserve1)",
  "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function token0() external view returns (address)",
  "function token1() external view returns (address)"
];

export class PoolTracker {
  private provider: ethers.Provider;
  private pairs: Map<string, TrackedPair> = new Map();
  private onOpportunityCallback?: (opp: any) => Promise<void>;

  constructor(provider: ethers.Provider) {
    this.provider = provider;
  }

  public registerPair(pair: TrackedPair) {
    this.pairs.set(pair.name, pair);
  }

  public onOpportunity(cb: (opp: any) => Promise<void>) {
    this.onOpportunityCallback = cb;
  }

  /**
   * Initializes WebSocket event listeners for fast low-latency reserve updates.
   */
  public async startListening() {
    console.log(`[PoolTracker] Starting listening on ${this.pairs.size} tracked pair sets...`);

    for (const [pairName, pair] of this.pairs) {
      this.subscribePair(pair.dexA.pairAddress, pairName, "dexA");
      this.subscribePair(pair.dexB.pairAddress, pairName, "dexB");
    }
  }

  private subscribePair(address: string, pairName: string, dexKey: "dexA" | "dexB") {
    const contract = new ethers.Contract(address, UNISWAP_V2_PAIR_ABI, this.provider);

    contract.on("Sync", async (reserve0: bigint, reserve1: bigint) => {
      const pair = this.pairs.get(pairName);
      if (!pair) return;

      pair[dexKey].reserve0 = reserve0;
      pair[dexKey].reserve1 = reserve1;

      await this.evaluateArbitrage(pair);
    });
  }

  /**
   * Evaluates arbitrage across both directions:
   * Direction 1: Buy on Dex A (Token0 -> Token1), Sell on Dex B (Token1 -> Token0)
   * Direction 2: Buy on Dex B (Token0 -> Token1), Sell on Dex A (Token1 -> Token0)
   */
  public async evaluateArbitrage(pair: TrackedPair) {
    const { dexA, dexB } = pair;
    if (dexA.reserve0 === 0n || dexB.reserve0 === 0n) return;

    // Direction 1: Borrow Token0 -> Swap on DexA for Token1 -> Swap on DexB for Token0
    const dir1 = computeOptimalInputAmount(
      dexA.reserve0,
      dexA.reserve1,
      dexB.reserve1,
      dexB.reserve0
    );

    // Direction 2: Borrow Token0 -> Swap on DexB for Token1 -> Swap on DexA for Token0
    const dir2 = computeOptimalInputAmount(
      dexB.reserve0,
      dexB.reserve1,
      dexA.reserve1,
      dexA.reserve0
    );

    let chosenOpp: any = null;

    if (dir1.maxProfit > 0n && dir1.maxProfit >= dir2.maxProfit) {
      chosenOpp = {
        pairName: pair.name,
        borrowToken: pair.token0,
        borrowSymbol: pair.symbol0,
        optimalInput: dir1.optimalInput,
        expectedGrossProfit: dir1.maxProfit,
        buyDex: dexA.name,
        sellDex: dexB.name,
        buyPairAddress: dexA.pairAddress,
        sellPairAddress: dexB.pairAddress,
      };
    } else if (dir2.maxProfit > 0n) {
      chosenOpp = {
        pairName: pair.name,
        borrowToken: pair.token0,
        borrowSymbol: pair.symbol0,
        optimalInput: dir2.optimalInput,
        expectedGrossProfit: dir2.maxProfit,
        buyDex: dexB.name,
        sellDex: dexA.name,
        buyPairAddress: dexB.pairAddress,
        sellPairAddress: dexA.pairAddress,
      };
    }

    if (chosenOpp && this.onOpportunityCallback) {
      await this.onOpportunityCallback(chosenOpp);
    }
  }
}
