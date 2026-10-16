import React from 'react';
import { Link } from 'react-router-dom';
import { DesignPreviewBanner } from '../components/DesignPreviewBanner';
import { StatusBadge } from '../components/StatusBadge';
import { SAMPLE_CHALLENGES } from '../data/fixtures';
import { CONTRACT_ADDRESS } from '../services/contractClient';

export const LandingPage: React.FC = () => {
  const featuredChallenge = SAMPLE_CHALLENGES[0]; // Aether OS

  return (
    <div className="flex flex-col w-full">
      <DesignPreviewBanner
        message={
          CONTRACT_ADDRESS
            ? `Design Preview — Contract deployed at ${CONTRACT_ADDRESS} on Studio Next (Chain 61997). Live reads active.`
            : 'Design Preview — Visual layout active. No contract address configured (VITE_BRIEF_ARENA_CONTRACT_ADDRESS unset).'
        }
      />

      {/* Top Forest Green Hero Banner */}
      <section className="relative bg-primary-container text-on-primary px-4 sm:px-6 lg:px-12 pt-16 pb-36 overflow-hidden">
        {/* Subtle architectural background glow */}
        <div className="absolute -top-32 right-10 w-96 h-96 rounded-full bg-surface-tint/20 blur-3xl pointer-events-none"></div>
        <div className="absolute bottom-0 left-1/4 w-80 h-80 rounded-full bg-secondary/15 blur-2xl pointer-events-none"></div>

        <div className="max-w-6xl mx-auto flex flex-col items-center text-center relative z-10 space-y-6">
          {/* Network Testnet Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-tertiary-container/80 text-primary-fixed-dim text-xs font-medium tracking-wide shadow-sm">
            <span className="w-2 h-2 rounded-full bg-secondary-fixed animate-ping"></span>
            <span className="w-1.5 h-1.5 -ml-2 rounded-full bg-secondary-fixed"></span>
            <span>GenLayer Studio Next Testnet</span>
            <span className="text-on-primary-container">•</span>
            <span className="font-mono text-secondary-fixed">Chain ID: 61997</span>
          </div>

          {/* Hero Title */}
          <h1 className="font-serif text-4xl sm:text-5xl lg:text-6xl tracking-tight text-surface-container-lowest max-w-4xl text-balance leading-tight">
            Good ideas deserve a{' '}
            <span className="italic font-serif text-secondary-fixed font-light">
              fair finish.
            </span>
          </h1>

          {/* Hero Subtitle */}
          <p className="text-base sm:text-lg text-inverse-primary max-w-2xl leading-relaxed">
            Fund a brief. Create an entry. Let independent validators decide the result through deterministic consensus on GenLayer Studio Next.
          </p>

          {/* Action Pill Group */}
          <div className="flex flex-wrap items-center justify-center gap-4 pt-2">
            <Link
              to="/challenges"
              className="px-6 sm:px-8 py-3 rounded-full bg-surface-container-lowest text-primary font-semibold text-sm sm:text-base hover:bg-surface-container transition-all duration-200 shadow-md hover:shadow-lg flex items-center gap-2"
            >
              <span>Explore challenges</span>
              <span className="material-symbols-outlined text-base">arrow_forward</span>
            </Link>
            <Link
              to="/challenges/new"
              className="px-6 sm:px-8 py-3 rounded-full bg-tertiary-container/80 text-surface-container-lowest hover:bg-tertiary-container font-semibold text-sm sm:text-base transition-all duration-200 shadow-sm flex items-center gap-2"
            >
              <span>Create a challenge</span>
              <span className="material-symbols-outlined text-base">add_circle</span>
            </Link>
          </div>

          {/* Format Constraints Strip */}
          <div className="pt-2">
            <div className="inline-flex items-center gap-2 px-5 py-1.5 rounded-full bg-primary/60 text-on-primary-container text-xs tracking-wider uppercase font-medium">
              <span className="material-symbols-outlined text-secondary-fixed text-sm">verified_user</span>
              <span>V1 Format: 1 Tagline + 1 Launch Paragraph • Max 3 Public Entries</span>
            </div>
          </div>
        </div>
      </section>

      {/* Overlapping Master Content Plinth */}
      <section className="relative px-4 sm:px-6 lg:px-12 -mt-24 pb-20 z-20">
        <div className="max-w-6xl mx-auto bg-surface-container-lowest rounded-2xl shadow-xl overflow-hidden p-6 sm:p-10 lg:p-12 space-y-12 border border-outline-variant/30">
          
          {/* Section 1: Protocol Architecture Overview */}
          <div className="space-y-6">
            <div className="flex items-center gap-2">
              <span className="px-3 py-1 rounded-full bg-surface-container text-on-surface-variant text-xs uppercase tracking-wider font-semibold inline-flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-secondary"></span>
                Protocol Architecture
              </span>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              <div className="lg:col-span-7 space-y-3">
                <h2 className="font-serif text-3xl sm:text-4xl text-on-surface tracking-tight leading-tight">
                  A deterministic, <span className="italic text-secondary font-serif">honest arena</span> for creative work
                </h2>
                <p className="text-base text-on-surface-variant leading-relaxed">
                  A sponsor locks test GEN and freezes the brief. Creators submit work before the deadline. GenLayer validators assess the entries against the original frozen requirements on-chain.
                </p>
              </div>

              {/* Protocol Metrics Badges Bento */}
              <div className="lg:col-span-5 grid grid-cols-2 gap-3 pt-1">
                <div className="p-4 rounded-xl bg-surface-container-low shadow-sm flex flex-col justify-between border border-outline-variant/20">
                  <span className="text-[11px] text-on-surface-variant uppercase font-medium">Network Layer</span>
                  <span className="text-base font-semibold text-primary font-mono mt-1">Chain 61997</span>
                  <span className="text-xs text-outline mt-0.5">Studio Next Testnet</span>
                </div>
                <div className="p-4 rounded-xl bg-surface-container-low shadow-sm flex flex-col justify-between border border-outline-variant/20">
                  <span className="text-[11px] text-on-surface-variant uppercase font-medium">Capped Arena</span>
                  <span className="text-base font-semibold text-primary font-mono mt-1">3 Entries max</span>
                  <span className="text-xs text-outline mt-0.5">High signal density</span>
                </div>
                <div className="p-4 rounded-xl bg-surface-container-low shadow-sm flex flex-col justify-between border border-outline-variant/20">
                  <span className="text-[11px] text-on-surface-variant uppercase font-medium">Evaluation</span>
                  <span className="text-base font-semibold text-primary mt-1">Consensus-Backed</span>
                  <span className="text-xs text-outline mt-0.5">Intelligent Contracts</span>
                </div>
                <div className="p-4 rounded-xl bg-surface-container-low shadow-sm flex flex-col justify-between border border-outline-variant/20">
                  <span className="text-[11px] text-on-surface-variant uppercase font-medium">Custody Model</span>
                  <span className="text-base font-semibold text-primary font-mono mt-1">Test GEN Escrow</span>
                  <span className="text-xs text-outline mt-0.5">Automated release</span>
                </div>
              </div>
            </div>
          </div>

          {/* Horizontal Strip of Badges */}
          <div className="w-full overflow-x-auto py-2 -mx-6 px-6 sm:-mx-10 sm:px-10 flex items-center gap-2 border-y border-outline-variant/20">
            {['Frozen Brief', 'Public Entries', 'Test GEN Prize', 'On-Chain Decision', 'Bounded Reasoning', 'Zero Subjective Bias', 'Refund Protection Model'].map((tag) => (
              <span key={tag} className="whitespace-nowrap px-3.5 py-1 rounded-full bg-surface-container text-on-surface-variant text-xs font-medium">
                {tag}
              </span>
            ))}
          </div>

          {/* Section 2: 3-Step Execution Model */}
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-2">
              <div>
                <span className="text-xs uppercase tracking-wider text-outline font-semibold">Workflow</span>
                <h3 className="font-serif text-2xl text-on-surface mt-1">How BriefArena operates</h3>
              </div>
              <span className="text-xs text-on-surface-variant">Zero hidden arbiters • Pure cryptographic auditability</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Step 1 */}
              <div className="p-6 rounded-xl bg-surface-container-low hover:bg-surface-container transition-all flex flex-col justify-between space-y-4 shadow-sm border border-outline-variant/20">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-base font-bold text-secondary">01</span>
                    <span className="material-symbols-outlined text-outline">lock_open_right</span>
                  </div>
                  <h4 className="font-serif text-lg font-semibold text-on-surface">Fund the brief</h4>
                  <p className="text-sm text-on-surface-variant leading-relaxed">
                    Sponsor supplies title, message, prohibited claims, test GEN prize, and deadline. Once locked, the parameter set is immutable and frozen on GenLayer.
                  </p>
                </div>
                <div className="pt-2">
                  <span className="inline-flex items-center gap-1 text-xs text-primary font-semibold">
                    <span>Escrow locked</span>
                    <span className="material-symbols-outlined text-xs">done</span>
                  </span>
                </div>
              </div>

              {/* Step 2 */}
              <div className="p-6 rounded-xl bg-surface-container-low hover:bg-surface-container transition-all flex flex-col justify-between space-y-4 shadow-sm border border-outline-variant/20">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-base font-bold text-secondary">02</span>
                    <span className="material-symbols-outlined text-outline">rate_review</span>
                  </div>
                  <h4 className="font-serif text-lg font-semibold text-on-surface">Submit the work</h4>
                  <p className="text-sm text-on-surface-variant leading-relaxed">
                    Exactly 3 entries accepted per challenge, capped at 1 per wallet. Public tagline and launch paragraph strictly checked against char constraints.
                  </p>
                </div>
                <div className="pt-2">
                  <span className="inline-flex items-center gap-1 text-xs text-primary font-semibold">
                    <span>Public registry</span>
                    <span className="material-symbols-outlined text-xs">done</span>
                  </span>
                </div>
              </div>

              {/* Step 3 */}
              <div className="p-6 rounded-xl bg-surface-container-low hover:bg-surface-container transition-all flex flex-col justify-between space-y-4 shadow-sm border border-outline-variant/20">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-base font-bold text-secondary">03</span>
                    <span className="material-symbols-outlined text-outline">gavel</span>
                  </div>
                  <h4 className="font-serif text-lg font-semibold text-on-surface">Decide and settle</h4>
                  <p className="text-sm text-on-surface-variant leading-relaxed">
                    Validators compare public work strictly to the frozen brief. Winning entry credited in contract balance; if no entry qualifies, the sponsor can reclaim the escrow.
                  </p>
                </div>
                <div className="pt-2">
                  <span className="inline-flex items-center gap-1 text-xs text-primary font-semibold">
                    <span>Deterministic release</span>
                    <span className="material-symbols-outlined text-xs">done</span>
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Section 3: Featured Live Challenge Preview Card */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs uppercase tracking-wider text-outline font-semibold">Design Preview</span>
                <h3 className="font-serif text-2xl text-on-surface mt-0.5">Featured Arena Brief</h3>
              </div>
              <Link to="/challenges" className="hidden sm:inline-flex items-center gap-1 text-sm font-semibold text-primary hover:text-secondary transition-colors">
                <span>View all briefs</span>
                <span className="material-symbols-outlined text-sm">arrow_forward</span>
              </Link>
            </div>

            {/* Featured Card Plinth */}
            <div className="p-6 sm:p-8 rounded-xl bg-surface-container-high shadow-md hover:shadow-lg transition-all border border-outline-variant/30">
              <div className="flex flex-col lg:flex-row justify-between gap-6">
                {/* Left Info Panel */}
                <div className="space-y-4 max-w-2xl">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={featuredChallenge.status} />
                    <span className="px-2.5 py-0.5 rounded-full bg-surface-container text-on-surface-variant text-xs font-mono">
                      {featuredChallenge.code}
                    </span>
                    <span className="px-2.5 py-0.5 rounded-full bg-surface-container text-on-surface-variant text-xs">
                      Format: Tagline + Paragraph
                    </span>
                  </div>
                  <div>
                    <h4 className="font-serif text-2xl sm:text-3xl text-on-surface tracking-tight">
                      {featuredChallenge.title}
                    </h4>
                    <p className="text-sm text-on-surface-variant mt-2 leading-relaxed">
                      {featuredChallenge.synopsis}
                    </p>
                  </div>
                  <div className="p-4 rounded-lg bg-surface-container-low space-y-1">
                    <span className="text-xs text-outline uppercase font-semibold">Strict Prohibited Claims:</span>
                    <p className="text-xs text-on-surface-variant">
                      Do not use generic tech clichés ("revolutionize", "blockchain", "web3", "ai-driven", "paradigm shift"). Must mention task switching &amp; zero telemetry.
                    </p>
                  </div>
                </div>

                {/* Right Bounty & Capacity Panel */}
                <div className="lg:w-80 flex flex-col justify-between p-6 rounded-xl bg-surface-container-lowest shadow-sm space-y-4 border border-outline-variant/20">
                  <div className="space-y-1">
                    <span className="text-[11px] uppercase tracking-wider text-outline font-medium">Locked Bounty</span>
                    <div className="flex items-baseline gap-2">
                      <span className="font-serif text-3xl font-semibold text-primary">{featuredChallenge.prizeAmount}</span>
                      <span className="text-sm text-secondary font-medium">{featuredChallenge.prizeCurrency}</span>
                    </div>
                    <p className="text-xs text-on-surface-variant">Contract settlement on validation consensus</p>
                  </div>

                  {/* Slot Allocation Progress */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-on-surface-variant">Arena Capacity</span>
                      <span className="font-semibold text-primary font-mono">{featuredChallenge.filledSlots} / {featuredChallenge.maxSlots} Slots Filled</span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-surface-container overflow-hidden">
                      <div className="h-full bg-primary rounded-full" style={{ width: `${(featuredChallenge.filledSlots / featuredChallenge.maxSlots) * 100}%` }}></div>
                    </div>
                    <div className="flex items-center justify-between text-outline text-xs pt-1">
                      <span className="flex items-center gap-1">
                        <span className="material-symbols-outlined text-xs">timer</span>
                        <span>{featuredChallenge.remainingTime}</span>
                      </span>
                      <span className="text-secondary font-semibold">
                        {featuredChallenge.maxSlots - featuredChallenge.filledSlots} slot left
                      </span>
                    </div>
                  </div>

                  <div className="pt-1 space-y-1">
                    <Link
                      to={`/challenges/${featuredChallenge.id}`}
                      className="w-full py-2.5 px-4 rounded-full bg-primary text-on-primary font-semibold text-xs sm:text-sm text-center block hover:bg-tertiary transition-all"
                    >
                      Inspect &amp; Submit Entry
                    </Link>
                    <span className="block text-center text-[11px] text-outline">Target: Studio Next (Chain 61997)</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Section 4: Bottom Callout Banner */}
          <div className="relative rounded-2xl bg-primary-container text-on-primary p-6 sm:p-10 overflow-hidden shadow-lg flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="absolute -right-20 -bottom-20 w-80 h-80 rounded-full bg-surface-tint/20 blur-3xl pointer-events-none"></div>
            <div className="space-y-2 max-w-xl relative z-10 text-center md:text-left">
              <span className="px-3 py-0.5 rounded-full bg-tertiary-container text-primary-fixed-dim text-xs uppercase tracking-wider inline-block font-semibold">
                Start on Studio Next
              </span>
              <h3 className="font-serif text-2xl sm:text-3xl tracking-tight text-surface-container-lowest">
                Ready to sponsor or compete?
              </h3>
              <p className="text-sm text-inverse-primary">
                Lock test GEN for your design prompt or submit your best draft before slots close.
              </p>
            </div>
            <div className="relative z-10 flex flex-wrap items-center justify-center gap-3">
              <Link
                to="/challenges/new"
                className="px-6 py-2.5 rounded-full bg-surface-container-lowest text-primary font-semibold text-sm hover:bg-surface-container transition-all shadow-md"
              >
                Launch Create Challenge
              </Link>
              <Link
                to="/how-it-works"
                className="px-6 py-2.5 rounded-full bg-tertiary-container/80 text-surface-container-lowest hover:bg-tertiary-container font-semibold text-sm transition-all"
              >
                Read Specifications
              </Link>
            </div>
          </div>

        </div>
      </section>
    </div>
  );
};
