import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { DesignPreviewBanner } from '../components/DesignPreviewBanner';
import { NETWORK_CONFIG } from '../types';

export const HowItWorksPage: React.FC = () => {
  const [activeTraceTab, setActiveTraceTab] = useState<'brief' | 'validator' | 'settlement'>('brief');

  return (
    <div className="flex flex-col w-full pb-20">
      <DesignPreviewBanner message="Protocol Specifications & Execution Model on GenLayer Studio Next (Chain 61997)." />

      {/* Top Hero Banner */}
      <section className="bg-primary-container text-on-primary px-4 sm:px-6 lg:px-12 pt-12 pb-16 border-b border-primary/30">
        <div className="max-w-7xl mx-auto space-y-4">
          <div className="flex items-center gap-2">
            <span className="px-3 py-0.5 rounded-full bg-tertiary-container text-primary-fixed-dim text-xs font-semibold uppercase tracking-wider">
              Architecture &amp; Rules
            </span>
            <span className="text-on-primary-container text-xs">•</span>
            <span className="text-secondary-fixed text-xs font-mono">Chain 61997</span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
            <div className="lg:col-span-7 space-y-3">
              <h1 className="font-serif text-3xl sm:text-4xl lg:text-5xl text-surface-container-lowest tracking-tight">
                How BriefArena Works
              </h1>
              <p className="text-base text-inverse-primary leading-relaxed max-w-2xl">
                A deterministic, dispute-free creative arena where creative briefs are frozen on-chain and evaluated by GenLayer validators on Studio Next through consensus.
              </p>
            </div>

            {/* Quick Metrics Plinths */}
            <div className="lg:col-span-5 grid grid-cols-2 gap-3">
              <div className="p-4 rounded-xl bg-tertiary-container/80 border border-outline/20">
                <span className="font-serif text-2xl font-bold text-secondary-fixed block">3 Slots Max</span>
                <span className="text-[11px] text-primary-fixed-dim uppercase tracking-wider font-medium">Per Brief Capacity</span>
              </div>
              <div className="p-4 rounded-xl bg-tertiary-container/80 border border-outline/20">
                <span className="font-serif text-2xl font-bold text-primary-fixed block">100% Allocation</span>
                <span className="text-[11px] text-primary-fixed-dim uppercase tracking-wider font-medium">Winner or Escrow Refund</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 4-Stage Lifecycle Section */}
      <section className="w-full px-4 sm:px-6 lg:px-12 py-12 bg-surface-container-lowest border-b border-outline-variant/30">
        <div className="max-w-7xl mx-auto space-y-8">
          <div className="space-y-1 max-w-2xl">
            <span className="text-xs uppercase tracking-widest text-secondary font-semibold">
              The 4-Stage Architecture
            </span>
            <h2 className="font-serif text-2xl sm:text-3xl text-on-surface font-semibold">
              From Frozen Spec to Settlement
            </h2>
            <p className="text-sm text-on-surface-variant leading-relaxed">
              Every phase is enforced by intelligent contract parameters. Code eliminates sponsor reneging and arbitrary grading panels.
            </p>
          </div>

          {/* 4 Lifecycle Stages Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            
            {/* Stage 1 */}
            <div className="p-6 rounded-xl bg-surface-container-low text-on-surface flex flex-col justify-between space-y-6 shadow-sm border border-outline-variant/20 hover:bg-surface-container transition-all">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xl font-bold text-primary">01</span>
                  <span className="px-2 py-0.5 rounded-full bg-surface-container-highest text-primary text-[10px] font-bold uppercase tracking-wider">
                    Escrow Locked
                  </span>
                </div>
                <div className="w-10 h-10 rounded-full bg-surface-container-highest text-primary flex items-center justify-center">
                  <span className="material-symbols-outlined text-xl">lock</span>
                </div>
                <div className="space-y-1">
                  <h3 className="font-serif text-lg font-semibold text-on-surface">The Frozen Brief</h3>
                  <p className="text-xs text-on-surface-variant leading-relaxed">
                    The sponsor locks test GEN into the intelligent contract. Requirements, prohibited words, and deliverables become immutable upon launch.
                  </p>
                </div>
              </div>
              <div className="p-3 rounded bg-surface-container-lowest font-mono text-[11px] space-y-1 border border-outline-variant/20">
                <div className="text-on-surface-variant flex justify-between">
                  <span>ESCROW_STATUS</span>
                  <span className="text-primary font-bold">COMMITTED</span>
                </div>
                <div className="text-on-surface-variant flex justify-between">
                  <span>PARAMETERS</span>
                  <span className="text-secondary font-bold">FROZEN</span>
                </div>
              </div>
            </div>

            {/* Stage 2 */}
            <div className="p-6 rounded-xl bg-surface-container-low text-on-surface flex flex-col justify-between space-y-6 shadow-sm border border-outline-variant/20 hover:bg-surface-container transition-all">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xl font-bold text-secondary">02</span>
                  <span className="px-2 py-0.5 rounded-full bg-secondary-container text-on-secondary-container text-[10px] font-bold uppercase tracking-wider">
                    3 Entries Max
                  </span>
                </div>
                <div className="w-10 h-10 rounded-full bg-surface-container-highest text-primary flex items-center justify-center">
                  <span className="material-symbols-outlined text-xl">view_column</span>
                </div>
                <div className="space-y-1">
                  <h3 className="font-serif text-lg font-semibold text-on-surface">The 3-Slot Arena</h3>
                  <p className="text-xs text-on-surface-variant leading-relaxed">
                    To maintain high curatorial rigor, challenges accept a strict maximum of 3 entries, capped at 1 per unique wallet.
                  </p>
                </div>
              </div>
              <div className="p-3 rounded bg-surface-container-lowest font-mono text-[11px] space-y-1 border border-outline-variant/20">
                <div className="text-on-surface-variant flex justify-between">
                  <span>SLOT_LIMIT</span>
                  <span className="text-secondary font-bold">3 PER BRIEF</span>
                </div>
                <div className="text-on-surface-variant flex justify-between">
                  <span>WALLET_CAP</span>
                  <span className="text-on-surface font-bold">1 PER WALLET</span>
                </div>
              </div>
            </div>

            {/* Stage 3 */}
            <div className="p-6 rounded-xl bg-surface-container-low text-on-surface flex flex-col justify-between space-y-6 shadow-sm border border-outline-variant/20 hover:bg-surface-container transition-all">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xl font-bold text-primary">03</span>
                  <span className="px-2 py-0.5 rounded-full bg-surface-container-highest text-primary text-[10px] font-bold uppercase tracking-wider">
                    Validator Audit
                  </span>
                </div>
                <div className="w-10 h-10 rounded-full bg-surface-container-highest text-primary flex items-center justify-center">
                  <span className="material-symbols-outlined text-xl">balance</span>
                </div>
                <div className="space-y-1">
                  <h3 className="font-serif text-lg font-semibold text-on-surface">Bounded Reasoning</h3>
                  <p className="text-xs text-on-surface-variant leading-relaxed">
                    Independent GenLayer validators evaluate submissions strictly against prompt adherence and violation detection—no subjective ratings.
                  </p>
                </div>
              </div>
              <div className="p-3 rounded bg-surface-container-lowest font-mono text-[11px] space-y-1 border border-outline-variant/20">
                <div className="text-on-surface-variant flex justify-between">
                  <span>CONSENSUS</span>
                  <span className="text-primary font-bold">DETERMINISTIC</span>
                </div>
                <div className="text-on-surface-variant flex justify-between">
                  <span>DISQUALIFIERS</span>
                  <span className="text-error font-bold">STRICT RULES</span>
                </div>
              </div>
            </div>

            {/* Stage 4 */}
            <div className="p-6 rounded-xl bg-surface-container-low text-on-surface flex flex-col justify-between space-y-6 shadow-sm border border-outline-variant/20 hover:bg-surface-container transition-all">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xl font-bold text-secondary">04</span>
                  <span className="px-2 py-0.5 rounded-full bg-secondary-container text-on-secondary-container text-[10px] font-bold uppercase tracking-wider">
                    Settlement
                  </span>
                </div>
                <div className="w-10 h-10 rounded-full bg-surface-container-highest text-primary flex items-center justify-center">
                  <span className="material-symbols-outlined text-xl">currency_exchange</span>
                </div>
                <div className="space-y-1">
                  <h3 className="font-serif text-lg font-semibold text-on-surface">Credit Allocation or Refund</h3>
                  <p className="text-xs text-on-surface-variant leading-relaxed">
                    Under the contract rules, winning entry is credited 100% of the prize escrow. If no submission fulfills rubric compliance, the entire escrow is reclaimable by the sponsor via creditAvailable.
                  </p>
                </div>
              </div>
              <div className="p-3 rounded bg-surface-container-lowest font-mono text-[11px] space-y-1 border border-outline-variant/20">
                <div className="text-on-surface-variant flex justify-between">
                  <span>WINNER_CREDIT</span>
                  <span className="text-primary font-bold">100% TO VICTOR</span>
                </div>
                <div className="text-on-surface-variant flex justify-between">
                  <span>NO_WINNER</span>
                  <span className="text-secondary font-bold">ESCROW RECLAIM</span>
                </div>
              </div>
            </div>

          </div>

          {/* Illustrative Protocol Trace Simulator */}
          <div className="p-6 sm:p-8 rounded-2xl bg-primary-container text-on-primary space-y-6 shadow-md border border-primary/40">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-primary-fixed"></span>
                  <h3 className="font-serif text-xl text-primary-fixed font-semibold">
                    Illustrative Consensus Trace
                  </h3>
                </div>
                <p className="text-xs text-on-primary-container">
                  Demonstration of how the GenLayer consensus state machine progresses through lifecycle stages.
                </p>
              </div>

              {/* Tabs */}
              <div className="flex items-center gap-1 bg-tertiary-container/80 p-1 rounded-full text-xs">
                <button
                  onClick={() => setActiveTraceTab('brief')}
                  className={`px-3 py-1.5 rounded-full transition-all font-semibold ${
                    activeTraceTab === 'brief'
                      ? 'bg-primary-fixed text-on-primary-fixed'
                      : 'text-on-primary-container hover:text-white'
                  }`}
                >
                  01. Frozen Brief State
                </button>
                <button
                  onClick={() => setActiveTraceTab('validator')}
                  className={`px-3 py-1.5 rounded-full transition-all font-semibold ${
                    activeTraceTab === 'validator'
                      ? 'bg-primary-fixed text-on-primary-fixed'
                      : 'text-on-primary-container hover:text-white'
                  }`}
                >
                  02. Validator Trace
                </button>
                <button
                  onClick={() => setActiveTraceTab('settlement')}
                  className={`px-3 py-1.5 rounded-full transition-all font-semibold ${
                    activeTraceTab === 'settlement'
                      ? 'bg-primary-fixed text-on-primary-fixed'
                      : 'text-on-primary-container hover:text-white'
                  }`}
                >
                  03. Settlement Receipt
                </button>
              </div>
            </div>

            {/* Trace View Box */}
            <div className="p-5 rounded-xl bg-primary/70 font-mono text-xs text-primary-fixed-dim space-y-3 leading-relaxed border border-primary/30">
              {activeTraceTab === 'brief' && (
                <div className="space-y-2">
                  <div className="flex justify-between text-[11px] text-secondary-fixed">
                    <span>&gt; BRIEF_SPEC: IMMUTABLE_PAYLOAD</span>
                    <span>STUDIO NEXT (CHAIN 61997)</span>
                  </div>
                  <p className="text-on-primary font-serif italic text-sm">
                    "Design the launch identity slogan for an off-grid ecological databank in Patagonia."
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2 text-[11px]">
                    <div className="p-3 rounded bg-tertiary-container">
                      <span className="text-primary-fixed block font-bold mb-1">MANDATORY_TERMS:</span>
                      <span>["glacier", "cold storage", "permanent"]</span>
                    </div>
                    <div className="p-3 rounded bg-tertiary-container">
                      <span className="text-secondary-fixed block font-bold mb-1">PROHIBITED_TERMS:</span>
                      <span>["crypto", "defi", "silicon", "blockchain"]</span>
                    </div>
                    <div className="p-3 rounded bg-tertiary-container">
                      <span className="text-primary-fixed-dim block font-bold mb-1">ESCROW_BALANCE:</span>
                      <span className="text-secondary-fixed font-bold">250.00 test GEN (Locked)</span>
                    </div>
                  </div>
                </div>
              )}

              {activeTraceTab === 'validator' && (
                <div className="space-y-3">
                  <div className="flex justify-between text-[11px] text-secondary-fixed">
                    <span>&gt; VALIDATOR_EVALUATION_AUDIT</span>
                    <span>BOUNDED REASONING RESULT</span>
                  </div>
                  <div className="p-3 rounded bg-tertiary-container text-xs space-y-1">
                    <span className="text-primary-fixed font-bold">[ENTRY 02 - 0x71C4...4b92]:</span> "Glacier Archive: Cold storage for civilization's permanent memory."
                    <span className="block text-primary-fixed-dim font-sans text-xs pt-1">
                      <strong>Verdict: QUALIFYING &amp; WINNER.</strong> Adheres to all required keywords; 0 prohibited tokens detected; character length 60/60 compliant.
                    </span>
                  </div>
                  <div className="p-3 rounded bg-tertiary-container text-xs space-y-1">
                    <span className="text-secondary-fixed font-bold">[ENTRY 01 - 0x04F1...1e18]:</span> "Decentralized blockchain cold storage in Patagonia."
                    <span className="block text-error-container text-xs font-sans pt-1">
                      <strong>Verdict: DISQUALIFIED.</strong> Prohibited term 'blockchain' found in copy. Rule constraint violation triggered.
                    </span>
                  </div>
                </div>
              )}

              {activeTraceTab === 'settlement' && (
                <div className="space-y-2">
                  <div className="flex justify-between text-[11px] text-secondary-fixed">
                    <span>&gt; SETTLEMENT_RECEIPT</span>
                    <span>STATE: SIMULATED_CREDIT_SETTLEMENT</span>
                  </div>
                  <div className="p-3 rounded bg-tertiary-container space-y-1 text-xs">
                    <div className="text-primary-fixed font-bold flex justify-between">
                      <span>RECIPIENT_WALLET:</span>
                      <span>0x71C4...4b92</span>
                    </div>
                    <div className="text-secondary-fixed font-bold flex justify-between">
                      <span>CREDITED_PAYOUT:</span>
                      <span>250.00 test GEN</span>
                    </div>
                    <div className="text-primary-fixed-dim flex justify-between">
                      <span>NETWORK:</span>
                      <span>Studio Next (Chain 61997)</span>
                    </div>
                  </div>
                  <p className="text-primary-fixed font-sans text-xs pt-1">
                    Consensus simulation completed. Under contract rules, prize is credited to internal credit balance, ready for native GEN withdrawal.
                  </p>
                </div>
              )}
            </div>
          </div>

        </div>
      </section>

      {/* Network Configuration Guide */}
      <section className="w-full px-4 sm:px-6 lg:px-12 py-12">
        <div className="max-w-7xl mx-auto space-y-6">
          <div className="space-y-1">
            <span className="text-xs uppercase tracking-widest text-secondary font-semibold">
              Network Details
            </span>
            <h2 className="font-serif text-2xl sm:text-3xl text-primary font-semibold">
              Studio Next Technical Configuration
            </h2>
            <p className="text-sm text-on-surface-variant">
              To test the app and interact with Studio Next, configure your injected wallet with these exact RPC settings.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-5 rounded-xl bg-surface-container-lowest border border-outline-variant/30 space-y-1">
              <span className="text-xs text-outline font-semibold uppercase">Network Name</span>
              <p className="text-sm font-semibold text-primary">{NETWORK_CONFIG.chainName}</p>
            </div>
            <div className="p-5 rounded-xl bg-surface-container-lowest border border-outline-variant/30 space-y-1">
              <span className="text-xs text-outline font-semibold uppercase">Chain ID</span>
              <p className="text-sm font-mono font-semibold text-primary">{NETWORK_CONFIG.chainId} (0xF22D)</p>
            </div>
            <div className="p-5 rounded-xl bg-surface-container-lowest border border-outline-variant/30 space-y-1">
              <span className="text-xs text-outline font-semibold uppercase">RPC Endpoint</span>
              <p className="text-xs font-mono font-semibold text-primary truncate" title={NETWORK_CONFIG.rpcUrl}>
                {NETWORK_CONFIG.rpcUrl}
              </p>
            </div>
            <div className="p-5 rounded-xl bg-surface-container-lowest border border-outline-variant/30 space-y-1">
              <span className="text-xs text-outline font-semibold uppercase">Currency Symbol</span>
              <p className="text-sm font-semibold text-primary">test GEN (18 Decimals)</p>
            </div>
          </div>

          <div className="pt-4 flex flex-wrap items-center gap-4">
            <a
              href={NETWORK_CONFIG.explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-6 py-2.5 rounded-full bg-primary text-on-primary text-xs font-semibold hover:bg-primary-container transition-all inline-flex items-center gap-1.5 shadow-sm"
            >
              <span>Explore Studio Next Blocks</span>
              <span className="material-symbols-outlined text-sm">open_in_new</span>
            </a>
            <Link
              to="/challenges"
              className="px-6 py-2.5 rounded-full bg-surface-container text-primary text-xs font-semibold hover:bg-surface-container-high transition-all"
            >
              Explore Sample Challenges
            </Link>
          </div>
        </div>
      </section>

    </div>
  );
};
