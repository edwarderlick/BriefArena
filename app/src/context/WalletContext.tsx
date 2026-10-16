import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import type { TransactionKit } from '@genlayer/transaction-kit';
import { WalletState, NETWORK_CONFIG } from '../types';

interface WalletContextType extends WalletState {
  connectWallet: () => Promise<void>;
  disconnectWallet: () => void;
  switchNetwork: () => Promise<void>;
  kit?: TransactionKit | null;
}

const defaultState: WalletState = {
  isConnected: false,
  address: null,
  chainId: null,
  isCorrectNetwork: false,
  balance: null,
  isConnecting: false,
  error: null,
};

export const WalletContext = createContext<WalletContextType>({
  ...defaultState,
  connectWallet: async () => {},
  disconnectWallet: () => {},
  switchNetwork: async () => {},
  kit: null,
});

/**
 * Safely format wei to test GEN without converting the full wei amount
 * through JavaScript Number, preserving precision for large values.
 * Returns null if the input is invalid, never fabricated "0.00".
 */
export function formatWeiToGen(rawWei: string | null | undefined, decimalsToKeep: number = 2): string | null {
  if (!rawWei || typeof rawWei !== 'string') return null;
  try {
    const trimmed = rawWei.trim();
    if (!trimmed) return null;
    const wei = BigInt(trimmed);
    if (wei < 0n) return null; // Negative balances are invalid and produce unavailable state
    const ONE_GEN = BigInt('1000000000000000000'); // 10^18
    const whole = wei / ONE_GEN;
    const remainder = wei % ONE_GEN;
    const remainderStr = remainder.toString().padStart(18, '0');
    const fractionalPart = remainderStr.slice(0, decimalsToKeep);
    const wholeFormatted = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `${wholeFormatted}.${fractionalPart}`;
  } catch (err) {
    console.warn('Invalid wei balance value encountered:', rawWei, err);
    return null;
  }
}

export const WalletProvider: React.FC<{ children: ReactNode; kit?: TransactionKit | null }> = ({
  children,
  kit = null,
}) => {
  const [wallet, setWallet] = useState<WalletState>(defaultState);
  // Monotonic sequence counter to guard against race conditions in asynchronous wallet refreshes
  const refreshSeqRef = useRef<number>(0);

  // Synchronously refresh address, chainId, and balance together with sequence guard
  const refreshWalletState = async (
    targetAccount?: string | null,
    targetChainHex?: string | null
  ) => {
    const seq = ++refreshSeqRef.current;
    const ethereum = (window as unknown as { ethereum?: any }).ethereum;
    if (!ethereum) {
      setWallet(defaultState);
      return;
    }

    try {
      let currentAccount = targetAccount;
      if (currentAccount === undefined || currentAccount === null) {
        const accounts: string[] = await ethereum.request({ method: 'eth_accounts' });
        if (seq !== refreshSeqRef.current) return; // Stale request discarded
        if (!accounts || accounts.length === 0) {
          refreshSeqRef.current++; // Invalidate any older in-flight requests
          setWallet(defaultState);
          return;
        }
        currentAccount = accounts[0];
      }

      let rawChainId: string | null = targetChainHex || null;
      if (!rawChainId) {
        const fetched: any = await ethereum.request({ method: 'eth_chainId' });
        if (seq !== refreshSeqRef.current) return; // Stale request discarded
        rawChainId = typeof fetched === 'string' ? fetched : null;
      }

      const chainId = rawChainId ? parseInt(rawChainId, 16) : null;
      const isCorrect = chainId === NETWORK_CONFIG.chainId;

      let balanceStr: string | null = null;
      // Only query balance when on the correct target network
      if (isCorrect) {
        try {
          const rawBal: string = await ethereum.request({
            method: 'eth_getBalance',
            params: [currentAccount, 'latest'],
          });
          if (seq !== refreshSeqRef.current) return; // Stale request discarded
          balanceStr = formatWeiToGen(rawBal, 2);
        } catch (balErr) {
          console.warn('Failed to read balance on chain', chainId, balErr);
          // Explicitly produce unavailable balance on failed read
          balanceStr = null;
        }
      } else {
        // Explicitly clear balance when on the wrong chain
        balanceStr = null;
      }

      if (seq !== refreshSeqRef.current) return; // Newer refresh superseded this execution

      setWallet({
        isConnected: true,
        address: currentAccount,
        chainId,
        isCorrectNetwork: isCorrect,
        balance: balanceStr,
        isConnecting: false,
        error: null,
      });
    } catch (err) {
      if (seq !== refreshSeqRef.current) return;
      console.error('Error refreshing wallet state:', err);
      setWallet(defaultState);
    }
  };

  // Check existing accounts on mount and attach synchronized event listeners
  useEffect(() => {
    const ethereum = (window as unknown as { ethereum?: any }).ethereum;
    if (!ethereum) return;

    // Initial check
    refreshWalletState();

    const handleAccountsChanged = (accounts: string[]) => {
      if (!accounts || accounts.length === 0) {
        refreshSeqRef.current++; // Invalidate any in-flight async requests
        setWallet(defaultState);
      } else {
        // Refresh address, chain ID, and balance together
        refreshWalletState(accounts[0], null);
      }
    };

    const handleChainChanged = (chainIdHex: string) => {
      // Refresh address, chain ID, and balance together; clear balance if wrong chain
      refreshWalletState(null, chainIdHex);
    };

    ethereum.on?.('accountsChanged', handleAccountsChanged);
    ethereum.on?.('chainChanged', handleChainChanged);

    return () => {
      ethereum.removeListener?.('accountsChanged', handleAccountsChanged);
      ethereum.removeListener?.('chainChanged', handleChainChanged);
    };
  }, []);

  const connectWallet = async () => {
    const ethereum = (window as unknown as { ethereum?: any }).ethereum;
    if (!ethereum) {
      setWallet(prev => ({
        ...prev,
        error: 'No Web3 wallet detected. Please install an EVM-compatible wallet (such as MetaMask) to connect.',
      }));
      return;
    }

    setWallet(prev => ({ ...prev, isConnecting: true, error: null }));

    try {
      const accounts: string[] = await ethereum.request({ method: 'eth_requestAccounts' });
      if (!accounts || accounts.length === 0) {
        throw new Error('No accounts selected');
      }

      await refreshWalletState(accounts[0], null);
    } catch (err: any) {
      setWallet(prev => ({
        ...prev,
        isConnecting: false,
        error: err?.message || 'Failed to connect wallet',
      }));
    }
  };

  // Disconnect only clears the local app session; it does not disconnect the wallet extension
  const disconnectWallet = () => {
    refreshSeqRef.current++; // Invalidate any in-flight async refreshes
    setWallet(defaultState);
  };

  const switchNetwork = async () => {
    const ethereum = (window as unknown as { ethereum?: any }).ethereum;
    if (!ethereum) return;

    try {
      await ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: NETWORK_CONFIG.chainIdHex }],
      });
    } catch (switchError: any) {
      // 4902 indicates chain is not added yet
      if (switchError.code === 4902) {
        try {
          await ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [
              {
                chainId: NETWORK_CONFIG.chainIdHex,
                chainName: NETWORK_CONFIG.chainName,
                rpcUrls: [NETWORK_CONFIG.rpcUrl],
                nativeCurrency: {
                  name: 'test GEN',
                  symbol: NETWORK_CONFIG.currencySymbol,
                  decimals: 18,
                },
                blockExplorerUrls: [NETWORK_CONFIG.explorerUrl],
              },
            ],
          });
        } catch (addError) {
          console.error('Error adding network:', addError);
        }
      }
    }
  };

  return (
    <WalletContext.Provider value={{ ...wallet, connectWallet, disconnectWallet, switchNetwork, kit }}>
      {children}
    </WalletContext.Provider>
  );
};

export const useWallet = () => useContext(WalletContext);
