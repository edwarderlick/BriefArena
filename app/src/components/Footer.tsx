import React from 'react';
import { Link } from 'react-router-dom';
import { NETWORK_CONFIG } from '../types';

export const Footer: React.FC = () => {
  return (
    <footer className="w-full bg-primary-container text-on-primary-container py-12 border-t border-outline/10 mt-auto">
      <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-12">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-8 pb-8 border-b border-outline/15">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="font-serif text-2xl text-primary-fixed tracking-tight font-medium">
                BriefArena
              </span>
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-tertiary-container text-primary-fixed-dim">
                Studio Preview
              </span>
            </div>
            <p className="text-sm text-on-primary-container max-w-md leading-relaxed">
              Decentralized creative brief execution and consensus-driven review running on GenLayer Studio Next.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-6 text-sm">
            <a
              className="text-primary-fixed hover:text-white flex items-center gap-1 transition-colors"
              href={NETWORK_CONFIG.explorerUrl}
              rel="noopener noreferrer"
              target="_blank"
            >
              Studio Explorer
              <span className="material-symbols-outlined text-xs">north_east</span>
            </a>
            <Link className="text-on-primary-container hover:text-white transition-colors" to="/how-it-works">
              Network Specs &amp; RPC
            </Link>
            <Link className="text-on-primary-container hover:text-white transition-colors" to="/challenges">
              Explore Challenges
            </Link>
            <Link className="text-on-primary-container hover:text-white transition-colors" to="/my-arena">
              My Arena
            </Link>
          </div>
        </div>

        <div className="pt-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="space-y-1">
            <p className="text-xs text-primary-fixed-dim">
              BriefArena on GenLayer Studio Next. Contract deployed on Chain 61997.
            </p>
            <p className="text-xs text-secondary-fixed/90">
              All prizes and credits use test GEN on Studio Next with no real monetary value.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-tertiary-container text-primary-fixed-dim text-xs font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-primary-fixed"></span>
              Studio Next (Chain 61997)
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
};
