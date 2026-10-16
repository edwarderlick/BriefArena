import React from 'react';
import { CONTRACT_ADDRESS } from '../services/contractClient';
import { WRITES_ENABLED } from '../services/transactionService';

interface DesignPreviewBannerProps {
  message?: string;
  isFixture?: boolean;
  contractAddress?: string;
}

export const DesignPreviewBanner: React.FC<DesignPreviewBannerProps> = ({ 
  message,
  isFixture = true,
  contractAddress,
}) => {
  const activeAddress = contractAddress || CONTRACT_ADDRESS;

  // When viewing live records read from Studio Next
  if (!isFixture) {
    return (
      <div className="w-full bg-surface-container-highest/60 border-b border-primary/20 px-4 py-2 text-on-surface text-xs font-medium tracking-wide flex items-center justify-between gap-3">
        <div className="max-w-7xl mx-auto w-full flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0"></span>
            <span className="font-semibold uppercase tracking-wider text-[10px] bg-primary/10 px-1.5 py-0.5 rounded text-primary">
              Live Contract Record
            </span>
            <span className="text-on-surface-variant truncate">
              Read from Studio Next (Chain 61997)
              {activeAddress ? ` • Contract: ${activeAddress}` : ''}
              {` — ${WRITES_ENABLED ? 'On-chain transaction submission enabled.' : 'Read-only mode (chain writes disabled).'}`}
            </span>
          </div>
          <div className="shrink-0 hidden sm:flex items-center gap-2 font-mono text-[11px] text-primary">
            <span>Studio Next (Chain 61997)</span>
          </div>
        </div>
      </div>
    );
  }

  // Design preview banner rendered strictly for fixture records
  const displayMsg = message || (WRITES_ENABLED ? "Design preview — sample fixture data. Live contract reads may be intermittently unavailable. On-chain transaction flow is enabled." : "Design preview — sample fixture data. Live contract reads may be intermittently unavailable; write controls are disabled.");

  return (
    <div className="w-full bg-secondary-fixed/40 border-b border-secondary/20 px-4 py-2 text-on-secondary-fixed text-xs font-medium tracking-wide flex items-center justify-between gap-3">
      <div className="max-w-7xl mx-auto w-full flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-secondary animate-pulse shrink-0"></span>
          <span className="font-semibold uppercase tracking-wider text-[10px] bg-secondary/15 px-1.5 py-0.5 rounded text-secondary">
            Fixture Data
          </span>
          <span className="text-secondary-fixed-variant truncate">
            {displayMsg}
          </span>
        </div>
        <div className="shrink-0 hidden sm:flex items-center gap-2 font-mono text-[11px] text-secondary">
          <span>Design Preview Only</span>
        </div>
      </div>
    </div>
  );
};
