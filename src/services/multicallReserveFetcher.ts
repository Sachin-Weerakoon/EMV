import { ethers } from "ethers";

// Canonical Multicall3 address deployed across Ethereum Mainnet, Arbitrum, Optimism, Base, and Polygon
export const MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11";

const MULTICALL3_ABI = [
  "function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) payable returns (tuple(bool success, bytes returnData)[] returnData)",
];

const PAIR_GET_RESERVES_ABI = [
  "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
];

export interface PoolBatchResult {
  poolAddress: string;
  success: boolean;
  reserve0: bigint;
  reserve1: bigint;
  blockTimestampLast: number;
}

export class MulticallReserveFetcher {
  private multicallContract: ethers.Contract;
  private pairInterface: ethers.Interface;

  constructor(provider: ethers.Provider, multicallAddress = MULTICALL3_ADDRESS) {
    this.multicallContract = new ethers.Contract(multicallAddress, MULTICALL3_ABI, provider);
    this.pairInterface = new ethers.Interface(PAIR_GET_RESERVES_ABI);
  }

  /**
   * Fetches reserves for tens or hundreds of pools simultaneously in a single RPC round-trip (< 20ms).
   */
  public async fetchReservesBatch(poolAddresses: string[]): Promise<PoolBatchResult[]> {
    if (poolAddresses.length === 0) return [];

    const callData = this.pairInterface.encodeFunctionData("getReserves");

    const calls = poolAddresses.map((address) => ({
      target: address,
      allowFailure: true,
      callData: callData,
    }));

    const results = await this.multicallContract.aggregate3.staticCall(calls);

    return results.map((res: { success: boolean; returnData: string }, index: number) => {
      const poolAddress = poolAddresses[index];
      if (!res.success || res.returnData === "0x") {
        return {
          poolAddress,
          success: false,
          reserve0: 0n,
          reserve1: 0n,
          blockTimestampLast: 0,
        };
      }

      try {
        const decoded = this.pairInterface.decodeFunctionResult("getReserves", res.returnData);
        return {
          poolAddress,
          success: true,
          reserve0: decoded.reserve0,
          reserve1: decoded.reserve1,
          blockTimestampLast: Number(decoded.blockTimestampLast),
        };
      } catch {
        return {
          poolAddress,
          success: false,
          reserve0: 0n,
          reserve1: 0n,
          blockTimestampLast: 0,
        };
      }
    });
  }
}
