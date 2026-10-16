import React, { useState, useEffect, useMemo } from 'react';
import { DesignPreviewBanner } from '../components/DesignPreviewBanner';
import { ContractPendingModal } from '../components/ContractPendingModal';
import { useWallet } from '../context/WalletContext';
import {
  buildCreateChallengeSubmitInput,
  createChallengeValue,
  genToWei,
  MIN_PRIZE_WEI,
  WRITES_ENABLED,
  type CreateChallengeFormValues,
} from '../services/transactionService';
import { CONTRACT_ADDRESS } from '../services/contractClient';
import {
  useTransactionController,
  useTransactionKit,
  type ActionPreconditionParams,
} from '../services/transactionController';
import type { SubmitInput, TransactionKit } from '@genlayer/transaction-kit';

export const CreateChallengePage: React.FC<{ kit?: TransactionKit | null }> = ({
  kit: injectedKit = null,
}) => {
  const { address, isConnected, chainId, isCorrectNetwork } = useWallet();
  const { kit } = useTransactionKit(injectedKit);
  const writesEnabled = WRITES_ENABLED;
  const [currentStep, setCurrentStep] = useState<number>(1);

  // Form states - unpopulated by default to prevent accidental submission of sample briefs
  const [title, setTitle] = useState('');
  const [synopsis, setSynopsis] = useState('');
  const [category, setCategory] = useState('Industrial Design Prose');

  // Step 2: Rubrics
  const [mandatoryAnchors, setMandatoryAnchors] = useState<string[]>([]);
  const [newAnchor, setNewAnchor] = useState('');

  const [prohibitedTerms, setProhibitedTerms] = useState<string[]>([]);
  const [newProhibited, setNewProhibited] = useState('');

  // Step 3: Escrow & Timing (bounty kept as decimal string throughout)
  const [bounty, setBounty] = useState<string>('');
  const [durationHours, setDurationHours] = useState<number>(72);

  // Step 4: Sponsor Agreement & Prepared Draft
  const [sponsorAcknowledged, setSponsorAcknowledged] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [preparedDraft, setPreparedDraft] = useState<{
    submitInput: SubmitInput;
    prizeWei: bigint;
    bountyStr: string;
  } | null>(null);

  const createValues: CreateChallengeFormValues = useMemo(() => ({
    title: title.trim(),
    category: category.trim(),
    synopsis: synopsis.trim(),
    mandatoryRequirements: mandatoryAnchors,
    prohibitedTerms,
    durationHours,
    prizeAmountGen: bounty.trim(),
  }), [title, category, synopsis, mandatoryAnchors, prohibitedTerms, durationHours, bounty]);

  const controllerParams: ActionPreconditionParams = useMemo(() => ({
    actionType: 'challenge_creation',
    walletState: {
      isConnected,
      address,
      chainId,
      isCorrectNetwork,
    },
    contractAddress: CONTRACT_ADDRESS as any,
    createChallengeValues: createValues,
  }), [isConnected, address, chainId, isCorrectNetwork, createValues]);

  const {
    state: controllerState,
    submit,
    estimateFee,
  } = useTransactionController(controllerParams, kit);

  // Optional sample brief loader
  const loadExampleBrief = () => {
    setTitle('Chronos Zero: Architectural Launch Narrative');
    setSynopsis(
      'Chronos Zero is an ultra-minimal mechanical wristwatch machined from recycled aeronautical titanium. It deliberately lacks branding, subdials, and hour indices, relying on a single monophonic chiming mechanism to communicate temporal weight rather than urgent productivity.'
    );
    setCategory('Industrial Design Prose');
    setMandatoryAnchors([
      'Anti-accelerationist quietude',
      'Aeronautical tactile grain',
      'Absence of urgent productivity metrics',
    ]);
    setProhibitedTerms([
      'luxury status',
      'disruptive',
      'crypto',
      'hustle',
      'game-changer',
    ]);
    setBounty('150');
    setDurationHours(72);
  };

  // Chip management with strict limit validation
  const trimmedAnchor = newAnchor.trim();
  const isNewAnchorValid =
    trimmedAnchor.length >= 5 &&
    trimmedAnchor.length <= 120 &&
    mandatoryAnchors.length < 4 &&
    !mandatoryAnchors.includes(trimmedAnchor);

  const addAnchor = () => {
    if (isNewAnchorValid) {
      setMandatoryAnchors([...mandatoryAnchors, trimmedAnchor]);
      setNewAnchor('');
    }
  };

  const removeAnchor = (index: number) => {
    setMandatoryAnchors(mandatoryAnchors.filter((_, i) => i !== index));
  };

  const trimmedProhibited = newProhibited.trim().toLowerCase();
  const isNewProhibitedValid =
    trimmedProhibited.length >= 2 &&
    trimmedProhibited.length <= 25 &&
    prohibitedTerms.length < 6 &&
    !prohibitedTerms.includes(trimmedProhibited);

  const addProhibited = () => {
    if (isNewProhibitedValid) {
      setProhibitedTerms([...prohibitedTerms, trimmedProhibited]);
      setNewProhibited('');
    }
  };

  const removeProhibited = (index: number) => {
    setProhibitedTerms(prohibitedTerms.filter((_, i) => i !== index));
  };

  // Validation strictly aligned with contract specification bounds
  const isTitleValid = title.trim().length >= 5 && title.trim().length <= 60;
  const isSynopsisValid = synopsis.trim().length >= 40 && synopsis.trim().length <= 500;
  const isStep1Valid = isTitleValid && isSynopsisValid;

  const isMandatoryValid =
    mandatoryAnchors.length >= 1 &&
    mandatoryAnchors.length <= 4 &&
    mandatoryAnchors.every((a) => a.length >= 5 && a.length <= 120);
  const isProhibitedValid =
    prohibitedTerms.length >= 1 &&
    prohibitedTerms.length <= 6 &&
    prohibitedTerms.every((p) => p.length >= 2 && p.length <= 25);
  const isStep2Valid = isMandatoryValid && isProhibitedValid;

  let isStep3Valid = false;
  try {
    if (bounty.trim() && durationHours >= 24 && durationHours <= 168) {
      const wei = genToWei(bounty.trim());
      if (wei >= MIN_PRIZE_WEI) {
        isStep3Valid = true;
      }
    }
  } catch {
    isStep3Valid = false;
  }
  const isStep4Valid = sponsorAcknowledged && isStep1Valid && isStep2Valid && isStep3Valid;

  const handleNext = () => {
    if (currentStep === 1 && isStep1Valid) setCurrentStep(2);
    else if (currentStep === 2 && isStep2Valid) setCurrentStep(3);
    else if (currentStep === 3 && isStep3Valid) setCurrentStep(4);
  };

  const handleBack = () => {
    if (currentStep > 1) setCurrentStep(currentStep - 1);
  };

  const handleFinalSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isStep4Valid) return;
    setSubmitError(null);
    try {
      const formValues: CreateChallengeFormValues = {
        title: title.trim(),
        category: category.trim(),
        synopsis: synopsis.trim(),
        mandatoryRequirements: mandatoryAnchors,
        prohibitedTerms,
        durationHours,
        prizeAmountGen: bounty.trim(),
      };
      const submitInput = buildCreateChallengeSubmitInput(formValues, CONTRACT_ADDRESS);
      const prizeWei = createChallengeValue(formValues);
      setPreparedDraft({
        submitInput,
        prizeWei,
        bountyStr: bounty.trim(),
      });
      setShowModal(true);
      if (kit) {
        estimateFee().catch((feeErr) => {
          console.warn('Real fee quote estimation failed:', feeErr);
        });
      }
    } catch (err: any) {
      console.error('Validation error preparing create_challenge draft:', err);
      setSubmitError(err?.message || 'Error preparing transaction draft');
      setPreparedDraft(null);
    }
  };

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

  return (
    <div className="flex flex-col w-full pb-20">
      <DesignPreviewBanner message={`Create Challenge studio: Form validation and step progression active. Contract is deployed at ${CONTRACT_ADDRESS} on Studio Next; ${writesEnabled ? 'on-chain publishing is enabled.' : 'on-chain publishing is behind the write gate (disabled).'}`} />

      <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-12 py-8 flex flex-col gap-8">
        
        {/* Header Strip */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-outline-variant/20 pb-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full bg-surface-container text-primary text-[10px] uppercase font-mono font-bold tracking-wider">
                Sponsor Studio
              </span>
              <span className="text-on-surface-variant text-xs">•</span>
              <span className="text-xs font-mono text-secondary font-medium">Studio Next (Chain 61997)</span>
            </div>
            <h1 className="font-serif text-3xl sm:text-4xl text-primary font-semibold tracking-tight">
              Create &amp; Freeze a Challenge
            </h1>
            <p className="text-sm text-on-surface-variant max-w-2xl leading-relaxed">
              Specify your creative requirements, set the test GEN prize escrow, and establish strict deterministic rubrics before locking parameters.
            </p>
          </div>

          {/* Action button to load example brief without prefilling by default */}
          <div className="shrink-0">
            <button
              type="button"
              onClick={loadExampleBrief}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-surface-container text-primary hover:bg-surface-container-high transition-colors text-xs font-semibold border border-outline-variant/30 shadow-sm"
              title="Populates form with the Chronos Zero sample brief for previewing"
            >
              <span className="material-symbols-outlined text-sm">content_paste</span>
              <span>Load Example Brief (Sample)</span>
            </button>
          </div>
        </div>

        {/* 4-Step Progress Bar Tabs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { step: 1, title: 'The Prompt', subtitle: 'Title & synopsis', icon: 'ink_pen' },
            { step: 2, title: 'Boundaries', subtitle: 'Tenets & prohibitions', icon: 'balance' },
            { step: 3, title: 'Escrow & Timing', subtitle: 'Bounty & 3-slot cap', icon: 'account_balance_wallet' },
            { step: 4, title: 'Audit & Freeze', subtitle: 'Payload review', icon: 'lock' },
          ].map(({ step, title: sTitle, subtitle, icon }) => {
            const isActive = currentStep === step;
            const isCompleted = currentStep > step;
            return (
              <button
                key={step}
                type="button"
                onClick={() => {
                  // Allow jumping to completed steps or current
                  if (step <= currentStep) setCurrentStep(step);
                }}
                className={`p-4 rounded-xl text-left border transition-all ${
                  isActive
                    ? 'bg-surface-container-lowest border-primary shadow-sm ring-1 ring-primary'
                    : isCompleted
                    ? 'bg-surface-container-low border-outline-variant/40 hover:bg-surface-container'
                    : 'bg-surface-container-lowest/50 border-outline-variant/20 opacity-60'
                }`}
              >
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-mono uppercase font-semibold text-on-surface-variant">
                    Step 0{step}
                  </span>
                  <span className={`material-symbols-outlined text-sm ${isActive ? 'text-primary' : 'text-outline'}`}>
                    {isCompleted ? 'check_circle' : icon}
                  </span>
                </div>
                <div className="font-serif text-base font-semibold text-primary">{sTitle}</div>
                <div className="text-[11px] text-on-surface-variant truncate">{subtitle}</div>
              </button>
            );
          })}
        </div>

        {/* Main Workspace Form (8 cols + 4 cols sidebar) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          
          {/* Form Step Panels */}
          <div className="lg:col-span-8 bg-surface-container-lowest rounded-xl p-6 sm:p-8 lg:p-10 shadow-sm border border-outline-variant/30 space-y-6">
            
            {/* STEP 1: The Prompt */}
            {currentStep === 1 && (
              <div className="space-y-6">
                <div className="flex items-start justify-between border-b border-outline-variant/20 pb-4">
                  <div>
                    <span className="text-xs uppercase tracking-widest text-secondary font-semibold">Section 1.0</span>
                    <h2 className="font-serif text-2xl text-primary font-semibold mt-0.5">The Creative Prompt</h2>
                    <p className="text-xs text-on-surface-variant mt-0.5">Define the challenge entity and product philosophy.</p>
                  </div>
                  <span className="material-symbols-outlined text-2xl text-surface-tint">ink_pen</span>
                </div>

                {/* Challenge Title */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label htmlFor="brief-title" className="block text-sm font-semibold text-primary">
                      Challenge Title <span className="text-error">*</span>
                    </label>
                    <span className="text-xs font-mono text-on-surface-variant">
                      <span className={title.length > 60 ? 'text-error font-bold' : ''}>{title.length}</span> / 60 characters
                    </span>
                  </div>
                  <input
                    id="brief-title"
                    type="text"
                    maxLength={60}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Chronos Zero: Architectural Launch Narrative"
                    className="w-full px-4 py-3 rounded-lg bg-surface-container-low text-on-surface text-sm border border-outline-variant/30 focus:outline-none focus:ring-2 focus:ring-primary-container"
                  />
                  <p className="text-xs text-on-surface-variant">A concise, authoritative title for indexing (5 to 60 characters).</p>
                </div>

                {/* Synopsis */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label htmlFor="product-synopsis" className="block text-sm font-semibold text-primary">
                      Product &amp; Philosophy Synopsis <span className="text-error">*</span>
                    </label>
                    <span className="text-xs font-mono text-on-surface-variant">
                      <span className={synopsis.length > 500 ? 'text-error font-bold' : ''}>{synopsis.length}</span> / 500 characters
                    </span>
                  </div>
                  <textarea
                    id="product-synopsis"
                    rows={5}
                    maxLength={500}
                    value={synopsis}
                    onChange={(e) => setSynopsis(e.target.value)}
                    placeholder="Elaborate on the origin story, physical materials, and consumer tension..."
                    className="w-full p-4 rounded-lg bg-surface-container-low text-on-surface text-sm border border-outline-variant/30 focus:outline-none focus:ring-2 focus:ring-primary-container leading-relaxed resize-none"
                  />
                  <div className="flex items-center justify-between text-xs text-on-surface-variant">
                    <span>Minimum 40 characters for clarity (40 to 500 characters)</span>
                    <span className="font-mono">{synopsis.length} / 500</span>
                  </div>
                </div>

                {/* Category Picker */}
                <div className="space-y-1.5">
                  <label className="block text-sm font-semibold text-primary">Curatorial Category</label>
                  <div className="flex flex-wrap gap-2">
                    {[
                      'Industrial Design Prose',
                      'Spatial Computing',
                      'Typography & Editorial',
                      'Sustainable Architecture',
                      'Micro-Poetics',
                    ].map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setCategory(cat)}
                        className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-all ${
                          category === cat
                            ? 'bg-primary text-on-primary'
                            : 'bg-surface-container text-on-surface hover:bg-surface-container-high'
                        }`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Fixed Format Reminder */}
                <div className="p-4 rounded-lg bg-surface-container-low flex items-start gap-3 text-xs border border-outline-variant/20">
                  <span className="material-symbols-outlined text-primary text-base shrink-0 mt-0.5">verified</span>
                  <div>
                    <strong className="text-primary font-semibold block">Fixed V1 Format:</strong>
                    <span className="text-on-surface-variant">
                      BriefArena challenges evaluate exactly 1 Tagline (max 60 chars) and 1 Launch Paragraph (max 280 chars).
                    </span>
                  </div>
                </div>

                <div className="flex justify-end pt-4 border-t border-outline-variant/20">
                  <button
                    type="button"
                    disabled={!isStep1Valid}
                    onClick={handleNext}
                    className="px-6 py-2.5 rounded-full bg-primary text-on-primary text-xs font-semibold hover:bg-primary-container transition-all flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <span>Next: Define Rubrics</span>
                    <span className="material-symbols-outlined text-sm">arrow_forward</span>
                  </button>
                </div>
              </div>
            )}

            {/* STEP 2: Boundaries & Rubrics */}
            {currentStep === 2 && (
              <div className="space-y-6">
                <div className="flex items-start justify-between border-b border-outline-variant/20 pb-4">
                  <div>
                    <span className="text-xs uppercase tracking-widest text-secondary font-semibold">Section 2.0</span>
                    <h2 className="font-serif text-2xl text-primary font-semibold mt-0.5">Algorithmic Rubrics &amp; Boundaries</h2>
                    <p className="text-xs text-on-surface-variant mt-0.5">Validators evaluate submissions directly against these exact parameters.</p>
                  </div>
                  <span className="material-symbols-outlined text-2xl text-surface-tint">balance</span>
                </div>

                {/* Mandatory Thematic Anchors */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="block text-sm font-semibold text-primary">
                      Mandatory Thematic Anchors <span className="text-error">*</span>
                    </label>
                    <span className="text-xs font-mono text-on-surface-variant">
                      {mandatoryAnchors.length} / 4 items (5–120 chars each)
                    </span>
                  </div>
                  <p className="text-xs text-on-surface-variant">Validators evaluate whether entries thread these core technical concepts (1 to 4 items max).</p>
                  <div className="flex flex-wrap gap-2 p-3 bg-surface-container-low rounded-lg border border-outline-variant/30 min-h-[44px] items-center">
                    {mandatoryAnchors.map((anchor, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-surface-container-highest text-primary text-xs font-medium"
                      >
                        <span>{anchor}</span>
                        <button
                          type="button"
                          onClick={() => removeAnchor(i)}
                          className="material-symbols-outlined text-xs hover:text-error"
                        >
                          close
                        </button>
                      </span>
                    ))}
                    {mandatoryAnchors.length === 0 && (
                      <span className="text-xs text-on-surface-variant/60 italic">No mandatory anchors added yet (min 1 required)</span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <input
                      type="text"
                      maxLength={120}
                      value={newAnchor}
                      disabled={mandatoryAnchors.length >= 4}
                      onChange={(e) => setNewAnchor(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addAnchor())}
                      placeholder={mandatoryAnchors.length >= 4 ? "Maximum 4 anchors reached" : "Add custom mandatory theme (5 to 120 characters)..."}
                      className="flex-1 px-3.5 py-2 rounded-full bg-surface-container-low text-xs border border-outline-variant/30 focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
                    />
                    <button
                      type="button"
                      disabled={!isNewAnchorValid}
                      onClick={addAnchor}
                      className="px-4 py-2 rounded-full bg-surface-container-high text-primary text-xs font-semibold hover:bg-surface-container-highest transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      + Add Theme
                    </button>
                  </div>
                </div>

                {/* Prohibited Buzzwords / Claims */}
                <div className="space-y-2 pt-2">
                  <div className="flex items-center justify-between">
                    <label className="block text-sm font-semibold text-error flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-base">block</span>
                      <span>Prohibited Lexicon &amp; Superlatives</span>
                    </label>
                    <span className="text-xs font-mono text-on-surface-variant">
                      {prohibitedTerms.length} / 6 items (2–25 chars each)
                    </span>
                  </div>
                  <p className="text-xs text-on-surface-variant">Any entry containing these words triggers automatic validator disqualification (1 to 6 items max).</p>
                  <div className="flex flex-wrap gap-2 p-3 bg-error-container/20 rounded-lg border border-error/20 min-h-[44px] items-center">
                    {prohibitedTerms.map((term, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-surface-container-lowest text-error text-xs font-mono font-medium border border-error/30"
                      >
                        <span>{term}</span>
                        <button
                          type="button"
                          onClick={() => removeProhibited(i)}
                          className="material-symbols-outlined text-xs hover:text-error"
                        >
                          close
                        </button>
                      </span>
                    ))}
                    {prohibitedTerms.length === 0 && (
                      <span className="text-xs text-error/60 italic">No prohibited terms added yet (min 1 required)</span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <input
                      type="text"
                      maxLength={25}
                      value={newProhibited}
                      disabled={prohibitedTerms.length >= 6}
                      onChange={(e) => setNewProhibited(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addProhibited())}
                      placeholder={prohibitedTerms.length >= 6 ? "Maximum 6 terms reached" : "Add prohibited term (2 to 25 characters)..."}
                      className="flex-1 px-3.5 py-2 rounded-full bg-surface-container-low text-xs border border-outline-variant/30 focus:outline-none focus:ring-1 focus:ring-error disabled:opacity-50"
                    />
                    <button
                      type="button"
                      disabled={!isNewProhibitedValid}
                      onClick={addProhibited}
                      className="px-4 py-2 rounded-full bg-error-container text-on-error-container text-xs font-semibold hover:bg-error-container/80 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      + Add Prohibited
                    </button>
                  </div>
                </div>

                <div className="flex justify-between items-center pt-4 border-t border-outline-variant/20">
                  <button
                    type="button"
                    onClick={handleBack}
                    className="px-5 py-2 rounded-full bg-surface-container text-on-surface-variant text-xs font-semibold hover:bg-surface-container-high transition-colors"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    disabled={!isStep2Valid}
                    onClick={handleNext}
                    className="px-6 py-2.5 rounded-full bg-primary text-on-primary text-xs font-semibold hover:bg-primary-container transition-all flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <span>Next: Escrow &amp; Timing</span>
                    <span className="material-symbols-outlined text-sm">arrow_forward</span>
                  </button>
                </div>
              </div>
            )}

            {/* STEP 3: Escrow & Timing */}
            {currentStep === 3 && (
              <div className="space-y-6">
                <div className="flex items-start justify-between border-b border-outline-variant/20 pb-4">
                  <div>
                    <span className="text-xs uppercase tracking-widest text-secondary font-semibold">Section 3.0</span>
                    <h2 className="font-serif text-2xl text-primary font-semibold mt-0.5">Escrow Bounty &amp; Timing</h2>
                    <p className="text-xs text-on-surface-variant mt-0.5">Sponsor test GEN prize and round duration.</p>
                  </div>
                  <span className="material-symbols-outlined text-2xl text-surface-tint">account_balance_wallet</span>
                </div>

                {/* Bounty Amount */}
                <div className="space-y-1.5">
                  <label htmlFor="bounty-input" className="block text-sm font-semibold text-primary">
                    Test GEN Prize Escrow <span className="text-error">*</span>
                  </label>
                  <div className="relative">
                    <input
                      id="bounty-input"
                      type="text"
                      inputMode="decimal"
                      placeholder="e.g. 150"
                      value={bounty}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (/^\d*\.?\d*$/.test(val)) {
                          setBounty(val);
                        }
                      }}
                      className="w-full px-4 py-3 rounded-lg bg-surface-container-low text-on-surface text-sm border border-outline-variant/30 focus:outline-none focus:ring-2 focus:ring-primary-container font-mono font-semibold"
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-secondary font-semibold">
                      test GEN
                    </span>
                  </div>
                  <p className="text-xs text-on-surface-variant">
                    Operating on GenLayer Studio Next testnet. No real monetary value. Contract rule: 100% credited to consensus winner or returnable to sponsor internal credit ledger.
                  </p>
                </div>

                {/* Duration */}
                <div className="space-y-1.5">
                  <label className="block text-sm font-semibold text-primary">Submission Window Duration</label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      { hours: 24, label: 'Flash (1 day)' },
                      { hours: 48, label: 'Standard (2 days)' },
                      { hours: 72, label: 'Sprint (3 days)' },
                      { hours: 168, label: 'Extended (7 days)' },
                    ].map(({ hours, label }) => (
                      <button
                        key={hours}
                        type="button"
                        onClick={() => setDurationHours(hours)}
                        className={`p-3 rounded-xl text-center border transition-all ${
                          durationHours === hours
                            ? 'bg-surface-container-lowest border-primary shadow-sm ring-1 ring-primary'
                            : 'bg-surface-container-low border-outline-variant/30 hover:bg-surface-container'
                        }`}
                      >
                        <span className="font-mono text-base font-bold text-primary block">{hours} Hours</span>
                        <span className="text-[11px] text-on-surface-variant">
                          {label}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Fixed Capacity Rule */}
                <div className="p-4 rounded-lg bg-surface-container flex items-start gap-3 text-xs border border-outline-variant/20">
                  <span className="material-symbols-outlined text-secondary text-base shrink-0 mt-0.5">info</span>
                  <div className="space-y-0.5">
                    <span className="font-semibold text-primary block">Strict 3-Slot Arena Rule:</span>
                    <p className="text-on-surface-variant">
                      Challenges strictly accept a maximum of 3 entries, capped at 1 entry per wallet. Under contract rules, if 0 entries arrive by deadline, sponsor escrow is returnable via expire_zero_entries.
                    </p>
                  </div>
                </div>

                <div className="flex justify-between items-center pt-4 border-t border-outline-variant/20">
                  <button
                    type="button"
                    onClick={handleBack}
                    className="px-5 py-2 rounded-full bg-surface-container text-on-surface-variant text-xs font-semibold hover:bg-surface-container-high transition-colors"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    disabled={!isStep3Valid}
                    onClick={handleNext}
                    className="px-6 py-2.5 rounded-full bg-primary text-on-primary text-xs font-semibold hover:bg-primary-container transition-all flex items-center gap-1.5 disabled:opacity-40"
                  >
                    <span>Next: Review &amp; Freeze</span>
                    <span className="material-symbols-outlined text-sm">arrow_forward</span>
                  </button>
                </div>
              </div>
            )}

            {/* STEP 4: Audit & Freeze Review */}
            {currentStep === 4 && (
              <form onSubmit={handleFinalSubmit} className="space-y-6">
                <div className="flex items-start justify-between border-b border-outline-variant/20 pb-4">
                  <div>
                    <span className="text-xs uppercase tracking-widest text-secondary font-semibold">Section 4.0</span>
                    <h2 className="font-serif text-2xl text-primary font-semibold mt-0.5">Audit &amp; Freeze Review</h2>
                    <p className="text-xs text-on-surface-variant mt-0.5">Inspect the deterministic brief payload before final confirmation.</p>
                  </div>
                  <span className="material-symbols-outlined text-2xl text-secondary">verified_user</span>
                </div>

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

                {/* Sponsor Commitment Notice */}
                <div className="p-4 rounded-lg bg-amber-500/10 border border-secondary/40 space-y-2 text-xs">
                  <div className="flex items-center gap-2 text-secondary font-semibold">
                    <span className="material-symbols-outlined text-base">warning</span>
                    <span>Sponsor Immutability Clause</span>
                  </div>
                  <p className="text-on-surface leading-relaxed">
                    Once committed, challenge parameters cannot be changed. Sponsors may only cancel if <strong>0 submissions exist</strong>. The prize pool cannot be withdrawn once an entry arrives.
                  </p>
                </div>

                {/* Structured Payload Preview */}
                <div className="space-y-3 bg-surface-container-low/60 p-5 rounded-lg border border-outline-variant/30 text-xs">
                  <div>
                    <span className="text-outline uppercase tracking-wider font-semibold block text-[10px]">Title</span>
                    <span className="font-serif text-lg font-semibold text-primary">{title}</span>
                  </div>
                  <div className="border-t border-outline-variant/20 pt-2">
                    <span className="text-outline uppercase tracking-wider font-semibold block text-[10px]">Synopsis</span>
                    <p className="text-on-surface italic mt-0.5 leading-relaxed">"{synopsis}"</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3 border-t border-outline-variant/20 pt-2">
                    <div>
                      <span className="text-outline uppercase tracking-wider font-semibold block text-[10px]">Bounty</span>
                      <span className="font-semibold text-primary font-mono">{bounty} test GEN</span>
                    </div>
                    <div>
                      <span className="text-outline uppercase tracking-wider font-semibold block text-[10px]">Capacity</span>
                      <span className="font-semibold text-primary">3 Entries Max</span>
                    </div>
                  </div>
                  <div className="border-t border-outline-variant/20 pt-2">
                    <span className="text-outline uppercase tracking-wider font-semibold block text-[10px]">Mandatory Themes</span>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {mandatoryAnchors.map((m, i) => (
                        <span key={i} className="px-2 py-0.5 rounded bg-surface-container text-primary text-[11px]">
                          {m}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="border-t border-outline-variant/20 pt-2">
                    <span className="text-error uppercase tracking-wider font-semibold block text-[10px]">Prohibited Terms</span>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {prohibitedTerms.map((p, i) => (
                        <span key={i} className="px-2 py-0.5 rounded bg-error-container text-on-error-container text-[11px] font-mono">
                          {p}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Confirmation Checkbox */}
                <label className="flex items-start gap-2.5 p-3 rounded-lg bg-surface-container cursor-pointer select-none border border-outline-variant/20 text-xs">
                  <input
                    type="checkbox"
                    checked={sponsorAcknowledged}
                    onChange={(e) => setSponsorAcknowledged(e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded text-primary focus:ring-primary"
                  />
                  <span className="text-on-surface leading-relaxed">
                    {writesEnabled
                      ? 'I acknowledge and confirm this brief specification. I understand this will attach the chosen test GEN bounty from my wallet and dispatch the transaction to GenLayer Studio Next.'
                      : 'I acknowledge and confirm this brief specification. I understand this frontend runs client validation, and on-chain transaction publishing is currently behind the write gate (disabled).'}
                  </span>
                </label>

                <div className="flex justify-between items-center pt-4 border-t border-outline-variant/20">
                  <button
                    type="button"
                    onClick={handleBack}
                    className="px-5 py-2 rounded-full bg-surface-container text-on-surface-variant text-xs font-semibold hover:bg-surface-container-high transition-colors"
                  >
                    Back
                  </button>
                  <button
                    type="submit"
                    disabled={!isStep4Valid}
                    className="px-6 py-2.5 rounded-full bg-primary text-on-primary text-xs font-semibold hover:bg-primary-container transition-all flex items-center gap-2 shadow-md disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-sm">{writesEnabled ? 'send' : 'lock'}</span>
                    <span>{writesEnabled ? 'Review & Freeze Brief' : 'Review Specification (Writes Disabled)'}</span>
                  </button>
                </div>
              </form>
            )}

          </div>

          {/* Right Sidebar: Rules & Guidelines (4 cols) */}
          <aside className="lg:col-span-4 space-y-6">
            <div className="p-6 rounded-xl bg-surface-container-low border border-outline-variant/20 space-y-4 text-xs">
              <div className="flex items-center gap-2 text-primary font-semibold text-sm">
                <span className="material-symbols-outlined text-base">gavel</span>
                <span>Creator Protocol Invariants</span>
              </div>
              <ul className="space-y-2.5 text-on-surface-variant leading-relaxed">
                <li className="flex items-start gap-2">
                  <span className="material-symbols-outlined text-xs text-primary mt-0.5">check</span>
                  <span><strong>Deterministic Consensus:</strong> Evaluator checks strict rule compliance rather than subjective ratings.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="material-symbols-outlined text-xs text-primary mt-0.5">check</span>
                  <span><strong>3-Slot Capped Arena:</strong> Only the first 3 valid entries are accepted into judging.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="material-symbols-outlined text-xs text-primary mt-0.5">check</span>
                  <span><strong>Sponsor Refund Invariant:</strong> Under the deployed contract rules, if a brief is cancelled before entries or expires unfilled, the locked prize escrow is credited back to the sponsor's claimable balance.</span>
                </li>
              </ul>
            </div>

            <div className="p-6 rounded-xl bg-primary-container text-on-primary border border-primary/40 space-y-2 text-xs">
              <span className="text-[10px] uppercase font-mono tracking-wider text-primary-fixed-dim">
                Deployment Network
              </span>
              <h3 className="font-serif text-lg text-secondary-fixed font-semibold">
                Studio Next Testnet (61997)
              </h3>
              <p className="text-primary-fixed-dim leading-relaxed">
                Operates on test GEN with zero monetary value. Safe sandbox environment for deterministic testing.
              </p>
            </div>
          </aside>

        </div>

      </div>

      {/* Review Draft Modal (Writes Disabled) */}
      <ContractPendingModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={writesEnabled ? 'Review & Freeze Brief' : 'Review Draft: Create Challenge'}
        actionType="challenge_creation"
        submitInput={preparedDraft?.submitInput || controllerState.submitInput || undefined}
        nativeValueGen={preparedDraft?.bountyStr}
        nativeValueWei={preparedDraft?.prizeWei}
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
          durationHours,
          sponsorAddress: isConnected && address ? address : null,
        }}
      />
    </div>
  );
};
