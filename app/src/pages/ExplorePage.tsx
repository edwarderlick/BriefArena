import React, { useState, useEffect } from 'react';
import { Challenge, ChallengeStatus } from '../types';
import { dataService } from '../services/dataService';
import { isContractConfigured, CONTRACT_ADDRESS } from '../services/contractClient';
import { ChallengeCard } from '../components/ChallengeCard';
import { DesignPreviewBanner } from '../components/DesignPreviewBanner';
import { LoadingState, EmptyState } from '../components/StateViews';

type FilterType = 'all' | ChallengeStatus;

export const ExplorePage: React.FC = () => {
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [allChallenges, setAllChallenges] = useState<Challenge[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshIndex, setRefreshIndex] = useState(0);

  useEffect(() => {
    let isCancelled = false;
    const loadChallenges = async () => {
      setIsLoading(true);
      setLoadError(null);
      try {
        const all = await dataService.getChallenges('all');
        if (isCancelled) return;
        setAllChallenges(all);

        const filtered = await dataService.getChallenges(activeFilter === 'all' ? undefined : activeFilter);
        if (isCancelled) return;
        setChallenges(filtered);
      } catch (err: any) {
        if (isCancelled) return;
        console.error('Failed reading challenges from Studio Next:', err);
        setLoadError(err?.message || 'RPC Read Failure');
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    };
    loadChallenges();
    return () => {
      isCancelled = true;
    };
  }, [activeFilter, refreshIndex]);

  const isLiveConfigured = isContractConfigured();
  const isFixture = !isLiveConfigured && (allChallenges.length === 0 || allChallenges.every(c => c.isFixture));

  const displayedChallenges = challenges.filter(c => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return c.title.toLowerCase().includes(q) || 
           c.category.toLowerCase().includes(q) || 
           c.code.toLowerCase().includes(q) ||
           c.synopsis.toLowerCase().includes(q);
  });

  const getCount = (filter: FilterType) => {
    if (filter === 'all') return allChallenges.length;
    return allChallenges.filter(c => c.status === filter).length;
  };

  const filterButtons: { key: FilterType; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'open', label: 'Open' },
    { key: 'closed', label: 'Closed for entries' },
    { key: 'judging', label: 'Judging' },
    { key: 'awarded', label: 'Awarded' },
    { key: 'no-winner', label: 'No Winner' },
    { key: 'canceled', label: 'Canceled' },
  ];

  const handleRetry = () => {
    setActiveFilter('all');
    setSearchQuery('');
    setRefreshIndex(prev => prev + 1);
  };

  return (
    <div className="flex flex-col w-full pb-20">
      <DesignPreviewBanner
        isFixture={isFixture}
        contractAddress={CONTRACT_ADDRESS || undefined}
        message="Design preview — sample data. Explore filters operate on typed fixture challenges."
      />

      {/* Hero Header Strip */}
      <section className="bg-primary-container text-on-primary px-4 sm:px-6 lg:px-12 pt-10 pb-12 border-b border-primary/30">
        <div className="max-w-7xl mx-auto space-y-4">
          <div className="flex items-center gap-2">
            <span className="px-3 py-0.5 rounded-full bg-tertiary-container text-primary-fixed-dim text-xs font-semibold uppercase tracking-wider">
              Directory
            </span>
            <span className="text-on-primary-container text-xs">•</span>
            <span className="text-secondary-fixed text-xs font-mono">Chain 61997</span>
          </div>

          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
            <div className="space-y-2 max-w-2xl">
              <h1 className="font-serif text-3xl sm:text-4xl lg:text-5xl text-surface-container-lowest tracking-tight">
                Explore Creative Briefs
              </h1>
              <p className="text-sm sm:text-base text-inverse-primary leading-relaxed">
                Review cryptographically frozen creative challenges, evaluate entries, or track settlement results across active and archived rounds.
              </p>
            </div>

            {/* Quick Search */}
            <div className="w-full md:w-80 relative">
              <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-outline text-lg">
                search
              </span>
              <input
                type="text"
                placeholder="Search briefs or keywords..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 rounded-full bg-tertiary-container/80 text-surface-container-lowest placeholder:text-primary-fixed-dim text-xs focus:outline-none focus:ring-2 focus:ring-primary-fixed"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-primary-fixed-dim hover:text-white"
                >
                  <span className="material-symbols-outlined text-sm">close</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Filter Tabs Bar */}
      <section className="w-full px-4 sm:px-6 lg:px-12 py-6 bg-surface-container-lowest/60 border-b border-outline-variant/30">
        <div className="max-w-7xl mx-auto flex flex-col xl:flex-row items-start xl:items-center justify-between gap-4">
          {/* State Pill Filters */}
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            {filterButtons.map(({ key, label }) => {
              const isActive = activeFilter === key;
              const count = getCount(key);
              return (
                <button
                  key={key}
                  onClick={() => setActiveFilter(key)}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-all flex items-center gap-1.5 ${
                    isActive
                      ? 'bg-primary text-on-primary shadow-sm'
                      : 'bg-surface-container-lowest text-on-surface hover:bg-surface-container border border-outline-variant/30'
                  }`}
                >
                  <span>{label}</span>
                  <span
                    className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                      isActive
                        ? 'bg-on-primary/20 text-on-primary'
                        : 'bg-surface-container-high text-on-surface-variant'
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Network Truth Indicator */}
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-surface-container text-primary text-xs self-stretch xl:self-auto justify-between xl:justify-start">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-surface-tint"></span>
              <span className="font-medium">GenLayer Studio Next (61997)</span>
            </div>
            <span className="text-outline-variant font-mono">/</span>
            <span className="text-secondary font-semibold uppercase tracking-wider text-[11px]">
              Test GEN Only
            </span>
          </div>
        </div>
      </section>

      {/* Challenge Grid */}
      <section className="w-full px-4 sm:px-6 lg:px-12 pt-8">
        <div className="max-w-7xl mx-auto">
          {isLoading ? (
            <LoadingState message="Filtering briefs..." />
          ) : loadError ? (
            <EmptyState
              title="Studio Next RPC / Contract Read Error"
              message={loadError}
              actionLabel="Retry Read"
              onAction={handleRetry}
            />
          ) : displayedChallenges.length === 0 ? (
            <EmptyState
              title={
                isLiveConfigured && allChallenges.length === 0
                  ? "No Briefs on Live Contract"
                  : `No ${activeFilter !== 'all' ? activeFilter : ''} challenges found`
              }
              message={
                isLiveConfigured && allChallenges.length === 0
                  ? `The BriefArena contract (${CONTRACT_ADDRESS}) currently contains no challenges on Studio Next (Chain 61997).`
                  : searchQuery
                  ? `No briefs match your query "${searchQuery}". Try clearing search.`
                  : `There are currently no briefs filed under "${activeFilter}".`
              }
              actionLabel={
                isLiveConfigured && allChallenges.length === 0
                  ? "Refresh Read"
                  : "Show All Challenges"
              }
              onAction={
                isLiveConfigured && allChallenges.length === 0
                  ? handleRetry
                  : () => {
                      setActiveFilter('all');
                      setSearchQuery('');
                    }
              }
            />
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {displayedChallenges.map(challenge => (
                <ChallengeCard key={challenge.id} challenge={challenge} />
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
