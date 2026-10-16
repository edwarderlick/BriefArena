import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import type { SubmitInput, TransactionKit } from '@genlayer/transaction-kit';
import { Challenge, Entry } from '../types';
import { dataService } from '../services/dataService';
import { useWallet } from '../context/WalletContext';
import {
  buildCancelChallengeSubmitInput,
  buildCloseDeadlineSubmitInput,
  buildExpireZeroEntriesSubmitInput,
  buildCommitJudgingSubmitInput,
  buildAttemptJudgementSubmitInput,
  buildTimeoutJudgementSubmitInput,
} from '../services/transactionService';
import { CONTRACT_ADDRESS } from '../services/contractClient';
import {
  useTransactionController,
  useTransactionKit,
  type ActionPreconditionParams,
  type TransactionActionType,
} from '../services/transactionController';
import { DesignPreviewBanner } from '../components/DesignPreviewBanner';
import { StatusBadge } from '../components/StatusBadge';
import { LoadingState, EmptyState } from '../components/StateViews';
import { ContractPendingModal } from '../components/ContractPendingModal';

type LifecycleAction =
  | 'cancel_challenge'
  | 'close_deadline'
  | 'expire_zero_entries'
  | 'commit_judging'
  | 'attempt_judgement'
  | 'timeout_judgement';


export interface LifecycleEligibilityResult {
  canPrepareDraft: boolean;
  isExecutionTimeVerified: boolean;
  isEligible: boolean; // Retained for execution eligibility: true ONLY if execution preconditions are verified. For close_deadline, expire_zero_entries, timeout_judgement, this is strictly false!
  ineligibleReason: string | null;
  warningNotice?: string | null;
}

export function evaluateLifecycleEligibility(
  action: LifecycleAction,
  challenge: Challenge,
  options?: {
    isConnected?: boolean;
    address?: string | null;
  }
): LifecycleEligibilityResult {
  const isConnected = options?.isConnected ?? false;
  const address = options?.address ?? null;

  const isNumericId = /^\d+$/.test(challenge.id);

  if (challenge.isFixture || !isNumericId) {
    return {
      canPrepareDraft: false,
      isExecutionTimeVerified: false,
      isEligible: false,
      ineligibleReason:
        action === 'cancel_challenge'
          ? 'Cancellation draft unavailable: this brief is a design fixture, not a live on-chain contract record. Fixture briefs cannot generate transaction calldata.'
          : 'Lifecycle draft unavailable: this brief is a design fixture, not a live on-chain contract record. Fixture briefs cannot generate transaction calldata.',
    };
  }

  const isSponsor = Boolean(
    address &&
    challenge.sponsorAddress &&
    address.toLowerCase() === challenge.sponsorAddress.toLowerCase()
  );
  const isOpen = challenge.status === 'open';
  const isClosed = challenge.status === 'closed';
  const isJudging = challenge.status === 'judging';
  const hasZeroEntries = challenge.filledSlots === 0;

  const hasDeadlineTimestamp =
    typeof challenge.deadlineTimestamp === 'number' && Number.isFinite(challenge.deadlineTimestamp);
  const isJudgingStartedAtVerified =
    typeof challenge.judgingStartedAtTimestamp === 'number' &&
    Number.isFinite(challenge.judgingStartedAtTimestamp);
  const isJudgingStartedAtZero = isJudgingStartedAtVerified && challenge.judgingStartedAtTimestamp === 0;
  const hasPositiveJudgingStartedAt =
    isJudgingStartedAtVerified && challenge.judgingStartedAtTimestamp! > 0;

  switch (action) {
    case 'cancel_challenge': {
      if (!isConnected) {
        return { canPrepareDraft: false, isExecutionTimeVerified: false, isEligible: false, ineligibleReason: 'Connect the sponsor wallet that created this brief to prepare a cancellation draft.' };
      }
      if (!isSponsor) {
        return {
          canPrepareDraft: false,
          isExecutionTimeVerified: false,
          isEligible: false,
          ineligibleReason: `Connected wallet (${address ? `${address.slice(0, 6)}...${address.slice(-4)}` : 'none'}) is not the sponsor (${challenge.sponsorAddress.slice(0, 6)}...${challenge.sponsorAddress.slice(-4)}). Only the sponsor can cancel an open brief.`,
        };
      }
      if (!isOpen) {
        return { canPrepareDraft: false, isExecutionTimeVerified: false, isEligible: false, ineligibleReason: `Cancellation is permitted only while the brief is in OPEN status (current status: ${challenge.status.toUpperCase()}).` };
      }
      if (!hasZeroEntries) {
        return { canPrepareDraft: false, isExecutionTimeVerified: false, isEligible: false, ineligibleReason: `Cancellation is prohibited because ${challenge.filledSlots} entry/entries have already been submitted. The contract strictly requires 0 active entries.` };
      }
      return { canPrepareDraft: true, isExecutionTimeVerified: true, isEligible: true, ineligibleReason: null };
    }

    case 'close_deadline': {
      if (!isOpen) {
        return { canPrepareDraft: false, isExecutionTimeVerified: false, isEligible: false, ineligibleReason: `close_deadline is permitted only while brief is in OPEN status (current status: ${challenge.status.toUpperCase()}).` };
      }
      if (challenge.filledSlots < 1) {
        return { canPrepareDraft: false, isExecutionTimeVerified: false, isEligible: false, ineligibleReason: 'Cannot close deadline with zero entries: at least 1 entry is required. If deadline expired with zero entries, use expire_zero_entries.' };
      }
      if (!hasDeadlineTimestamp) {
        return { canPrepareDraft: false, isExecutionTimeVerified: false, isEligible: false, ineligibleReason: 'Time eligibility unverified: on-chain deadline timestamp is unset or malformed.' };
      }
      return {
        canPrepareDraft: true,
        isExecutionTimeVerified: false,
        isEligible: false,
        ineligibleReason: null,
        warningNotice: 'Execution time unverified; an early transaction can fail and incur fees.',
      };
    }

    case 'expire_zero_entries': {
      if (!isOpen) {
        return { canPrepareDraft: false, isExecutionTimeVerified: false, isEligible: false, ineligibleReason: `expire_zero_entries is permitted only while brief is in OPEN status (current status: ${challenge.status.toUpperCase()}).` };
      }
      if (challenge.filledSlots > 0) {
        return { canPrepareDraft: false, isExecutionTimeVerified: false, isEligible: false, ineligibleReason: `Cannot expire zero entries: brief has ${challenge.filledSlots} active entry/entries.` };
      }
      if (!hasDeadlineTimestamp) {
        return { canPrepareDraft: false, isExecutionTimeVerified: false, isEligible: false, ineligibleReason: 'Time eligibility unverified: on-chain deadline timestamp is unset or malformed.' };
      }
      return {
        canPrepareDraft: true,
        isExecutionTimeVerified: false,
        isEligible: false,
        ineligibleReason: null,
        warningNotice: 'Execution time unverified; an early transaction can fail and incur fees.',
      };
    }

    case 'commit_judging': {
      if (!isClosed) {
        return { canPrepareDraft: false, isExecutionTimeVerified: false, isEligible: false, ineligibleReason: `commit_judging is permitted only while brief is in CLOSED status (current status: ${challenge.status.toUpperCase()}).` };
      }
      if (challenge.filledSlots < 1) {
        return { canPrepareDraft: false, isExecutionTimeVerified: false, isEligible: false, ineligibleReason: 'Cannot commit judging: brief has 0 submitted entries.' };
      }
      if (!isJudgingStartedAtVerified) {
        return { canPrepareDraft: false, isExecutionTimeVerified: false, isEligible: false, ineligibleReason: 'Time eligibility unverified: on-chain judging start timestamp is unset or malformed.' };
      }
      if (challenge.judgingStartedAtTimestamp! > 0) {
        return { canPrepareDraft: false, isExecutionTimeVerified: false, isEligible: false, ineligibleReason: 'Judging deliberation has already been committed for this brief.' };
      }
      if (!isJudgingStartedAtZero) {
        return { canPrepareDraft: false, isExecutionTimeVerified: false, isEligible: false, ineligibleReason: 'Time eligibility unverified: on-chain judging start timestamp is unset or malformed.' };
      }
      return { canPrepareDraft: true, isExecutionTimeVerified: true, isEligible: true, ineligibleReason: null };
    }

    case 'attempt_judgement': {
      if (!isJudging) {
        return { canPrepareDraft: false, isExecutionTimeVerified: false, isEligible: false, ineligibleReason: `attempt_judgement is permitted only while brief is in JUDGING status (current status: ${challenge.status.toUpperCase()}).` };
      }
      return { canPrepareDraft: true, isExecutionTimeVerified: true, isEligible: true, ineligibleReason: null };
    }

    case 'timeout_judgement': {
      if (!isJudging) {
        return { canPrepareDraft: false, isExecutionTimeVerified: false, isEligible: false, ineligibleReason: `timeout_judgement is permitted only while brief is in JUDGING status (current status: ${challenge.status.toUpperCase()}).` };
      }
      if (!isJudgingStartedAtVerified) {
        return { canPrepareDraft: false, isExecutionTimeVerified: false, isEligible: false, ineligibleReason: 'Time eligibility unverified: on-chain judging start timestamp is unset or malformed. Cannot infer a 48-hour judging timeout from an unset timestamp or fixture.' };
      }
      if (challenge.judgingStartedAtTimestamp === 0) {
        return { canPrepareDraft: false, isExecutionTimeVerified: false, isEligible: false, ineligibleReason: 'Judging start timestamp is unset. Cannot infer a 48-hour judging timeout from an unset timestamp or fixture.' };
      }
      if (!hasPositiveJudgingStartedAt) {
        return { canPrepareDraft: false, isExecutionTimeVerified: false, isEligible: false, ineligibleReason: 'Time eligibility unverified: on-chain judging start timestamp is unset or malformed. Cannot infer a 48-hour judging timeout from an unset timestamp or fixture.' };
      }
      return {
        canPrepareDraft: true,
        isExecutionTimeVerified: false,
        isEligible: false,
        ineligibleReason: null,
        warningNotice: 'Execution time unverified; an early transaction can fail and incur fees.',
      };
    }

    default:
      return { canPrepareDraft: false, isExecutionTimeVerified: false, isEligible: false, ineligibleReason: `Unknown lifecycle action: ${action}` };
  }
}

export const ChallengeDetailPage: React.FC<{ kit?: TransactionKit | null }> = ({
  kit: injectedKit = null,
}) => {
  const { id } = useParams<{ id: string }>();
  const { isConnected, address, chainId, isCorrectNetwork } = useWallet();
  const { kit } = useTransactionKit(injectedKit);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [activeModalAction, setActiveModalAction] = useState<LifecycleAction | null>(null);
  const [activeDraft, setActiveDraft] = useState<SubmitInput | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const cId = /^\d+$/.test(challenge?.id || '') ? BigInt(challenge!.id) : null;

  const controllerParams: ActionPreconditionParams = useMemo(() => ({
    actionType: (activeModalAction || 'close_deadline') as TransactionActionType,
    walletState: {
      isConnected,
      address,
      chainId,
      isCorrectNetwork,
    },
    contractAddress: CONTRACT_ADDRESS as any,
    currentChallenge: challenge,
    lifecycleValues: cId ? { challengeId: cId } : undefined,
    cancelChallengeValues: cId ? { challengeId: cId } : undefined,
  }), [activeModalAction, isConnected, address, chainId, isCorrectNetwork, challenge, cId]);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      if (!id) {
        setChallenge(null);
        return;
      }
      const found = await dataService.getChallengeById(id);
      setChallenge(found);
      if (found) {
        const entryList = await dataService.getEntriesForChallenge(found.id);
        setEntries(entryList);
      }
    } catch (err: any) {
      console.error('Error reading challenge from Studio Next:', err);
      setLoadError(err?.message || 'RPC Read Failure');
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  const {
    state: controllerState,
    submit,
    estimateFee,
  } = useTransactionController(controllerParams, kit, load);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (activeModalAction && activeDraft && kit) {
      estimateFee().catch((feeErr) => {
        console.warn(`Real fee quote estimation failed for ${activeModalAction}:`, feeErr);
      });
    }
  }, [activeModalAction, activeDraft, kit, estimateFee]);

  if (isLoading) {
    return <LoadingState message="Loading frozen brief specification..." />;
  }

  if (loadError) {
    return (
      <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-12 py-12 flex flex-col items-center gap-4">
        <EmptyState
          title="Studio Next RPC / Contract Read Error"
          message={loadError}
          actionLabel="Retry Live Read"
          onAction={load}
          icon="sync_problem"
        />
        <Link
          to="/challenges"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-surface-container text-on-surface hover:bg-surface-container-high transition-colors text-xs font-semibold"
        >
          <span className="material-symbols-outlined text-sm">west</span>
          <span>Back to Explore</span>
        </Link>
      </div>
    );
  }

  if (!challenge) {
    return (
      <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-12 py-12">
        <EmptyState
          title="Challenge Not Found"
          message={`No brief matching identifier "${id}" could be retrieved.`}
          actionLabel="Back to Explore"
          onAction={() => window.history.back()}
        />
      </div>
    );
  }

  const remainingSlots = challenge.maxSlots - challenge.filledSlots;
  const isSubmissionOpen = challenge.status === 'open' && remainingSlots > 0;

  // Evaluate action eligibility via single deterministic authority
  const cancelEval = evaluateLifecycleEligibility('cancel_challenge', challenge, { isConnected, address });
  const canPrepareCancel = cancelEval.canPrepareDraft;
  const cancelIneligibleReason = cancelEval.ineligibleReason;

  const closeDeadlineEval = evaluateLifecycleEligibility('close_deadline', challenge, { isConnected, address });
  const canPrepareCloseDeadline = closeDeadlineEval.canPrepareDraft;
  const closeDeadlineReason = closeDeadlineEval.ineligibleReason;

  const expireZeroEval = evaluateLifecycleEligibility('expire_zero_entries', challenge, { isConnected, address });
  const canPrepareExpireZeroEntries = expireZeroEval.canPrepareDraft;
  const expireZeroEntriesReason = expireZeroEval.ineligibleReason;

  const commitJudgingEval = evaluateLifecycleEligibility('commit_judging', challenge, { isConnected, address });
  const canPrepareCommitJudging = commitJudgingEval.canPrepareDraft;
  const commitJudgingReason = commitJudgingEval.ineligibleReason;

  const attemptJudgementEval = evaluateLifecycleEligibility('attempt_judgement', challenge, { isConnected, address });
  const canPrepareAttemptJudgement = attemptJudgementEval.canPrepareDraft;
  const attemptJudgementReason = attemptJudgementEval.ineligibleReason;

  const timeoutJudgementEval = evaluateLifecycleEligibility('timeout_judgement', challenge, { isConnected, address });
  const canPrepareTimeoutJudgement = timeoutJudgementEval.canPrepareDraft;
  const timeoutJudgementReason = timeoutJudgementEval.ineligibleReason;

  const handleOpenDraftModal = (action: LifecycleAction) => {
    setActionError(null);

    // Recheck action draft eligibility before building draft; contract preconditions are final authority
    const eligibility = evaluateLifecycleEligibility(action, challenge, { isConnected, address });
    if (!eligibility.canPrepareDraft) {
      setActionError(eligibility.ineligibleReason || `Cannot prepare draft for ${action}`);
      return;
    }

    try {
      let draft: SubmitInput;
      const cId = BigInt(challenge.id);
      switch (action) {
        case 'cancel_challenge':
          draft = buildCancelChallengeSubmitInput({ challengeId: cId });
          break;
        case 'close_deadline':
          draft = buildCloseDeadlineSubmitInput({ challengeId: cId });
          break;
        case 'expire_zero_entries':
          draft = buildExpireZeroEntriesSubmitInput({ challengeId: cId });
          break;
        case 'commit_judging':
          draft = buildCommitJudgingSubmitInput({ challengeId: cId });
          break;
        case 'attempt_judgement':
          draft = buildAttemptJudgementSubmitInput({ challengeId: cId });
          break;
        case 'timeout_judgement':
          draft = buildTimeoutJudgementSubmitInput({ challengeId: cId });
          break;
      }
      setActiveDraft(draft);
      setActiveModalAction(action);
    } catch (err: any) {
      setActionError(err?.message || `Failed to build ${action} draft`);
    }
  };

  const getModalTitle = (action: LifecycleAction): string => {
    switch (action) {
      case 'cancel_challenge':
        return 'Review Draft: Cancel Challenge';
      case 'close_deadline':
        return 'Review Draft: Close Deadline';
      case 'expire_zero_entries':
        return 'Review Draft: Expire Zero Entries';
      case 'commit_judging':
        return 'Review Draft: Commit Judging';
      case 'attempt_judgement':
        return 'Review Draft: Attempt Judgement';
      case 'timeout_judgement':
        return 'Review Draft: Timeout Judgement';
    }
  };

  return (
    <div className="flex flex-col w-full pb-20">
      <DesignPreviewBanner
        isFixture={challenge.isFixture}
        contractAddress={challenge.contractAddress}
        message={`Design preview — sample brief "${challenge.title}". This is a design fixture; not a live contract.`}
      />

      <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-12 py-8 flex flex-col gap-8">
        
        {/* Top Utility & Metadata Track */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 pb-2 border-b border-outline-variant/20">
          <div className="flex items-center gap-3 flex-wrap">
            <Link
              to="/challenges"
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-surface-container text-on-surface hover:bg-surface-container-high transition-colors text-xs font-semibold"
            >
              <span className="material-symbols-outlined text-sm">west</span>
              <span>Back to Explore</span>
            </Link>
            <span className="text-outline-variant text-xs">/</span>
            <div className="flex items-center gap-1.5 text-xs font-mono text-on-surface-variant bg-surface-container-low px-3 py-1 rounded-full">
              <span className="text-on-tertiary-fixed-variant">CHALLENGE</span>
              <span className="text-on-surface font-bold">{challenge.code}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={challenge.status} />
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-tertiary-container text-primary-fixed-dim text-xs font-mono">
              <span className="material-symbols-outlined text-xs text-primary-fixed">hub</span>
              <span>Studio Next (Chain 61997)</span>
            </div>
          </div>
        </div>

        {/* Editorial Canvas Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          
          {/* Primary Left Column: Frozen Brief & Core Requirements (8 cols) */}
          <div className="lg:col-span-8 flex flex-col gap-8">
            
            {/* Frozen Brief Editorial Card */}
            <div className="relative bg-surface-container-lowest rounded-xl p-6 sm:p-8 lg:p-10 shadow-sm border border-outline-variant/30 flex flex-col gap-6 overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-primary-container via-surface-container-highest to-secondary-container"></div>
              
              {/* Cryptographic Seal Banner */}
              <div className="flex items-center justify-between gap-4 flex-wrap pt-1">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-surface-container text-on-surface text-xs font-semibold">
                  <span className="material-symbols-outlined text-sm text-primary">lock</span>
                  <span>Cryptographically Frozen Specification</span>
                </div>
                <span className="text-xs font-mono text-on-surface-variant">
                  {challenge.isFixture ? "Sample Fixture Parameter Set" : "Live Contract Parameter Set"}
                </span>
              </div>

              {/* Main Challenge Headline & Sponsor */}
              <div className="space-y-2">
                <h1 className="font-serif text-3xl sm:text-4xl lg:text-5xl text-primary tracking-tight">
                  {challenge.title}
                </h1>
                <div className="flex items-center gap-2 flex-wrap text-on-surface-variant text-xs">
                  <span className="uppercase tracking-wider text-outline font-semibold">Sponsor Address:</span>
                  <span className="bg-surface-container-low px-2.5 py-0.5 rounded-full font-mono text-on-surface">
                    {challenge.sponsorAddress}
                  </span>
                  <span className="text-on-tertiary-fixed-variant font-medium">• Sponsor Escrow Creator</span>
                </div>
              </div>

              {/* Product Synopsis */}
              <div className="space-y-2 bg-surface-container-low/60 p-5 rounded-lg border border-outline-variant/20">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-base text-primary">description</span>
                  <h2 className="text-xs font-semibold text-primary uppercase tracking-wider">Product Synopsis</h2>
                </div>
                <p className="text-base text-on-surface leading-relaxed">
                  {challenge.synopsis}
                </p>
              </div>

              {/* Requirements Mosaic: Required vs Prohibited */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Mandatory Messages */}
                <div className="p-5 rounded-lg bg-surface-container-low flex flex-col justify-between gap-4 border border-outline-variant/20">
                  <div className="space-y-2">
                    <div className="inline-flex items-center gap-1.5 text-primary text-sm font-semibold">
                      <span className="material-symbols-outlined text-base">check_circle</span>
                      <span>Mandatory Requirements</span>
                    </div>
                    <p className="text-xs text-on-surface-variant">
                      Submissions must strictly foreground the following core architectural pillars:
                    </p>
                    <ul className="space-y-1.5 text-xs text-on-surface pt-1">
                      {challenge.mandatoryRequirements.map((req, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="material-symbols-outlined text-xs text-primary mt-0.5">arrow_forward</span>
                          <span>{req}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                {/* Prohibited Buzzwords */}
                <div className="p-5 rounded-lg bg-surface-container-low flex flex-col justify-between gap-4 border border-outline-variant/20">
                  <div className="space-y-2">
                    <div className="inline-flex items-center gap-1.5 text-error text-sm font-semibold">
                      <span className="material-symbols-outlined text-base">cancel</span>
                      <span>Disqualifying Vocabulary</span>
                    </div>
                    <p className="text-xs text-on-surface-variant">
                      Literal mention of any prohibited term immediately triggers on-chain disqualification:
                    </p>
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {challenge.prohibitedTerms.map((term, i) => (
                        <span
                          key={i}
                          className="px-2.5 py-1 rounded bg-error-container/40 text-on-error-container text-xs font-mono font-medium border border-error-container"
                        >
                          {term}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

            </div>

            {/* Submissions Manifest Section */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h2 className="font-serif text-2xl text-primary">Submissions Ledger</h2>
                  <span className="px-2.5 py-0.5 rounded-full bg-surface-container text-xs font-mono font-bold text-on-surface">
                    {challenge.filledSlots} / {challenge.maxSlots}
                  </span>
                </div>
                <span className="text-xs font-mono text-outline">Deterministic Evaluation Rubric</span>
              </div>

              {entries.length === 0 ? (
                <div className="p-8 rounded-xl bg-surface-container-lowest border border-outline-variant/30 text-center space-y-2">
                  <p className="text-sm font-semibold text-primary">No submissions registered yet.</p>
                  <p className="text-xs text-on-surface-variant max-w-md mx-auto">
                    {isSubmissionOpen
                      ? "Be the first copywriter to claim one of the 3 strictly bounded entry slots."
                      : "Submission period ended with 0 entries recorded on-chain."}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4">
                  {entries.map((entry) => (
                    <div
                      key={entry.id}
                      className="p-6 rounded-xl bg-surface-container-lowest border border-outline-variant/30 shadow-sm space-y-3"
                    >
                      <div className="flex items-center justify-between border-b border-outline-variant/20 pb-3">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded bg-surface-container font-mono text-xs font-bold text-primary">
                            SLOT #{entry.entryNumber}
                          </span>
                          <span className="text-xs font-mono text-on-surface-variant">
                            {entry.authorAddress.slice(0, 6)}...{entry.authorAddress.slice(-4)}
                          </span>
                        </div>
                        <span className="text-xs font-mono text-outline">{entry.submittedAtDisplay}</span>
                      </div>
                      <blockquote className="font-serif text-lg text-primary italic">
                        &ldquo;{entry.tagline}&rdquo;
                      </blockquote>
                      <p className="text-xs text-on-surface leading-relaxed">
                        {entry.paragraph}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>

          {/* Sidebar / Action CTA Dock (4 cols) */}
          <div className="lg:col-span-4 flex flex-col gap-6">
            
            {/* Escrow Value Card */}
            <div className="bg-surface-container-lowest rounded-xl p-6 shadow-sm border border-outline-variant/30 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-outline uppercase tracking-wider font-semibold">
                  {challenge.status === 'canceled'
                    ? 'Refunded Escrow Prize'
                    : challenge.status === 'awarded'
                    ? 'Awarded Prize Pool'
                    : challenge.status === 'no-winner'
                    ? 'Refunded Prize Pool'
                    : 'Locked Escrow'}
                </span>
                <span className="material-symbols-outlined text-base text-secondary">
                  {challenge.status === 'canceled' ? 'cancel' : challenge.status === 'awarded' || challenge.status === 'no-winner' ? 'task_alt' : 'verified'}
                </span>
              </div>
              <div className="space-y-1">
                <div
                  className={`text-3xl font-serif font-bold ${
                    challenge.status === 'canceled'
                      ? 'text-on-surface-variant line-through decoration-error/50'
                      : 'text-primary'
                  }`}
                >
                  {challenge.prizeAmount} {challenge.prizeCurrency}
                </div>
                <p className="text-xs text-on-surface-variant">
                  {challenge.status === 'canceled'
                    ? `0.00 test GEN locked in contract escrow — ${challenge.prizeAmount} test GEN was returned to sponsor claimable credit upon cancellation.`
                    : challenge.status === 'awarded'
                    ? `0.00 test GEN locked — prize was settled on-chain and paid out to the winning creator.`
                    : challenge.status === 'no-winner'
                    ? `0.00 test GEN locked — consensus finished with no qualified winner; prize refunded to sponsor claimable credit.`
                    : `≈ $${(challenge.prizeAmount * 0.15).toFixed(2)} USD value locked in contract escrow`}
                </p>
              </div>
              <div className="p-2.5 rounded bg-surface-container text-[11px] text-on-surface-variant flex items-center justify-between">
                <span>Escrow Status:</span>
                <span
                  className={`font-mono font-semibold ${
                    challenge.status === 'canceled'
                      ? 'text-error'
                      : challenge.status === 'no-winner'
                      ? 'text-secondary'
                      : 'text-primary'
                  }`}
                >
                  {challenge.status === 'canceled'
                    ? '0 Locked (Refunded to Sponsor)'
                    : challenge.status === 'awarded'
                    ? 'Settled (Paid to Winner)'
                    : challenge.status === 'no-winner'
                    ? '0 Locked (Refunded to Sponsor)'
                    : 'Verifiably Locked'}
                </span>
              </div>
            </div>

            {/* Deadline & Slot Status Card */}
            <div className="bg-surface-container-lowest rounded-xl p-6 shadow-sm border border-outline-variant/30 flex flex-col gap-4">
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-outline uppercase tracking-wider font-semibold">
                    {challenge.status === 'open' ? 'Submission Window' : 'Lifecycle Status'}
                  </span>
                  <span className="material-symbols-outlined text-base text-secondary">
                    {challenge.status === 'canceled'
                      ? 'cancel'
                      : challenge.status === 'awarded' || challenge.status === 'no-winner'
                      ? 'task_alt'
                      : 'timer'}
                  </span>
                </div>
                <p className="text-sm font-semibold text-primary">
                  {challenge.status === 'canceled'
                    ? 'Challenge Cancelled'
                    : challenge.status === 'awarded'
                    ? 'Challenge Settled'
                    : challenge.status === 'no-winner'
                    ? 'Settled (No Winner)'
                    : challenge.deadlineDisplay}
                </p>
                <div
                  className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-xs font-medium ${
                    challenge.status === 'canceled'
                      ? 'bg-error-container/40 text-error'
                      : challenge.status === 'awarded' || challenge.status === 'no-winner'
                      ? 'bg-surface-container text-primary'
                      : 'bg-secondary-container/50 text-on-secondary-container'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      challenge.status === 'canceled' ? 'bg-error' : 'bg-secondary'
                    }`}
                  ></span>
                  <span>
                    {challenge.status === 'canceled'
                      ? 'Cancelled (Prize Refunded to Sponsor)'
                      : challenge.status === 'awarded'
                      ? 'Settled (Winner Awarded)'
                      : challenge.status === 'no-winner'
                      ? 'Settled (No Winner — Refunded)'
                      : challenge.status === 'closed'
                      ? 'Submission Window Closed'
                      : challenge.status === 'judging'
                      ? 'In Consensus Deliberation'
                      : challenge.remainingTime}
                  </span>
                </div>
                <p className="text-[10px] text-on-surface-variant leading-tight">
                  {challenge.status === 'canceled'
                    ? 'Submission window ended upon cancellation. No entries can be submitted.'
                    : challenge.status === 'awarded' || challenge.status === 'no-winner'
                    ? 'Challenge concluded and settled on-chain.'
                    : 'Browser clock local estimate — consensus deadline is enforced at transaction execution on-chain.'}
                </p>
              </div>

              {/* Minimalist Ring Gauge */}
              <div className="p-3.5 rounded-lg bg-surface-container flex items-center gap-4">
                <div className="relative w-14 h-14 shrink-0 flex items-center justify-center">
                  <svg className="w-14 h-14 transform -rotate-90" viewBox="0 0 36 36">
                    <path
                      className="text-surface-container-high"
                      d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3.5"
                    />
                    <path
                      className="text-primary"
                      d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                      fill="none"
                      stroke="currentColor"
                      strokeDasharray={`${(challenge.filledSlots / challenge.maxSlots) * 100}, 100`}
                      strokeLinecap="round"
                      strokeWidth="3.5"
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-xs font-bold font-mono text-primary leading-none">
                      {challenge.filledSlots}/{challenge.maxSlots}
                    </span>
                  </div>
                </div>
                <div className="flex-1 space-y-0.5">
                  <span className="text-xs font-semibold text-primary">Slots Filled</span>
                  <p className="text-[11px] text-on-surface-variant">
                    {challenge.filledSlots} of {challenge.maxSlots} maximum entries. {remainingSlots} open.
                  </p>
                </div>
              </div>

              {/* Action CTA & Lifecycle Controls Dock */}
              <div className="pt-2 space-y-3">
                {/* 1. Terminal Decisions (AWARDED / NO_WINNER) */}
                {challenge.status === 'awarded' || challenge.status === 'no-winner' ? (
                  <Link
                    to={`/challenges/${challenge.id}/decision`}
                    className="w-full flex items-center justify-center gap-2 py-3 px-6 rounded-full bg-primary text-on-primary text-xs sm:text-sm font-semibold shadow hover:bg-primary-container transition-all text-center"
                  >
                    <span>{challenge.status === 'no-winner' ? 'View Consensus Verdict' : 'View Settlement Decision'}</span>
                    <span className="material-symbols-outlined text-base">gavel</span>
                  </Link>
                ) : null}

                {/* 2. JUDGING State Controls */}
                {challenge.status === 'judging' && (
                  <div className="space-y-3">
                    <div className="p-3 rounded-xl bg-surface-container-low border border-outline-variant/30 space-y-1 text-xs">
                      <div className="flex items-center gap-1.5 font-semibold text-primary">
                        <span className="material-symbols-outlined text-xs text-secondary">psychology</span>
                        <span>Deliberation in Progress</span>
                      </div>
                      <p className="leading-relaxed text-[11px] text-on-surface-variant">
                        AI validators perform comparative consensus against the frozen rubric. If consensus fails or remains undetermined, the transaction reverts with zero state change and escrow stays locked in the contract (retryable anytime).
                      </p>
                    </div>

                    {/* attempt_judgement control */}
                    {canPrepareAttemptJudgement ? (
                      <button
                        type="button"
                        id="attempt-judgement-draft-btn"
                        onClick={() => handleOpenDraftModal('attempt_judgement')}
                        className="w-full py-2.5 px-4 rounded-full bg-primary text-on-primary text-xs font-semibold hover:bg-primary/90 transition-all flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-sm">gavel</span>
                        <span>Review Attempt Judgement Draft</span>
                      </button>
                    ) : (
                      <div className="p-2.5 rounded-lg bg-surface-container text-on-surface-variant text-[11px]">
                        {attemptJudgementReason}
                      </div>
                    )}

                    {/* timeout_judgement control */}
                    {canPrepareTimeoutJudgement ? (
                      <div className="space-y-1.5">
                        <button
                          type="button"
                          id="timeout-judgement-draft-btn"
                          onClick={() => handleOpenDraftModal('timeout_judgement')}
                          className="w-full py-2.5 px-4 rounded-full bg-error-container text-on-error-container text-xs font-semibold hover:bg-error-container/80 transition-all flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
                        >
                          <span className="material-symbols-outlined text-sm">timer_off</span>
                          <span>Review Timeout Judgement Draft</span>
                        </button>
                        <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[10px] text-amber-900 dark:text-amber-200 leading-tight px-2 text-center">
                          <span className="font-semibold block">Execution time unverified; an early transaction can fail and incur fees.</span>
                          <span>Contract strictly enforces 48h timeout (<code className="font-mono">now &gt;= judgingStartedAt + 172800</code>) at execution via validator consensus datetime. Browser clock is a local estimate.</span>
                        </div>
                      </div>
                    ) : (
                      <div className="p-2.5 rounded-lg bg-surface-container text-on-surface-variant text-[11px] border border-outline-variant/20">
                        <span className="font-semibold block text-primary">48h Timeout Notice:</span>
                        <span>{timeoutJudgementReason}</span>
                      </div>
                    )}

                    <Link
                      to={`/challenges/${challenge.id}/decision`}
                      className="w-full inline-flex items-center justify-center gap-1.5 py-2 px-4 rounded-full bg-surface-container text-on-surface hover:bg-surface-container-high transition-colors text-xs font-medium text-center"
                    >
                      <span>View Deliberation Status</span>
                      <span className="material-symbols-outlined text-xs">arrow_forward</span>
                    </Link>
                  </div>
                )}

                {/* 3. CLOSED State Controls */}
                {challenge.status === 'closed' && (
                  <div className="space-y-3">
                    <div className="p-3 rounded-xl bg-surface-container-low border border-outline-variant/30 space-y-1 text-xs">
                      <div className="flex items-center gap-1.5 font-semibold text-primary">
                        <span className="material-symbols-outlined text-xs text-secondary">lock_clock</span>
                        <span>Submissions Closed</span>
                      </div>
                      <p className="leading-relaxed text-[11px] text-on-surface-variant">
                        Submission window is closed with {challenge.filledSlots} entry/entries. The brief is ready for validator judging commitment.
                      </p>
                    </div>

                    {canPrepareCommitJudging ? (
                      <button
                        type="button"
                        id="commit-judging-draft-btn"
                        onClick={() => handleOpenDraftModal('commit_judging')}
                        className="w-full py-2.5 px-4 rounded-full bg-primary text-on-primary text-xs font-semibold hover:bg-primary/90 transition-all flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-sm">play_circle</span>
                        <span>Review Commit Judging Draft</span>
                      </button>
                    ) : (
                      <div className="p-2.5 rounded-lg bg-surface-container text-on-surface-variant text-[11px]">
                        {commitJudgingReason}
                      </div>
                    )}
                  </div>
                )}

                {/* 4. OPEN State Controls */}
                {challenge.status === 'open' && (
                  <div className="space-y-2">
                    {/* Submit Entry link if slots open */}
                    {isSubmissionOpen && (
                      <Link
                        to={`/challenges/${challenge.id}/submit`}
                        className="w-full flex items-center justify-center gap-2 py-3 px-6 rounded-full bg-primary text-on-primary text-xs sm:text-sm font-semibold shadow hover:bg-primary-container transition-all text-center"
                      >
                        <span>Submit Your Entry</span>
                        <span className="material-symbols-outlined text-base">arrow_forward</span>
                      </Link>
                    )}

                    {/* Cancel Challenge (Sponsor only, 0 entries) */}
                    {canPrepareCancel ? (
                      <button
                        type="button"
                        id="cancel-challenge-draft-btn"
                        onClick={() => handleOpenDraftModal('cancel_challenge')}
                        className="w-full py-2.5 px-4 rounded-full bg-error-container text-on-error-container text-xs font-semibold hover:bg-error-container/80 transition-all flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-sm">cancel</span>
                        <span>Review Cancel Challenge Draft</span>
                      </button>
                    ) : (
                      <div className="p-3 rounded-xl bg-surface-container-low border border-outline-variant/30 space-y-1 text-xs text-on-surface-variant">
                        <div className="flex items-center gap-1.5 font-semibold text-primary">
                          <span className="material-symbols-outlined text-xs text-secondary">info</span>
                          <span>Cancellation Unavailable</span>
                        </div>
                        <p className="leading-relaxed text-[11px]">
                          {cancelIneligibleReason}
                        </p>
                      </div>
                    )}

                    {/* Deadline reached lifecycle controls (close_deadline or expire_zero_entries) */}
                    {canPrepareCloseDeadline && (
                      <div className="space-y-1.5">
                        <button
                          type="button"
                          id="close-deadline-draft-btn"
                          onClick={() => handleOpenDraftModal('close_deadline')}
                          className="w-full py-2.5 px-4 rounded-full bg-secondary-container text-on-secondary-container text-xs font-semibold hover:bg-secondary-container/80 transition-all flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
                        >
                          <span className="material-symbols-outlined text-sm">lock</span>
                          <span>Review Close Deadline Draft</span>
                        </button>
                        <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[10px] text-amber-900 dark:text-amber-200 leading-tight px-2 text-center">
                          <span className="font-semibold block">Execution time unverified; an early transaction can fail and incur fees.</span>
                          <span>Contract strictly enforces deadline (<code className="font-mono">now &gt;= deadline</code>) at execution via validator consensus datetime. Browser clock is a local estimate.</span>
                        </div>
                      </div>
                    )}

                    {canPrepareExpireZeroEntries && (
                      <div className="space-y-1.5">
                        <button
                          type="button"
                          id="expire-zero-entries-draft-btn"
                          onClick={() => handleOpenDraftModal('expire_zero_entries')}
                          className="w-full py-2.5 px-4 rounded-full bg-secondary-container text-on-secondary-container text-xs font-semibold hover:bg-secondary-container/80 transition-all flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
                        >
                          <span className="material-symbols-outlined text-sm">hourglass_disabled</span>
                          <span>Review Expire Zero Entries Draft</span>
                        </button>
                        <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[10px] text-amber-900 dark:text-amber-200 leading-tight px-2 text-center">
                          <span className="font-semibold block">Execution time unverified; an early transaction can fail and incur fees.</span>
                          <span>Contract strictly enforces deadline (<code className="font-mono">now &gt;= deadline</code>) at execution via validator consensus datetime. Browser clock is a local estimate.</span>
                        </div>
                      </div>
                    )}

                    {/* Explanation if neither close_deadline nor expire_zero_entries is eligible */}
                    {!canPrepareCloseDeadline && !canPrepareExpireZeroEntries && (
                      <div className="p-2.5 rounded-lg bg-surface-container-low border border-outline-variant/20 text-[11px] text-on-surface-variant">
                        <span>{challenge.filledSlots >= 1 ? closeDeadlineReason : expireZeroEntriesReason}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* 5. CANCELED State Notice */}
                {challenge.status === 'canceled' && (
                  <div className="space-y-3">
                    <div className="p-3.5 rounded-xl bg-surface-container-low border border-outline-variant/30 space-y-1.5 text-xs">
                      <div className="flex items-center gap-1.5 font-semibold text-error">
                        <span className="material-symbols-outlined text-sm">cancel</span>
                        <span>Brief Cancelled</span>
                      </div>
                      <p className="leading-relaxed text-[11px] text-on-surface-variant">
                        This brief was cancelled and the prize escrow was returned to the sponsor's claimable credits. No further submissions or lifecycle actions can be executed.
                      </p>
                    </div>
                    <Link
                      to="/challenges"
                      className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-full bg-surface-container text-primary hover:bg-surface-container-highest transition-colors text-xs font-semibold text-center"
                    >
                      <span>Explore Active Creative Briefs</span>
                      <span className="material-symbols-outlined text-xs">arrow_forward</span>
                    </Link>
                  </div>
                )}

                {actionError && (
                  <div className="p-2.5 rounded-lg bg-error-container text-on-error-container text-xs">
                    {actionError}
                  </div>
                )}

                <p className="text-center text-[11px] text-on-surface-variant">
                  Network: Studio Next • Chain ID 61997 • Read-Only
                </p>
              </div>

              {/* Sponsor Immutability Notice */}
              <div className="p-3 rounded-lg bg-surface-container-low text-on-surface-variant flex items-start gap-2 text-xs">
                <span className="material-symbols-outlined text-base text-outline mt-0.5">info</span>
                <p>
                  <strong className="font-semibold text-on-surface">Sponsor Notice:</strong> Brief parameters cannot be modified or canceled once entries have arrived.
                </p>
              </div>
            </div>

          </div>

        </div>

      </div>

      {/* Lifecycle Draft Review Modal */}
      {activeModalAction && activeDraft && (
        <ContractPendingModal
          isOpen={Boolean(activeModalAction && activeDraft)}
          onClose={() => {
            setActiveModalAction(null);
            setActiveDraft(null);
          }}
          title={getModalTitle(activeModalAction)}
          actionType={activeModalAction}
          submitInput={activeDraft || controllerState.submitInput || undefined}
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
          onConfirmSubmit={async () => {
            await submit();
          }}
          onRetryEstimate={estimateFee}
          extraContext={{
            challengeCode: challenge.code,
            sponsorAddress: challenge.sponsorAddress,
          }}
        />
      )}
    </div>
  );
};
