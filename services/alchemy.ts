const ALCHEMY_API_KEY = '<your-alchemy-api-key>';

const chainToAlchemyNetwork: Record<string, string> = {
  // Mainnets
  '1': 'eth-mainnet',
  '137': 'polygon-mainnet',
  '42161': 'arb-mainnet',
  '10': 'opt-mainnet',
  '8453': 'base-mainnet',
  // Testnets
  '11155111': 'eth-sepolia',
  '80002': 'polygon-amoy',
  '421614': 'arb-sepolia',
  '84532': 'base-sepolia',
  '11155420': 'opt-sepolia',
};

const chainNativeCoin: Record<string, { symbol: string; decimals: number }> = {
  '1': { symbol: 'ETH', decimals: 18 },
  '137': { symbol: 'POL', decimals: 18 },
  '42161': { symbol: 'ETH', decimals: 18 },
  '10': { symbol: 'ETH', decimals: 18 },
  '8453': { symbol: 'ETH', decimals: 18 },
  '59144': { symbol: 'ETH', decimals: 18 },
  '11155111': { symbol: 'ETH', decimals: 18 },
  '80002': { symbol: 'POL', decimals: 18 },
  '421614': { symbol: 'ETH', decimals: 18 },
  '84532': { symbol: 'ETH', decimals: 18 },
  '11155420': { symbol: 'ETH', decimals: 18 },
};

export const chainNames: Record<string, string> = {
  // Mainnets
  '1': 'Ethereum',
  '137': 'Polygon',
  '42161': 'Arbitrum',
  '10': 'Optimism',
  '8453': 'Base',
  '56': 'BNB Smart Chain',
  '59144': 'Linea',
  // Testnets
  '11155111': 'Sepolia',
  '80002': 'Polygon Amoy',
  '421614': 'Arbitrum Sepolia',
  '84532': 'Base Sepolia',
  '11155420': 'Optimism Sepolia',
};

export interface TokenBalance {
  name: string;
  symbol: string;
  balance: string;
  contractAddress: string | null; // null for native coin
  priceUsd: number | null;
  valueUsd: number | null;
}

export interface ChainBalances {
  chainId: string;
  chainName: string;
  tokens: TokenBalance[];
}

function getAlchemyUrl(chainId: string): string | null {
  const network = chainToAlchemyNetwork[chainId];
  if (!network) return null;
  return `https://${network}.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;
}

function hexToDecimal(hex: string): bigint {
  return BigInt(hex);
}

function formatBalance(rawBalance: bigint, decimals: number): string {
  if (rawBalance === 0n) return '0';

  const divisor = 10n ** BigInt(decimals);
  const whole = rawBalance / divisor;
  const remainder = rawBalance % divisor;

  if (remainder === 0n) return whole.toString();

  const remainderStr = remainder.toString().padStart(decimals, '0');
  // Show up to 6 decimal places, trim trailing zeros
  const trimmed = remainderStr.slice(0, 6).replace(/0+$/, '');
  if (!trimmed) return whole.toString();

  return `${whole}.${trimmed}`;
}

async function alchemyRpc(url: string, method: string, params: any[]): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });

  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Alchemy returned non-JSON response: ${text.slice(0, 200)}`);
  }

  if (json.error) {
    throw new Error(`Alchemy RPC error: ${json.error.message ?? JSON.stringify(json.error)}`);
  }

  return json.result;
}

async function getNativeBalance(url: string, address: string, chainId: string): Promise<TokenBalance> {
  const result = await alchemyRpc(url, 'eth_getBalance', [address, 'latest']);
  const native = chainNativeCoin[chainId] ?? { symbol: 'ETH', decimals: 18 };
  const balance = formatBalance(hexToDecimal(result), native.decimals);

  return {
    name: native.symbol,
    symbol: native.symbol,
    balance,
    contractAddress: null,
    priceUsd: null,
    valueUsd: null,
  };
}

async function getTokenBalances(url: string, address: string): Promise<TokenBalance[]> {
  const result = await alchemyRpc(url, 'alchemy_getTokenBalances', [address, 'erc20']);

  if (!result?.tokenBalances?.length) return [];

  // Filter out zero balances
  const nonZero = result.tokenBalances.filter(
    (t: any) => t.tokenBalance && t.tokenBalance !== '0x0' && t.tokenBalance !== '0x'
  );

  if (!nonZero.length) return [];

  // Fetch metadata for each token
  const tokens = await Promise.all(
    nonZero.map(async (t: any) => {
      try {
        const metadata = await alchemyRpc(url, 'alchemy_getTokenMetadata', [t.contractAddress]);
        const balance = formatBalance(hexToDecimal(t.tokenBalance), metadata.decimals ?? 18);

        return {
          name: metadata.name ?? 'Unknown',
          symbol: metadata.symbol ?? '???',
          balance,
          contractAddress: t.contractAddress,
          priceUsd: null,
          valueUsd: null,
        };
      } catch {
        return null;
      }
    })
  );

  return tokens.filter(Boolean) as TokenBalance[];
}

export async function getBalancesForChain(chainId: string, address: string): Promise<ChainBalances | null> {
  const url = getAlchemyUrl(chainId);
  if (!url) return null;

  const [nativeBalance, tokenBalances] = await Promise.all([
    getNativeBalance(url, address, chainId),
    getTokenBalances(url, address),
  ]);

  // Fetch USD prices from CoinGecko
  const contractAddresses = tokenBalances
    .map((t) => t.contractAddress)
    .filter(Boolean) as string[];

  try {
    const { getPricesForChain } = await import('./coingecko');
    const { nativePrice, tokenPrices } = await getPricesForChain(chainId, contractAddresses);

    if (nativePrice != null) {
      nativeBalance.priceUsd = nativePrice;
      nativeBalance.valueUsd = parseFloat(nativeBalance.balance) * nativePrice;
    }

    for (const token of tokenBalances) {
      if (token.contractAddress) {
        const price = tokenPrices[token.contractAddress.toLowerCase()];
        if (price) {
          token.priceUsd = price;
          token.valueUsd = parseFloat(token.balance) * price;
        }
      }
    }
  } catch (e) {
    console.error('Failed to fetch prices:', e);
  }

  return {
    chainId,
    chainName: chainNames[chainId] ?? chainId,
    tokens: [nativeBalance, ...tokenBalances],
  };
}

export async function getAllBalances(address: string, chainIds: string[]): Promise<ChainBalances[]> {
  const results = await Promise.all(
    chainIds.map((chainId) => getBalancesForChain(chainId, address))
  );

  return results.filter(Boolean) as ChainBalances[];
}
