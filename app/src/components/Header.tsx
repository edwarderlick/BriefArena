import React, { useState } from 'react';
import { NavLink, Link } from 'react-router-dom';
import { useWallet } from '../context/WalletContext';
import { NETWORK_CONFIG } from '../types';
import { BriefArenaLogo } from './BriefArenaLogo';

export const Header: React.FC = () => {
  const { isConnected, address, balance, isConnecting, isCorrectNetwork, connectWallet, disconnectWallet, switchNetwork } = useWallet();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const formatAddress = (addr: string) => {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  const navLinkClasses = ({ isActive }: { isActive: boolean }) =>
    isActive
      ? "px-space-md py-2 rounded-full transition-all bg-tertiary-container text-primary-fixed font-semibold text-sm"
      : "px-space-md py-2 rounded-full font-medium text-sm text-on-primary-container hover:text-on-primary hover:bg-tertiary-container/60 transition-all";

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-primary-container text-on-primary shadow-[0_1px_8px_rgba(0,0,0,0.06)] border-b border-primary/40">
      <div className="h-20 w-full px-4 sm:px-6 lg:px-12 flex items-center justify-between gap-4">
        {/* Left: Brand + Nav */}
        <div className="flex items-center gap-6 lg:gap-10">
          <Link to="/" className="flex items-center gap-3 group text-decoration-none" aria-label="BriefArena Home">
            <BriefArenaLogo className="w-9 h-9 transition-transform group-hover:scale-105" />
            <div className="flex items-center gap-2">
              <span className="font-serif text-2xl text-primary-fixed tracking-tight font-medium group-hover:text-surface-bright transition-colors">
                BriefArena
              </span>
              <span className="px-2 py-0.5 rounded-full bg-tertiary-container text-primary-fixed-dim text-[11px] font-semibold uppercase tracking-wider">
                Studio
              </span>
            </div>
          </Link>

          {/* Desktop Nav */}
          <nav className="hidden xl:flex items-center gap-1 p-1 rounded-full bg-primary/40">
            <NavLink to="/challenges" className={navLinkClasses}>
              Explore Challenges
            </NavLink>
            <NavLink to="/challenges/new" className={navLinkClasses}>
              Create Challenge
            </NavLink>
            <NavLink to="/how-it-works" className={navLinkClasses}>
              How It Works
            </NavLink>
            <NavLink to="/my-arena" className={navLinkClasses}>
              My Arena
            </NavLink>
          </nav>
        </div>

        {/* Right: Network info + Wallet Widget */}
        <div className="flex items-center gap-2 sm:gap-4">
          {/* Network Pill */}
          <a
            href={NETWORK_CONFIG.explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden md:inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-tertiary-container/90 text-primary-fixed-dim hover:text-on-primary hover:bg-tertiary-container transition-all text-xs"
            title="GenLayer Studio Next Testnet (Chain ID 61997)"
          >
            <span className="w-2 h-2 rounded-full bg-primary-fixed animate-pulse shadow-[0_0_8px_rgba(201,234,215,0.8)]"></span>
            <span className="font-medium">Studio Next (61997)</span>
            <span className="material-symbols-outlined text-xs text-on-primary-container">north_east</span>
          </a>

          {/* Wallet State Widget */}
          {!isConnected ? (
            <button
              id="connect-wallet-btn"
              onClick={connectWallet}
              disabled={isConnecting}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-secondary-container text-on-secondary-container hover:bg-secondary-fixed transition-all text-xs font-semibold shadow-sm active:scale-95 disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-sm">account_balance_wallet</span>
              <span>{isConnecting ? "Connecting..." : "Connect Wallet"}</span>
            </button>
          ) : !isCorrectNetwork ? (
            <button
              id="switch-network-btn"
              onClick={switchNetwork}
              className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-error-container text-on-error-container hover:bg-error-container/80 transition-all text-xs font-semibold"
            >
              <span className="material-symbols-outlined text-sm">warning</span>
              <span>Switch to Chain 61997</span>
            </button>
          ) : (
            <div className="flex items-center gap-2 pl-2 pr-3 py-1 rounded-full bg-tertiary-container border border-outline/20">
              {balance !== null ? (
                <div className="hidden sm:flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary-container/80 text-[11px] font-semibold text-secondary-fixed">
                  <span className="material-symbols-outlined text-xs">token</span>
                  <span>{balance} test GEN</span>
                </div>
              ) : (
                <div
                  className="hidden sm:flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary-container/40 text-[11px] font-medium text-primary-fixed-dim"
                  title="The Studio Next contract read is currently failing; retry or inspect the error."
                >
                  <span className="material-symbols-outlined text-xs text-outline">sync_problem</span>
                  <span>Balance unavailable</span>
                </div>
              )}
              <div className="flex items-center gap-1.5 font-mono text-xs text-primary-fixed-dim">
                <span>{address ? formatAddress(address) : ''}</span>
              </div>
              <button
                onClick={disconnectWallet}
                className="text-on-primary-container hover:text-on-primary text-xs p-1 rounded-full transition-colors"
                title="Clear app session (clears local state only; does not disconnect wallet extension)"
                aria-label="Clear app session (clears local state only; does not disconnect wallet extension)"
              >
                <span className="material-symbols-outlined text-sm">logout</span>
              </button>
            </div>
          )}

          {/* Mobile hamburger button */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="xl:hidden p-2 rounded-full text-primary-fixed hover:bg-tertiary-container/60 transition-colors"
            aria-label="Toggle Navigation Menu"
          >
            <span className="material-symbols-outlined text-2xl">
              {mobileMenuOpen ? 'close' : 'menu'}
            </span>
          </button>
        </div>
      </div>

      {/* Mobile Menu Dropdown */}
      {mobileMenuOpen && (
        <div className="xl:hidden bg-primary-container border-t border-tertiary-container px-6 py-4 space-y-2">
          <NavLink
            to="/challenges"
            onClick={() => setMobileMenuOpen(false)}
            className="block py-2 text-primary-fixed hover:text-white font-medium text-sm"
          >
            Explore Challenges
          </NavLink>
          <NavLink
            to="/challenges/new"
            onClick={() => setMobileMenuOpen(false)}
            className="block py-2 text-primary-fixed hover:text-white font-medium text-sm"
          >
            Create Challenge
          </NavLink>
          <NavLink
            to="/how-it-works"
            onClick={() => setMobileMenuOpen(false)}
            className="block py-2 text-primary-fixed hover:text-white font-medium text-sm"
          >
            How It Works
          </NavLink>
          <NavLink
            to="/my-arena"
            onClick={() => setMobileMenuOpen(false)}
            className="block py-2 text-primary-fixed hover:text-white font-medium text-sm"
          >
            My Arena
          </NavLink>
          <div className="pt-2 border-t border-tertiary-container flex items-center justify-between text-xs text-primary-fixed-dim">
            <span>Studio Next (Chain 61997)</span>
            <a
              href={NETWORK_CONFIG.explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-secondary-fixed hover:underline flex items-center gap-0.5"
            >
              Explorer <span className="material-symbols-outlined text-[10px]">north_east</span>
            </a>
          </div>
        </div>
      )}
    </header>
  );
};
