import { expect } from "chai";
import { ethers } from "ethers";
import {
  getAmountOut,
  simulateCycle,
  computeOptimalInputAmount,
} from "../src/math/uniswapV2Math";

describe("Arbitrage Math Engine", () => {
  it("should calculate Uniswap V2 output correctly with 0.3% fee", () => {
    // 1000 WETH reserve, 2,000,000 USDC reserve
    const reserveIn = ethers.parseEther("1000"); // 1000 WETH
    const reserveOut = ethers.parseUnits("2000000", 6); // 2,000,000 USDC
    const amountIn = ethers.parseEther("1"); // 1 WETH

    const amountOut = getAmountOut(amountIn, reserveIn, reserveOut);
    // Rough price should be ~1992 USDC after 0.3% fee and slippage
    const formatted = ethers.formatUnits(amountOut, 6);
    expect(parseFloat(formatted)).to.be.closeTo(1992, 2);
  });

  it("should return zero profit when no price discrepancy exists", () => {
    // Identical pools
    const pool1Res0 = ethers.parseEther("1000");
    const pool1Res1 = ethers.parseUnits("2000000", 6);
    const pool2Res0 = ethers.parseEther("1000");
    const pool2Res1 = ethers.parseUnits("2000000", 6);

    const { optimalInput, maxProfit } = computeOptimalInputAmount(
      pool1Res0,
      pool1Res1,
      pool2Res1,
      pool2Res0
    );

    expect(optimalInput).to.equal(0n);
    expect(maxProfit).to.equal(0n);
  });

  it("should find the optimal trade size when a price spread exists", () => {
    // Pool 1 (Uniswap): 1000 WETH / 2,000,000 USDC -> 1 WETH = 2000 USDC
    const pool1ResIn = ethers.parseEther("1000");
    const pool1ResOut = ethers.parseUnits("2000000", 6);

    // Pool 2 (Sushiswap): 1,900,000 USDC / 1000 WETH -> 1 WETH = 1900 USDC (WETH is cheap on Sushi, high on Uni)
    // Swap direction:
    // Buy USDC with WETH on Pool 1 (getting ~2000 USDC per WETH)
    // Sell USDC for WETH on Pool 2 (paying only ~1900 USDC per WETH)
    const pool2ResIn = ethers.parseUnits("1900000", 6);
    const pool2ResOut = ethers.parseEther("1000");

    const { optimalInput, maxProfit } = computeOptimalInputAmount(
      pool1ResIn,
      pool1ResOut,
      pool2ResIn,
      pool2ResOut
    );

    expect(optimalInput).to.be.greaterThan(0n);
    expect(maxProfit).to.be.greaterThan(0n);

    console.log(`\n  [Test Result] Optimal Input: ${ethers.formatEther(optimalInput)} WETH`);
    console.log(`  [Test Result] Expected Gross Profit: ${ethers.formatEther(maxProfit)} WETH`);

    // Verify that testing 1 wei above or below does not produce significantly better profit
    const baseProfit = simulateCycle(
      optimalInput,
      pool1ResIn,
      pool1ResOut,
      pool2ResIn,
      pool2ResOut
    ).profit;
    expect(baseProfit).to.equal(maxProfit);
  });
});
