import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Decision, Challenge } from '../types';
import { dataService } from '../services/dataService';
import { CONTRACT_ADDRESS, getContractCredit } from '../services/contractClient';
import { DesignPreviewBanner } from '../components/DesignPreviewBanner';
import { LoadingState, EmptyState } from '../components/StateViews';
import { NETWORK_CONFIG } from '../types';

export const DecisionPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [decision, setDecision] = useState<Decision | null>(null);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [winnerCreditWei, setWinnerCreditWei] = useState<bigint | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = React.useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      if (!id) {
        setChallenge(null);
        setDecision(null);
        setWinnerCreditWei(null);
        return;
      }
      const foundChal = await dataService.getChallengeById(id);
      setChallenge(foundChal);

      const foundDec = await dataService.getDecisionForChallenge(id);
      setDecision(foundDec);

      if (foundDec && foundDec.winnerAddress && CONTRACT_ADDRESS && !foundDec.isFixture) {
        try {
          const credit = await getContractCredit(CONTRACT_ADDRESS, foundDec.winnerAddress);
          setWinnerCreditWei(credit);
        } catch (e) {
          console.warn('Could not read live winner credit:', e);
          setWinnerCreditWei(null);
        }
      } else {
        setWinnerCreditWei(null);
      }
    } catch (err: any) {
      console.error('Error loading decision from Studio Next:', err);
      setLoadError(err?.message || 'RPC Read Failure');
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (isLoading) {
    return <LoadingState message="Loading consensus decision ledger..." />;
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

  if (!decision || !challenge) {
    if (challenge) {
      return (
        <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-12 py-12 flex flex-col items-center gap-4">
          <EmptyState
            title={challenge.status === 'judging' ? "Consensus Deliberation In Progress" : "No Consensus Decision Recorded"}
            message={
              challenge.status === 'judging'
                ? `Challenge ${challenge.code} is currently committed to validator judging. Final consensus has not settled a decision yet.`
                : `Challenge ${challenge.code} has not concluded validator consensus yet (current status: ${challenge.status.toUpperCase()}).`
            }
            actionLabel="View Challenge Deliberation & Lifecycle"
            onAction={() => window.location.assign(`/challenges/${challenge.id}`)}
            icon="psychology"
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
    return (
      <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-12 py-12 flex flex-col items-center gap-4">
        <EmptyState
          title="No Consensus Decision Recorded"
          message={`This challenge (${id}) has not concluded validator consensus yet, or no decision fixture is assigned.`}
          actionLabel="View Active Challenges"
          onAction={() => window.location.assign('/challenges')}
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

  return (
    <div className="flex flex-col w-full pb-20">
      <DesignPreviewBanner
        isFixture={decision.isFixture}
        contractAddress={challenge.contractAddress}
        message="Design preview — sample outcome. Do not treat this sample winner, hash, or validator reasoning as a live transaction."
      />

      <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-12 py-8 flex flex-col gap-8">
        
        {/* Top Breadcrumb & Status */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-3 border-b border-outline-variant/20">
          <div className="flex items-center gap-3">
            <Link
              to="/challenges"
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-surface-container text-on-surface hover:bg-surface-container-high transition-colors text-xs font-semibold"
            >
              <span className="material-symbols-outlined text-sm">west</span>
              <span>Back to Explore</span>
            </Link>
            <span className="text-outline-variant text-xs">/</span>
            <span className="text-xs font-mono text-on-surface-variant font-medium">
              DECISION SETTLEMENT • {challenge.code}
            </span>
          </div>

          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-secondary-container/60 text-on-secondary-container text-xs font-semibold">
            <span className="material-symbols-outlined text-sm text-secondary">
              {decision.outcome === 'winner' ? 'hotel_class' : 'cancel'}
            </span>
            <span>
              {decision.isFixture
                ? (decision.outcome === 'winner' ? 'Sample Consensus Winner' : 'Sample Verdict: No Winner')
                : (decision.outcome === 'winner' ? 'Consensus Winner' : 'Consensus Verdict: No Winner')}
            </span>
          </div>
        </div>

        {/* 12-Column Editorial Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          
          {/* Main Left Column: Winner or No-Winner Showcase & Logs (8 cols) */}
          <div className="lg:col-span-8 space-y-8">
            
            {/* Outcome Card Plinth */}
            <div className="bg-surface-container-lowest rounded-xl p-6 sm:p-8 lg:p-10 shadow-sm border border-outline-variant/30 space-y-6">
              
              {decision.outcome === 'winner' ? (
                <>
                  {/* Winner Header Badges */}
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-outline-variant/20 pb-4">
                    <div className="flex items-center gap-2">
                      <span className="px-3 py-1 rounded-full bg-primary text-on-primary text-xs font-semibold inline-flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-sm text-primary-fixed">hotel_class</span>
                        <span>{decision.isFixture ? 'Sample Winner' : 'Consensus Winner'}: Entry #{decision.winningEntryNumber ? `0${decision.winningEntryNumber}` : '02'}</span>
                      </span>
                      {winnerCreditWei !== null && (
                        <span className="px-2.5 py-0.5 rounded-full bg-secondary-container/80 text-on-secondary-container text-xs font-mono font-semibold">
                          Claimable: {Number(winnerCreditWei) / 1e18} test GEN
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-surface-container text-xs">
                      <span className="text-on-surface-variant">Author:</span>
                      <span className="font-mono font-semibold text-primary">{decision.winnerAddress}</span>
                    </div>
                  </div>

                  {/* Winning Submissions Display */}
                  <div className="space-y-4">
                    <blockquote className="font-serif text-2xl sm:text-3xl text-primary italic leading-snug">
                      “{decision.winningTagline}”
                    </blockquote>
                    <p className="text-base text-on-surface leading-relaxed">
                      {decision.winningParagraph}
                    </p>
                  </div>

                  {/* Bounded Reason */}
                  <div className="rounded-lg bg-surface-container p-5 space-y-2 border border-outline-variant/20">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 text-primary">
                        <span className="material-symbols-outlined text-base">gavel</span>
                        <span className="text-xs uppercase tracking-wider font-semibold">
                          Bounded Validator Decision Reason
                        </span>
                      </div>
                      <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-surface-container-highest text-primary">
                        Frozen Spec Compliance
                      </span>
                    </div>
                    <p className="text-sm text-on-surface leading-relaxed">
                      {decision.boundedReason}
                    </p>
                  </div>
                </>
              ) : (
                <>
                  {/* No Winner Header Badges */}
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-outline-variant/20 pb-4">
                    <div className="flex items-center gap-2">
                      <span className="px-3 py-1 rounded-full bg-secondary-container text-on-secondary-container text-xs font-semibold inline-flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-sm text-secondary">cancel</span>
                        <span>Consensus Outcome: No Winner</span>
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-surface-container text-xs">
                      <span className="text-on-surface-variant">Sponsor Escrow Protected:</span>
                      <span className="font-mono font-semibold text-primary">{challenge.sponsorAddress}</span>
                    </div>
                  </div>

                  {/* No Winner Explanation Banner */}
                  <div className="space-y-3 p-6 rounded-xl bg-surface-container-low border border-outline-variant/30">
                    <div className="flex items-center gap-2 text-secondary font-semibold">
                      <span className="material-symbols-outlined text-lg">unpublished</span>
                      <h3 className="font-serif text-xl text-primary font-semibold">
                        No Submissions Qualified
                      </h3>
                    </div>
                    <p className="text-sm text-on-surface leading-relaxed">
                      The validation consensus round concluded without awarding a winner. All submitted candidate entries failed mandatory requirement adherence or violated prohibited lexicon constraints. Under protocol rules, no winner address or prize credit is assigned.
                    </p>
                  </div>

                  {/* Sponsor Refund Path */}
                  <div className="p-5 rounded-lg bg-surface-container space-y-3 border border-outline-variant/30">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 text-primary font-semibold text-xs uppercase tracking-wider">
                        <span className="material-symbols-outlined text-base text-secondary">currency_exchange</span>
                        <span>Sponsor Refund Path (Internal Credit)</span>
                      </div>
                      <span className="px-2.5 py-0.5 rounded-full bg-secondary text-on-secondary text-[11px] font-mono font-semibold">
                        {challenge.prizeAmount} {challenge.prizeCurrency} Escrow
                      </span>
                    </div>
                    <p className="text-xs text-on-surface-variant leading-relaxed">
                      Because zero entries fulfilled the rubric, 100% of the locked escrow ({challenge.prizeAmount} test GEN) is designated for sponsor refund back to <code className="font-mono text-primary font-semibold">{challenge.sponsorAddress}</code> in internal contract balance, rather than being forfeited or disbursed.
                    </p>
                  </div>

                  {/* Bounded Reason for Disqualification */}
                  <div className="rounded-lg bg-surface-container p-5 space-y-2 border border-outline-variant/20">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 text-primary">
                        <span className="material-symbols-outlined text-base">gavel</span>
                        <span className="text-xs uppercase tracking-wider font-semibold">
                          Bounded Validator Decision Reason
                        </span>
                      </div>
                      <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-surface-container-highest text-primary">
                        Disqualification Audit
                      </span>
                    </div>
                    <p className="text-sm text-on-surface leading-relaxed">
                      {decision.boundedReason}
                    </p>
                  </div>
                </>
              )}

            </div>

            {/* Transparency Log of submissions */}
            <div className="rounded-xl bg-surface-container-low p-6 sm:p-8 space-y-6 border border-outline-variant/20">
              <div className="space-y-1">
                <span className="text-xs uppercase tracking-widest text-on-surface-variant font-semibold">
                  Transparency Log
                </span>
                <h2 className="font-serif text-2xl text-primary font-semibold">
                  {decision.outcome === 'winner' ? 'Evaluated Submissions' : 'All Evaluated Submissions'}
                </h2>
                <p className="text-xs text-on-surface-variant">
                  Public ledger of entries evaluated during consensus round.
                </p>
              </div>

              <div className="space-y-4">
                {decision.transparencyLog.map((log) => (
                  <div
                    key={log.entryNumber}
                    className="rounded-lg bg-surface-container-lowest p-5 space-y-2 border border-outline-variant/30 shadow-sm"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-primary">Entry #0{log.entryNumber}</span>
                        <span className="font-mono text-xs text-on-surface-variant">by {log.authorAddress}</span>
                      </div>
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                          log.status === 'winner'
                            ? 'bg-primary text-on-primary ring-1 ring-primary/40'
                            : log.status === 'qualifying'
                            ? 'bg-secondary-container text-on-secondary-container'
                            : log.status === 'disqualified'
                            ? 'bg-error-container text-on-error-container'
                            : 'bg-surface-container-highest text-on-surface-variant'
                        }`}
                      >
                        {log.status === 'winner'
                          ? 'Winner'
                          : log.status === 'qualifying'
                          ? 'Qualifying'
                          : log.status === 'disqualified'
                          ? 'Disqualified'
                          : 'Non-qualifying'}
                      </span>
                    </div>

                    <p className="text-sm font-serif italic text-on-surface">
                      “{log.tagline}”
                    </p>

                    {log.defectReason && (
                      <div className="rounded bg-surface-container p-3 flex items-start gap-2 text-xs">
                        <span className="material-symbols-outlined text-secondary text-base shrink-0 mt-0.5">
                          info
                        </span>
                        <p className="text-on-surface-variant leading-relaxed">
                          <strong className="text-primary font-semibold">Consensus Defect:</strong> {log.defectReason}
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

          </div>

          {/* Right Column: Smart Contract Ledger Status (4 cols) */}
          <div className="lg:col-span-4 space-y-6">
            
            {/* State Breakdown Card */}
            <div className="rounded-xl bg-surface-container-lowest p-6 space-y-6 shadow-sm border border-outline-variant/30">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-wider text-on-surface-variant font-semibold">
                  Smart Contract Ledger States
                </span>
                <span className="material-symbols-outlined text-primary text-lg">account_balance_wallet</span>
              </div>

              {/* The 3 States: Initial Escrow -> Claimable Credit -> Native GEN Withdrawal */}
              <div className="space-y-4 text-xs">
                {/* State 1 */}
                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-full bg-primary-container text-primary-fixed flex items-center justify-center shrink-0">
                    <span className="material-symbols-outlined text-sm">check</span>
                  </div>
                  <div className="space-y-0.5 min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-primary">1. Initial Escrow</span>
                      <span className="font-mono text-[11px] text-primary font-semibold">Settled & Released</span>
                    </div>
                    <p className="text-on-surface-variant">
                      {challenge.prizeAmount} test GEN was locked into contract escrow during open submissions and released from locked escrow upon consensus settlement.
                    </p>
                  </div>
                </div>

                {/* State 2 */}
                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-full bg-primary-container text-primary-fixed flex items-center justify-center shrink-0">
                    <span className="material-symbols-outlined text-sm">check</span>
                  </div>
                  <div className="space-y-0.5 min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-primary">
                        {decision.outcome === 'winner' ? '2. Claimable Credit Allocated' : '2. Sponsor Refund Allocated'}
                      </span>
                      <span className="font-mono text-[11px] font-semibold text-primary">
                        Internal Credit Ledger
                      </span>
                    </div>
                    <p className="text-on-surface-variant">
                      {winnerCreditWei !== null
                        ? `Verified on-chain via get_credit(): ${Number(winnerCreditWei) / 1e18} test GEN (${winnerCreditWei.toString()} wei) currently available in internal credit ledger for winner ${decision.winnerAddress}.`
                        : (decision.outcome === 'winner'
                          ? `On-chain decision allocates ${challenge.prizeAmount} test GEN to winner's internal claimable credit balance (transferred out of locked escrow).`
                          : `On-chain decision allocates ${challenge.prizeAmount} test GEN back to sponsor (${challenge.sponsorAddress}) as internal claimable credit.`)}
                    </p>
                  </div>
                </div>

                {/* State 3 */}
                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center shrink-0">
                    <span className="material-symbols-outlined text-sm">outbox</span>
                  </div>
                  <div className="space-y-0.5 min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-primary">
                        {decision.outcome === 'winner' ? '3. Native GEN Withdrawal' : '3. Escrow Reclaim Withdrawal'}
                      </span>
                      <span className="font-semibold text-[11px] text-secondary">
                        {winnerCreditWei !== null && winnerCreditWei > 0n ? 'Awaiting Signature' : 'Separate Step'}
                      </span>
                    </div>
                    <p className="text-on-surface-variant">
                      {decision.outcome === 'winner'
                        ? (winnerCreditWei !== null && winnerCreditWei > 0n
                          ? 'Winner has 10 test GEN in claimable credit. To disburse native GEN to an external wallet, the winner must connect and sign a withdraw() transaction.'
                          : 'Internal credit is distinct from native GEN transfer; withdrawing to an external wallet requires a separate transaction signed by the winner.')
                        : 'Sponsor may withdraw available refund credit back to their external wallet as native GEN via a withdraw transaction.'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Protocol Links */}
              <div className="pt-2 space-y-2 border-t border-outline-variant/20">
                <a
                  href={NETWORK_CONFIG.explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-full bg-primary-container text-on-primary hover:bg-tertiary-container transition-colors text-xs font-semibold shadow-sm"
                >
                  <span>Open Studio Next Explorer</span>
                  <span className="material-symbols-outlined text-xs">open_in_new</span>
                </a>
                <Link
                  to="/my-arena"
                  className="w-full inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-full bg-surface-container text-primary hover:bg-surface-container-high transition-colors text-xs font-semibold"
                >
                  View My Arena Portfolio
                </Link>
              </div>
            </div>

            {/* Consensus Architecture Note */}
            <div className="rounded-xl bg-surface-container-low p-6 space-y-4 border border-outline-variant/20 text-xs">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-base">psychology_alt</span>
                <span className="font-semibold text-primary text-sm">Consensus Architecture</span>
              </div>
              <p className="text-on-surface-variant leading-relaxed">
                How GenLayer Studio Next forms consensus creative outcomes without subjective ratings:
              </p>
              <div className="space-y-2">
                <div className="p-3 rounded bg-surface-container-lowest space-y-0.5">
                  <span className="font-semibold text-primary block">1. Immutable Rubric Hash</span>
                  <p className="text-on-surface-variant">Brief constraints were locked into state at initialization.</p>
                </div>
                <div className="p-3 rounded bg-surface-container-lowest space-y-0.5">
                  <span className="font-semibold text-primary block">2. Multi-Validator Parsing</span>
                  <p className="text-on-surface-variant">Independent nodes execute deterministic rule tests on inputs.</p>
                </div>
                <div className="p-3 rounded bg-surface-container-lowest space-y-0.5">
                  <span className="font-semibold text-primary block">3. Equivalence Verification</span>
                  <p className="text-on-surface-variant">Outcome attained by checking constraint adherence, not literary taste.</p>
                </div>
              </div>
            </div>

          </div>

        </div>

      </div>
    </div>
  );
};
