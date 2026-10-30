import { expect } from "chai";
import { ethers } from "hardhat";

describe("ArbitrageExecutor Contract", function () {
  let executor: any;
  let owner: any;
  let user: any;

  // Mock addresses for testing deployment (checksummed via ethers.getAddress)
  const DUMMY_BALANCER_VAULT = ethers.getAddress("0xba12222222228d8ba53145452315844438464296");
  const DUMMY_AAVE_POOL = ethers.getAddress("0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2");
  const DUMMY_WETH = ethers.getAddress("0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2");

  beforeEach(async function () {
    [owner, user] = await ethers.getSigners();

    const ArbitrageExecutorFactory = await ethers.getContractFactory("ArbitrageExecutor");
    executor = await ArbitrageExecutorFactory.deploy(
      DUMMY_BALANCER_VAULT,
      DUMMY_AAVE_POOL,
      DUMMY_WETH
    );
    await executor.waitForDeployment();
  });

  it("should deploy with correct owner and immutable addresses", async function () {
    expect(await executor.owner()).to.equal(owner.address);
    expect(await executor.balancerVault()).to.equal(DUMMY_BALANCER_VAULT);
    expect(await executor.aavePool()).to.equal(DUMMY_AAVE_POOL);
    expect(await executor.weth()).to.equal(DUMMY_WETH);
  });

  it("should prevent non-owners from initiating flash loans", async function () {
    const dummyParams = {
      borrowedToken: DUMMY_WETH,
      borrowedAmount: ethers.parseEther("1"),
      minProfitExpected: ethers.parseEther("0.01"),
      bribePercentage: 90,
      steps: [],
    };

    // Attempt call as non-owner
    await expect(
      executor.connect(user).executeFlashArbitrage(0, dummyParams)
    ).to.be.revertedWithCustomError(executor, "OwnableUnauthorizedAccount");
  });

  it("should reject callbacks from unauthorized addresses", async function () {
    // Attempt unauthorized Balancer callback
    await expect(
      executor.connect(user).receiveFlashLoan([], [], [], "0x")
    ).to.be.revertedWith("Unauthorized Balancer caller");

    // Attempt unauthorized Aave callback
    await expect(
      executor.connect(user).executeOperation(DUMMY_WETH, 100, 1, user.address, "0x")
    ).to.be.revertedWith("Unauthorized Aave caller");
  });
});
