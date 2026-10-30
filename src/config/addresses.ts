import { ethers } from "ethers";

export interface NetworkAddresses {
  BALANCER_VAULT: string;
  AAVE_V3_POOL: string;
  WETH: string;
  UNISWAP_V2_ROUTER: string;
  UNISWAP_V2_FACTORY: string;
  SUSHISWAP_ROUTER: string;
  SUSHISWAP_FACTORY: string;
  UNISWAP_V3_ROUTER: string;
  UNISWAP_V3_FACTORY: string;
}

export const MAINNET_ADDRESSES: NetworkAddresses = {
  // Flash Loan Providers
  BALANCER_VAULT: ethers.getAddress("0xba12222222228d8ba53145452315844438464296"),
  AAVE_V3_POOL: ethers.getAddress("0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2"),

  // Core Tokens
  WETH: ethers.getAddress("0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"),

  // Decentralized Exchanges
  UNISWAP_V2_ROUTER: ethers.getAddress("0x7a250d5630b4cf539739df2c5dacb4c659f2488d"),
  UNISWAP_V2_FACTORY: ethers.getAddress("0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f"),
  SUSHISWAP_ROUTER: ethers.getAddress("0xd9e1ce17f2641f24ae83637ab66a2cca9c378b9f"),
  SUSHISWAP_FACTORY: ethers.getAddress("0xc0aee478e3658e2610c5f7a4a2e1777ce9e4f2ac"),
  UNISWAP_V3_ROUTER: ethers.getAddress("0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45"),
  UNISWAP_V3_FACTORY: ethers.getAddress("0x1f98431c8ad98523631ae4a59f267346ea31f984"),
};

export const CORE_TOKENS = {
  WETH: {
    address: ethers.getAddress("0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"),
    decimals: 18,
    symbol: "WETH",
  },
  USDC: {
    address: ethers.getAddress("0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"),
    decimals: 6,
    symbol: "USDC",
  },
  USDT: {
    address: ethers.getAddress("0xdac17f958d2ee523a2206206994597c13d831ec7"),
    decimals: 6,
    symbol: "USDT",
  },
  DAI: {
    address: ethers.getAddress("0x6b175474e89094c44da98b954eedeac495271d0f"),
    decimals: 18,
    symbol: "DAI",
  },
  WBTC: {
    address: ethers.getAddress("0x2260fac5e5542a773aa44fbcfedf7c193bc2c599"),
    decimals: 8,
    symbol: "WBTC",
  },
};
