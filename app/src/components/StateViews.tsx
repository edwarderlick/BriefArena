import React from 'react';
import { useWallet } from '../context/WalletContext';
import { NETWORK_CONFIG } from '../types';

export const LoadingState: React.FC<{ message?: string }> = ({ 
  message = "Loading brief data from Studio Next..." 
}) => {
  return (
    <div className="w-full py-16 flex flex-col items-center justify-center text-center space-y-3">
      <div className="w-10 h-10 rounded-full border-2 border-primary-container border-t-secondary animate-spin"></div>
      <p className="text-sm text-on-surface-variant font-medium">{message}</p>
    </div>
  );
};

export const EmptyState: React.FC<{
  title?: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: string;
}> = ({
  title = "No challenges found",
  message = "There are no entries or challenges matching this filter criteria.",
  actionLabel,
  onAction,
  icon = "inbox"
}) => {
  return (
    <div className="w-full py-16 px-4 bg-surface-container-lowest rounded-xl border border-outline-variant/30 text-center flex flex-col items-center justify-center space-y-3">
      <div className="w-12 h-12 rounded-full bg-surface-container flex items-center justify-center text-on-surface-variant">
        <span className="material-symbols-outlined text-2xl">{icon}</span>
      </div>
      <h3 className="font-serif text-xl text-primary font-semibold">{title}</h3>
      <p className="text-sm text-on-surface-variant max-w-md leading-relaxed">{message}</p>
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="mt-2 px-5 py-2 rounded-full bg-primary text-on-primary text-xs font-semibold hover:bg-primary-container transition-all"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
};

export const ErrorState: React.FC<{
  title?: string;
  message?: string;
  onRetry?: () => void;
}> = ({
  title = "Unable to load data",
  message = "A network or parameter read error occurred while fetching brief state.",
  onRetry
}) => {
  return (
    <div className="w-full py-16 px-4 bg-error-container/20 rounded-xl border border-error/30 text-center flex flex-col items-center justify-center space-y-3">
      <div className="w-12 h-12 rounded-full bg-error-container text-error flex items-center justify-center">
        <span className="material-symbols-outlined text-2xl">error_outline</span>
      </div>
      <h3 className="font-serif text-xl text-error font-semibold">{title}</h3>
      <p className="text-sm text-on-surface-variant max-w-md leading-relaxed">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-2 px-5 py-2 rounded-full bg-error text-on-error text-xs font-semibold hover:bg-error/90 transition-all"
        >
          Try Again
        </button>
      )}
    </div>
  );
};

export const DisconnectedState: React.FC<{
  title?: string;
  message?: string;
}> = ({
  title = "Wallet Not Connected",
  message = "Connect your EVM wallet configured for GenLayer Studio Next to view live entries or submit to challenges."
}) => {
  const { connectWallet, isConnecting } = useWallet();

  return (
    <div className="w-full py-16 px-4 bg-surface-container-lowest rounded-xl border border-outline-variant/30 text-center flex flex-col items-center justify-center space-y-3">
      <div className="w-12 h-12 rounded-full bg-surface-container flex items-center justify-center text-primary">
        <span className="material-symbols-outlined text-2xl">account_balance_wallet</span>
      </div>
      <h3 className="font-serif text-xl text-primary font-semibold">{title}</h3>
      <p className="text-sm text-on-surface-variant max-w-md leading-relaxed">{message}</p>
      <button
        onClick={connectWallet}
        disabled={isConnecting}
        className="mt-2 px-6 py-2.5 rounded-full bg-primary text-on-primary text-xs font-semibold hover:bg-primary-container transition-all shadow-sm"
      >
        {isConnecting ? "Connecting..." : "Connect Wallet"}
      </button>
    </div>
  );
};

export const WrongNetworkState: React.FC = () => {
  const { switchNetwork } = useWallet();

  return (
    <div className="w-full py-16 px-4 bg-amber-500/10 rounded-xl border border-secondary/30 text-center flex flex-col items-center justify-center space-y-3">
      <div className="w-12 h-12 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center">
        <span className="material-symbols-outlined text-2xl">hub</span>
      </div>
      <h3 className="font-serif text-xl text-primary font-semibold">Wrong Network Detected</h3>
      <p className="text-sm text-on-surface-variant max-w-md leading-relaxed">
        Your wallet is connected to an unsupported network. Please switch to {NETWORK_CONFIG.chainName} (Chain ID {NETWORK_CONFIG.chainId}).
      </p>
      <button
        onClick={switchNetwork}
        className="mt-2 px-6 py-2.5 rounded-full bg-secondary text-on-secondary text-xs font-semibold hover:bg-secondary/90 transition-all shadow-sm"
      >
        Switch to Chain {NETWORK_CONFIG.chainId}
      </button>
    </div>
  );
};
