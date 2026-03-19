import { useAccount, useAppKit, useProvider } from '@reown/appkit-react-native';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { type ChainBalances, chainNames, getBalancesForChain } from '@/services/alchemy';

export default function HomeScreen() {
  const { open, disconnect, switchNetwork } = useAppKit();
  const { isConnected, allAccounts } = useAccount();
  const { provider } = useProvider();

  const configuredChainIds = new Set(['11155111', '80002', '421614', '84532', '11155420']);
  const filteredAccounts = allAccounts.filter((a) => configuredChainIds.has(a.chainId));

  const [selectedChain, setSelectedChain] = useState<ChainBalances | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [loadingChain, setLoadingChain] = useState(false);

  // Transfer state
  const [transferVisible, setTransferVisible] = useState(false);
  const [toAddress, setToAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [sending, setSending] = useState(false);
  const [transferFrom, setTransferFrom] = useState('');
  const [transferChainId, setTransferChainId] = useState('');

  const handleChainPress = useCallback(async (chainId: string, address: string) => {
    setModalVisible(true);
    setLoadingChain(true);
    setSelectedChain(null);
    try {
      const result = await getBalancesForChain(chainId, address);
      setSelectedChain(result);
    } catch (e) {
      console.error('Failed to fetch chain balances:', e);
    } finally {
      setLoadingChain(false);
    }
  }, []);

  const openTransfer = useCallback((fromAddress: string, chainId: string) => {
    setTransferFrom(fromAddress);
    setTransferChainId(chainId);
    setToAddress('');
    setAmount('');
    setModalVisible(false);
    setTransferVisible(true);
  }, []);

  const handleSend = useCallback(async () => {
    if (!provider || !toAddress || !amount || !transferFrom) return;

    if (!/^0x[0-9a-fA-F]{40}$/.test(toAddress)) {
      Alert.alert('Invalid Address', 'Please enter a valid Ethereum address');
      return;
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid amount');
      return;
    }

    setSending(true);
    try {
      // Switch to the correct chain first
      await switchNetwork(`eip155:${transferChainId}`);

      // Convert ETH amount to wei (hex)
      const weiValue = BigInt(Math.floor(parsedAmount * 1e18));
      const hexValue = '0x' + weiValue.toString(16);

      const txHash = await provider.request({
        method: 'eth_sendTransaction',
        params: [
          {
            from: transferFrom,
            to: toAddress,
            value: hexValue,
          },
        ],
      });

      Alert.alert('Transaction Sent', `TX Hash:\n${txHash}`, [
        { text: 'OK', onPress: () => setTransferVisible(false) },
      ]);
    } catch (e: any) {
      console.error('Transfer failed:', e);
      Alert.alert('Transfer Failed', e?.message ?? 'Unknown error');
    } finally {
      setSending(false);
    }
  }, [provider, toAddress, amount, transferFrom, transferChainId, switchNetwork]);

  return (
    <ThemedView style={styles.container}>
      <ThemedText type="title">Wallet Connect</ThemedText>

      {isConnected ? (
        <ScrollView contentContainerStyle={styles.listContainer} style={styles.scrollView}>
          {filteredAccounts.map((account) => (
            <Pressable
              key={`${account.namespace}:${account.chainId}:${account.address}`}
              style={styles.chainCard}
              onPress={() => handleChainPress(account.chainId, account.address)}
            >
              <ThemedText type="subtitle">
                {chainNames[account.chainId] ?? `${account.namespace}:${account.chainId}`}
              </ThemedText>
              <ThemedText selectable style={styles.addressText}>{account.address}</ThemedText>
              <ThemedText style={styles.tapHint}>Tap to view balances</ThemedText>
            </Pressable>
          ))}
          <Pressable style={styles.disconnectButton} onPress={() => disconnect()}>
            <ThemedText style={styles.buttonText}>Disconnect</ThemedText>
          </Pressable>
        </ScrollView>
      ) : (
        <ThemedView style={styles.disconnectedContainer}>
          <ThemedText>Connect your wallet to get started</ThemedText>
          <Pressable style={styles.button} onPress={() => open()}>
            <ThemedText style={styles.buttonText}>Connect Wallet</ThemedText>
          </Pressable>
        </ThemedView>
      )}

      {/* Balance Modal */}
      <Modal visible={modalVisible} animationType="slide" transparent>
        <ThemedView style={styles.modalOverlay}>
          <ThemedView style={styles.modalContent}>
            {loadingChain ? (
              <ActivityIndicator size="large" style={styles.loader} />
            ) : selectedChain ? (
              <ScrollView contentContainerStyle={styles.modalScroll}>
                <ThemedText type="title">{selectedChain.chainName}</ThemedText>
                {selectedChain.tokens.map((token) => (
                  <ThemedView key={token.contractAddress ?? 'native'} style={styles.tokenRow}>
                    <ThemedView style={styles.tokenInfo}>
                      <ThemedText style={styles.tokenSymbol}>{token.symbol}</ThemedText>
                      <ThemedText style={styles.tokenNameText}>{token.name}</ThemedText>
                      {token.priceUsd != null && (
                        <ThemedText style={styles.priceText}>${token.priceUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</ThemedText>
                      )}
                    </ThemedView>
                    <ThemedView style={styles.balanceInfo}>
                      <ThemedText style={styles.tokenBalance}>{token.balance}</ThemedText>
                      {token.valueUsd != null && (
                        <ThemedText style={styles.valueText}>${token.valueUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</ThemedText>
                      )}
                    </ThemedView>
                    <Pressable
                      style={styles.sendSmallButton}
                      onPress={() => openTransfer(filteredAccounts[0]?.address ?? '', selectedChain?.chainId ?? '')}
                    >
                      <ThemedText style={styles.sendSmallText}>Send</ThemedText>
                    </Pressable>
                  </ThemedView>
                ))}
                {selectedChain.tokens.length === 0 && (
                  <ThemedText style={styles.emptyText}>No tokens found</ThemedText>
                )}
              </ScrollView>
            ) : (
              <ThemedText>Failed to load balances</ThemedText>
            )}

            <Pressable style={styles.closeButton} onPress={() => setModalVisible(false)}>
              <ThemedText style={styles.buttonText}>Close</ThemedText>
            </Pressable>
          </ThemedView>
        </ThemedView>
      </Modal>

      {/* Transfer Modal */}
      <Modal visible={transferVisible} animationType="slide" transparent>
        <ThemedView style={styles.modalOverlay}>
          <ThemedView style={styles.modalContent}>
            <ThemedText type="title">Send ETH</ThemedText>
            <ThemedText style={styles.fromLabel}>From: {transferFrom}</ThemedText>

            <TextInput
              style={styles.input}
              placeholder="Recipient address (0x...)"
              placeholderTextColor="rgba(150,150,150,0.6)"
              value={toAddress}
              onChangeText={setToAddress}
              autoCapitalize="none"
              autoCorrect={false}
            />

            <TextInput
              style={styles.input}
              placeholder="Amount (ETH)"
              placeholderTextColor="rgba(150,150,150,0.6)"
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
            />

            {sending ? (
              <ActivityIndicator size="large" style={styles.loader} />
            ) : (
              <Pressable style={styles.button} onPress={handleSend}>
                <ThemedText style={styles.buttonText}>Send</ThemedText>
              </Pressable>
            )}

            <Pressable style={styles.closeButton} onPress={() => setTransferVisible(false)}>
              <ThemedText style={styles.buttonText}>Cancel</ThemedText>
            </Pressable>
          </ThemedView>
        </ThemedView>
      </Modal>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 60,
    paddingHorizontal: 16,
  },
  scrollView: {
    flex: 1,
  },
  listContainer: {
    gap: 12,
    paddingBottom: 40,
    paddingTop: 40,
  },
  disconnectedContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  addressText: {
    fontSize: 12,
  },
  chainCard: {
    padding: 16,
    borderRadius: 12,
    backgroundColor: 'rgba(150, 150, 150, 0.1)',
    gap: 4,
  },
  tapHint: {
    fontSize: 12,
    opacity: 0.5,
  },
  button: {
    backgroundColor: '#3396FF',
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
    minWidth: 200,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 16,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalContent: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    maxHeight: '80%',
    gap: 12,
  },
  modalScroll: {
    gap: 12,
    paddingBottom: 16,
  },
  tokenRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(150, 150, 150, 0.2)',
  },
  tokenInfo: {
    flex: 1,
    gap: 2,
  },
  tokenSymbol: {
    fontSize: 16,
    fontWeight: '600',
  },
  tokenNameText: {
    fontSize: 12,
    opacity: 0.6,
  },
  balanceInfo: {
    alignItems: 'flex-end',
    gap: 2,
  },
  tokenBalance: {
    fontSize: 16,
  },
  priceText: {
    fontSize: 11,
    opacity: 0.5,
  },
  valueText: {
    fontSize: 12,
    opacity: 0.7,
    color: '#4CAF50',
  },
  emptyText: {
    textAlign: 'center',
    opacity: 0.5,
    marginTop: 20,
  },
  loader: {
    marginVertical: 20,
  },
  closeButton: {
    backgroundColor: '#3396FF',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  disconnectButton: {
    backgroundColor: '#FF3B30',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  fromLabel: {
    fontSize: 12,
    opacity: 0.6,
  },
  input: {
    borderWidth: 1,
    borderColor: 'rgba(150, 150, 150, 0.3)',
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    color: '#fff',
  },
  sendSmallButton: {
    backgroundColor: '#3396FF',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    marginLeft: 8,
  },
  sendSmallText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
});
