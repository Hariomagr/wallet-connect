const COINGECKO_API_KEY = '<your-coingecko-api-key>';
const BASE_URL = 'https://api.coingecko.com/api/v3';

// Map chain IDs to CoinGecko asset platform IDs
const chainToPlatform: Record<string, string> = {
  '1': 'ethereum',
  '137': 'polygon-pos',
  '42161': 'arbitrum-one',
  '10': 'optimistic-ethereum',
  '8453': 'base',
  '56': 'binance-smart-chain',
  '59144': 'linea',
};

// Map native coin symbols to CoinGecko IDs
const nativeCoinIds: Record<string, string> = {
  '1': 'ethereum',
  '137': 'matic-network',
  '42161': 'ethereum',
  '10': 'ethereum',
  '8453': 'ethereum',
  '56': 'binancecoin',
  '59144': 'ethereum',
  // Testnets use mainnet prices for display purposes
  '11155111': 'ethereum',
  '80002': 'matic-network',
  '421614': 'ethereum',
  '84532': 'ethereum',
  '11155420': 'ethereum',
};

async function fetchCoinGecko(endpoint: string): Promise<any> {
  const url = `${BASE_URL}${endpoint}`;
  const res = await fetch(url, {
    headers: {
      'x-cg-demo-api-key': COINGECKO_API_KEY,
    },
  });

  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`CoinGecko returned non-JSON: ${text.slice(0, 200)}`);
  }
}

export async function getNativePrice(chainId: string): Promise<number | null> {
  const coinId = nativeCoinIds[chainId];
  if (!coinId) return null;

  try {
    const data = await fetchCoinGecko(`/simple/price?ids=${coinId}&vs_currencies=usd`);
    return data[coinId]?.usd ?? null;
  } catch (e) {
    console.error('Failed to fetch native price:', e);
    return null;
  }
}

export async function getTokenPrices(
  chainId: string,
  contractAddresses: string[],
): Promise<Record<string, number>> {
  if (!contractAddresses.length) return {};

  const platform = chainToPlatform[chainId];
  if (!platform) return {};

  try {
    const addresses = contractAddresses.join(',');
    const data = await fetchCoinGecko(
      `/simple/token_price/${platform}?contract_addresses=${addresses}&vs_currencies=usd`,
    );

    const prices: Record<string, number> = {};
    for (const [address, priceData] of Object.entries(data)) {
      prices[address.toLowerCase()] = (priceData as any)?.usd ?? 0;
    }
    return prices;
  } catch (e) {
    console.error('Failed to fetch token prices:', e);
    return {};
  }
}

export async function getPricesForChain(
  chainId: string,
  contractAddresses: string[],
): Promise<{ nativePrice: number | null; tokenPrices: Record<string, number> }> {
  const [nativePrice, tokenPrices] = await Promise.all([
    getNativePrice(chainId),
    getTokenPrices(chainId, contractAddresses),
  ]);

  return { nativePrice, tokenPrices };
}
