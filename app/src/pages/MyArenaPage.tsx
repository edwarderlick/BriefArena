import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import type { SubmitInput, TransactionKit } from '@genlayer/transaction-kit';
import { useWallet } from '../context/WalletContext';
import { dataService } from '../services/dataService';
import { buildWithdrawSubmitInput, WRITES_ENABLED } from '../services/transactionService';
import { CONTRACT_ADDRESS, getContractCredit, getContractWithdrawn } from '../services/contractClient';
import {
  useTransactionController,
  useTransactionKit,
  type ActionPreconditionParams,
} from '../services/transactionController';
import { Challenge, Entry, MoneyState } from '../types';
import { DesignPreviewBanner } from '../components/DesignPreviewBanner';
import { EmptyState, LoadingState } from '../components/StateViews';
import { ContractPendingModal } from '../components/ContractPendingModal';

function getChallengeStatusBadge(status: string): { label: string; badgeClass: string } {
  switch (status) {
    case 'open':
      return { label: 'Open for Entries', badgeClass: 'bg-surface-tint/20 text-primary font-semibold' };
    case 'closed':
      return { label: 'Entries Closed (Pending Judging)', badgeClass: 'bg-secondary/20 text-secondary font-semibold' };
    case 'judging':
      return { label: 'Deliberation & Judging Phase', badgeClass: 'bg-primary-container text-on-primary-container font-semibold' };
    case 'awarded':
      return { label: 'Awarded & Settled', badgeClass: 'bg-tertiary-container text-primary-fixed-dim font-semibold' };
    case 'no-winner':
      return { label: 'Settled (No Winner Awarded)', badgeClass: 'bg-surface-container-highest text-on-surface-variant font-semibold' };
    case 'canceled':
      return { label: 'Cancelled (Prize Refunded)', badgeClass: 'bg-error-container/40 text-error font-semibold' };
    default:
      return { label: status, badgeClass: 'bg-surface-container text-on-surface-variant font-medium' };
  }
}

export const MyArenaPage: React.FC<{ kit?: TransactionKit | null }> = ({
  kit: injectedKit = null,
}) => {
  const { isConnected, address, chainId, isCorrectNetwork, connectWallet } = useWallet();
  const { kit } = useTransactionKit(injectedKit);
  const writesEnabled = WRITES_ENABLED;
  const [activeTab, setActiveTab] = useState<'sponsored' | 'entries' | 'refunds'>('sponsored');
  const [showPreviewData, setShowPreviewData] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [contractAvailable, setContractAvailable] = useState<boolean>(false);
  const [unavailableReason, setUnavailableReason] = useState<string>('');

  const [sponsoredChallenges, setSponsoredChallenges] = useState<Challenge[]>([]);
  const [submittedEntries, setSubmittedEntries] = useState<{ challenge: Challenge; entry: Entry }[]>([]);
  const [moneyState, setMoneyState] = useState<MoneyState | null>(null);

  const [isWithdrawModalOpen, setIsWithdrawModalOpen] = useState(false);
  const [withdrawDraft, setWithdrawDraft] = useState<SubmitInput | null>(null);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);

  const controllerParams: ActionPreconditionParams = useMemo(() => ({
    actionType: 'withdraw',
    walletState: {
      isConnected,
      address,
      chainId,
      isCorrectNetwork,
    },
    contractAddress: CONTRACT_ADDRESS as any,
    claimableCreditWei: moneyState?.creditAvailableWei !== undefined
      ? moneyState.creditAvailableWei
      : moneyState?.creditAvailableWeiStr
      ? BigInt(moneyState.creditAvailableWeiStr)
      : null,
  }), [isConnected, address, chainId, isCorrectNetwork, moneyState]);

  const {
    state: controllerState,
    submit,
    estimateFee,
    reconcileAmbiguous,
  } = useTransactionController(controllerParams, kit, async () => {
    if (address) {
      const overview = await dataService.getMyArenaOverview(address);
      setContractAvailable(overview.contractDataAvailable);
      setUnavailableReason(overview.reason);
      setSponsoredChallenges(overview.sponsored || []);
      setSubmittedEntries(overview.entered || []);
      setMoneyState(overview.moneyState);
    }
  });

  const handleReconcileCheckContract = useCallback(async () => {
    if (!address || !CONTRACT_ADDRESS) {
      return { creditWei: null, withdrawnWei: null, message: 'No wallet or contract address' };
    }
    try {
      const [creditWei, withdrawnWei] = await Promise.all([
        getContractCredit(CONTRACT_ADDRESS, address),
        getContractWithdrawn(CONTRACT_ADDRESS, address),
      ]);
      return {
        creditWei,
        withdrawnWei,
        message: `Live get_credit: ${creditWei} wei. Live get_withdrawn: ${withdrawnWei} wei.`,
      };
    } catch (err: any) {
      return {
        creditWei: null,
        withdrawnWei: null,
        message: err?.message || 'Failed reading live contract credit',
      };
    }
  }, [address]);

  const handleReconcileReleaseLock = useCallback(async () => {
    await reconcileAmbiguous({
      walletActivityChecked: true,
      noPendingTxInWallet: true,
    });
    if (address) {
      const overview = await dataService.getMyArenaOverview(address);
      setContractAvailable(overview.contractDataAvailable);
      setUnavailableReason(overview.reason);
      setSponsoredChallenges(overview.sponsored || []);
      setSubmittedEntries(overview.entered || []);
      setMoneyState(overview.moneyState);
    }
  }, [reconcileAmbiguous, address]);

  const refundedChallenges = useMemo(() => {
    return (sponsoredChallenges || []).filter(c => c && c.status === 'canceled');
  }, [sponsoredChallenges]);

  const handleRetryRead = async () => {
    setIsLoading(true);
    try {
      if (showPreviewData) {
        const preview = await dataService.getMyArenaPreviewData();
        setContractAvailable(false);
        setSponsoredChallenges(preview.sponsored || []);
        setSubmittedEntries(preview.entered || []);
        setMoneyState(preview.moneyState);
      } else {
        const overview = await dataService.getMyArenaOverview(address);
        setContractAvailable(overview.contractDataAvailable);
        setUnavailableReason(overview.reason);
        setSponsoredChallenges(overview.sponsored || []);
        setSubmittedEntries(overview.entered || []);
        setMoneyState(overview.moneyState);
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    handleRetryRead();
  }, [showPreviewData, address]);

  const canWithdraw = Boolean(
    !showPreviewData &&
    contractAvailable &&
    isConnected &&
    isCorrectNetwork &&
    address &&
    moneyState !== null &&
    moneyState.creditAvailableWei !== undefined &&
    moneyState.creditAvailableWei > 0n
  );

  let withdrawDisabledReason: string;
  if (showPreviewData) {
    withdrawDisabledReason = 'Design preview mode: sample credit representation cannot produce on-chain withdraw calldata.';
  } else if (!isConnected) {
    withdrawDisabledReason = 'Connect your wallet to inspect claimable on-chain credit and prepare a withdrawal draft.';
  } else if (!isCorrectNetwork) {
    withdrawDisabledReason = 'Wallet is on the wrong chain. Switch to GenLayer Studio Next (Chain 61997) to withdraw.';
  } else if (!contractAvailable) {
    withdrawDisabledReason = 'Live credit query is unavailable. A failed read is never assumed to be zero.';
  } else if (moneyState === null || moneyState.creditAvailableWei === undefined) {
    withdrawDisabledReason = 'Credit read unavailable. Missing exact claimable wei cannot be approximated.';
  } else if (moneyState.creditAvailableWei <= 0n) {
    withdrawDisabledReason = 'No claimable credit allocated on-chain (0.00 test GEN available). Withdraw requires positive claimable credit.';
  } else {
    withdrawDisabledReason = '';
  }

  const handleOpenWithdrawModal = () => {
    setWithdrawError(null);
    if (!canWithdraw) return;
    try {
      const draft = buildWithdrawSubmitInput();
      setWithdrawDraft(draft);
      setIsWithdrawModalOpen(true);
      if (kit) {
        estimateFee().catch((feeErr) => {
          console.warn('Real fee quote estimation failed for withdraw:', feeErr);
        });
      }
    } catch (err: any) {
      setWithdrawError(err?.message || 'Failed to build withdraw draft');
    }
  };

  useEffect(() => {
    if (
      isWithdrawModalOpen &&
      withdrawDraft &&
      kit &&
      !controllerState.quote &&
      !controllerState.quoteError &&
      controllerState.phase !== 'estimating' &&
      controllerState.phase !== 'error'
    ) {
      estimateFee().catch((feeErr) => {
        console.warn('Real fee quote estimation failed for withdraw:', feeErr);
      });
    }
  }, [isWithdrawModalOpen, withdrawDraft, kit, controllerState.quote, controllerState.quoteError, controllerState.phase, estimateFee]);

  return (
    <div className="flex flex-col w-full pb-20">
      {showPreviewData && (
        <DesignPreviewBanner message={`Design preview mode — showing sample portfolio layout with fixture data. Contract at ${CONTRACT_ADDRESS} is deployed on Studio Next. ${writesEnabled ? 'On-chain write actions enabled.' : 'Write controls are disabled.'}`} />
      )}

      <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-12 py-8 flex flex-col gap-8">
        
        {/* Header Strip & Mode Toggle */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-outline-variant/20 pb-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full bg-surface-container text-primary text-[10px] uppercase font-mono font-bold tracking-wider">
                Portfolio Desk
              </span>
              <span className="text-on-surface-variant text-xs">•</span>
              <span className="text-xs font-mono text-secondary font-medium">Studio Next (Chain 61997)</span>
            </div>
            <h1 className="font-serif text-3xl sm:text-4xl text-primary font-semibold tracking-tight">
              My Arena Overview
            </h1>
            <p className="text-sm text-on-surface-variant max-w-xl leading-relaxed">
              Track locked challenge escrow, claimable internal credits, and your submission ledger.
            </p>
          </div>

          {/* Toggle between Live On-Chain Network and Design Preview */}
          <div className="flex items-center gap-2 bg-surface-container-lowest p-1.5 rounded-2xl border border-outline-variant/30 shadow-sm self-start md:self-auto">
            <span className="text-xs font-medium text-on-surface-variant pl-2">Display Mode:</span>
            <button
              onClick={() => setShowPreviewData(false)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                !showPreviewData
                  ? 'bg-primary text-on-primary shadow-sm'
                  : 'text-on-surface-variant hover:text-primary'
              }`}
            >
              Live On-Chain
            </button>
            <button
              onClick={() => setShowPreviewData(true)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                showPreviewData
                  ? 'bg-secondary text-on-secondary shadow-sm'
                  : 'text-on-surface-variant hover:text-primary'
              }`}
            >
              Design Preview (Sample Data)
            </button>
          </div>
        </div>

        {/* DEFAULT VIEW: Explicit Contract Data Unavailable State when neither contract nor preview is active */}
        {!contractAvailable && !showPreviewData ? (
          <div className="bg-surface-container-lowest rounded-2xl p-8 sm:p-12 border border-outline-variant/30 text-center space-y-6 max-w-2xl mx-auto shadow-sm my-6">
            <div className="w-16 h-16 mx-auto rounded-full bg-surface-container flex items-center justify-center text-secondary">
              <span className="material-symbols-outlined text-3xl">cloud_off</span>
            </div>
            
            <div className="space-y-2">
              <span className="px-3 py-1 rounded-full bg-secondary-fixed/30 text-secondary-fixed-dim text-xs font-mono font-semibold">
                Live Data Unavailable
              </span>
              <h2 className="font-serif text-2xl sm:text-3xl text-primary font-semibold">
                Live Data Unavailable
              </h2>
              <p className="text-sm text-on-surface-variant leading-relaxed max-w-lg mx-auto">
                {unavailableReason || 'The Studio Next contract read is currently failing; retry or inspect the error.'}
              </p>
            </div>

            <div className="p-4 rounded-xl bg-surface-container-low border border-outline-variant/30 text-xs text-on-surface-variant text-left space-y-2">
              <div className="flex items-center gap-2 text-primary font-semibold">
                <span className="material-symbols-outlined text-sm text-secondary">info</span>
                <span>Why balances are not shown as zero:</span>
              </div>
              <p className="leading-relaxed">
                Zero is not an observed on-chain value. Displaying 0.00 would falsely imply an active contract reported a zero balance. Live portfolio data is currently unavailable from the RPC endpoint.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
              <button
                type="button"
                id="my-arena-retry-rpc-btn"
                onClick={handleRetryRead}
                disabled={isLoading}
                className="w-full sm:w-auto px-6 py-2.5 rounded-full bg-primary text-on-primary text-xs font-semibold hover:bg-primary-container transition-all flex items-center justify-center gap-2 shadow-sm disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-sm">{isLoading ? 'hourglass_top' : 'refresh'}</span>
                <span>{isLoading ? 'Retrying RPC Read...' : 'Retry RPC Read'}</span>
              </button>
              <button
                onClick={() => setShowPreviewData(true)}
                className="w-full sm:w-auto px-6 py-2.5 rounded-full bg-surface-container text-primary text-xs font-semibold hover:bg-surface-container-high transition-all flex items-center justify-center gap-2 border border-outline-variant/30"
              >
                <span className="material-symbols-outlined text-sm">visibility</span>
                <span>Toggle Design Preview (Sample Portfolio)</span>
              </button>
              <Link
                to="/challenges"
                className="w-full sm:w-auto px-6 py-2.5 rounded-full bg-surface-container text-primary text-xs font-semibold hover:bg-surface-container-high transition-colors text-center"
              >
                Browse Creative Briefs
              </Link>
            </div>
          </div>
        ) : (
          <>
            {/* Top 3 Metrics Cards: Clear Delineation of States */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              
              {/* Card 1: Prize Locked */}
              <div className="bg-surface-container-lowest rounded-xl p-6 shadow-sm border border-outline-variant/30 flex flex-col justify-between space-y-4">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                      1. Prize Locked
                    </span>
                    <span className="px-2 py-0.5 rounded bg-surface-container text-outline text-[10px] font-semibold">
                      {contractAvailable ? "On-Chain Escrow" : "Sample Preview"}
                    </span>
                  </div>
                  <div className="flex items-baseline gap-2 pt-1">
                    <span className="font-serif text-3xl sm:text-4xl text-primary font-semibold">
                      {moneyState?.prizeLocked?.toFixed(2) ?? '—'}
                    </span>
                    <span className="text-xs font-mono text-secondary font-medium">test GEN</span>
                  </div>
                  <p className="text-xs text-on-surface-variant leading-relaxed">
                    {contractAvailable
                      ? "Total prize escrow locked on-chain in your active sponsored challenges awaiting judging consensus."
                      : "Example representation of locked sponsor escrow awaiting validation consensus settlement."}
                  </p>
                </div>
                <div className="pt-3 border-t border-outline-variant/20 flex items-center justify-between text-xs text-on-surface-variant">
                  <span>Escrow State</span>
                  <span className="font-mono text-primary font-semibold">
                    {sponsoredChallenges.length} Sponsored Briefs
                  </span>
                </div>
              </div>

              {/* Card 2: Credit Available (Available to Withdraw) */}
              <div className="bg-primary-container text-on-primary rounded-xl p-6 shadow-md border border-primary/40 flex flex-col justify-between space-y-4 relative overflow-hidden">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-primary-fixed-dim">
                      2. Credit Available
                    </span>
                    <span className="px-2 py-0.5 rounded bg-primary text-secondary-fixed text-[10px] uppercase font-semibold">
                      {contractAvailable ? "On-Chain Credit" : "Settled Credit"}
                    </span>
                  </div>
                  <div className="flex items-baseline gap-2 pt-1">
                    <span className="font-serif text-3xl sm:text-4xl text-secondary-fixed font-semibold">
                      {moneyState?.creditAvailable !== null && moneyState?.creditAvailable !== undefined
                        ? moneyState.creditAvailable.toFixed(2)
                        : '—'}
                    </span>
                    <span className="text-xs font-mono text-primary-fixed font-medium">test GEN</span>
                  </div>
                  {moneyState?.creditAvailableWeiStr && (
                    <div className="text-[10px] font-mono text-primary-fixed-dim">
                      Exact: {moneyState.creditAvailableWeiStr} wei
                    </div>
                  )}
                  {moneyState?.creditReadError && (
                    <div className="p-2 rounded bg-error-container/40 border border-error/30 text-[11px] text-error flex items-start gap-1.5 mt-1">
                      <span className="material-symbols-outlined text-xs shrink-0 mt-0.5">error</span>
                      <span>Credit read failed: {moneyState.creditReadError}</span>
                    </div>
                  )}
                  <p className="text-xs text-primary-fixed-dim leading-relaxed">
                    Internal contract credit allocated upon winning or refund. Separate from native GEN wallet balance.
                  </p>
                </div>

                {/* Withdrawal Action: Prepared draft or disabled with actionable reason */}
                <div className="pt-3 border-t border-tertiary-container flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    {canWithdraw ? (
                      <button
                        type="button"
                        id="withdraw-credit-draft-btn"
                        onClick={handleOpenWithdrawModal}
                        className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-full bg-secondary-fixed text-on-secondary-fixed text-xs font-semibold hover:bg-secondary-fixed-dim transition-all shadow-sm cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-sm">payments</span>
                        <span>{writesEnabled ? 'Review & Submit Withdrawal' : 'Review Withdraw Draft'}</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        id="withdraw-credit-draft-btn"
                        disabled
                        title={withdrawDisabledReason}
                        className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-full bg-secondary-fixed/50 text-on-secondary-fixed text-xs font-semibold cursor-not-allowed opacity-80"
                      >
                        <span className="material-symbols-outlined text-sm">lock</span>
                        <span>
                          {showPreviewData
                            ? "Preview Mode (No Calldata)"
                            : !isConnected
                            ? "Connect Wallet to Withdraw"
                            : !isCorrectNetwork
                            ? "Switch to Studio Next (Chain 61997)"
                            : !contractAvailable
                            ? "Live Credit Read Unavailable"
                            : (moneyState && moneyState.creditAvailableWei === undefined)
                            ? "Credit Read Unavailable"
                            : (moneyState && moneyState.creditAvailableWei !== undefined && moneyState.creditAvailableWei <= 0n)
                            ? "No Claimable Credit (0.00 test GEN)"
                            : "Withdrawal Unavailable"}
                        </span>
                      </button>
                    )}
                  </div>
                  <span className="text-[10px] text-primary-fixed-dim text-center leading-tight">
                    {withdrawDisabledReason || (writesEnabled ? "Live on-chain credit • Ready to withdraw" : "Live on-chain credit • Chain writes disabled")}
                  </span>
                  {controllerState.isDuplicateBlocked && (
                    <div className="p-2.5 rounded-lg bg-amber-500/20 border border-amber-500/40 text-[11px] text-on-primary space-y-1.5 mt-1">
                      <div className="flex items-center gap-1.5 font-semibold text-secondary-fixed">
                        <span className="material-symbols-outlined text-xs">lock_clock</span>
                        <span>Ambiguous Withdrawal Blocked</span>
                      </div>
                      <p className="leading-tight text-primary-fixed-dim">
                        A withdrawal transaction ended without definitive receipt. Reconcile with wallet activity and live contract before retrying.
                      </p>
                      <button
                        type="button"
                        id="reconcile-withdrawal-btn"
                        onClick={() => {
                          const draft = buildWithdrawSubmitInput();
                          setWithdrawDraft(draft);
                          setIsWithdrawModalOpen(true);
                        }}
                        className="w-full px-2.5 py-1 rounded bg-secondary-fixed text-on-secondary-fixed text-xs font-semibold hover:bg-secondary-fixed-dim transition-colors text-center cursor-pointer shadow-sm"
                      >
                        Review & Reconcile Withdrawal
                      </button>
                    </div>
                  )}
                  {controllerState.errorMessage && !controllerState.isDuplicateBlocked && (
                    <div className="p-2 rounded bg-error-container/40 border border-error/30 text-[11px] text-error flex items-start gap-1.5 mt-1">
                      <span className="material-symbols-outlined text-xs shrink-0 mt-0.5">info</span>
                      <span>{controllerState.errorMessage}</span>
                    </div>
                  )}
                  {withdrawError && (
                    <div className="p-2 rounded bg-error-container text-on-error-container text-[11px]">
                      {withdrawError}
                    </div>
                  )}
                </div>
              </div>

              {/* Card 3: GEN Withdrawn (Dispatched/Requested) */}
              <div className="bg-surface-container-lowest rounded-xl p-6 shadow-sm border border-outline-variant/30 flex flex-col justify-between space-y-4">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                      3. GEN Withdrawn (Dispatched)
                    </span>
                    <span className="px-2 py-0.5 rounded bg-surface-container text-outline text-[10px] font-semibold">
                      {contractAvailable ? "On-Chain Dispatched" : "Sample Preview"}
                    </span>
                  </div>
                  <div className="flex items-baseline gap-2 pt-1">
                    <span className="font-serif text-3xl sm:text-4xl text-primary font-semibold">
                      {moneyState?.genWithdrawn !== null && moneyState?.genWithdrawn !== undefined
                        ? moneyState.genWithdrawn.toFixed(2)
                        : '—'}
                    </span>
                    <span className="text-xs font-mono text-on-surface-variant">test GEN</span>
                  </div>
                  {moneyState?.genWithdrawnWeiStr && (
                    <div className="text-[10px] font-mono text-on-surface-variant">
                      Exact: {moneyState.genWithdrawnWeiStr} wei
                    </div>
                  )}
                  {moneyState?.withdrawnReadError && (
                    <div className="p-2 rounded bg-error-container/40 border border-error/30 text-[11px] text-error flex items-start gap-1.5 mt-1">
                      <span className="material-symbols-outlined text-xs shrink-0 mt-0.5">error</span>
                      <span>Withdrawn read failed: {moneyState.withdrawnReadError}</span>
                    </div>
                  )}
                  <p className="text-xs text-on-surface-variant leading-relaxed">
                    Cumulative native GEN dispatched via message emission. On-chain delivery requires verified child receipt and recipient balance update.
                  </p>
                </div>
                <div className="pt-3 border-t border-outline-variant/20 flex items-center justify-between text-xs text-on-surface-variant">
                  <span>Dispatched Transfers</span>
                  <span className="font-mono text-on-surface-variant font-semibold">
                    {contractAvailable ? "Query complete" : "0 Txs"}
                  </span>
                </div>
              </div>

            </div>

        {/* Section 2: Portfolio Tabs & Records */}
        <div className="bg-surface-container-lowest rounded-xl p-6 sm:p-8 shadow-sm border border-outline-variant/30 space-y-6">
          
          {/* Tab Controls */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-outline-variant/20 pb-4">
            <div className="flex items-center p-1 rounded-full bg-surface-container-low max-w-fit">
              <button
                onClick={() => setActiveTab('sponsored')}
                className={`px-4 py-2 rounded-full text-xs font-semibold transition-all flex items-center gap-1.5 ${
                  activeTab === 'sponsored'
                    ? 'bg-surface-container-lowest text-primary shadow-sm'
                    : 'text-on-surface-variant hover:text-primary'
                }`}
              >
                <span className="material-symbols-outlined text-sm">campaign</span>
                <span>Challenges I Sponsored</span>
                <span className="px-1.5 py-0.2 rounded-full bg-surface-container text-[10px] font-mono">
                  {sponsoredChallenges.length}
                </span>
              </button>

              <button
                onClick={() => setActiveTab('entries')}
                className={`px-4 py-2 rounded-full text-xs font-semibold transition-all flex items-center gap-1.5 ${
                  activeTab === 'entries'
                    ? 'bg-surface-container-lowest text-primary shadow-sm'
                    : 'text-on-surface-variant hover:text-primary'
                }`}
              >
                <span className="material-symbols-outlined text-sm">draw</span>
                <span>My Submitted Entries</span>
                <span className="px-1.5 py-0.2 rounded-full bg-surface-container text-[10px] font-mono">
                  {submittedEntries.length}
                </span>
              </button>

              <button
                onClick={() => setActiveTab('refunds')}
                className={`px-4 py-2 rounded-full text-xs font-semibold transition-all flex items-center gap-1.5 ${
                  activeTab === 'refunds'
                    ? 'bg-surface-container-lowest text-primary shadow-sm'
                    : 'text-on-surface-variant hover:text-primary'
                }`}
              >
                <span className="material-symbols-outlined text-sm">history</span>
                <span>Refunds</span>
                <span className="px-1.5 py-0.2 rounded-full bg-surface-container text-[10px] font-mono">
                  {refundedChallenges.length}
                </span>
              </button>
            </div>

            <div className="text-xs text-on-surface-variant flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-secondary"></span>
              <span>Intelligent Contract Verifier: GenLayer Studio Next</span>
            </div>
          </div>

          {/* TAB 1: Sponsored Challenges */}
          {activeTab === 'sponsored' && (
            <div className="space-y-4">
              {isLoading ? (
                <LoadingState message="Loading sponsored briefs..." />
              ) : sponsoredChallenges.length === 0 ? (
                <EmptyState
                  title="No Sponsored Challenges"
                  message={
                    !isConnected
                      ? "Connect your wallet to see challenges you have funded on Studio Next, or switch to Design Preview mode."
                      : "You have not funded any challenges on Studio Next yet."
                  }
                  actionLabel={!isConnected ? "Connect Wallet" : "Launch Create Challenge"}
                  onAction={!isConnected ? connectWallet : () => window.location.assign('/challenges/new')}
                />
              ) : (
                <div className="space-y-4">
                  {sponsoredChallenges.map((chal) => {
                    const statusInfo = getChallengeStatusBadge(chal.status);
                    return (
                      <div
                        key={chal.id}
                        className="bg-surface-container-low/40 rounded-xl p-5 sm:p-6 border border-outline-variant/30 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6 hover:shadow-sm transition-all"
                      >
                        <div className="space-y-2 max-w-2xl">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-serif text-lg font-semibold text-primary">
                              {chal.title}
                            </span>
                            <span className="px-2 py-0.5 rounded-full bg-surface-container-highest text-primary text-xs font-semibold font-mono">
                              {chal.code}
                            </span>
                            <span className={`px-2.5 py-0.5 rounded-full text-[11px] ${statusInfo.badgeClass}`}>
                              {statusInfo.label}
                            </span>
                          </div>
                          <p className="text-xs text-on-surface-variant leading-relaxed">
                            {chal.synopsis}
                          </p>
                          <div className="flex items-center gap-4 text-xs text-on-surface-variant pt-1 font-mono">
                            <span>
                              {chal.status === 'canceled'
                                ? 'Refunded Bounty: '
                                : chal.status === 'awarded'
                                ? 'Awarded Bounty: '
                                : 'Bounty: '}
                              <strong className={chal.status === 'canceled' ? 'text-on-surface-variant line-through decoration-error/50' : 'text-primary'}>
                                {chal.prizeAmount} test GEN
                              </strong>
                            </span>
                            <span>•</span>
                            <span>{chal.status === 'canceled' ? '0 Locked (Refunded)' : '3 Slots Capped'}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-3 shrink-0">
                          {chal.status === 'awarded' || chal.status === 'no-winner' ? (
                            <Link
                              to={`/challenges/${chal.id}/decision`}
                              className="px-4 py-2 rounded-full bg-primary text-on-primary text-xs font-semibold hover:bg-primary-container transition-colors inline-flex items-center gap-1 shadow-sm"
                            >
                              <span>Inspect Verdict</span>
                              <span className="material-symbols-outlined text-xs">gavel</span>
                            </Link>
                          ) : chal.status === 'canceled' ? (
                            <Link
                              to={`/challenges/${chal.id}`}
                              className="px-4 py-2 rounded-full bg-surface-container text-primary text-xs font-semibold hover:bg-surface-container-high transition-colors"
                            >
                              View Brief Details
                            </Link>
                          ) : (
                            <Link
                              to={`/challenges/${chal.id}`}
                              className="px-4 py-2 rounded-full bg-surface-container text-primary text-xs font-semibold hover:bg-surface-container-high transition-colors inline-flex items-center gap-1"
                            >
                              <span>Manage Brief</span>
                              <span className="material-symbols-outlined text-xs">arrow_forward</span>
                            </Link>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: My Submitted Entries */}
          {activeTab === 'entries' && (
            <div className="space-y-4">
              {isLoading ? (
                <LoadingState message="Loading submitted entries..." />
              ) : submittedEntries.length === 0 ? (
                <EmptyState
                  title="No Entries Submitted"
                  message={
                    !isConnected
                      ? "Connect your wallet to track submissions under your address, or switch to Design Preview mode."
                      : "You have not submitted an entry to any active challenge yet."
                  }
                  actionLabel="Explore Active Briefs"
                  onAction={() => window.location.assign('/challenges')}
                />
              ) : (
                <div className="space-y-4">
                  {submittedEntries.map(({ challenge: chal, entry }) => (
                    <div
                      key={entry.id}
                      className="bg-surface-container-low/40 rounded-xl p-5 sm:p-6 border border-outline-variant/30 space-y-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-outline-variant/20 pb-3">
                        <div className="flex items-center gap-2">
                          <span className="font-serif text-base font-semibold text-primary">{chal.title}</span>
                          <span className="text-xs font-mono text-on-surface-variant">({chal.code})</span>
                        </div>
                        <span className="px-2.5 py-0.5 rounded-full bg-surface-container text-primary text-xs font-semibold">
                          Entry #{entry.entryNumber} • {entry.status === 'winner' ? 'Consensus Victor' : 'Qualifying Entry'}
                        </span>
                      </div>

                      <div className="space-y-1">
                        <div className="text-[11px] text-outline uppercase font-semibold">Tagline</div>
                        <p className="font-serif text-base text-primary italic">“{entry.tagline}”</p>
                      </div>

                      <div className="space-y-1">
                        <div className="text-[11px] text-outline uppercase font-semibold">Paragraph</div>
                        <p className="text-xs text-on-surface leading-relaxed">{entry.paragraph}</p>
                      </div>

                      <div className="pt-2 flex justify-end">
                        <Link
                          to={`/challenges/${chal.id}`}
                          className="text-xs font-semibold text-primary hover:underline flex items-center gap-1"
                        >
                          <span>View Full Challenge</span>
                          <span className="material-symbols-outlined text-xs">arrow_forward</span>
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: Refunds */}
          {activeTab === 'refunds' && (
            <div className="space-y-4">
              {refundedChallenges.length === 0 ? (
                <EmptyState
                  icon="history"
                  title="No Refunded Briefs"
                  message="When a brief you sponsor is cancelled before entries or expires unfilled, the locked prize escrow is credited back to your internal claimable credit on-chain."
                  actionLabel="Browse Creative Briefs"
                  onAction={() => window.location.assign('/challenges')}
                />
              ) : (
                <div className="space-y-4">
                  {refundedChallenges.map((chal) => (
                    <div
                      key={chal.id}
                      className="bg-surface-container-low/40 rounded-xl p-5 sm:p-6 border border-outline-variant/30 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6 hover:shadow-sm transition-all"
                    >
                      <div className="space-y-2 max-w-2xl">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-serif text-lg font-semibold text-primary">
                            {chal.title}
                          </span>
                          <span className="px-2 py-0.5 rounded-full bg-surface-container-highest text-primary text-xs font-semibold font-mono">
                            {chal.code}
                          </span>
                          <span className="px-2.5 py-0.5 rounded-full bg-error-container/40 text-error text-[11px] font-semibold">
                            Cancelled (Prize Refunded)
                          </span>
                        </div>
                        <p className="text-xs text-on-surface-variant leading-relaxed">
                          {chal.synopsis}
                        </p>
                        <div className="flex items-center gap-4 text-xs text-on-surface-variant pt-1 font-mono">
                          <span>Refunded Escrow: <strong className="text-primary">{chal.prizeAmount} test GEN</strong></span>
                          <span>•</span>
                          <span className="text-secondary font-medium">Credited to internal claimable balance</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        {canWithdraw && (
                          <button
                            type="button"
                            onClick={handleOpenWithdrawModal}
                            className="px-4 py-2 rounded-full bg-secondary-fixed text-on-secondary-fixed text-xs font-semibold hover:bg-secondary-fixed-dim transition-colors inline-flex items-center gap-1 shadow-sm"
                          >
                            <span>Withdraw Credit</span>
                            <span className="material-symbols-outlined text-xs">payments</span>
                          </button>
                        )}
                        <Link
                          to={`/challenges/${chal.id}`}
                          className="px-4 py-2 rounded-full bg-surface-container text-primary text-xs font-semibold hover:bg-surface-container-high transition-colors"
                        >
                          View Brief Specification
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

        </div>
        </>
        )}

      </div>

      {isWithdrawModalOpen && withdrawDraft && (
        <ContractPendingModal
          isOpen={isWithdrawModalOpen}
          actionType="withdraw"
          title={writesEnabled ? 'Review & Submit Withdrawal' : 'Review Draft: Withdraw Credit'}
          submitInput={withdrawDraft || controllerState.submitInput || undefined}
          nativeValueWei={0n}
          nativeValueGen="0"
          quote={controllerState.quote}
          quoteError={controllerState.quoteError}
          isEstimating={controllerState.phase === 'estimating'}
          txId={controllerState.txId}
          trackedStatus={controllerState.trackedStatus}
          childTransferStatus={controllerState.childTransferStatus}
          childTxId={controllerState.childTxId}
          observedChildFields={controllerState.observedChildFields}
          isSubmitting={controllerState.phase === 'submitting'}
          isDuplicateBlocked={controllerState.isDuplicateBlocked}
          unresolvedMessage={controllerState.unresolvedMessage}
          errorMessage={controllerState.errorMessage}
          walletAddress={address}
          onConfirmSubmit={async () => {
            await submit();
          }}
          onRetryEstimate={estimateFee}
          onReconcileCheckContract={handleReconcileCheckContract}
          onReconcileReleaseLock={handleReconcileReleaseLock}
          onClose={() => setIsWithdrawModalOpen(false)}
        />
      )}
    </div>
  );
};
