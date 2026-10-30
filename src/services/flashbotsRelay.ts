import { ethers } from "ethers";
import { FlashbotsBundleProvider } from "@flashbots/ethers-provider-bundle";

export interface BundleSubmissionParams {
  signedTransactions: string[];
  targetBlockNumber: number;
  minTimestamp?: number;
  maxTimestamp?: number;
}

export class FlashbotsRelayService {
  private flashbotsProvider?: FlashbotsBundleProvider;
  private authSigner: ethers.Wallet | ethers.HDNodeWallet;
  private connectionPromise?: Promise<void>;

  constructor(authPrivateKey?: string) {
    // Dedicated reputation identity key for Flashbots header signatures
    this.authSigner = authPrivateKey
      ? new ethers.Wallet(authPrivateKey)
      : ethers.Wallet.createRandom();
  }

  /**
   * Initializes connection with Flashbots Relay RPC.
   */
  public async initialize(standardProvider: ethers.JsonRpcProvider) {
    if (!this.connectionPromise) {
      this.connectionPromise = (async () => {
        console.log(`[Flashbots] Initializing Flashbots relay provider with auth signer: ${this.authSigner.address}`);
        this.flashbotsProvider = await FlashbotsBundleProvider.create(
          standardProvider,
          this.authSigner,
          "https://relay.flashbots.net"
        );
      })();
    }
    await this.connectionPromise;
  }

  /**
   * Simulates a transaction bundle against the target block to verify profitability and gas consumption.
   */
  public async simulateBundle(signedTransactions: string[], targetBlockNumber: number) {
    if (!this.flashbotsProvider) {
      throw new Error("Flashbots provider is not initialized");
    }

    console.log(`[Flashbots] Simulating bundle for target block ${targetBlockNumber}...`);
    const simulation = await this.flashbotsProvider.simulate(
      signedTransactions,
      targetBlockNumber
    );

    if ("error" in simulation) {
      console.warn(`[Flashbots] Simulation error: ${simulation.error.message}`);
      return { success: false, error: simulation.error.message };
    }

    console.log(`[Flashbots] Simulation succeeded. Gas used: ${simulation.totalGasUsed}, Miner bribe: ${simulation.coinbaseDiff} wei`);
    return {
      success: true,
      gasUsed: simulation.totalGasUsed,
      coinbaseDiff: simulation.coinbaseDiff,
      gasPrice: simulation.bundleGasPrice,
    };
  }

  /**
   * Submits bundle privately to block builders. Never reveals tx to public mempool.
   */
  public async submitBundle(params: BundleSubmissionParams) {
    if (!this.flashbotsProvider) {
      throw new Error("Flashbots provider is not initialized");
    }

    const bundleSubmission = await this.flashbotsProvider.sendRawBundle(
      params.signedTransactions,
      params.targetBlockNumber,
      {
        minTimestamp: params.minTimestamp,
        maxTimestamp: params.maxTimestamp,
      }
    );

    if ("error" in bundleSubmission) {
      console.error(`[Flashbots] Submission error: ${bundleSubmission.error.message}`);
      return { success: false, error: bundleSubmission.error.message };
    }

    console.log(`[Flashbots] Bundle submitted for block ${params.targetBlockNumber}. Waiting for resolution...`);
    const waitResponse = await bundleSubmission.wait();
    return { success: true, waitResponse };
  }
}
