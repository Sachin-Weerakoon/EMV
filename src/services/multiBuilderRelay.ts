import { ethers } from "ethers";
import { FlashbotsBundleProvider } from "@flashbots/ethers-provider-bundle";

export interface BuilderRelayConfig {
  name: string;
  rpcUrl: string;
}

/**
 * Top Ethereum block builders that accept private MEV bundles.
 * Broadcasting to all major builders is crucial to achieve >90% block inclusion coverage.
 */
export const BUILDER_RELAYS: BuilderRelayConfig[] = [
  { name: "Flashbots", rpcUrl: "https://relay.flashbots.net" },
  { name: "BeaverBuild", rpcUrl: "https://rpc.beaverbuild.org" },
  { name: "Titan Builder", rpcUrl: "https://rpc.titanbuilder.xyz" },
  { name: "Builder0x69", rpcUrl: "https://builder0x69.io" },
  { name: "Rsync Builder", rpcUrl: "https://rsync-builder.xyz" },
];

export class MultiBuilderRelayService {
  private standardProvider: ethers.JsonRpcProvider;
  private authSigner: ethers.Wallet | ethers.HDNodeWallet;
  private relayProviders: Map<string, FlashbotsBundleProvider> = new Map();

  constructor(
    standardProvider: ethers.JsonRpcProvider,
    authPrivateKey?: string
  ) {
    this.standardProvider = standardProvider;
    this.authSigner = authPrivateKey
      ? new ethers.Wallet(authPrivateKey)
      : ethers.Wallet.createRandom();
  }

  /**
   * Initializes bundle providers for all supported MEV relays.
   */
  public async initialize() {
    console.log(`[MultiRelay] Initializing ${BUILDER_RELAYS.length} block builder relays...`);

    for (const relay of BUILDER_RELAYS) {
      try {
        const provider = await FlashbotsBundleProvider.create(
          this.standardProvider,
          this.authSigner,
          relay.rpcUrl
        );
        this.relayProviders.set(relay.name, provider);
        console.log(`[MultiRelay] Connected to: ${relay.name} (${relay.rpcUrl})`);
      } catch (err: any) {
        console.warn(`[MultiRelay] Failed to connect to ${relay.name}: ${err?.message || err}`);
      }
    }
  }

  /**
   * Simulates the bundle on Flashbots relay first to confirm zero reverts and estimate miner bribe.
   */
  public async simulateOnFlashbots(signedTransactions: string[], targetBlockNumber: number) {
    const flashbots = this.relayProviders.get("Flashbots");
    if (!flashbots) {
      throw new Error("Flashbots relay not connected for simulation");
    }

    const simulation = await flashbots.simulate(signedTransactions, targetBlockNumber);
    if ("error" in simulation) {
      return { success: false, error: simulation.error.message };
    }

    return {
      success: true,
      gasUsed: simulation.totalGasUsed,
      coinbaseDiff: simulation.coinbaseDiff,
      gasPrice: simulation.bundleGasPrice,
    };
  }

  /**
   * Concurrently broadcasts the bundle to all connected block builders.
   * Uses Promise.allSettled to ensure that one slow or offline relay does not block others.
   */
  public async broadcastBundleToAll(
    signedTransactions: string[],
    targetBlockNumber: number,
    minTimestamp?: number,
    maxTimestamp?: number
  ) {
    console.log(`[MultiRelay] Broadcasting bundle for block ${targetBlockNumber} across ${this.relayProviders.size} relays...`);

    const promises = Array.from(this.relayProviders.entries()).map(async ([name, provider]) => {
      try {
        const response = await provider.sendRawBundle(signedTransactions, targetBlockNumber, {
          minTimestamp,
          maxTimestamp,
        });

        if ("error" in response) {
          return { relay: name, success: false, error: response.error.message };
        }
        return { relay: name, success: true, response };
      } catch (err: any) {
        return { relay: name, success: false, error: err?.message || err };
      }
    });

    const results = await Promise.allSettled(promises);
    const summary = results.map((res, i) => {
      if (res.status === "fulfilled") {
        return res.value;
      } else {
        return { relay: BUILDER_RELAYS[i]?.name || "unknown", success: false, error: res.reason };
      }
    });

    const successCount = summary.filter((s) => s.success).length;
    console.log(`[MultiRelay] Broadcast result: ${successCount}/${this.relayProviders.size} relays accepted the bundle.`);
    return summary;
  }
}
