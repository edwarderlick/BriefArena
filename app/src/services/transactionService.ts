/**
 * transactionService.ts
 *
 * Typed transaction service for BriefArena contract methods.
 * Covers: create_challenge and submit_entry.
 *
 * WRITE GATE
 * ----------
 * WRITES_ENABLED is false. All on-chain dispatch (createKit, dispatchTransaction,
 * and any transaction submission) is guarded by this constant.
 * Even if a caller constructs or provides a TransactionKit and PolicyQuote,
 * dispatchTransaction will unconditionally reject the call while WRITES_ENABLED
 * is false. Zero transactions can be broadcast.
 *
 * When WRITES_ENABLED is later set to true:
 *   1. A wallet must be connected (provider available via window.ethereum).
 *   2. The wallet must be on Chain 61997 (Studio Next).
 *   3. CONTRACT_ADDRESS must be non-null.
 *   4. A successful estimate (PolicyQuote carrying userValue) must precede submit.
 *   5. Fee-estimation failures block dispatch and surface a typed error.
 *
 * No reads, explorer links, or state queries are gated — they are always
 * available through contractClient.ts and dataService.ts.
 */

import {
  createTransactionKit,
  type TransactionKit,
  type SubmitInput,
  type PolicyInput,
  type PolicyQuote,
  type TrackedStatus,
  type Eip1193Provider,
} from '@genlayer/transaction-kit';
import { chains } from 'genlayer-js';
import { CONTRACT_ADDRESS, type Address } from './contractClient';
import { NETWORK_CONFIG } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// BUILD-CONTROLLED WRITE GATE
// ─────────────────────────────────────────────────────────────────────────────
// Defaults to false. Can ONLY be toggled at build time via VITE_WRITES_ENABLED.
// Vite statically inlines this during bundling (import.meta.env.VITE_WRITES_ENABLED === 'true').
// In Node/SSR test runners, it reads process.env.VITE_WRITES_ENABLED === 'true'.
// No runtime setters, window overrides, global overrides, or test bypasses exist.
const getBuildWritesEnabled = (): boolean => {
  if (typeof process !== 'undefined' && process.env && typeof process.env.VITE_WRITES_ENABLED !== 'undefined') {
    return process.env.VITE_WRITES_ENABLED === 'true';
  }
  if (typeof import.meta !== 'undefined' && import.meta.env && typeof import.meta.env.VITE_WRITES_ENABLED !== 'undefined') {
    return import.meta.env.VITE_WRITES_ENABLED === 'true';
  }
  return false;
};

export const WRITES_ENABLED: boolean = getBuildWritesEnabled();

// ─────────────────────────────────────────────────────────────────────────────
// Studio Next chain definition (mirrors contractClient.ts studioNextChain)
// ─────────────────────────────────────────────────────────────────────────────
export const studioNextChain = {
  ...chains.studioDevnet,
  rpcUrls: {
    ...chains.studioDevnet.rpcUrls,
    default: { http: ['https://studio-next.genlayer.com/api'] },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Typed error class for transaction-layer failures
// ─────────────────────────────────────────────────────────────────────────────
export type TxErrorCode =
  | 'WRITE_GATE_DISABLED'
  | 'CONTRACT_ADDRESS_MISSING'
  | 'WRONG_CHAIN'
  | 'NO_WALLET'
  | 'INVALID_INPUT_BOUNDS'
  | 'FEE_ESTIMATION_FAILED'
  | 'DISPATCH_FAILED'
  | 'EXECUTION_FAILED';

export class TransactionServiceError extends Error {
  readonly code: TxErrorCode;
  readonly cause?: unknown;

  constructor(code: TxErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'TransactionServiceError';
    this.code = code;
    this.cause = cause;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// Address Validation & Resolution
// ─────────────────────────────────────────────────────────────────────────────
export function isValidAddress(address: unknown): address is Address {
  return typeof address === 'string' && /^0x[0-9a-fA-F]{40}$/.test(address);
}

export function resolveContractAddress(explicitAddress?: Address | null): Address {
  const candidate = explicitAddress ?? CONTRACT_ADDRESS;
  if (!candidate || !isValidAddress(candidate)) {
    throw new TransactionServiceError(
      'CONTRACT_ADDRESS_MISSING',
      'Contract address is not configured or is invalid. Set VITE_BRIEF_ARENA_CONTRACT_ADDRESS in environment or pass a valid address argument.',
    );
  }
  return candidate;
}

// ─────────────────────────────────────────────────────────────────────────────
// Transaction UI state machine for review & future enabled flow:
// review → fee_quote → confirming → broadcast → tracking → success | execution_failed | unknown
// ─────────────────────────────────────────────────────────────────────────────
export type TxFlowPhase =
  | 'idle'
  | 'estimating'
  | 'review'
  | 'fee_quote'
  | 'confirming'
  | 'broadcast'
  | 'tracking'
  | 'pending'
  | 'finalized'
  | 'success'
  | 'execution_failed'
  | 'unknown'
  | 'error';

export type TxUIState =
  | { phase: 'idle' }
  | { phase: 'estimating' }
  | {
      phase: 'review';
      submitInput?: SubmitInput;
      quote?: PolicyQuote;
      nativeValueGen?: string;
      nativeValueWei?: bigint;
    }
  | {
      phase: 'fee_quote';
      submitInput: SubmitInput;
      quote: PolicyQuote;
      nativeValueGen?: string;
    }
  | {
      phase: 'confirming';
      submitInput: SubmitInput;
      quote: PolicyQuote;
    }
  | {
      phase: 'broadcast';
      txId: `0x${string}`;
      explorerLink: string;
      evmTxHash?: `0x${string}`;
    }
  | {
      phase: 'tracking';
      txId: `0x${string}`;
      explorerLink: string;
      status: TrackedStatus;
    }
  | { phase: 'pending'; txId: `0x${string}`; explorerLink: string }
  | { phase: 'finalized'; txId: `0x${string}`; explorerLink: string; status: TrackedStatus }
  | {
      phase: 'success';
      txId: `0x${string}`;
      explorerLink: string;
      status: TrackedStatus;
    }
  | {
      phase: 'execution_failed';
      txId: `0x${string}`;
      explorerLink: string;
      status: TrackedStatus;
      reason?: string;
    }
  | {
      phase: 'unknown';
      txId: `0x${string}`;
      explorerLink: string;
      status: TrackedStatus;
      reason: string;
      retryable: true;
    }
  | { phase: 'error'; error: TransactionServiceError };

export function makeTxExplorerLink(txId: string): string {
  return `${NETWORK_CONFIG.explorerUrl}tx/${txId}`;
}

export function idleState(): TxUIState {
  return { phase: 'idle' };
}

export function reviewDraftState(
  submitInput: SubmitInput,
  nativeValueGen?: string,
  nativeValueWei?: bigint,
): TxUIState {
  return {
    phase: 'review',
    submitInput,
    nativeValueGen,
    nativeValueWei,
  };
}

/**
 * Determines whether a TrackedStatus represents genuinely successful on-chain execution.
 *
 * CRITICAL CONSENSUS RULE:
 * GenLayer transactions reach 'finalized' on consensus regardless of whether the contract
 * method reverted. A status with phase 'finalized' must NEVER be treated as successful
 * unless executionResultName === 'FINISHED_WITH_RETURN' and successful === true.
 * Execution failures (FINISHED_WITH_ERROR, reverts) must resolve to execution_failed.
 * Conflicting or missing execution evidence must resolve to 'unknown; verify receipt'.
 * An ACCEPTED or decided phase is NOT finalized and must never be treated as finalized success.
 */
export function isExecutionSuccessful(status: TrackedStatus): boolean {
  if (status.phase !== 'finalized' && status.statusName !== 'FINALIZED') {
    return false;
  }
  if (status.statusName === 'CANCELED') return false;
  if (status.executionResultName === 'FINISHED_WITH_ERROR') return false;
  if (status.successful === false) return false;

  // Strict verification: requires FINISHED_WITH_RETURN and successful === true
  return status.executionResultName === 'FINISHED_WITH_RETURN' && status.successful === true;
}

export function isExecutionProvenFailed(status: TrackedStatus): boolean {
  if (status.phase !== 'finalized' && status.statusName !== 'FINALIZED') {
    return false;
  }
  // Conflicting evidence is inconclusive, not proven failure
  if (status.executionResultName === 'FINISHED_WITH_RETURN' && status.successful === false) {
    return false;
  }
  if (status.executionResultName === 'FINISHED_WITH_ERROR' && status.successful === true) {
    return false;
  }

  if (
    status.executionResultName === 'FINISHED_WITH_ERROR' ||
    status.executionResultName === 'ERROR' ||
    status.executionResultName === 'TIMEOUT' ||
    status.executionResultName === 'NONDET_DISAGREE' ||
    status.statusName === 'CANCELED'
  ) {
    return true;
  }

  if (status.successful === false && status.executionResultName !== undefined) {
    return true;
  }

  return false;
}

export function isExecutionInconclusive(status: TrackedStatus): boolean {
  if (status.phase !== 'finalized' && status.statusName !== 'FINALIZED') {
    return false;
  }
  return !isExecutionSuccessful(status) && !isExecutionProvenFailed(status);
}

/**
 * Maps a resolved TrackedStatus from Transaction Kit into success, execution_failed, or unknown.
 * Guarantees that:
 *  1. FINALIZED alone without successful execution is never reported as success.
 *  2. ACCEPTED or decided phase is never treated as finalized success (remains in tracking).
 *  3. Conflicting or missing execution evidence maps to 'unknown' ("unknown; verify receipt"), preserving txId & explorer link.
 */
export function mapTrackedStatusToOutcome(
  status: TrackedStatus,
  txId: `0x${string}`,
  explorerLink: string,
): TxUIState {
  // If not finalized, it remains in tracking phase (ACCEPTED / decided alone is not finalized success)
  if (status.phase !== 'finalized' && status.statusName !== 'FINALIZED') {
    return {
      phase: 'tracking',
      txId,
      explorerLink,
      status,
    };
  }

  // Finalized on consensus: evaluate execution evidence
  if (isExecutionSuccessful(status)) {
    return {
      phase: 'success',
      txId,
      explorerLink,
      status,
    };
  }

  if (isExecutionProvenFailed(status)) {
    return {
      phase: 'execution_failed',
      txId,
      explorerLink,
      status,
      reason: status.executionResultName || status.statusName || 'Execution reverted on-chain',
    };
  }

  // Inconclusive or conflicting execution evidence: unknown; verify receipt
  return {
    phase: 'unknown',
    txId,
    explorerLink,
    status,
    reason: 'Inconclusive execution evidence (unknown; verify receipt)',
    retryable: true,
  };
}

export function isTerminal(state: TxUIState): boolean {
  return (
    state.phase === 'success' ||
    state.phase === 'finalized' ||
    state.phase === 'execution_failed' ||
    state.phase === 'unknown' ||
    state.phase === 'error'
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Safe GEN to Wei conversion (zero floating-point math inaccuracies)
// ─────────────────────────────────────────────────────────────────────────────
export const MIN_PRIZE_WEI = 10n * 10n ** 18n; // 10 test GEN minimum escrow
export const MIN_DURATION_SECONDS = 86400n;    // 24 hours
export const MAX_DURATION_SECONDS = 604800n;   // 168 hours (7 days)

/**
 * Converts a human GEN decimal amount (number or string) to wei as a BigInt
 * without IEEE 754 floating-point multiplication errors.
 */
export function genToWei(genAmount: number | string): bigint {
  const str = typeof genAmount === 'number' ? genAmount.toString() : String(genAmount).trim();
  if (!/^\d+(\.\d+)?$/.test(str)) {
    throw new TransactionServiceError(
      'INVALID_INPUT_BOUNDS',
      `Invalid GEN amount format: "${genAmount}". Must be a non-negative decimal string or number.`,
    );
  }

  const [whole, fraction = ''] = str.split('.');
  if (fraction.length > 18) {
    throw new TransactionServiceError(
      'INVALID_INPUT_BOUNDS',
      `GEN amount "${genAmount}" exceeds maximum 18 decimal places.`,
    );
  }

  const paddedFraction = fraction.padEnd(18, '0');
  const combined = `${whole}${paddedFraction}`.replace(/^0+/, '') || '0';
  return BigInt(combined);
}

// ─────────────────────────────────────────────────────────────────────────────
// create_challenge — form values mapped to exact deployed contract signature
//
// Deployed contract signature (from contracts/brief_arena.py & CONTRACT_SPEC.md):
//   @gl.public.write.payable
//   def create_challenge(
//       self,
//       title: str,                          # 5 <= len <= 60
//       category: str,                       # 3 <= len <= 40
//       synopsis: str,                       # 40 <= len <= 500
//       mandatory_requirements: list[str],   # 1 <= len <= 4, each 5 <= len <= 120
//       prohibited_terms: list[str],         # 1 <= len <= 6, each 2 <= len <= 25
//       duration_seconds: u256,              # 86400 <= dur <= 604800 (24h–168h)
//   ) -> u256
//
// PRIZE ATTACHMENT:
//   Attached GEN is read on-chain from gl.message.value (assert >= 10 GEN).
//   The prize is NOT an argument to create_challenge.
//   It MUST be attached via PolicyInput.userValue during fee estimation,
//   which produces a PolicyQuote whose userValue is carried into kit.submit().
// ─────────────────────────────────────────────────────────────────────────────
export interface CreateChallengeFormValues {
  title: string;
  category: string;
  synopsis: string;
  mandatoryRequirements: string[];  // 1–4 items, each trimmed 5–120 chars
  prohibitedTerms: string[];        // 1–6 items, each trimmed 2–25 chars
  durationHours: number;            // 24–168 hours, converted to duration_seconds
  prizeAmountGen: number | string;  // >= 10 GEN, converted to wei for PolicyInput.userValue
}

export interface ValidatedCreateChallenge {
  cleanTitle: string;
  cleanCategory: string;
  cleanSynopsis: string;
  cleanRequirements: string[];
  cleanProhibited: string[];
  durationSeconds: bigint;
  prizeWei: bigint;
}

export function validateCreateChallengeValues(
  values: CreateChallengeFormValues,
): ValidatedCreateChallenge {
  const cleanTitle = values.title?.trim() ?? '';
  if (cleanTitle.length < 5 || cleanTitle.length > 60) {
    throw new TransactionServiceError(
      'INVALID_INPUT_BOUNDS',
      `Title must be between 5 and 60 characters (received ${cleanTitle.length}).`,
    );
  }

  const cleanCategory = values.category?.trim() ?? '';
  if (cleanCategory.length < 3 || cleanCategory.length > 40) {
    throw new TransactionServiceError(
      'INVALID_INPUT_BOUNDS',
      `Category must be between 3 and 40 characters (received ${cleanCategory.length}).`,
    );
  }

  const cleanSynopsis = values.synopsis?.trim() ?? '';
  if (cleanSynopsis.length < 40 || cleanSynopsis.length > 500) {
    throw new TransactionServiceError(
      'INVALID_INPUT_BOUNDS',
      `Synopsis must be between 40 and 500 characters (received ${cleanSynopsis.length}).`,
    );
  }

  const cleanRequirements = (values.mandatoryRequirements ?? [])
    .map(r => r.trim())
    .filter(r => r.length > 0);
  if (cleanRequirements.length < 1 || cleanRequirements.length > 4) {
    throw new TransactionServiceError(
      'INVALID_INPUT_BOUNDS',
      `Mandatory requirements count must be between 1 and 4 (received ${cleanRequirements.length}).`,
    );
  }
  for (const req of cleanRequirements) {
    if (req.length < 5 || req.length > 120) {
      throw new TransactionServiceError(
        'INVALID_INPUT_BOUNDS',
        `Each mandatory requirement must be between 5 and 120 characters (received "${req}": ${req.length}).`,
      );
    }
  }

  const cleanProhibited = (values.prohibitedTerms ?? [])
    .map(p => p.trim())
    .filter(p => p.length > 0);
  if (cleanProhibited.length < 1 || cleanProhibited.length > 6) {
    throw new TransactionServiceError(
      'INVALID_INPUT_BOUNDS',
      `Prohibited terms count must be between 1 and 6 (received ${cleanProhibited.length}).`,
    );
  }
  for (const term of cleanProhibited) {
    if (term.length < 2 || term.length > 25) {
      throw new TransactionServiceError(
        'INVALID_INPUT_BOUNDS',
        `Each prohibited term must be between 2 and 25 characters (received "${term}": ${term.length}).`,
      );
    }
  }

  if (typeof values.durationHours !== 'number' || !Number.isFinite(values.durationHours)) {
    throw new TransactionServiceError(
      'INVALID_INPUT_BOUNDS',
      `Duration hours must be a valid number (received ${values.durationHours}).`,
    );
  }
  const durationSeconds = BigInt(Math.round(values.durationHours * 3600));
  if (durationSeconds < MIN_DURATION_SECONDS || durationSeconds > MAX_DURATION_SECONDS) {
    throw new TransactionServiceError(
      'INVALID_INPUT_BOUNDS',
      `Duration must be between 24 hours (86,400s) and 168 hours (604,800s). Received ${durationSeconds}s.`,
    );
  }

  const prizeWei = genToWei(values.prizeAmountGen);
  if (prizeWei < MIN_PRIZE_WEI) {
    throw new TransactionServiceError(
      'INVALID_INPUT_BOUNDS',
      `Prize escrow must be at least 10 GEN (10,000,000,000,000,000,000 wei). Received ${prizeWei.toString()} wei.`,
    );
  }

  return {
    cleanTitle,
    cleanCategory,
    cleanSynopsis,
    cleanRequirements,
    cleanProhibited,
    durationSeconds,
    prizeWei,
  };
}

/**
 * Builds the exact six-argument SubmitInput for create_challenge.
 * Arguments: title, category, synopsis, mandatory_requirements, prohibited_terms, duration_seconds.
 * The prize is strictly excluded from args (attached via PolicyInput.userValue).
 */
export function buildCreateChallengeSubmitInput(
  values: CreateChallengeFormValues,
  contractAddress?: Address | null,
): SubmitInput {
  const validated = validateCreateChallengeValues(values);
  const resolvedAddress: Address = resolveContractAddress(contractAddress);

  return {
    kind: 'write',
    address: resolvedAddress,
    method: 'create_challenge',
    args: [
      validated.cleanTitle,
      validated.cleanCategory,
      validated.cleanSynopsis,
      validated.cleanRequirements,
      validated.cleanProhibited,
      validated.durationSeconds,
    ],
  };
}

/**
 * Returns prize value in wei to be passed into PolicyInput.userValue for fee estimation.
 */
export function createChallengeValue(values: CreateChallengeFormValues): bigint {
  const validated = validateCreateChallengeValues(values);
  return validated.prizeWei;
}

/**
 * Builds PolicyInput for estimating create_challenge with attached prize escrow.
 */
export function buildCreateChallengePolicyInput(
  values: CreateChallengeFormValues,
  preset: 'low' | 'standard' | 'high' = 'standard',
): PolicyInput {
  return {
    preset,
    userValue: createChallengeValue(values),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// submit_entry — form value types mapped to exact deployed contract signature
//
// Deployed contract signature (from contracts/brief_arena.py & CONTRACT_SPEC.md):
//   @gl.public.write
//   def submit_entry(
//       self,
//       challenge_id: u256,
//       tagline: str,      # 1 <= len(tagline.strip()) <= 60
//       paragraph: str,    # 30 <= len(paragraph.strip()) <= 280
//   ) -> None
//   payable: no (userValue = 0)
// ─────────────────────────────────────────────────────────────────────────────
export interface SubmitEntryFormValues {
  challengeId: bigint;
  tagline: string;    // contract limit: 1–60 chars (trimmed)
  paragraph: string;  // contract limit: 30–280 chars (trimmed)
}

export interface ValidatedSubmitEntry {
  challengeId: bigint;
  cleanTagline: string;
  cleanParagraph: string;
}

export function validateSubmitEntryValues(
  values: SubmitEntryFormValues,
): ValidatedSubmitEntry {
  if (typeof values.challengeId !== 'bigint' || values.challengeId <= 0n) {
    throw new TransactionServiceError(
      'INVALID_INPUT_BOUNDS',
      `Challenge ID must be a positive integer (received ${values.challengeId}).`,
    );
  }

  const cleanTagline = values.tagline?.trim() ?? '';
  if (cleanTagline.length < 1 || cleanTagline.length > 60) {
    throw new TransactionServiceError(
      'INVALID_INPUT_BOUNDS',
      `Tagline must be between 1 and 60 characters (received ${cleanTagline.length}).`,
    );
  }

  const cleanParagraph = values.paragraph?.trim() ?? '';
  if (cleanParagraph.length < 30 || cleanParagraph.length > 280) {
    throw new TransactionServiceError(
      'INVALID_INPUT_BOUNDS',
      `Paragraph must be between 30 and 280 characters (received ${cleanParagraph.length}).`,
    );
  }

  return {
    challengeId: values.challengeId,
    cleanTagline,
    cleanParagraph,
  };
}

export function buildSubmitEntrySubmitInput(
  values: SubmitEntryFormValues,
  contractAddress?: Address | null,
): SubmitInput {
  const validated = validateSubmitEntryValues(values);
  const resolvedAddress: Address = resolveContractAddress(contractAddress);

  return {
    kind: 'write',
    address: resolvedAddress,
    method: 'submit_entry',
    args: [
      validated.challengeId,
      validated.cleanTagline,
      validated.cleanParagraph,
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// cancel_challenge — input validation and SubmitInput builder
//
// Deployed contract signature (from contracts/brief_arena.py & CONTRACT_SPEC.md):
//   @gl.public.write
//   def cancel_challenge(self, challenge_id: u256) -> None:
//
// Contract Preconditions:
//   - challenge_id in self.challenges
//   - gl.message.sender_address == ch.sponsorAddress
//   - ch.status == ChallengeStatus.OPEN
//   - ch.filledSlots == 0 (no active entries)
//
// Note on Value / Refunds:
//   Cancellation allocates 100% of prize escrow to the sponsor's internal credit
//   ledger (self.creditAvailable). It does NOT emit a native GEN transfer.
//   Withdrawal is a separate action. userValue is strictly 0n (non-payable).
// ─────────────────────────────────────────────────────────────────────────────
export interface CancelChallengeFormValues {
  challengeId: bigint;
}

export interface ValidatedCancelChallenge {
  challengeId: bigint;
}

export function validateCancelChallengeValues(
  values: CancelChallengeFormValues,
): ValidatedCancelChallenge {
  if (typeof values.challengeId !== 'bigint' || values.challengeId <= 0n) {
    throw new TransactionServiceError(
      'INVALID_INPUT_BOUNDS',
      `Challenge ID must be a positive integer (received ${values.challengeId}).`,
    );
  }
  return { challengeId: values.challengeId };
}

export function buildCancelChallengeSubmitInput(
  values: CancelChallengeFormValues,
  contractAddress?: Address | null,
): SubmitInput {
  const validated = validateCancelChallengeValues(values);
  const resolvedAddress: Address = resolveContractAddress(contractAddress);

  return {
    kind: 'write',
    address: resolvedAddress,
    method: 'cancel_challenge',
    args: [validated.challengeId],
  };
}

export function buildCancelChallengePolicyInput(
  preset: 'low' | 'standard' | 'high' = 'standard',
): PolicyInput {
  return {
    preset,
    userValue: 0n,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// withdraw — input builder for claiming internal credits
//
// Deployed contract signature (from contracts/brief_arena.py & CONTRACT_SPEC.md):
//   @gl.public.write
//   def withdraw(self) -> None:
//
// Contract Preconditions:
//   - self.creditAvailable[gl.message.sender_address] > 0
//
// Effects:
//   - Clears sender credit in internal ledger to 0
//   - Updates totalClaimableCredits and genWithdrawn
//   - Emits native GEN transfer to sender's EOA via _Recipient(user).emit_transfer()
//   - Requires zero contract arguments (args: [])
//   - Non-payable from caller: userValue is strictly 0n
// ─────────────────────────────────────────────────────────────────────────────
export function buildWithdrawSubmitInput(
  contractAddress?: Address | null,
): SubmitInput {
  const resolvedAddress: Address = resolveContractAddress(contractAddress);

  return {
    kind: 'write',
    address: resolvedAddress,
    method: 'withdraw',
    args: [],
  };
}

export function buildWithdrawPolicyInput(
  preset: 'low' | 'standard' | 'high' = 'standard',
): PolicyInput {
  return {
    preset,
    userValue: 0n,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle method builders:
//   close_deadline(challenge_id: u256)
//   expire_zero_entries(challenge_id: u256)
//   commit_judging(challenge_id: u256)
//   attempt_judgement(challenge_id: u256)
//   timeout_judgement(challenge_id: u256)
//
// All 5 methods take exactly one validated positive u256 challenge ID,
// require a resolved contract address, and are non-payable (userValue: 0n).
// ─────────────────────────────────────────────────────────────────────────────

export interface LifecycleChallengeFormValues {
  challengeId: bigint;
}

export interface ValidatedLifecycleChallenge {
  challengeId: bigint;
}

export function validateLifecycleChallengeValues(
  values: LifecycleChallengeFormValues,
): ValidatedLifecycleChallenge {
  if (typeof values.challengeId !== 'bigint' || values.challengeId <= 0n) {
    throw new TransactionServiceError(
      'INVALID_INPUT_BOUNDS',
      `Challenge ID must be a positive integer (received ${values.challengeId}).`,
    );
  }
  return { challengeId: values.challengeId };
}

// 1. close_deadline(challenge_id: u256)
export function buildCloseDeadlineSubmitInput(
  values: LifecycleChallengeFormValues,
  contractAddress?: Address | null,
): SubmitInput {
  const validated = validateLifecycleChallengeValues(values);
  const resolvedAddress: Address = resolveContractAddress(contractAddress);
  return {
    kind: 'write',
    address: resolvedAddress,
    method: 'close_deadline',
    args: [validated.challengeId],
  };
}

export function buildCloseDeadlinePolicyInput(
  preset: 'low' | 'standard' | 'high' = 'standard',
): PolicyInput {
  return { preset, userValue: 0n };
}

// 2. expire_zero_entries(challenge_id: u256)
export function buildExpireZeroEntriesSubmitInput(
  values: LifecycleChallengeFormValues,
  contractAddress?: Address | null,
): SubmitInput {
  const validated = validateLifecycleChallengeValues(values);
  const resolvedAddress: Address = resolveContractAddress(contractAddress);
  return {
    kind: 'write',
    address: resolvedAddress,
    method: 'expire_zero_entries',
    args: [validated.challengeId],
  };
}

export function buildExpireZeroEntriesPolicyInput(
  preset: 'low' | 'standard' | 'high' = 'standard',
): PolicyInput {
  return { preset, userValue: 0n };
}

// 3. commit_judging(challenge_id: u256)
export function buildCommitJudgingSubmitInput(
  values: LifecycleChallengeFormValues,
  contractAddress?: Address | null,
): SubmitInput {
  const validated = validateLifecycleChallengeValues(values);
  const resolvedAddress: Address = resolveContractAddress(contractAddress);
  return {
    kind: 'write',
    address: resolvedAddress,
    method: 'commit_judging',
    args: [validated.challengeId],
  };
}

export function buildCommitJudgingPolicyInput(
  preset: 'low' | 'standard' | 'high' = 'standard',
): PolicyInput {
  return { preset, userValue: 0n };
}

// 4. attempt_judgement(challenge_id: u256)
export function buildAttemptJudgementSubmitInput(
  values: LifecycleChallengeFormValues,
  contractAddress?: Address | null,
): SubmitInput {
  const validated = validateLifecycleChallengeValues(values);
  const resolvedAddress: Address = resolveContractAddress(contractAddress);
  return {
    kind: 'write',
    address: resolvedAddress,
    method: 'attempt_judgement',
    args: [validated.challengeId],
  };
}

export function buildAttemptJudgementPolicyInput(
  preset: 'low' | 'standard' | 'high' = 'standard',
): PolicyInput {
  return { preset, userValue: 0n };
}

// 5. timeout_judgement(challenge_id: u256)
export function buildTimeoutJudgementSubmitInput(
  values: LifecycleChallengeFormValues,
  contractAddress?: Address | null,
): SubmitInput {
  const validated = validateLifecycleChallengeValues(values);
  const resolvedAddress: Address = resolveContractAddress(contractAddress);
  return {
    kind: 'write',
    address: resolvedAddress,
    method: 'timeout_judgement',
    args: [validated.challengeId],
  };
}

export function buildTimeoutJudgementPolicyInput(
  preset: 'low' | 'standard' | 'high' = 'standard',
): PolicyInput {
  return { preset, userValue: 0n };
}

// ─────────────────────────────────────────────────────────────────────────────
// Kit factory — creates a TransactionKit from a live EIP-1193 provider.
//
// WRITE GATE:
//   createKit unconditionally throws WRITE_GATE_DISABLED while WRITES_ENABLED is false.
//
// FEE SUGGESTIONS:
//   Uses the kit's network-wide defaults (suggestions omitted).
//   No unmeasured or invented developer allocations are supplied.
// ─────────────────────────────────────────────────────────────────────────────

function getWindowProvider(): Eip1193Provider | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { ethereum?: Eip1193Provider }).ethereum ?? null;
}

/**
 * createKit — validates all preconditions and returns a TransactionKit.
 *
 * Throws TransactionServiceError for:
 *   WRITE_GATE_DISABLED      — WRITES_ENABLED is false
 *   CONTRACT_ADDRESS_MISSING — VITE_BRIEF_ARENA_CONTRACT_ADDRESS is unset
 *   NO_WALLET                — no EIP-1193 provider in window.ethereum
 *   WRONG_CHAIN              — wallet is on a chain other than 61997
 */
export interface CreateKitOptions {
  provider?: Eip1193Provider;
  account?: `0x${string}`;
}

export async function createKit(
  walletChainId: number | null,
  options?: CreateKitOptions
): Promise<TransactionKit> {
  if (!WRITES_ENABLED) {
    throw new TransactionServiceError(
      'WRITE_GATE_DISABLED',
      'Transaction dispatch is disabled. WRITES_ENABLED must be build-enabled to create a transaction kit or submit on-chain transactions.',
    );
  }

  if (!CONTRACT_ADDRESS) {
    throw new TransactionServiceError(
      'CONTRACT_ADDRESS_MISSING',
      'VITE_BRIEF_ARENA_CONTRACT_ADDRESS is not set. Cannot build a transaction kit without a contract address.',
    );
  }

  const provider = options?.provider || getWindowProvider();
  if (!provider) {
    throw new TransactionServiceError(
      'NO_WALLET',
      'No EIP-1193 wallet provider found (window.ethereum is absent). Install an EVM-compatible wallet.',
    );
  }

  if (walletChainId !== NETWORK_CONFIG.chainId) {
    throw new TransactionServiceError(
      'WRONG_CHAIN',
      `Wallet is on chain ${walletChainId ?? 'unknown'}. Switch to GenLayer Studio Next (Chain ${NETWORK_CONFIG.chainId}).`,
    );
  }

  // Use kit's network defaults (no invented/unmeasured developer allocations)
  return createTransactionKit({
    chain: studioNextChain,
    provider,
    account: options?.account,
  });
}

/**
 * estimateFees — gets a PolicyQuote for a prepared SubmitInput.
 * PolicyInput carries userValue (for payable calls like create_challenge) and
 * optional fee preset. The returned PolicyQuote preserves quote.userValue.
 *
 * WRITE GATE:
 *   Guarded by WRITES_ENABLED. All fee estimation reads the same build gate.
 *
 * Throws TransactionServiceError(FEE_ESTIMATION_FAILED | WRITE_GATE_DISABLED) on error.
 */
export async function estimateFees(
  kit: TransactionKit,
  tx: SubmitInput,
  policyInput: PolicyInput = { preset: 'standard' },
): Promise<PolicyQuote> {
  if (!WRITES_ENABLED) {
    throw new TransactionServiceError(
      'WRITE_GATE_DISABLED',
      'Fee estimation is disabled while the write gate is closed. Set VITE_WRITES_ENABLED=true at build time to enable.',
    );
  }

  try {
    return await kit.estimate(policyInput, tx);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new TransactionServiceError(
      'FEE_ESTIMATION_FAILED',
      `Fee estimation failed: ${msg}`,
      err,
    );
  }
}

/**
 * dispatchTransaction — submits a pre-estimated quote.
 *
 * WRITE GATE:
 *   Guarded by WRITES_ENABLED. Even if a caller creates a mock kit or supplies
 *   their own kit and quote, this function throws WRITE_GATE_DISABLED immediately.
 *   Zero on-chain writes can occur while WRITES_ENABLED is false.
 */
export async function dispatchTransaction(
  kit: TransactionKit,
  quote: PolicyQuote,
  tx: SubmitInput,
): Promise<{ genlayerTxId: `0x${string}`; explorerLink: string }> {
  if (!WRITES_ENABLED) {
    throw new TransactionServiceError(
      'WRITE_GATE_DISABLED',
      'Transaction dispatch is disabled. WRITES_ENABLED must be build-enabled to submit on-chain transactions.',
    );
  }

  try {
    const result = await kit.submit(quote, tx);
    return {
      genlayerTxId: result.genlayerTxId,
      explorerLink: makeTxExplorerLink(result.genlayerTxId),
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new TransactionServiceError(
      'DISPATCH_FAILED',
      `Transaction dispatch failed: ${msg}`,
      err,
    );
  }
}

/**
 * trackTransaction — subscribes to status updates for a submitted tx.
 * Resolves with the final TrackedStatus when the tx reaches the target phase.
 * onUpdate is called for each intermediate status change.
 */
export async function trackTransaction(
  kit: TransactionKit,
  genlayerTxId: `0x${string}`,
  onUpdate: (s: TrackedStatus) => void,
  trackUntil: 'decided' | 'finalized' = 'finalized',
): Promise<TrackedStatus> {
  return kit.track(genlayerTxId, onUpdate, { until: trackUntil });
}
