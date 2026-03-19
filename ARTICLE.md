# Building a Multi-Chain Crypto Wallet App with React Native

A complete guide to building a mobile wallet app that connects to MetaMask, fetches balances across multiple EVM chains, shows live market prices, and sends transactions — all from a React Native app.

---

## What We Built

A React Native (Expo) mobile app that:

1. **Connects to MetaMask** via WalletConnect protocol
2. **Displays connected accounts** across multiple EVM chains
3. **Fetches token balances** (native + ERC-20) using Alchemy
4. **Shows live USD prices** using CoinGecko
5. **Sends ETH transactions** that get signed by MetaMask

---

## The Tech Stack

| Library | Purpose | Why This One |
|---------|---------|--------------|
| **Expo (v54)** | React Native framework | Managed workflow, easy native module support via dev client |
| **Reown AppKit** (`@reown/appkit-react-native`) | WalletConnect integration | Official SDK for connecting mobile dApps to wallets like MetaMask |
| **Ethers Adapter** (`@reown/appkit-ethers-react-native`) | Ethereum provider | Bridges WalletConnect to the Ethers.js ecosystem |
| **MMKV** (`react-native-mmkv`) | Fast key-value storage | Required by AppKit for persisting session state. Way faster than AsyncStorage |
| **Alchemy API** | Blockchain data indexer | Fetches balances and token metadata without running our own node |
| **CoinGecko API** | Market price data | Free tier provides real-time USD prices for tokens |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│                   React Native App              │
│                                                 │
│  ┌───────────┐  ┌───────────┐  ┌─────────────┐ │
│  │  AppKit   │  │  Alchemy  │  │  CoinGecko  │ │
│  │  Provider │  │  Service  │  │  Service    │ │
│  └─────┬─────┘  └─────┬─────┘  └──────┬──────┘ │
│        │              │               │         │
└────────┼──────────────┼───────────────┼─────────┘
         │              │               │
    WalletConnect    JSON-RPC        REST API
    Protocol         over HTTPS      over HTTPS
         │              │               │
    ┌────▼────┐   ┌─────▼─────┐  ┌─────▼──────┐
    │MetaMask │   │  Alchemy  │  │ CoinGecko  │
    │ (Wallet)│   │  Nodes    │  │  Servers   │
    └─────────┘   └─────┬─────┘  └────────────┘
                        │
                   ┌────▼────┐
                   │Blockchain│
                   │ (EVM)    │
                   └──────────┘
```

---

## Part 1: WalletConnect Setup

### What is WalletConnect?

WalletConnect is an open protocol that lets your app communicate with crypto wallets (MetaMask, Trust Wallet, Rainbow, etc.) without ever touching the user's private keys. It works like this:

1. Your app creates a session request
2. The user scans a QR code or gets redirected to their wallet app
3. The wallet approves the connection
4. Now your app can request signatures and transactions through an encrypted relay

Your app never sees the private key. It sends *requests*, and the wallet *approves or rejects* them.

### Setting Up AppKit

AppKit (by Reown, formerly WalletConnect Inc.) provides the React Native SDK. Here's what each piece does:

#### The Config File (`config/appkit.ts`)

```typescript
import '@walletconnect/react-native-compat';  // Must be first — polyfills for RN

import { EthersAdapter } from '@reown/appkit-ethers-react-native';
import { createAppKit } from '@reown/appkit-react-native';
import { createMMKV } from 'react-native-mmkv';
```

**`@walletconnect/react-native-compat`** — This import MUST come before anything else. It patches React Native's environment to support WalletConnect's WebSocket connections, crypto operations, and URL handling that exist in browsers but not in React Native.

**`EthersAdapter`** — Bridges WalletConnect to the Ethers.js interface. This is what lets you call `provider.request()` to interact with the blockchain. Without an adapter, AppKit doesn't know how to talk to EVM chains.

**`createMMKV`** — AppKit requires a storage implementation to persist:
- The active WalletConnect session (so you don't re-connect on every app open)
- Recently used wallets
- User preferences

We use MMKV because it's synchronous and ~30x faster than AsyncStorage. AppKit's `Storage` interface requires 5 methods:

```typescript
const storage = {
  getKeys: async () => mmkv.getAllKeys(),
  getEntries: async () => /* all key-value pairs */,
  getItem: async (key) => /* get one value */,
  setItem: async (key, value) => /* store a value */,
  removeItem: async (key) => /* delete a value */,
};
```

#### Defining Chains

Each EVM chain is defined as an object:

```typescript
const sepolia = {
  id: 11155111,              // Unique chain ID
  name: 'Sepolia',           // Human-readable name
  nativeCurrency: {
    name: 'Sepolia ETH',
    symbol: 'ETH',
    decimals: 18              // 1 ETH = 10^18 wei
  },
  rpcUrls: {
    default: { http: ['https://rpc.sepolia.org'] }  // Public RPC endpoint
  },
  blockExplorers: {
    default: { name: 'Etherscan', url: 'https://sepolia.etherscan.io' }
  },
  testnet: true,
};
```

**What is a Chain ID?** Every EVM network has a unique integer ID. Ethereum mainnet is `1`, Polygon is `137`, Sepolia testnet is `11155111`. This prevents transactions meant for one chain from being replayed on another.

**What is an RPC URL?** RPC (Remote Procedure Call) is how you talk to blockchain nodes. Your app sends JSON-RPC requests (like `eth_getBalance`) to this URL, and the node responds with blockchain data. Public RPCs are free but rate-limited.

**What does `decimals: 18` mean?** Blockchains don't have floating point numbers. Instead, ETH is stored as an integer in its smallest unit called "wei". 1 ETH = 1,000,000,000,000,000,000 wei (10^18). When you see a balance of `0x4563918244F40000` from the blockchain, you divide by 10^18 to get `5.0 ETH`.

#### The `createAppKit` Call

```typescript
export const appKit = createAppKit({
  projectId,        // From cloud.reown.com — identifies your app
  storage,          // MMKV storage implementation
  networks: [...],  // Which chains to support
  defaultNetwork,   // Which chain to connect to by default
  adapters: [ethersAdapter],  // How to talk to the blockchain
  metadata: {
    name: 'Wallet Connect',
    description: 'Wallet Connect Demo App',
    url: 'https://walletconnect.com',
    icons: ['https://...'],
    redirect: {
      native: 'walletconnect://',  // Deep link scheme for wallet redirect
    },
  },
});
```

The `redirect.native` field matches the `scheme` in `app.json`. When MetaMask finishes approving a transaction, it uses this URL scheme to bounce the user back to your app.

### Wrapping the App (`app/_layout.tsx`)

```tsx
<AppKitProvider instance={appKit}>
  {/* Your app content */}
  <AppKit />  {/* The modal UI component */}
</AppKitProvider>
```

**`AppKitProvider`** — React context provider that makes the AppKit instance available to all child components via hooks like `useAppKit()`, `useAccount()`, `useProvider()`.

**`<AppKit />`** — Renders the connection modal UI (wallet list, QR code, loading states). It's placed outside your navigation stack so it overlays everything. On Expo Router with Android, it sometimes needs an absolute-positioned wrapper.

### The Hooks

```typescript
const { open, disconnect, switchNetwork } = useAppKit();
const { isConnected, allAccounts } = useAccount();
const { provider } = useProvider();
```

- **`open()`** — Opens the WalletConnect modal showing available wallets
- **`disconnect()`** — Ends the WalletConnect session
- **`switchNetwork('eip155:11155111')`** — Tells both app and wallet to switch to a specific chain
- **`isConnected`** — Boolean, whether a wallet is currently connected
- **`allAccounts`** — Array of all accounts the wallet shared. Each has `address`, `chainId`, `namespace`
- **`provider`** — The WalletConnect provider for sending requests to the wallet

---

## Part 2: EVM Chains Explained

### What is EVM?

EVM (Ethereum Virtual Machine) is the runtime environment that executes smart contracts. Chains that implement EVM are "EVM-compatible" — they run the same code, use the same address format, and speak the same RPC protocol.

### EVM vs Non-EVM

| EVM Chains | Non-EVM Chains |
|-----------|---------------|
| Ethereum, Polygon, Arbitrum, Optimism, Base, BNB Chain, Linea | Bitcoin, Solana, Tron |
| Same address format (`0x...`) | Different address formats |
| Same RPC methods (`eth_*`) | Different protocols |
| One adapter handles all | Each needs its own adapter |

This is why one EVM address works on all EVM chains — the address is derived from your private key using the same algorithm everywhere. If your MetaMask address is `0xABC...` on Ethereum, it's the same `0xABC...` on Polygon, Arbitrum, etc.

### Mainnets vs Testnets

| Mainnet | Testnet |
|---------|---------|
| Real money | Fake money (free from faucets) |
| Ethereum (Chain ID: 1) | Sepolia (Chain ID: 11155111) |
| Polygon (Chain ID: 137) | Polygon Amoy (Chain ID: 80002) |

Testnets mirror mainnet functionality but with valueless tokens, perfect for development.

---

## Part 3: Fetching Balances with Alchemy

### Why Alchemy? Why Not Call the Blockchain Directly?

You *can* call `eth_getBalance` on a public RPC to get a native coin balance. But to find *all tokens* a wallet holds, you'd need to:

1. Know every token contract address on that chain (thousands)
2. Call `balanceOf()` on each one
3. Filter out zeros

That's thousands of RPC calls per wallet per chain. Alchemy solves this by running **indexer nodes** that:

1. Process every block and transaction
2. Parse all `Transfer` event logs from ERC-20 contracts
3. Build a pre-computed database of who holds what
4. Expose it via one API call: `alchemy_getTokenBalances`

### What is ERC-20?

ERC-20 is a standard interface for fungible tokens on EVM chains. Any token (USDT, USDC, UNI, LINK, etc.) implements these functions:

```solidity
function balanceOf(address owner) → uint256    // How many tokens this address holds
function transfer(address to, uint256 amount)  // Send tokens
function symbol() → string                     // "USDT"
function decimals() → uint8                    // Usually 18 or 6
```

Native coins (ETH, POL, BNB) are NOT ERC-20 — they're built into the chain protocol itself. That's why we need separate calls for native vs token balances.

### How Our Alchemy Service Works

#### Step 1: Get Native Balance

```typescript
const result = await alchemyRpc(url, 'eth_getBalance', [address, 'latest']);
```

This is a standard JSON-RPC call. The blockchain returns a hex string like `0x4563918244F40000`. We convert it:

```typescript
function hexToDecimal(hex: string): bigint {
  return BigInt(hex);  // "0x4563918244F40000" → 5000000000000000000n
}

function formatBalance(rawBalance: bigint, decimals: number): string {
  const divisor = 10n ** BigInt(decimals);  // 10^18
  const whole = rawBalance / divisor;        // 5
  const remainder = rawBalance % divisor;    // 0
  return `${whole}.${trimmedRemainder}`;     // "5"
}
```

We use `BigInt` because JavaScript's `Number` type loses precision beyond 2^53. Token balances regularly exceed this.

#### Step 2: Get All ERC-20 Token Balances

```typescript
const result = await alchemyRpc(url, 'alchemy_getTokenBalances', [address, 'erc20']);
```

Returns something like:

```json
{
  "tokenBalances": [
    { "contractAddress": "0xdAC17F...", "tokenBalance": "0x4C4B40" },
    { "contractAddress": "0xA0b86...",  "tokenBalance": "0x0" }
  ]
}
```

We filter out zero balances, then for each non-zero token, fetch its metadata:

#### Step 3: Get Token Metadata

```typescript
const metadata = await alchemyRpc(url, 'alchemy_getTokenMetadata', [contractAddress]);
// Returns: { name: "Tether USD", symbol: "USDT", decimals: 6 }
```

**Why `decimals` matters:** USDT has 6 decimals, meaning a raw balance of `5000000` = `5.0 USDT`. But ETH has 18 decimals, so `5000000` ETH wei = `0.000000000005 ETH`. Without knowing the decimals, you can't display the right number.

### Contract Addresses

Each ERC-20 token is a smart contract deployed at a specific address. The same token has DIFFERENT addresses on different chains:

| Token | Ethereum | Polygon |
|-------|----------|---------|
| USDT | `0xdAC17F958D...` | `0xc2132D05D3...` |
| USDC | `0xA0b86991c6...` | `0x2791Bca1f2...` |

These addresses are static — once deployed, they never change.

### Chain-Specific Alchemy URLs

Alchemy uses different subdomains per chain:

```typescript
const chainToAlchemyNetwork = {
  '1': 'eth-mainnet',       // https://eth-mainnet.g.alchemy.com/v2/KEY
  '11155111': 'eth-sepolia', // https://eth-sepolia.g.alchemy.com/v2/KEY
  '137': 'polygon-mainnet',
  '42161': 'arb-mainnet',
  // ... etc
};
```

Same API key works across all chains — only the subdomain changes.

---

## Part 4: Market Prices with CoinGecko

### Why CoinGecko?

Alchemy gives us token *balances* but not *prices*. To show USD values, we need a market data provider. CoinGecko aggregates prices from hundreds of exchanges.

### How It Works

#### Native Coin Prices

```typescript
// GET /simple/price?ids=ethereum&vs_currencies=usd
// Response: { "ethereum": { "usd": 2456.78 } }
```

We map chain IDs to CoinGecko coin IDs:

```typescript
const nativeCoinIds = {
  '1': 'ethereum',      // ETH price
  '137': 'matic-network', // POL price
  '56': 'binancecoin',   // BNB price
  // Testnets map to mainnet prices for reference
  '11155111': 'ethereum',
};
```

#### ERC-20 Token Prices

```typescript
// GET /simple/token_price/ethereum?contract_addresses=0xdAC17F...&vs_currencies=usd
// Response: { "0xdac17f...": { "usd": 1.0 } }
```

CoinGecko uses "platform IDs" instead of chain IDs:

```typescript
const chainToPlatform = {
  '1': 'ethereum',
  '137': 'polygon-pos',
  '42161': 'arbitrum-one',
};
```

### Combining Alchemy + CoinGecko

In `getBalancesForChain()`, after fetching balances from Alchemy, we fetch prices from CoinGecko and multiply:

```typescript
// Alchemy: balance = "1.5" ETH
// CoinGecko: priceUsd = 2456.78
// Result: valueUsd = 1.5 * 2456.78 = $3,685.17

nativeBalance.priceUsd = nativePrice;
nativeBalance.valueUsd = parseFloat(nativeBalance.balance) * nativePrice;
```

---

## Part 5: Sending Transactions

### The Transaction Flow

```
User taps "Send"
    │
    ▼
App calls switchNetwork('eip155:11155111')
    │
    ▼
App calls provider.request({ method: 'eth_sendTransaction', params: [...] })
    │
    ▼
WalletConnect sends request to MetaMask via encrypted relay
    │
    ▼
MetaMask opens, shows transaction details + gas estimate
    │
    ▼
User approves or rejects
    │
    ▼
If approved: MetaMask signs with private key, broadcasts to blockchain
    │
    ▼
Transaction hash returned to app
```

### The Code

```typescript
// 1. Switch to the correct chain
await switchNetwork(`eip155:${transferChainId}`);

// 2. Convert human-readable amount to wei (hex)
const weiValue = BigInt(Math.floor(parsedAmount * 1e18));
const hexValue = '0x' + weiValue.toString(16);
// Example: 0.01 ETH → 10000000000000000 wei → "0x2386F26FC10000"

// 3. Send the transaction request
const txHash = await provider.request({
  method: 'eth_sendTransaction',
  params: [{
    from: transferFrom,  // Sender address
    to: toAddress,        // Recipient address
    value: hexValue,      // Amount in wei (hex)
    // gas, gasPrice, maxFeePerGas — MetaMask estimates these automatically
  }],
});
```

### Why `switchNetwork` First?

The WalletConnect provider maintains one "active chain" at a time. If you're connected on Sepolia but try to send a transaction meant for Arbitrum Sepolia, the chain IDs won't match and MetaMask rejects it with "missing or invalid chainId".

`switchNetwork()` tells both your app and MetaMask to switch to the target chain before the transaction.

### Gas Fees

We don't specify gas parameters in the transaction. When `gas`, `gasPrice`, or `maxFeePerGas` are omitted:

1. MetaMask calls `eth_estimateGas` to calculate the needed gas limit
2. It checks the current network gas price
3. Shows the user the total fee before they confirm

For a simple ETH transfer, gas is typically ~21,000 units. The total fee = gas units x gas price.

### What `provider.request()` Can Do

| Method | What Happens | Wallet Popup? |
|--------|-------------|---------------|
| `eth_sendTransaction` | Send ETH/tokens | Yes |
| `personal_sign` | Sign a text message | Yes |
| `eth_signTypedData_v4` | Sign structured data (EIP-712) | Yes |
| `eth_getBalance` | Read balance from chain | No |
| `eth_call` | Call a read-only contract function | No |
| `wallet_switchEthereumChain` | Switch active chain | Sometimes |

Read operations execute silently. Write/sign operations always open the wallet for user approval.

---

## Project Structure

```
wallet-connect/
├── app/
│   ├── _layout.tsx          # Root layout with AppKitProvider
│   └── (tabs)/
│       ├── _layout.tsx      # Tab navigation
│       └── index.tsx        # Main screen (connect, balances, send)
├── config/
│   └── appkit.ts            # WalletConnect + chain configuration
├── services/
│   ├── alchemy.ts           # Blockchain data (balances, token metadata)
│   └── coingecko.ts         # Market prices (USD values)
├── app.json                 # Expo config (scheme: "walletconnect")
├── babel.config.js          # Babel with import.meta transform
└── package.json
```

---

## Key Concepts Recap

### Addresses
- EVM addresses look like `0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18`
- 20 bytes (40 hex characters) derived from the public key
- Same address works on ALL EVM chains (Ethereum, Polygon, Arbitrum, etc.)
- Non-EVM chains (Bitcoin, Solana) use completely different address formats

### Tokens vs Coins
- **Native coins** (ETH, POL, BNB) are built into the chain protocol
- **Tokens** (USDT, USDC, UNI) are smart contracts that follow the ERC-20 standard
- Each token has a unique contract address per chain
- Tokens are tracked by calling `balanceOf(yourAddress)` on the token's contract

### Balances and Decimals
- Blockchain stores amounts as integers in the smallest unit
- ETH: 1 ETH = 10^18 wei (18 decimals)
- USDT: 1 USDT = 10^6 units (6 decimals)
- Always use `BigInt` for arithmetic — JavaScript `Number` loses precision above 2^53

### The Provider Pattern
- Your app never holds private keys
- `provider.request()` sends requests via WalletConnect to the wallet
- The wallet signs transactions locally and broadcasts them
- Your app receives the transaction hash as confirmation

### Indexers vs Direct RPC
- Direct RPC: one call = one piece of data (slow for "get all tokens")
- Indexers (Alchemy, Moralis): pre-process every block, store results in a database, expose via API
- Indexers can answer "what tokens does this address hold?" in one call

---

## APIs Used

### Reown Cloud
- **URL:** https://cloud.reown.com
- **Purpose:** Get a Project ID for WalletConnect
- **Cost:** Free

### Alchemy
- **URL:** https://dashboard.alchemy.com
- **Purpose:** Blockchain data (balances, token metadata)
- **Methods Used:** `eth_getBalance`, `alchemy_getTokenBalances`, `alchemy_getTokenMetadata`
- **Cost:** Free tier — 3M compute units/month

### CoinGecko
- **URL:** https://www.coingecko.com/en/api
- **Purpose:** Live market prices in USD
- **Endpoints Used:** `/simple/price`, `/simple/token_price/{platform}`
- **Cost:** Free tier — 10-30 requests/minute

---

## Supported Chains

### Mainnets
| Chain | ID | Native Coin | Alchemy Slug |
|-------|----|-------------|-------------|
| Ethereum | 1 | ETH | eth-mainnet |
| Polygon | 137 | POL | polygon-mainnet |
| Arbitrum | 42161 | ETH | arb-mainnet |
| Optimism | 10 | ETH | opt-mainnet |
| Base | 8453 | ETH | base-mainnet |
| BNB Smart Chain | 56 | BNB | Not on Alchemy |
| Linea | 59144 | ETH | Not on free tier |

### Testnets
| Chain | ID | Alchemy Slug |
|-------|----|-------------|
| Sepolia | 11155111 | eth-sepolia |
| Polygon Amoy | 80002 | polygon-amoy |
| Arbitrum Sepolia | 421614 | arb-sepolia |
| Base Sepolia | 84532 | base-sepolia |
| Optimism Sepolia | 11155420 | opt-sepolia |
