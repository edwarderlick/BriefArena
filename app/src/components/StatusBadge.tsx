import React from 'react';
import { ChallengeStatus } from '../types';

interface StatusBadgeProps {
  status: ChallengeStatus;
  size?: 'sm' | 'md';
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, size = 'md' }) => {
  const isSm = size === 'sm';
  const padding = isSm ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-label-sm';

  switch (status) {
    case 'open':
      return (
        <span className={`inline-flex items-center gap-1.5 rounded-full bg-surface-container-high text-primary font-semibold ${padding}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-surface-tint"></span>
          <span>Open</span>
        </span>
      );
    case 'closed':
      return (
        <span className={`inline-flex items-center gap-1.5 rounded-full bg-surface-container text-on-surface-variant font-medium ${padding}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-outline"></span>
          <span>Closed for entries</span>
        </span>
      );
    case 'judging':
      return (
        <span className={`inline-flex items-center gap-1.5 rounded-full bg-secondary-container text-on-secondary-container font-semibold ${padding}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-secondary animate-pulse"></span>
          <span>Judging</span>
        </span>
      );
    case 'awarded':
      return (
        <span className={`inline-flex items-center gap-1.5 rounded-full bg-primary text-on-primary font-semibold ${padding}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-primary-fixed"></span>
          <span>Awarded</span>
        </span>
      );
    case 'no-winner':
      return (
        <span className={`inline-flex items-center gap-1.5 rounded-full bg-surface-container-high text-on-surface-variant font-medium ${padding}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-outline"></span>
          <span>No Winner</span>
        </span>
      );
    case 'canceled':
      return (
        <span className={`inline-flex items-center gap-1.5 rounded-full bg-error-container text-on-error-container font-medium ${padding}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-error"></span>
          <span>Canceled</span>
        </span>
      );
    default:
      return null;
  }
};
