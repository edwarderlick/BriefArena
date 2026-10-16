import React, { useState, useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Challenge } from '../types';
import { dataService } from '../services/dataService';
import { DesignPreviewBanner } from '../components/DesignPreviewBanner';
import { ContractPendingModal } from '../components/ContractPendingModal';
import { LoadingState, EmptyState } from '../components/StateViews';
import { useWallet } from '../context/WalletContext';
import {
  buildSubmitEntrySubmitInput,
  WRITES_ENABLED,
  type SubmitEntryFormValues,
} from '../services/transactionService';
import { CONTRACT_ADDRESS } from '../services/contractClient';
import {
  useTransactionController,
  useTransactionKit,
  type ActionPreconditionParams,
} from '../services/transactionController';
import type { SubmitInput, TransactionKit } from '@genlayer/transaction-kit';

export const SubmitEntryPage: React.FC<{ kit?: TransactionKit | null }> = ({
  kit: injectedKit = null,
}) => {
  const { id } = useParams<{ id: string }>();
  const { address, isConnected, chainId, isCorrectNetwork } = useWallet();
  const { kit } = useTransactionKit(injectedKit);
  const writesEnabled = WRITES_ENABLED;

  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Form fields & Prepared Draft
  const [tagline, setTagline] = useState('');
  const [paragraph, setParagraph] = useState('');
  const [confirmedAgreement, setConfirmedAgreement] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [preparedDraft, setPreparedDraft] = useState<SubmitInput | null>(null);
  const [unsuitableReason, setUnsuitableReason] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const load = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      if (!id) {
        setChallenge(null);
        return;
      }
      const found = await dataService.getChallengeById(id);
      setChallenge(found);
    } catch (err: any) {
      console.error('Failed reading challenge from Studio Next:', err);
      const msg = err?.message || 'RPC Read Failure';
      setLoadError(msg);
      setChallenge(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [id]);

  // Check whether this challenge is a live on-chain record with a numeric ID
  const isNumericId = Boolean(challenge && /^\d+$/.test(challenge.id));
  const isOnChainChallenge = Boolean(isNumericId && !challenge?.isFixture);
  const unsuitableIdReason = !challenge
    ? null
    : !isNumericId
    ? `Challenge identifier "${challenge.id}" is a fixture string, not a numeric on-chain ID. Chain-call drafts require a live numeric challenge ID with an on-chain record on Studio Next.`
    : challenge.isFixture
    ? `Challenge #${challenge.id} is a design fixture without an on-chain contract record. Chain-call drafts require a live contract record on Studio Next.`
    : null;

  // Real-time prohibited words scanning
  const combinedText = `${tagline} ${paragraph}`.toLowerCase();
  const detectedProhibited = challenge
    ? challenge.prohibitedTerms.filter(term => combinedText.includes(term.toLowerCase()))
    : [];
  const hasProhibited = detectedProhibited.length > 0;

  // Validation rules
  const isSubmissionOpen = Boolean(challenge && challenge.status === 'open' && challenge.filledSlots < challenge.maxSlots);
  const isTaglineValid = tagline.trim().length > 0 && tagline.length <= 60;
  const isParagraphValid = paragraph.trim().length >= 30 && paragraph.length <= 280;
  const isFormValid = isSubmissionOpen && isTaglineValid && isParagraphValid && !hasProhibited && confirmedAgreement;

  const submitValues: SubmitEntryFormValues = useMemo(() => ({
    challengeId: isNumericId && challenge ? BigInt(challenge.id) : 0n,
    tagline: tagline.trim(),
    paragraph: paragraph.trim(),
  }), [challenge, isNumericId, tagline, paragraph]);

  const controllerParams: ActionPreconditionParams = useMemo(() => ({
    actionType: 'entry_submission',
    walletState: {
      isConnected,
      address,
      chainId,
      isCorrectNetwork,
    },
    contractAddress: CONTRACT_ADDRESS as any,
    currentChallenge: challenge,
    submitEntryValues: submitValues,
    unsuitableReason: unsuitableIdReason || undefined,
  }), [isConnected, address, chainId, isCorrectNetwork, challenge, submitValues, unsuitableIdReason]);

  const {
    state: controllerState,
    submit,
    estimateFee,
  } = useTransactionController(controllerParams, kit);

  useEffect(() => {
    if (
      showModal &&
      preparedDraft &&
      kit &&
      !controllerState.quote &&
      !controllerState.quoteError &&
      controllerState.phase !== 'estimating' &&
      controllerState.phase !== 'error'
    ) {
      estimateFee().catch((feeErr) => {
        console.warn('Real fee quote estimation failed:', feeErr);
      });
    }
  }, [showModal, preparedDraft, kit, controllerState.quote, controllerState.quoteError, controllerState.phase, estimateFee]);

  if (isLoading) {
    return <LoadingState message="Loading challenge requirements..." />;
  }

  if (loadError) {
    return (
      <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-12 py-12">
        <EmptyState
          icon="cloud_off"
          title="Live Data Unavailable"
          message={`The Studio Next contract read is currently failing; retry or inspect the error. (${loadError})`}
          actionLabel="Retry Live Read"
          onAction={load}
        />
      </div>
    );
  }

  if (!challenge) {
    return (
      <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-12 py-12">
        <EmptyState
          title="Challenge Not Found"
          message={`No brief matching identifier "${id}" exists.`}
          actionLabel="Back to Explore"
          onAction={() => window.history.back()}
        />
      </div>
    );
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid || !challenge) return;
    setSubmitError(null);

    // If ID is unsuitable (fixture challenge), do not construct fabricated calldata!
    if (!isOnChainChallenge || unsuitableIdReason) {
      setPreparedDraft(null);
      setUnsuitableReason(
        unsuitableIdReason ||
        `Challenge "${challenge.id}" is a design fixture without an on-chain contract record. Chain-call drafts require a live numeric challenge ID and contract record on Studio Next.`
      );
      setShowModal(true);
      return;
    }

    try {
      const challengeIdBigInt = BigInt(challenge.id);
      const formValues: SubmitEntryFormValues = {
        challengeId: challengeIdBigInt,
        tagline: tagline.trim(),
        paragraph: paragraph.trim(),
      };
      const submitInput = buildSubmitEntrySubmitInput(formValues, CONTRACT_ADDRESS);
      setPreparedDraft(submitInput);
      setUnsuitableReason(null);
      setShowModal(true);
      if (kit) {
        estimateFee().catch((feeErr) => {
          console.warn('Real fee quote estimation failed:', feeErr);
        });
      }
    } catch (err: any) {
      console.error('Validation error preparing submit_entry draft:', err);
      setSubmitError(err?.message || 'Error preparing transaction draft');
      setPreparedDraft(null);
    }
  };

  return (
    <div className="flex flex-col w-full pb-20">
      <DesignPreviewBanner message={writesEnabled ? `Submit Entry desk for "${challenge.title}". Real on-chain quoting and submission active.` : `Submit Entry desk for "${challenge.title}". Client validation active; chain writes are disabled.`} />

      <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-12 py-8 flex flex-col gap-8">
        
        {/* Unsuitable ID / Fixture Banner */}
        {unsuitableIdReason && (
          <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-3 text-xs">
            <span className="material-symbols-outlined text-amber-600 text-lg shrink-0 mt-0.5">info</span>
            <div className="space-y-1">
              <strong className="text-on-surface font-semibold block">Design Preview Only — Chain Call Unavailable</strong>
              <p className="text-on-surface-variant leading-relaxed">
                {unsuitableIdReason}
              </p>
              <div className="pt-1">
                <Link
                  to="/challenges"
                  className="inline-flex items-center gap-1 text-primary font-semibold hover:underline"
                >
                  <span>Explore live on-chain challenges</span>
                  <span className="material-symbols-outlined text-xs">arrow_forward</span>
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* Submit Error Banner (e.g. CONTRACT_ADDRESS_MISSING) */}
        {submitError && (
          <div className="p-4 rounded-xl bg-error-container/40 border border-error/30 flex items-start gap-3 text-xs text-on-error-container">
            <span className="material-symbols-outlined text-error text-lg shrink-0 mt-0.5">error</span>
            <div className="space-y-0.5">
              <strong className="font-semibold block">Unable to prepare transaction draft</strong>
              <p>{submitError}</p>
            </div>
          </div>
        )}
        
        {/* Top Breadcrumb */}
        <div className="flex items-center justify-between gap-4 border-b border-outline-variant/20 pb-3">
          <div className="flex items-center gap-3">
            <Link
              to={`/challenges/${challenge.id}`}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-surface-container text-on-surface hover:bg-surface-container-high transition-colors text-xs font-semibold"
            >
              <span className="material-symbols-outlined text-sm">west</span>
              <span>Back to Brief</span>
            </Link>
            <span className="text-outline-variant text-xs">/</span>
            <span className="text-xs font-mono text-on-surface-variant font-medium">
              SUBMIT ENTRY • {challenge.code}
            </span>
          </div>

          <div className="text-xs text-on-surface-variant flex items-center gap-2">
            <span>Capacity:</span>
            <span className="font-mono font-semibold text-primary">
              {challenge.filledSlots} / {challenge.maxSlots} Slots
            </span>
          </div>
        </div>

        {/* Dual Column Architecture */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          
          {/* LEFT COLUMN: Frozen Brief Reference (5 cols) */}
          <aside className="lg:col-span-5 space-y-6 lg:sticky lg:top-24">
            
            {/* Brief Card */}
            <div className="bg-surface-container-lowest rounded-xl p-6 shadow-sm border border-outline-variant/30 space-y-6">
              <div className="flex items-start justify-between gap-4 border-b border-outline-variant/20 pb-4">
                <div>
                  <span className="px-2 py-0.5 rounded bg-surface-container-high text-primary text-[10px] uppercase font-mono font-bold tracking-wider">
                    Frozen Specimen
                  </span>
                  <h2 className="font-serif text-2xl text-on-surface mt-1.5 leading-tight">
                    {challenge.title}
                  </h2>
                  <p className="text-xs text-on-surface-variant mt-0.5">{challenge.category}</p>
                </div>
                <div className="w-10 h-10 rounded-full bg-surface-container flex items-center justify-center text-primary shrink-0">
                  <span className="material-symbols-outlined text-xl">terminal</span>
                </div>
              </div>

              {/* Product Synopsis snippet */}
              <div className="space-y-1 bg-surface-container-low p-4 rounded-lg">
                <span className="text-[11px] uppercase tracking-wider font-semibold text-on-surface-variant flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-xs text-primary">menu_book</span>
                  Core Premise
                </span>
                <p className="text-xs text-on-surface leading-relaxed italic line-clamp-4">
                  "{challenge.synopsis}"
                </p>
              </div>

              {/* Mandatory Requirements */}
              <div className="space-y-3">
                <span className="text-xs uppercase tracking-wider font-semibold text-on-surface block">
                  Mandatory Tenets (Adherence Required)
                </span>
                <div className="space-y-2">
                  {challenge.mandatoryRequirements.map((req, i) => (
                    <div key={i} className="flex items-start gap-2.5 p-3 rounded-lg bg-surface-container-low text-xs">
                      <span className="material-symbols-outlined text-base text-primary shrink-0 mt-0.5">
                        check_circle
                      </span>
                      <span className="text-on-surface leading-relaxed">{req}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Prohibited Terms Warning Box */}
              <div className="p-4 rounded-lg bg-error-container/20 border border-error/20 space-y-2">
                <div className="flex items-center gap-1.5 text-error">
                  <span className="material-symbols-outlined text-base">gavel</span>
                  <span className="text-xs uppercase tracking-wider font-semibold">Client Guidance: Prohibited Lexicon</span>
                </div>
                <p className="text-xs text-on-surface-variant leading-relaxed">
                  Client-side draft check. Submissions containing these terms are rejected by deployed contract evaluation rules:
                </p>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {challenge.prohibitedTerms.map((term, i) => {
                    const isDetected = combinedText.includes(term.toLowerCase());
                    return (
                      <span
                        key={i}
                        className={`px-2.5 py-0.5 rounded-full text-xs font-mono transition-all ${
                          isDetected
                            ? 'bg-error text-white font-bold ring-2 ring-error'
                            : 'bg-surface-container-lowest text-error line-through border border-error/30'
                        }`}
                      >
                        {term}
                      </span>
                    );
                  })}
                </div>
              </div>

              {/* Curatorial Note */}
              <div className="p-4 rounded-lg bg-surface-container-low flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-surface-container-highest flex items-center justify-center text-secondary shrink-0">
                  <span className="material-symbols-outlined text-base">auto_stories</span>
                </div>
                <div className="space-y-0.5 text-xs">
                  <div className="font-semibold text-on-surface">Curatorial Note</div>
                  <p className="text-on-surface-variant leading-relaxed">
                    Judges favor calm declarative sentences. Avoid marketing superlatives and hype clichés.
                  </p>
                </div>
              </div>
            </div>

          </aside>

          {/* RIGHT COLUMN: Writing Desk & Verification Engine (7 cols) */}
          <main className="lg:col-span-7 space-y-6">
            <form onSubmit={handleSubmit} className="bg-surface-container-lowest rounded-xl p-6 sm:p-8 shadow-sm border border-outline-variant/30 space-y-6">
              
              {/* Header Status Row */}
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-outline-variant/20 pb-4">
                <div>
                  <span className="text-[11px] uppercase tracking-widest text-primary font-mono font-semibold">
                    Author Desk
                  </span>
                  <h2 className="font-serif text-2xl text-on-surface mt-0.5">
                    Draft Creative Entry
                  </h2>
                </div>

                {/* Prohibited Terms Indicator Badge (Client Guidance) */}
                <div
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all ${
                    hasProhibited
                      ? 'bg-error-container text-on-error-container'
                      : 'bg-surface-container text-primary'
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${
                      hasProhibited ? 'bg-error animate-ping' : 'bg-primary'
                    }`}
                  ></span>
                  <span>
                    {hasProhibited
                      ? `Client Warning: Prohibited term detected (${detectedProhibited.join(', ')})`
                      : 'Client Guidance: No prohibited terms detected'}
                  </span>
                </div>
              </div>

              {/* Closed Warning Banner */}
              {!isSubmissionOpen && (
                <div className="p-4 rounded-lg bg-surface-container border border-outline-variant/40 flex items-center gap-3 text-xs">
                  <span className="material-symbols-outlined text-secondary text-lg">lock</span>
                  <div>
                    <strong className="text-primary font-semibold block">Submissions Closed for Brief</strong>
                    <span className="text-on-surface-variant">
                      This brief is no longer accepting submissions ({challenge.filledSlots}/{challenge.maxSlots} slots filled, status: {challenge.status}).
                    </span>
                  </div>
                </div>
              )}

              {/* Field 1: Tagline */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label htmlFor="taglineInput" className="text-sm font-semibold text-on-surface flex items-center gap-1">
                    <span>Entry Tagline</span>
                    <span className="text-error">*</span>
                  </label>
                  <div className="text-xs font-mono text-on-surface-variant">
                    <span className={tagline.length > 60 ? 'text-error font-bold' : ''}>
                      {tagline.length}
                    </span>{' '}
                    / 60 characters
                  </div>
                </div>
                <p className="text-xs text-on-surface-variant">
                  A single declarative axiom. Maximum clarity, minimal adjectives (max 60 characters).
                </p>
                <input
                  id="taglineInput"
                  type="text"
                  maxLength={60}
                  disabled={!isSubmissionOpen}
                  value={tagline}
                  onChange={(e) => setTagline(e.target.value)}
                  placeholder="e.g. Computing restored to absolute quiet and mathematical certitude."
                  className="w-full px-4 py-3 rounded-lg bg-surface-container-low text-on-surface placeholder:text-outline/60 text-sm focus:outline-none focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary-container border border-outline-variant/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                />
              </div>

              {/* Field 2: Launch Paragraph */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label htmlFor="paragraphInput" className="text-sm font-semibold text-on-surface flex items-center gap-1">
                    <span>Launch Paragraph</span>
                    <span className="text-error">*</span>
                  </label>
                  <div className="text-xs font-mono text-on-surface-variant">
                    <span className={paragraph.length > 280 ? 'text-error font-bold' : ''}>
                      {paragraph.length}
                    </span>{' '}
                    / 280 characters
                  </div>
                </div>
                <p className="text-xs text-on-surface-variant">
                  The complete positioning statement. Thread mandatory architectural tenets (30 to 280 characters).
                </p>
                <textarea
                  id="paragraphInput"
                  rows={5}
                  maxLength={280}
                  disabled={!isSubmissionOpen}
                  value={paragraph}
                  onChange={(e) => setParagraph(e.target.value)}
                  placeholder="Aether OS operates with deterministic sub-millisecond task switching, discarding unnecessary abstractions. Built upon direct spatial silicon isolation, it enforces zero telemetry by design. Your thoughts remain local, sovereign, and imperviously silent."
                  className="w-full p-4 rounded-lg bg-surface-container-low text-on-surface placeholder:text-outline/60 text-sm focus:outline-none focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary-container border border-outline-variant/30 transition-all leading-relaxed resize-none disabled:opacity-50 disabled:cursor-not-allowed"
                />
              </div>

              {/* Real-time typographic consensus preview */}
              <div className="space-y-2 pt-1">
                <div className="flex items-center justify-between text-xs font-semibold text-on-surface">
                  <span className="uppercase tracking-wider">Live Typographic Preview</span>
                  <span className="text-outline font-mono">Consensus View</span>
                </div>
                <div className="p-5 rounded-lg bg-surface-container space-y-3 border border-outline-variant/30">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-secondary"></span>
                    <span className="text-[11px] font-mono text-secondary font-semibold uppercase">
                      Candidate Submission Preview
                    </span>
                    <span className="text-outline/40">•</span>
                    <span className="text-[11px] font-mono text-on-surface-variant">
                      {isConnected && address ? `Wallet ${address.slice(0, 6)}...${address.slice(-4)}` : 'Client Preview'}
                    </span>
                  </div>
                  <div className="font-serif text-lg text-primary italic">
                    {tagline.trim() ? `“${tagline.trim()}”` : '“Your tagline will preview here...”'}
                  </div>
                  <p className="text-sm text-on-surface leading-relaxed">
                    {paragraph.trim()
                      ? paragraph.trim()
                      : 'Your complete launch paragraph statement will preview here as you draft...'}
                  </p>
                </div>
              </div>

              {/* Mandatory Confirmation Disclaimers */}
              <div className="p-4 rounded-lg bg-surface-container-highest space-y-3 text-xs border border-outline-variant/30">
                <div className="flex items-start gap-2.5">
                  <span className="material-symbols-outlined text-secondary text-xl shrink-0 mt-0.5">policy</span>
                  <div className="space-y-0.5">
                    <h3 className="font-semibold text-on-surface">Submission Constraints</h3>
                    <p className="text-on-surface-variant leading-relaxed">
                      Submissions on Studio Next are public and cannot be edited once broadcast. Exactly 1 entry is permitted per wallet on Chain 61997.
                    </p>
                  </div>
                </div>

                <label className="flex items-start gap-2.5 p-3 rounded bg-surface-container-lowest cursor-pointer select-none border border-outline-variant/20">
                  <input
                    type="checkbox"
                    checked={confirmedAgreement}
                    onChange={(e) => setConfirmedAgreement(e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded text-primary focus:ring-primary"
                  />
                  <span className="text-on-surface leading-normal">
                    I confirm that this submission is original work conforming to the {challenge.title} specification, and I understand this frontend uses test GEN on Studio Next with no real monetary value.
                  </span>
                </label>
              </div>

              {/* Action Bar */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2 border-t border-outline-variant/20">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5 text-xs text-on-surface font-semibold">
                    <span className="material-symbols-outlined text-sm text-secondary">fact_check</span>
                    <span>Client Guidance Active</span>
                  </div>
                  <div className="text-[11px] font-mono text-on-surface-variant">
                    Studio Next • Chain 61997
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={!isFormValid}
                  className="px-6 py-3 rounded-full bg-primary text-on-primary font-semibold text-xs sm:text-sm shadow-md hover:bg-primary-container transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  <span className="material-symbols-outlined text-base">fingerprint</span>
                  <span>{writesEnabled ? 'Review & Submit Entry' : 'Review Draft (Writes Disabled)'}</span>
                </button>
              </div>

            </form>
          </main>

        </div>

      </div>

      {/* Review Draft Modal (Writes Disabled) */}
      <ContractPendingModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={writesEnabled ? 'Review & Submit Entry' : 'Review Draft: Submit Entry'}
        actionType="entry_submission"
        submitInput={preparedDraft || controllerState.submitInput || undefined}
        unsuitableReason={unsuitableReason || undefined}
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
        }}
      />
    </div>
  );
};
