import { expect } from "chai";
import { ethers } from "ethers";
import {
  simulateTriangularCycle,
  computeOptimalTriangularInput,
  PoolHop,
} from "../src/math/triangularMath";
import { ArbitragePathFinder } from "../src/services/pathFinder";

describe("Triangular Arbitrage Engine & Graph Path Finder", () => {
  it("should calculate zero profit on an equilibrium triangular cycle", () => {
    // 1 WETH = 2000 USDC
    // 1 USDC = 1 DAI
    // 1 DAI = 0.0005 WETH (i.e. 2000 DAI = 1 WETH)
    const hop1: PoolHop = {
      poolAddress: "0x1111111111111111111111111111111111111111",
      reserveIn: ethers.parseEther("1000"), // 1000 WETH
      reserveOut: ethers.parseUnits("2000000", 6), // 2M USDC
    };
    const hop2: PoolHop = {
      poolAddress: "0x2222222222222222222222222222222222222222",
      reserveIn: ethers.parseUnits("2000000", 6), // 2M USDC
      reserveOut: ethers.parseEther("2000000"), // 2M DAI
    };
    const hop3: PoolHop = {
      poolAddress: "0x3333333333333333333333333333333333333333",
      reserveIn: ethers.parseEther("2000000"), // 2M DAI
      reserveOut: ethers.parseEther("1000"), // 1000 WETH
    };

    const opp = computeOptimalTriangularInput(hop1, hop2, hop3);
    expect(opp.optimalInput).to.equal(0n);
    expect(opp.grossProfit).to.equal(0n);
  });

  it("should calculate optimal input and profit when triangular discrepancy occurs", () => {
    // Suppose DAI is undervalued on Hop 2: 1 USDC gets 1.05 DAI instead of 1.00 DAI
    const hop1: PoolHop = {
      poolAddress: "0x1111111111111111111111111111111111111111",
      reserveIn: ethers.parseEther("1000"), // 1000 WETH
      reserveOut: ethers.parseUnits("2000000", 6), // 2M USDC
    };
    const hop2: PoolHop = {
      poolAddress: "0x2222222222222222222222222222222222222222",
      reserveIn: ethers.parseUnits("2000000", 6), // 2M USDC
      reserveOut: ethers.parseEther("2150000"), // 2.15M DAI (7.5% price imbalance)
    };
    const hop3: PoolHop = {
      poolAddress: "0x3333333333333333333333333333333333333333",
      reserveIn: ethers.parseEther("2000000"), // 2M DAI
      reserveOut: ethers.parseEther("1000"), // 1000 WETH
    };

    const opp = computeOptimalTriangularInput(hop1, hop2, hop3);
    expect(opp.optimalInput).to.be.greaterThan(0n);
    expect(opp.grossProfit).to.be.greaterThan(0n);

    console.log(`\n  [Triangular Test] Optimal Input: ${ethers.formatEther(opp.optimalInput)} WETH`);
    console.log(`  [Triangular Test] Expected Gross Profit: ${ethers.formatEther(opp.grossProfit)} WETH`);
  });

  it("should identify triangular cycles through the ArbitragePathFinder graph", () => {
    const finder = new ArbitragePathFinder();

    const WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
    const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
    const DAI = "0x6b175474e89094c44da98b954eedeac495271d0f";

    // Pool 1: Uniswap WETH-USDC
    finder.registerPool({
      poolAddress: "0x1111111111111111111111111111111111111111",
      dexName: "UniswapV2",
      token0: WETH,
      token1: USDC,
      reserve0: ethers.parseEther("1000"),
      reserve1: ethers.parseUnits("2000000", 6),
    });

    // Pool 2: SushiSwap USDC-DAI with imbalance
    finder.registerPool({
      poolAddress: "0x2222222222222222222222222222222222222222",
      dexName: "SushiSwap",
      token0: USDC,
      token1: DAI,
      reserve0: ethers.parseUnits("2000000", 6),
      reserve1: ethers.parseEther("2150000"),
    });

    // Pool 3: Uniswap DAI-WETH
    finder.registerPool({
      poolAddress: "0x3333333333333333333333333333333333333333",
      dexName: "UniswapV2",
      token0: DAI,
      token1: WETH,
      reserve0: ethers.parseEther("2000000"),
      reserve1: ethers.parseEther("1000"),
    });

    const cycle = finder.findBestCycle(WETH);
    expect(cycle).to.not.be.null;
    expect(cycle?.type).to.equal("TRIANGULAR");
    expect(cycle?.hops.length).to.equal(3);
    expect(cycle?.expectedGrossProfit).to.be.greaterThan(0n);
    console.log(`  [PathFinder Test] Discovered Cycle Type: ${cycle?.type}, Hops: ${cycle?.hops.length}`);
  });
});
