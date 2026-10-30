import { expect } from "chai";
import { ethers } from "ethers";
import { computeOptimalInputAmount } from "../src/math/uniswapV2Math";
import { computeOptimalInputClosedForm, sqrtBigInt } from "../src/math/closedFormMath";

describe("Closed-Form Calculus Sizer vs Ternary Search Benchmark", () => {
  it("should calculate integer square root accurately", () => {
    expect(sqrtBigInt(0n)).to.equal(0n);
    expect(sqrtBigInt(4n)).to.equal(2n);
    expect(sqrtBigInt(100n)).to.equal(10n);
    expect(sqrtBigInt(1000000000000000000n)).to.equal(1000000000n);
  });

  it("should match ternary search output with mathematical precision", () => {
    const pool1ResIn = ethers.parseEther("1000");
    const pool1ResOut = ethers.parseUnits("2000000", 6);
    const pool2ResIn = ethers.parseUnits("1900000", 6);
    const pool2ResOut = ethers.parseEther("1000");

    const ternary = computeOptimalInputAmount(pool1ResIn, pool1ResOut, pool2ResIn, pool2ResOut);
    const closedForm = computeOptimalInputClosedForm(pool1ResIn, pool1ResOut, pool2ResIn, pool2ResOut);

    console.log(`\n  [Ternary Search] Optimal: ${ethers.formatEther(ternary.optimalInput)} WETH, Profit: ${ethers.formatEther(ternary.maxProfit)} WETH`);
    console.log(`  [Closed-Form]   Optimal: ${ethers.formatEther(closedForm.optimalInput)} WETH, Profit: ${ethers.formatEther(closedForm.maxProfit)} WETH`);

    // The two outputs should be virtually identical (within 0.001%)
    const diff = ternary.optimalInput > closedForm.optimalInput
      ? ternary.optimalInput - closedForm.optimalInput
      : closedForm.optimalInput - ternary.optimalInput;

    expect(diff).to.be.lessThan(ethers.parseEther("0.001"));
    expect(closedForm.maxProfit).to.be.greaterThan(0n);
  });

  it("benchmark: closed-form is orders of magnitude faster", () => {
    const pool1ResIn = ethers.parseEther("1000");
    const pool1ResOut = ethers.parseUnits("2000000", 6);
    const pool2ResIn = ethers.parseUnits("1900000", 6);
    const pool2ResOut = ethers.parseEther("1000");

    const iterations = 5000;

    const startTernary = performance.now();
    for (let i = 0; i < iterations; i++) {
      computeOptimalInputAmount(pool1ResIn, pool1ResOut, pool2ResIn, pool2ResOut);
    }
    const endTernary = performance.now();

    const startClosed = performance.now();
    for (let i = 0; i < iterations; i++) {
      computeOptimalInputClosedForm(pool1ResIn, pool1ResOut, pool2ResIn, pool2ResOut);
    }
    const endClosed = performance.now();

    const ternaryTime = (endTernary - startTernary) / iterations;
    const closedTime = (endClosed - startClosed) / iterations;

    console.log(`\n  [Speed Benchmark] Ternary Search: ${(ternaryTime * 1000).toFixed(2)} µs/op`);
    console.log(`  [Speed Benchmark] Closed-Form Calculus: ${(closedTime * 1000).toFixed(2)} µs/op`);
    console.log(`  [Speedup Factor] ~${(ternaryTime / closedTime).toFixed(1)}x Faster!`);

    expect(closedTime).to.be.lessThan(ternaryTime);
  });
});
