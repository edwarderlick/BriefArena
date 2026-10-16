import React from 'react';
import { Link } from 'react-router-dom';
import { Challenge } from '../types';
import { StatusBadge } from './StatusBadge';

interface ChallengeCardProps {
  challenge: Challenge;
}

export const ChallengeCard: React.FC<ChallengeCardProps> = ({ challenge }) => {
  const isAvailable = challenge.status === 'open' && challenge.filledSlots < challenge.maxSlots;

  return (
    <article className="flex flex-col justify-between bg-surface-container-lowest rounded-xl p-6 shadow-sm hover:shadow-md border border-outline-variant/30 transition-all group relative overflow-hidden">
      <div className="space-y-4">
        {/* Header Meta Strip */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={challenge.status} />
            <span className="px-2.5 py-0.5 rounded-full bg-surface-container-low text-on-surface-variant text-xs">
              {challenge.category}
            </span>
            <span className="px-2.5 py-0.5 rounded-full bg-surface-container-low text-on-surface-variant text-xs font-mono">
              {challenge.code}
            </span>
          </div>

          {/* Bounty Box */}
          <div className="flex flex-col items-end shrink-0">
            <span className="text-[11px] text-on-surface-variant uppercase tracking-wider font-medium">
              {challenge.status === 'canceled'
                ? 'Refunded Bounty'
                : challenge.status === 'awarded'
                ? 'Awarded Prize'
                : challenge.status === 'no-winner'
                ? 'Refunded Bounty'
                : 'Escrow Bounty'}
            </span>
            <span
              className={`font-serif text-xl font-semibold flex items-center gap-1 ${
                challenge.status === 'canceled'
                  ? 'text-on-surface-variant line-through decoration-error/50'
                  : 'text-primary'
              }`}
            >
              {challenge.prizeAmount}{' '}
              <span className="font-sans text-xs text-secondary font-medium">
                {challenge.prizeCurrency}
              </span>
            </span>
            {challenge.status === 'canceled' && (
              <span className="text-[10px] text-error font-medium">0 locked • Refunded to Sponsor</span>
            )}
            {challenge.status === 'awarded' && (
              <span className="text-[10px] text-primary font-medium">Settled • Paid to Winner</span>
            )}
          </div>
        </div>

        {/* Title & Brief Context */}
        <div className="space-y-1">
          <h2 className="font-serif text-2xl text-primary group-hover:text-surface-tint transition-colors leading-tight">
            <Link to={`/challenges/${challenge.id}`} className="hover:underline">
              {challenge.title}
            </Link>
          </h2>
          <p className="text-sm text-on-surface-variant leading-relaxed line-clamp-2">
            {challenge.synopsis}
          </p>
        </div>

        {/* Visual Editorial Feature Inset */}
        <div className="p-3.5 bg-surface-container-low rounded-lg flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-surface-container-high flex items-center justify-center text-primary shrink-0">
              <span className="material-symbols-outlined text-lg">format_quote</span>
            </div>
            <div className="flex flex-col">
              <span className="text-xs font-semibold text-primary">V1 Deliverable Format</span>
              <span className="text-xs text-on-surface-variant">1 Tagline + 1 Launch Paragraph</span>
            </div>
          </div>
          <div className="text-right shrink-0">
            <span className="text-[11px] text-on-surface-variant block uppercase tracking-wider">Slots</span>
            <span className="text-sm font-mono font-semibold text-primary">
              {challenge.filledSlots} / {challenge.maxSlots} Entries
            </span>
          </div>
        </div>
      </div>

      {/* Bottom Footer Details */}
      <div className="mt-6 pt-4 -mx-6 -mb-6 px-6 py-4 bg-surface-container-low/40 rounded-b-xl border-t border-outline-variant/20 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 text-on-surface-variant text-xs">
          <span className="material-symbols-outlined text-sm text-secondary">
            {challenge.status === 'canceled'
              ? 'cancel'
              : challenge.status === 'awarded' || challenge.status === 'no-winner'
              ? 'task_alt'
              : 'schedule'}
          </span>
          <span className={challenge.status === 'canceled' ? 'text-error font-medium' : ''}>
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

        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
          {challenge.status === 'awarded' || challenge.status === 'no-winner' ? (
            <Link
              to={`/challenges/${challenge.id}/decision`}
              className="px-4 py-1.5 rounded-full bg-surface-container text-primary hover:bg-surface-container-highest transition-colors text-xs font-semibold inline-flex items-center gap-1"
            >
              <span>{challenge.status === 'no-winner' ? 'View Verdict' : 'View Decision'}</span>
              <span className="material-symbols-outlined text-xs">gavel</span>
            </Link>
          ) : isAvailable ? (
            <Link
              to={`/challenges/${challenge.id}/submit`}
              className="px-4 py-1.5 rounded-full bg-primary text-on-primary hover:bg-primary-container transition-colors text-xs font-semibold inline-flex items-center gap-1 shadow-sm"
            >
              <span>Submit Entry</span>
              <span className="material-symbols-outlined text-xs">arrow_forward</span>
            </Link>
          ) : (
            <Link
              to={`/challenges/${challenge.id}`}
              className="px-4 py-1.5 rounded-full bg-surface-container text-primary hover:bg-surface-container-highest transition-colors text-xs font-semibold inline-flex items-center gap-1"
            >
              <span>Inspect Brief</span>
              <span className="material-symbols-outlined text-xs">arrow_forward</span>
            </Link>
          )}
        </div>
      </div>
    </article>
  );
};
