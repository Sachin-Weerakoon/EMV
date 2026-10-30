import { ethers } from "hardhat";
import { MAINNET_ADDRESSES } from "../src/config/addresses";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`[Deploy] Deploying ArbitrageExecutor with account: ${deployer.address}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`[Deploy] Account balance: ${ethers.formatEther(balance)} ETH`);

  const ArbitrageExecutor = await ethers.getContractFactory("ArbitrageExecutor");
  const executor = await ArbitrageExecutor.deploy(
    MAINNET_ADDRESSES.BALANCER_VAULT,
    MAINNET_ADDRESSES.AAVE_V3_POOL,
    MAINNET_ADDRESSES.WETH
  );

  await executor.waitForDeployment();
  const address = await executor.getAddress();

  console.log(`=======================================================`);
  console.log(`ArbitrageExecutor deployed successfully!`);
  console.log(`Contract Address: ${address}`);
  console.log(`Set EXECUTOR_CONTRACT_ADDRESS in your .env file.`);
  console.log(`=======================================================`);
}

main().catch((error) => {
  console.error("Deployment failed:", error);
  process.exitCode = 1;
});
