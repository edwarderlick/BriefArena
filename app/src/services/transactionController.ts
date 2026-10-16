/**
 * transactionController.ts
 *
 * Shared transaction controller for BriefArena frontend write operations.
 * Coordinates all review screens:
 *   - create_challenge
 *   - submit_entry
 *   - cancel_challenge
 *   - withdraw
 *   - close_deadline
 *   - expire_zero_entries
 *   - commit_judging
 *   - attempt_judgement
 *   - timeout_judgement
 *
 * Architecture & Guarantees:
 *   1. Fail-Closed Duplicate Prevention & Persistence:
 *      - Binds records to RPC, chainId (61997), contract address, wallet address,
 *        actionType, contract arguments, and attached value.
 *      - Never releases a duplicate block simply because time elapsed.
 *      - On reload/re-instantiation, reconciles saved transaction ID against chain status
 *        before allowing another submission.
 *      - If lookup fails or outcome is unknown, retains block and surfaces saved ID for manual review.
 *      - reset() will not silently erase an unresolved transaction without proven resolution or force override.
 *      - Submit exceptions after possible broadcast are treated as ambiguous and fail closed.
 *   2. Precondition Validation:
 *      - Wallet connected & account available
 *      - Chain 61997 (Studio Next)
 *      - Contract address configured and valid
 *      - Target challenge record (fixtures without on-chain record rejected)
 *      - Action-specific contract constraints
 *   3. Calldata & Value Preparation:
 *      - Exact contract arguments conforming to contracts/brief_arena.py
 *      - PolicyInput.userValue (prize attached for payable create_challenge, 0n for non-payable)
 *   4. Real Fee Quoting (Zero Invented Fallbacks):
 *      - Only displays fee quote when a genuine PolicyQuote is received from kit.estimate.
 *      - If unavailable, explicitly displays "Fee quote unavailable / not estimated" without invented numbers.
 *      - Shows known attached escrow separately from network fee estimates.
 *   5. Centrally Gated Dispatch:
 *      - Submits strictly through dispatchTransaction(kit, quote, tx)
 *      - Enforces WRITES_ENABLED = false gate unconditionally
 *      - Confirmation controls disabled while WRITES_ENABLED = false
 *      - Re-verifies preconditions and obtains fresh quote prior to on-chain submission
 *   6. Consensus vs Execution Separation:
 *      - Distinguishes consensus phase ('finalized') from execution result ('FINISHED_WITH_RETURN').
 *      - Never claims success from finalized alone.
 *   7. Withdraw Child-Transfer Delivery Tracking:
 *      - Successful parent withdraw does not prove child GEN delivery.
 *      - Confirms delivery only from actual child transaction/receipt execution.
 *      - If child evidence is unavailable, marks "delivery unverified"; never "confirmed".
 *   8. Post-Success Refresh:
 *      - Automatically triggers contract read refresh on confirmed success.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  TransactionKit,
  SubmitInput,
  PolicyInput,
  PolicyQuote,
  TrackedStatus,
} from '@genlayer/transaction-kit';
import {
  WRITES_ENABLED,
  TransactionServiceError,
  resolveContractAddress,
  estimateFees,
  dispatchTransaction,
  trackTransaction,
  isExecutionSuccessful,
  isExecutionProvenFailed,
  isExecutionInconclusive,
  makeTxExplorerLink,
  validateCreateChallengeValues,
  buildCreateChallengeSubmitInput,
  buildCreateChallengePolicyInput,
  validateSubmitEntryValues,
  buildSubmitEntrySubmitInput,
  validateCancelChallengeValues,
  buildCancelChallengeSubmitInput,
  buildCancelChallengePolicyInput,
  buildWithdrawSubmitInput,
  buildWithdrawPolicyInput,
  validateLifecycleChallengeValues,
  buildCloseDeadlineSubmitInput,
  buildCloseDeadlinePolicyInput,
  buildExpireZeroEntriesSubmitInput,
  buildExpireZeroEntriesPolicyInput,
  buildCommitJudgingSubmitInput,
  buildCommitJudgingPolicyInput,
  buildAttemptJudgementSubmitInput,
  buildAttemptJudgementPolicyInput,
  buildTimeoutJudgementSubmitInput,
  buildTimeoutJudgementPolicyInput,
  createKit,
  classifyWalletDispatchError,
  isProvenPreBroadcastWalletFailure,
  type CreateChallengeFormValues,
  type SubmitEntryFormValues,
  type CancelChallengeFormValues,
  type LifecycleChallengeFormValues,
  type WalletErrorClassification,
} from './transactionService';
import type { Address } from './contractClient';
import {
  CONTRACT_ADDRESS,
  readOnlyClient,
  getContractCredit,
  getContractWithdrawn,
  toCalldataAddress,
} from './contractClient';

export { isProvenPreBroadcastWalletFailure, type WalletErrorClassification };
import { useWallet } from '../context/WalletContext';
import { Challenge, NETWORK_CONFIG } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Action Types
// ─────────────────────────────────────────────────────────────────────────────
export type TransactionActionType =
  | 'challenge_creation'
  | 'entry_submission'
  | 'cancel_challenge'
  | 'withdraw'
  | 'close_deadline'
  | 'expire_zero_entries'
  | 'commit_judging'
  | 'attempt_judgement'
  | 'timeout_judgement';

export type ChildTransferStatus = 'idle' | 'pending' | 'confirmed' | 'failed' | 'unverified';

export interface ObservedChildTransferFields {
  childTxId?: `0x${string}` | null;
  from?: string | null;
  recipient?: string | null;
  amountWei?: string | null;
  isEthSend?: boolean | null;
  valueCredited?: boolean | null;
  statusName?: string | null;
  executionResultName?: string | null;
}

export interface ActionWalletState {
  isConnected: boolean;
  address: string | null;
  chainId: number | null;
  isCorrectNetwork?: boolean;
}

export interface ActionPreconditionParams {
  actionType: TransactionActionType;
  walletState: ActionWalletState;
  contractAddress?: Address | null;
  currentChallenge?: Challenge | null;
  claimableCreditWei?: bigint | null;
  createChallengeValues?: CreateChallengeFormValues;
  submitEntryValues?: SubmitEntryFormValues;
  cancelChallengeValues?: CancelChallengeFormValues;
  lifecycleValues?: LifecycleChallengeFormValues;
  unsuitableReason?: string;
  rpcUrl?: string;
}

export interface PreconditionValidationResult {
  isValid: boolean;
  error?: TransactionServiceError;
  submitInput?: SubmitInput;
  policyInput?: PolicyInput;
  nativeValueGen?: string;
  nativeValueWei?: bigint;
}

function safeArgsEqual(a: unknown, b: unknown): boolean {
  try {
    const replacer = (_key: string, value: any) =>
      typeof value === 'bigint' ? value.toString() : value;
    return JSON.stringify(a, replacer) === JSON.stringify(b, replacer);
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Bound Persisted Transaction Record
// ─────────────────────────────────────────────────────────────────────────────
export interface PersistedTxRecord {
  txId?: `0x${string}` | null;
  actionKey: string;
  rpcUrl: string;
  chainId: number;
  contractAddress: string;
  walletAddress: string;
  actionType: TransactionActionType;
  args: any[];
  userValueWei: string;
  claimableCreditWei?: string | null;
  submittedAt: number;
  status: 'submitted' | 'pending' | 'processing' | 'decided' | 'finalized' | 'success' | 'failed' | 'ambiguous';
  executionResultName?: string;
  childTransferStatus?: ChildTransferStatus;
  childTxId?: `0x${string}` | null;
  observedChildFields?: ObservedChildTransferFields | null;
  explorerLink?: string | null;
  error?: string;
  errorMessage?: string;
}

export interface ReconciliationEvidence {
  walletActivityChecked?: boolean;
  noPendingTxInWallet?: boolean;
  explorerChecked?: boolean;
  userNotes?: string;
  currentLiveCreditWei?: bigint;
  currentLiveWithdrawnWei?: bigint;
}

export interface ReconciliationOutcome {
  actionKey: string;
  actionType: TransactionActionType;
  resolved: boolean;
  outcome:
    | 'confirmed_success'
    | 'confirmed_failed'
    | 'unchanged_credit_still_blocked'
    | 'reconciled_and_unlocked';
  creditRemainingWei?: bigint | null;
  genWithdrawnWei?: bigint | null;
  message: string;
}

const memoryTxStore = new Map<string, PersistedTxRecord>();

function getStorageSafe(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      return window.sessionStorage;
    }
  } catch {
    // Sandboxed or private browsing fallback to in-memory
  }
  return null;
}

export function persistTransactionRecord(record: PersistedTxRecord): void {
  memoryTxStore.set(record.actionKey, record);
  if (record.txId) {
    memoryTxStore.set(record.txId, record);
  }
  const storage = getStorageSafe();
  if (storage) {
    try {
      storage.setItem(`briefarena_tx_${record.actionKey}`, JSON.stringify(record));
      if (record.txId) {
        storage.setItem(`briefarena_tx_id_${record.txId}`, JSON.stringify(record));
      }
    } catch {
      // quota or access restriction ignored
    }
  }
}

export function getPersistedTransaction(actionKey: string): PersistedTxRecord | null {
  if (memoryTxStore.has(actionKey)) {
    return memoryTxStore.get(actionKey)!;
  }
  const storage = getStorageSafe();
  if (storage) {
    try {
      const raw = storage.getItem(`briefarena_tx_${actionKey}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        memoryTxStore.set(actionKey, parsed);
        return parsed;
      }
    } catch {
      return null;
    }
  }
  return null;
}

export function clearPersistedTransaction(actionKey: string): void {
  const existing = memoryTxStore.get(actionKey);
  memoryTxStore.delete(actionKey);
  if (existing?.txId) {
    memoryTxStore.delete(existing.txId);
  }
  const storage = getStorageSafe();
  if (storage) {
    try {
      storage.removeItem(`briefarena_tx_${actionKey}`);
      if (existing?.txId) {
        storage.removeItem(`briefarena_tx_id_${existing.txId}`);
      }
    } catch {
      // ignore
    }
  }
}

/**
 * Computes an immutable actionKey binding:
 * RPC URL, chain ID, contract address, wallet address, actionType, contract arguments, and value.
 */
export function computeActionKey(options: {
  rpcUrl?: string;
  chainId?: number;
  contractAddress?: string | null;
  walletAddress?: string | null;
  actionType: TransactionActionType;
  args?: any[];
  userValueWei?: bigint | string;
  challengeId?: string | bigint | null;
}): string {
  const normRpc = (options.rpcUrl || NETWORK_CONFIG.rpcUrl).toLowerCase();
  const normChain = options.chainId || NETWORK_CONFIG.chainId;
  const normContract = (options.contractAddress || CONTRACT_ADDRESS || 'unconfigured').toLowerCase();
  const normWallet = options.walletAddress?.toLowerCase() || 'anonymous';
  const normAction = options.actionType;
  const normValue = options.userValueWei !== undefined ? options.userValueWei.toString() : '0';
  const serializedArgs = options.args
    ? JSON.stringify(options.args, (_k, v) => (typeof v === 'bigint' ? `${v.toString()}n` : v))
    : options.challengeId !== undefined && options.challengeId !== null
    ? String(options.challengeId)
    : 'default';

  return `${normRpc}::${normChain}::${normContract}::${normWallet}::${normAction}::${serializedArgs}::${normValue}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Precondition Validation Logic
// ─────────────────────────────────────────────────────────────────────────────
export function validateActionPreconditions(
  params: ActionPreconditionParams
): PreconditionValidationResult {
  const { actionType, walletState, contractAddress, currentChallenge, unsuitableReason } = params;

  // 1. Unsuitable reason / design fixture check
  if (unsuitableReason) {
    return {
      isValid: false,
      error: new TransactionServiceError(
        'INVALID_INPUT_BOUNDS',
        `Action unavailable: ${unsuitableReason}`
      ),
    };
  }

  // 2. Wallet connection check
  if (!walletState.isConnected || !walletState.address) {
    return {
      isValid: false,
      error: new TransactionServiceError(
        'NO_WALLET',
        'Wallet is not connected. Connect an EVM-compatible wallet on Studio Next to proceed.'
      ),
    };
  }

  // 3. Chain ID 61997 check
  if (walletState.chainId !== NETWORK_CONFIG.chainId) {
    return {
      isValid: false,
      error: new TransactionServiceError(
        'WRONG_CHAIN',
        `Wallet is on chain ${walletState.chainId ?? 'unknown'}. Please switch network to GenLayer Studio Next (Chain ${NETWORK_CONFIG.chainId}).`
      ),
    };
  }

  // 4. Contract Address resolution
  let resolvedAddress: Address;
  try {
    resolvedAddress = resolveContractAddress(contractAddress);
  } catch (err) {
    return {
      isValid: false,
      error:
        err instanceof TransactionServiceError
          ? err
          : new TransactionServiceError(
              'CONTRACT_ADDRESS_MISSING',
              'BriefArena contract address is not configured or is invalid.'
            ),
    };
  }

  // 5. Fixture check on existing challenge
  if (currentChallenge?.isFixture) {
    return {
      isValid: false,
      error: new TransactionServiceError(
        'INVALID_INPUT_BOUNDS',
        'This brief is a design preview fixture without an on-chain record. Chain transactions are only permitted for on-chain records.'
      ),
    };
  }

  // 6. Action-specific validation & calldata builders
  try {
    switch (actionType) {
      case 'challenge_creation': {
        if (!params.createChallengeValues) {
          throw new TransactionServiceError(
            'INVALID_INPUT_BOUNDS',
            'Missing form values for challenge creation.'
          );
        }
        const validated = validateCreateChallengeValues(params.createChallengeValues);
        const submitInput = buildCreateChallengeSubmitInput(
          params.createChallengeValues,
          resolvedAddress
        );
        const policyInput = buildCreateChallengePolicyInput(params.createChallengeValues);
        return {
          isValid: true,
          submitInput,
          policyInput,
          nativeValueGen: String(params.createChallengeValues.prizeAmountGen),
          nativeValueWei: validated.prizeWei,
        };
      }

      case 'entry_submission': {
        if (!params.submitEntryValues) {
          throw new TransactionServiceError(
            'INVALID_INPUT_BOUNDS',
            'Missing entry values for submission.'
          );
        }
        validateSubmitEntryValues(params.submitEntryValues);
        if (currentChallenge) {
          if (currentChallenge.status !== 'open') {
            throw new TransactionServiceError(
              'INVALID_INPUT_BOUNDS',
              `Cannot submit entry: challenge status is "${currentChallenge.status}" (must be open).`
            );
          }
          if (
            walletState.address &&
            currentChallenge.sponsorAddress &&
            walletState.address.toLowerCase() === currentChallenge.sponsorAddress.toLowerCase()
          ) {
            throw new TransactionServiceError(
              'INVALID_INPUT_BOUNDS',
              'Sponsors cannot submit entries to their own briefs.'
            );
          }
          if (currentChallenge.filledSlots >= (currentChallenge.maxSlots || 3)) {
            throw new TransactionServiceError(
              'INVALID_INPUT_BOUNDS',
              'Submission window is full (all 3 participant slots filled).'
            );
          }
        }
        const submitInput = buildSubmitEntrySubmitInput(
          params.submitEntryValues,
          resolvedAddress
        );
        const policyInput: PolicyInput = { preset: 'standard', userValue: 0n };
        return {
          isValid: true,
          submitInput,
          policyInput,
          nativeValueGen: '0',
          nativeValueWei: 0n,
        };
      }

      case 'cancel_challenge': {
        if (!params.cancelChallengeValues) {
          throw new TransactionServiceError(
            'INVALID_INPUT_BOUNDS',
            'Missing challenge ID for cancellation.'
          );
        }
        validateCancelChallengeValues(params.cancelChallengeValues);
        if (currentChallenge) {
          if (currentChallenge.status !== 'open') {
            throw new TransactionServiceError(
              'INVALID_INPUT_BOUNDS',
              `Cannot cancel challenge: status is "${currentChallenge.status}" (must be open).`
            );
          }
          if (currentChallenge.filledSlots > 0) {
            throw new TransactionServiceError(
              'INVALID_INPUT_BOUNDS',
              `Cannot cancel challenge: has ${currentChallenge.filledSlots} active entries (must have 0).`
            );
          }
          if (
            walletState.address &&
            currentChallenge.sponsorAddress &&
            walletState.address.toLowerCase() !== currentChallenge.sponsorAddress.toLowerCase()
          ) {
            throw new TransactionServiceError(
              'INVALID_INPUT_BOUNDS',
              'Only the sponsor who created this brief can cancel it.'
            );
          }
        }
        const submitInput = buildCancelChallengeSubmitInput(
          params.cancelChallengeValues,
          resolvedAddress
        );
        const policyInput = buildCancelChallengePolicyInput();
        return {
          isValid: true,
          submitInput,
          policyInput,
          nativeValueGen: '0',
          nativeValueWei: 0n,
        };
      }

      case 'withdraw': {
        if (
          params.claimableCreditWei !== undefined &&
          params.claimableCreditWei !== null &&
          params.claimableCreditWei <= 0n
        ) {
          throw new TransactionServiceError(
            'INVALID_INPUT_BOUNDS',
            'No claimable credits available to withdraw. Credit balance is 0.'
          );
        }
        const submitInput = buildWithdrawSubmitInput(resolvedAddress);
        const policyInput = buildWithdrawPolicyInput();
        return {
          isValid: true,
          submitInput,
          policyInput,
          nativeValueGen: '0',
          nativeValueWei: 0n,
        };
      }

      case 'close_deadline': {
        if (!params.lifecycleValues) {
          throw new TransactionServiceError('INVALID_INPUT_BOUNDS', 'Missing lifecycle challenge ID.');
        }
        validateLifecycleChallengeValues(params.lifecycleValues);
        if (currentChallenge) {
          if (currentChallenge.status !== 'open') {
            throw new TransactionServiceError(
              'INVALID_INPUT_BOUNDS',
              `Cannot close deadline: status is "${currentChallenge.status}" (must be open).`
            );
          }
          if (currentChallenge.filledSlots === 0) {
            throw new TransactionServiceError(
              'INVALID_INPUT_BOUNDS',
              'Cannot close deadline with 0 entries (use expire_zero_entries instead).'
            );
          }
          if (
            currentChallenge.deadlineTimestamp === undefined ||
            Number.isNaN(currentChallenge.deadlineTimestamp)
          ) {
            throw new TransactionServiceError(
              'INVALID_INPUT_BOUNDS',
              'On-chain deadline timestamp is unset or unverified.'
            );
          }
        }
        const submitInput = buildCloseDeadlineSubmitInput(
          params.lifecycleValues,
          resolvedAddress
        );
        const policyInput = buildCloseDeadlinePolicyInput();
        return {
          isValid: true,
          submitInput,
          policyInput,
          nativeValueGen: '0',
          nativeValueWei: 0n,
        };
      }

      case 'expire_zero_entries': {
        if (!params.lifecycleValues) {
          throw new TransactionServiceError('INVALID_INPUT_BOUNDS', 'Missing lifecycle challenge ID.');
        }
        validateLifecycleChallengeValues(params.lifecycleValues);
        if (currentChallenge) {
          if (currentChallenge.status !== 'open') {
            throw new TransactionServiceError(
              'INVALID_INPUT_BOUNDS',
              `Cannot expire challenge: status is "${currentChallenge.status}" (must be open).`
            );
          }
          if (currentChallenge.filledSlots > 0) {
            throw new TransactionServiceError(
              'INVALID_INPUT_BOUNDS',
              `Cannot expire zero entries: challenge already has ${currentChallenge.filledSlots} entry.`
            );
          }
          if (
            currentChallenge.deadlineTimestamp === undefined ||
            Number.isNaN(currentChallenge.deadlineTimestamp)
          ) {
            throw new TransactionServiceError(
              'INVALID_INPUT_BOUNDS',
              'On-chain deadline timestamp is unset or unverified.'
            );
          }
        }
        const submitInput = buildExpireZeroEntriesSubmitInput(
          params.lifecycleValues,
          resolvedAddress
        );
        const policyInput = buildExpireZeroEntriesPolicyInput();
        return {
          isValid: true,
          submitInput,
          policyInput,
          nativeValueGen: '0',
          nativeValueWei: 0n,
        };
      }

      case 'commit_judging': {
        if (!params.lifecycleValues) {
          throw new TransactionServiceError('INVALID_INPUT_BOUNDS', 'Missing lifecycle challenge ID.');
        }
        validateLifecycleChallengeValues(params.lifecycleValues);
        if (currentChallenge) {
          if (currentChallenge.status !== 'closed') {
            throw new TransactionServiceError(
              'INVALID_INPUT_BOUNDS',
              `Cannot commit judging: status is "${currentChallenge.status}" (must be closed).`
            );
          }
          if (currentChallenge.filledSlots === 0) {
            throw new TransactionServiceError(
              'INVALID_INPUT_BOUNDS',
              'Cannot commit judging with 0 entries.'
            );
          }
          if (
            currentChallenge.judgingStartedAtTimestamp !== undefined &&
            currentChallenge.judgingStartedAtTimestamp > 0
          ) {
            throw new TransactionServiceError(
              'INVALID_INPUT_BOUNDS',
              'Challenge has already been committed to judging on-chain.'
            );
          }
        }
        const submitInput = buildCommitJudgingSubmitInput(
          params.lifecycleValues,
          resolvedAddress
        );
        const policyInput = buildCommitJudgingPolicyInput();
        return {
          isValid: true,
          submitInput,
          policyInput,
          nativeValueGen: '0',
          nativeValueWei: 0n,
        };
      }

      case 'attempt_judgement': {
        if (!params.lifecycleValues) {
          throw new TransactionServiceError('INVALID_INPUT_BOUNDS', 'Missing lifecycle challenge ID.');
        }
        validateLifecycleChallengeValues(params.lifecycleValues);
        if (currentChallenge && currentChallenge.status !== 'judging') {
          throw new TransactionServiceError(
            'INVALID_INPUT_BOUNDS',
            `Cannot attempt judgement: challenge status is "${currentChallenge.status}" (must be judging).`
          );
        }
        const submitInput = buildAttemptJudgementSubmitInput(
          params.lifecycleValues,
          resolvedAddress
        );
        const policyInput = buildAttemptJudgementPolicyInput();
        return {
          isValid: true,
          submitInput,
          policyInput,
          nativeValueGen: '0',
          nativeValueWei: 0n,
        };
      }

      case 'timeout_judgement': {
        if (!params.lifecycleValues) {
          throw new TransactionServiceError('INVALID_INPUT_BOUNDS', 'Missing lifecycle challenge ID.');
        }
        validateLifecycleChallengeValues(params.lifecycleValues);
        if (currentChallenge) {
          if (currentChallenge.status !== 'judging') {
            throw new TransactionServiceError(
              'INVALID_INPUT_BOUNDS',
              `Cannot timeout judgement: status is "${currentChallenge.status}" (must be judging).`
            );
          }
          if (
            currentChallenge.judgingStartedAtTimestamp === undefined ||
            currentChallenge.judgingStartedAtTimestamp <= 0
          ) {
            throw new TransactionServiceError(
              'INVALID_INPUT_BOUNDS',
              'Judging start timestamp is unset. Cannot infer a 48-hour judging timeout from an unset timestamp.'
            );
          }
        }
        const submitInput = buildTimeoutJudgementSubmitInput(
          params.lifecycleValues,
          resolvedAddress
        );
        const policyInput = buildTimeoutJudgementPolicyInput();
        return {
          isValid: true,
          submitInput,
          policyInput,
          nativeValueGen: '0',
          nativeValueWei: 0n,
        };
      }

      default:
        return {
          isValid: false,
          error: new TransactionServiceError(
            'INVALID_INPUT_BOUNDS',
            `Unknown transaction action: "${actionType}".`
          ),
        };
    }
  } catch (err) {
    return {
      isValid: false,
      error:
        err instanceof TransactionServiceError
          ? err
          : new TransactionServiceError(
              'INVALID_INPUT_BOUNDS',
              `Validation failed: ${(err as Error)?.message || String(err)}`
            ),
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared Transaction Controller Class
// ─────────────────────────────────────────────────────────────────────────────
export interface TransactionControllerState {
  phase:
    | 'idle'
    | 'validating'
    | 'estimating'
    | 'ready_to_confirm'
    | 'submitting'
    | 'tracking'
    | 'success'
    | 'execution_failed'
    | 'unknown'
    | 'error';
  validationError: TransactionServiceError | null;
  submitInput: SubmitInput | null;
  policyInput: PolicyInput | null;
  quotedSubmitInput?: SubmitInput | null;
  quotedPolicyInput?: PolicyInput | null;
  quotedWalletAddress?: string | null;
  quote: PolicyQuote | null;
  quoteError: string | null;
  txId: `0x${string}` | null;
  explorerLink: string | null;
  trackedStatus: TrackedStatus | null;
  childTransferStatus: ChildTransferStatus;
  childTxId: `0x${string}` | null;
  observedChildFields?: ObservedChildTransferFields | null;
  isDuplicateBlocked: boolean;
  isRefreshed: boolean;
  canConfirm: boolean;
  writesEnabled: boolean;
  unresolvedMessage?: string | null;
  errorMessage?: string | null;
}

/**
 * Strict boolean parser.
 * Strings such as "false" or "true", numbers, and null/undefined must NEVER count as true.
 * Only boolean primitive true returns true.
 */
export function parseStrictBoolean(val: unknown): boolean {
  return val === true;
}

export class TransactionController {
  private params: ActionPreconditionParams;
  private state: TransactionControllerState;
  private actionKey: string;
  private listeners: Set<(s: TransactionControllerState) => void> = new Set();
  private onSuccessRefresh?: () => Promise<void> | void;

  constructor(
    params: ActionPreconditionParams,
    onSuccessRefresh?: () => Promise<void> | void
  ) {
    this.params = params;
    this.onSuccessRefresh = onSuccessRefresh;
    this.actionKey = this.deriveActionKey(params);

    this.state = {
      phase: 'idle',
      validationError: null,
      submitInput: null,
      policyInput: null,
      quotedSubmitInput: null,
      quotedPolicyInput: null,
      quotedWalletAddress: null,
      quote: null,
      quoteError: null,
      txId: null,
      explorerLink: null,
      trackedStatus: null,
      childTransferStatus: 'idle',
      childTxId: null,
      observedChildFields: null,
      isDuplicateBlocked: false,
      isRefreshed: false,
      canConfirm: false,
      writesEnabled: WRITES_ENABLED,
      unresolvedMessage: null,
      errorMessage: null,
    };

    // Check existing persisted transaction and fail closed
    const existing = getPersistedTransaction(this.actionKey);
    if (existing) {
      if (existing.status !== 'success' && existing.status !== 'failed') {
        // Retain the duplicate block unconditionally until on-chain status is resolved!
        this.state = {
          ...this.state,
          phase: existing.status === 'ambiguous' ? 'unknown' : 'tracking',
          txId: existing.txId || null,
          explorerLink: existing.explorerLink || null,
          isDuplicateBlocked: true,
          childTransferStatus: existing.childTransferStatus || 'idle',
          childTxId: existing.childTxId || null,
          observedChildFields: existing.observedChildFields || null,
          unresolvedMessage: existing.txId
            ? `Unresolved transaction detected on-chain (${existing.txId}). Resubmission is blocked to protect your funds. Check status on explorer.`
            : 'Ambiguous transaction detected for this action with no returned transaction ID. Resubmission is blocked to protect against duplicate execution. Manual reconciliation required.',
        };
      } else if (existing.status === 'success') {
        this.state = {
          ...this.state,
          txId: existing.txId || null,
          explorerLink: existing.explorerLink || null,
          childTransferStatus: existing.childTransferStatus || 'idle',
          childTxId: existing.childTxId || null,
          observedChildFields: existing.observedChildFields || null,
        };
      }
    }
  }

  private deriveActionKey(params: ActionPreconditionParams): string {
    const challengeId =
      params.lifecycleValues?.challengeId ??
      params.cancelChallengeValues?.challengeId ??
      params.submitEntryValues?.challengeId ??
      params.currentChallenge?.id;

    let userValueWei: bigint | string = '0';
    if (params.actionType === 'challenge_creation' && params.createChallengeValues) {
      try {
        const validated = validateCreateChallengeValues(params.createChallengeValues);
        userValueWei = validated.prizeWei;
      } catch {
        userValueWei = '0';
      }
    }

    const args = params.createChallengeValues
      ? [
          params.createChallengeValues.title,
          params.createChallengeValues.category,
          params.createChallengeValues.synopsis,
          params.createChallengeValues.mandatoryRequirements,
          params.createChallengeValues.prohibitedTerms,
          params.createChallengeValues.durationHours,
        ]
      : params.submitEntryValues
      ? [
          params.submitEntryValues.challengeId,
          params.submitEntryValues.tagline,
          params.submitEntryValues.paragraph,
        ]
      : params.cancelChallengeValues
      ? [params.cancelChallengeValues.challengeId]
      : params.lifecycleValues
      ? [params.lifecycleValues.challengeId]
      : [];

    return computeActionKey({
      rpcUrl: params.rpcUrl || NETWORK_CONFIG.rpcUrl,
      chainId: params.walletState.chainId || NETWORK_CONFIG.chainId,
      contractAddress: params.contractAddress,
      walletAddress: params.walletState.address,
      actionType: params.actionType,
      args,
      userValueWei,
      challengeId,
    });
  }

  public getActionKey(): string {
    return this.actionKey;
  }

  public getState(): TransactionControllerState {
    return { ...this.state };
  }

  public subscribe(listener: (s: TransactionControllerState) => void): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    const s = this.getState();
    for (const l of this.listeners) {
      l(s);
    }
  }

  public updateParams(newParams: ActionPreconditionParams): void {
    const oldActionKey = this.actionKey;
    this.params = newParams;
    this.actionKey = this.deriveActionKey(newParams);

    if (this.actionKey !== oldActionKey) {
      // Clear stale quote and confirmation state when the action identity changes
      this.state.quote = null;
      this.state.quoteError = null;
      this.state.canConfirm = false;

      // Look up any saved unresolved record for the newly derived key and restore its duplicate block, transaction ID, and status
      const existing = getPersistedTransaction(this.actionKey);
      if (existing && existing.status !== 'success' && existing.status !== 'failed') {
        this.state.phase = existing.status === 'ambiguous' ? 'unknown' : 'tracking';
        this.state.txId = existing.txId || null;
        this.state.explorerLink = existing.explorerLink || (existing.txId ? makeTxExplorerLink(existing.txId) : null);
        this.state.isDuplicateBlocked = true;
        this.state.childTransferStatus = existing.childTransferStatus || 'idle';
        this.state.childTxId = existing.childTxId || null;
        this.state.observedChildFields = existing.observedChildFields || null;
        this.state.unresolvedMessage = existing.txId
          ? `Unresolved transaction detected on-chain (${existing.txId}). Resubmission is blocked to protect your funds. Check status on explorer.`
          : 'Ambiguous transaction detected for this action with no returned transaction ID. Resubmission is blocked to protect against duplicate execution. Manual reconciliation required.';
      } else if (existing && existing.status === 'success') {
        this.state.txId = existing.txId || null;
        this.state.explorerLink = existing.explorerLink || (existing.txId ? makeTxExplorerLink(existing.txId) : null);
        this.state.isDuplicateBlocked = false;
        this.state.childTransferStatus = existing.childTransferStatus || 'idle';
        this.state.childTxId = existing.childTxId || null;
        this.state.observedChildFields = existing.observedChildFields || null;
      } else {
        // If there is no unresolved record for the newly derived key, release any prior lock
        if (this.state.isDuplicateBlocked || this.state.txId) {
          this.state.isDuplicateBlocked = false;
          this.state.txId = null;
          this.state.explorerLink = null;
          this.state.unresolvedMessage = null;
          this.state.phase = 'idle';
          this.state.childTransferStatus = 'idle';
          this.state.childTxId = null;
          this.state.observedChildFields = null;
        }
      }

      this.notify();
    }
  }

  public validate(): PreconditionValidationResult {
    this.state.phase = 'validating';
    const result = validateActionPreconditions(this.params);
    if (!result.isValid) {
      this.state.phase = 'error';
      this.state.validationError = result.error || null;
      this.state.canConfirm = false;
    } else {
      this.state.validationError = null;
      this.state.submitInput = result.submitInput || null;
      this.state.policyInput = result.policyInput || null;
      this.state.phase = 'idle';
    }
    this.notify();
    return result;
  }

  /**
   * Reconciles a saved unresolved transaction against chain status before allowing retry.
   * If lookup fails or outcome is unknown, retains the duplicate block.
   * Defaults to readOnlyClient when clientOrKit is not provided.
   */
  public async reconcile(
    clientOrKit?: any,
    evidence?: ReconciliationEvidence
  ): Promise<PersistedTxRecord | null> {
    const existing = getPersistedTransaction(this.actionKey);
    if (!existing) {
      return null;
    }

    if (existing.status === 'failed') {
      this.state.phase = 'execution_failed';
      this.state.txId = existing.txId || null;
      this.state.explorerLink = existing.explorerLink || (existing.txId ? makeTxExplorerLink(existing.txId) : null);
      this.state.isDuplicateBlocked = false;
      this.state.unresolvedMessage = null;
      this.state.errorMessage = existing.errorMessage || `Transaction execution failed on-chain (${existing.executionResultName || 'FINALIZED_FAILED'}).`;
      this.notify();
      return existing;
    }

    if (existing.status === 'success') {
      this.state.phase = 'success';
      this.state.txId = existing.txId || null;
      this.state.explorerLink = existing.explorerLink || (existing.txId ? makeTxExplorerLink(existing.txId) : null);
      this.state.isDuplicateBlocked = false;
      this.state.unresolvedMessage = null;

      if (existing.actionType === 'withdraw' && existing.childTransferStatus !== 'confirmed' && existing.txId) {
        const client = clientOrKit || readOnlyClient;
        if (client) {
          try {
            let remoteTx: any = null;
            if (typeof client.getTransaction === 'function') {
              remoteTx = await client.getTransaction({ hash: existing.txId });
            } else if (typeof client.track === 'function') {
              remoteTx = await client.track(existing.txId, () => {}, { until: 'finalized' });
            } else if (client?.client && typeof client.client.getTransaction === 'function') {
              remoteTx = await client.client.getTransaction({ hash: existing.txId });
            }
            if (remoteTx) {
              await this.verifyWithdrawChildTransfer(remoteTx, client, existing.txId);
              existing.childTransferStatus = this.state.childTransferStatus;
              existing.childTxId = this.state.childTxId || undefined;
              existing.observedChildFields = this.state.observedChildFields || undefined;
              persistTransactionRecord(existing);
            }
          } catch {
            // retain existing child transfer status
          }
        }
      } else {
        this.state.childTransferStatus = existing.childTransferStatus || 'idle';
        this.state.childTxId = existing.childTxId || null;
        this.state.observedChildFields = existing.observedChildFields || null;
      }

      this.notify();
      return existing;
    }

    if (!existing.txId) {
      if (existing.actionType === 'withdraw') {
        let liveCreditWei: bigint | null = null;
        let liveWithdrawnWei: bigint | null = null;
        const resolvedAddr = this.params.contractAddress || CONTRACT_ADDRESS;
        const resolvedWallet = this.params.walletState.address || existing.walletAddress;

        if (resolvedAddr && resolvedWallet) {
          try {
            [liveCreditWei, liveWithdrawnWei] = await Promise.all([
              getContractCredit(resolvedAddr as Address, resolvedWallet),
              getContractWithdrawn(resolvedAddr as Address, resolvedWallet),
            ]);
          } catch (readErr) {
            console.warn('Failed reading live contract credit during reconciliation:', readErr);
          }
        }
        void liveWithdrawnWei;

        const savedCredit = existing.claimableCreditWei ? BigInt(existing.claimableCreditWei) : null;

        // 1. Confirmed success: credit decreased on-chain
        if (liveCreditWei !== null && savedCredit !== null && savedCredit > 0n && liveCreditWei < savedCredit) {
          existing.status = 'success';
          existing.executionResultName = 'FINISHED_WITH_RETURN';
          this.state.phase = 'success';
          this.state.isDuplicateBlocked = false;
          this.state.unresolvedMessage = null;
          persistTransactionRecord(existing);
          await this.triggerStateRefresh();
          this.notify();
          return existing;
        }

        // 2. Unchanged credit:
        // An unchanged credit balance alone must NOT silently unlock a possibly pending transaction.
        if (evidence?.noPendingTxInWallet === true && evidence?.walletActivityChecked === true) {
          clearPersistedTransaction(this.actionKey);
          this.state.isDuplicateBlocked = false;
          this.state.phase = 'idle';
          this.state.unresolvedMessage = null;
          this.state.errorMessage = null;
          this.notify();
          return null;
        }

        this.state.isDuplicateBlocked = true;
        this.state.phase = 'unknown';
        this.state.txId = null;
        this.state.explorerLink = null;
        this.state.unresolvedMessage =
          'Ambiguous submission with no returned transaction ID. Cannot query chain status automatically. Retaining duplicate submission block; manual reconciliation required.';
        this.notify();
        return existing;
      }

      // Generic actions without txId
      if (evidence?.noPendingTxInWallet === true && evidence?.walletActivityChecked === true) {
        clearPersistedTransaction(this.actionKey);
        this.state.isDuplicateBlocked = false;
        this.state.phase = 'idle';
        this.state.unresolvedMessage = null;
        this.state.errorMessage = null;
        this.notify();
        return null;
      }

      // Ambiguous submission without a transaction ID: cannot query chain automatically
      this.state.isDuplicateBlocked = true;
      this.state.phase = 'unknown';
      this.state.txId = null;
      this.state.explorerLink = null;
      this.state.unresolvedMessage =
        'Ambiguous submission with no returned transaction ID. Cannot query chain status automatically. Retaining duplicate submission block; manual reconciliation required.';
      this.notify();
      return existing;
    }

    const client = clientOrKit || readOnlyClient;
    if (!client) {
      // No client available to reconcile against; fail closed
      this.state.isDuplicateBlocked = true;
      this.state.phase = 'unknown';
      this.state.unresolvedMessage = `No client available to reconcile transaction ${existing.txId}. Retaining submission lock.`;
      this.notify();
      return existing;
    }

    try {
      let remoteTx: any = null;
      if (typeof client.getTransaction === 'function') {
        remoteTx = await client.getTransaction({ hash: existing.txId });
      } else if (typeof client.track === 'function') {
        remoteTx = await client.track(existing.txId, () => {}, { until: 'finalized' });
      } else if (client?.client && typeof client.client.getTransaction === 'function') {
        remoteTx = await client.client.getTransaction({ hash: existing.txId });
      }

      if (remoteTx) {
        const execResult =
          remoteTx.executionResultName ||
          remoteTx.txExecutionResultName ||
          (remoteTx.receipt && (remoteTx.receipt.executionResultName || remoteTx.receipt.execution_result)) ||
          remoteTx.consensus_data?.validators?.[0]?.execution_result ||
          remoteTx.consensus_data?.leader_receipt?.[0]?.execution_result;

        const isSuccess =
          (execResult === 'FINISHED_WITH_RETURN' || execResult === 'SUCCESS') &&
          (remoteTx.successful === true || remoteTx.statusName === 'FINALIZED' || remoteTx.status === 'FINALIZED');

        const isFailed =
          execResult === 'FINISHED_WITH_ERROR' ||
          execResult === 'ERROR' ||
          remoteTx.successful === false ||
          remoteTx.statusName === 'CANCELED' ||
          remoteTx.status === 'FAILED' ||
          (remoteTx.statusName === 'FINALIZED' && (execResult === 'ERROR' || execResult === 'FINISHED_WITH_ERROR'));

        if (isSuccess) {
          existing.status = 'success';
          existing.executionResultName = 'FINISHED_WITH_RETURN';
          this.state.phase = 'success';
          this.state.isDuplicateBlocked = false;
          this.state.unresolvedMessage = null;
          if (existing.actionType === 'withdraw') {
            await this.verifyWithdrawChildTransfer(remoteTx, client, existing.txId);
            existing.childTransferStatus = this.state.childTransferStatus;
            existing.childTxId = this.state.childTxId || undefined;
            existing.observedChildFields = this.state.observedChildFields || undefined;
          }
          persistTransactionRecord(existing);
          this.notify();
          return existing;
        } else if (isFailed) {
          existing.status = 'failed';
          existing.executionResultName = execResult || 'FINISHED_WITH_ERROR';
          this.state.phase = 'execution_failed';
          this.state.isDuplicateBlocked = false;
          this.state.unresolvedMessage = null;
          this.state.errorMessage = `Transaction execution failed on-chain (${existing.executionResultName}).`;
          persistTransactionRecord(existing);
          this.notify();
          return existing;
        }
      }
    } catch (err) {
      // Lookup failed (e.g. node error or timeout). Fail closed!
      console.warn(`Failed reconciling transaction ${existing.txId}:`, err);
    }

    // Retain block if reconciliation did not prove terminal outcome
    this.state.isDuplicateBlocked = true;
    this.state.phase = 'unknown';
    this.state.unresolvedMessage = `Transaction ${existing.txId} is still unresolved on-chain (or status check failed). Retaining submission lock.`;
    this.notify();
    return existing;
  }

  /**
   * Explicit user-facing reconciliation flow for genuinely ambiguous cases.
   * Leverages:
   *   1. Wallet activity (user asserts whether transaction was broadcast or pending).
   *   2. Explorer evidence.
   *   3. Fresh contract reads (checks get_credit and get_withdrawn).
   *
   * Crucial Safety Invariant:
   *   An unchanged credit balance alone must NOT silently unlock a possibly pending transaction.
   *   Unlocking requires explicit confirmation that wallet activity has no pending transaction.
   */
  public async reconcileAmbiguous(
    evidence?: ReconciliationEvidence,
    clientOrKit?: any
  ): Promise<ReconciliationOutcome> {
    const existing = getPersistedTransaction(this.actionKey);
    if (!existing) {
      this.state.isDuplicateBlocked = false;
      this.state.phase = 'idle';
      this.state.unresolvedMessage = null;
      this.notify();
      return {
        actionKey: this.actionKey,
        actionType: this.params.actionType,
        resolved: true,
        outcome: 'reconciled_and_unlocked',
        message: 'No active unresolved transaction found for this action.',
      };
    }

    if (this.params.actionType === 'withdraw' || existing.actionType === 'withdraw') {
      let liveCreditWei: bigint | null =
        evidence?.currentLiveCreditWei !== undefined ? evidence.currentLiveCreditWei : null;
      let liveWithdrawnWei: bigint | null =
        evidence?.currentLiveWithdrawnWei !== undefined ? evidence.currentLiveWithdrawnWei : null;
      const resolvedAddr = this.params.contractAddress || CONTRACT_ADDRESS;
      const resolvedWallet = this.params.walletState.address || existing.walletAddress;

      if (liveCreditWei === null && resolvedAddr && resolvedWallet) {
        if (clientOrKit && typeof clientOrKit.readContract === 'function') {
          try {
            const [c, w] = await Promise.all([
              clientOrKit.readContract({
                address: resolvedAddr,
                functionName: 'get_credit',
                args: [toCalldataAddress(resolvedWallet)],
              }),
              clientOrKit.readContract({
                address: resolvedAddr,
                functionName: 'get_withdrawn',
                args: [toCalldataAddress(resolvedWallet)],
              }),
            ]);
            liveCreditWei = BigInt(c || 0);
            liveWithdrawnWei = BigInt(w || 0);
          } catch (readErr) {
            console.warn('Custom client readContract error in reconcileAmbiguous:', readErr);
          }
        } else {
          try {
            [liveCreditWei, liveWithdrawnWei] = await Promise.all([
              getContractCredit(resolvedAddr as Address, resolvedWallet),
              getContractWithdrawn(resolvedAddr as Address, resolvedWallet),
            ]);
          } catch (readErr) {
            console.warn('Failed reading live contract credit during reconciliation:', readErr);
          }
        }
      }

      const savedCredit = existing.claimableCreditWei ? BigInt(existing.claimableCreditWei) : null;

      // 1. Confirmed success: credit decreased on-chain
      if (liveCreditWei !== null && savedCredit !== null && savedCredit > 0n && liveCreditWei < savedCredit) {
        existing.status = 'success';
        existing.executionResultName = 'FINISHED_WITH_RETURN';
        this.state.phase = 'success';
        this.state.isDuplicateBlocked = false;
        this.state.unresolvedMessage = null;
        persistTransactionRecord(existing);
        await this.triggerStateRefresh();
        this.notify();
        return {
          actionKey: this.actionKey,
          actionType: 'withdraw',
          resolved: true,
          outcome: 'confirmed_success',
          creditRemainingWei: liveCreditWei,
          genWithdrawnWei: liveWithdrawnWei,
          message: 'Confirmed on-chain: internal credit was deducted. Withdrawal succeeded.',
        };
      }

      // 2. Unchanged credit:
      // An unchanged credit balance alone must NOT silently unlock a possibly pending transaction.
      if (!evidence?.walletActivityChecked || !evidence?.noPendingTxInWallet) {
        this.state.isDuplicateBlocked = true;
        this.state.phase = 'unknown';
        const amtStr = liveCreditWei !== null ? `${(Number(liveCreditWei) / 1e18).toFixed(2)} test GEN` : 'unknown';
        this.state.unresolvedMessage = `Live contract credit is unchanged (${amtStr} remaining). An unchanged credit balance alone does not prove a broadcasted transaction will not execute. Confirm in wallet activity that no transaction is pending.`;
        this.notify();
        return {
          actionKey: this.actionKey,
          actionType: 'withdraw',
          resolved: false,
          outcome: 'unchanged_credit_still_blocked',
          creditRemainingWei: liveCreditWei,
          genWithdrawnWei: liveWithdrawnWei,
          message: this.state.unresolvedMessage,
        };
      }

      // 3. User explicitly confirmed wallet activity has no pending transaction AND live credit verified intact:
      // Release ONLY that action's lock!
      clearPersistedTransaction(this.actionKey);
      this.state.isDuplicateBlocked = false;
      this.state.phase = 'idle';
      this.state.unresolvedMessage = null;
      this.state.errorMessage = null;
      this.notify();
      return {
        actionKey: this.actionKey,
        actionType: 'withdraw',
        resolved: true,
        outcome: 'reconciled_and_unlocked',
        creditRemainingWei: liveCreditWei,
        genWithdrawnWei: liveWithdrawnWei,
        message: 'Reconciliation complete: verified wallet activity has no pending transaction and credit is intact. Action lock released for retry.',
      };
    }

    // Generic actions:
    if (evidence?.walletActivityChecked && evidence?.noPendingTxInWallet) {
      clearPersistedTransaction(this.actionKey);
      this.state.isDuplicateBlocked = false;
      this.state.phase = 'idle';
      this.state.unresolvedMessage = null;
      this.state.errorMessage = null;
      this.notify();
      return {
        actionKey: this.actionKey,
        actionType: this.params.actionType,
        resolved: true,
        outcome: 'reconciled_and_unlocked',
        message: 'Reconciliation complete: verified wallet activity. Action lock released.',
      };
    }

    this.state.isDuplicateBlocked = true;
    this.notify();
    return {
      actionKey: this.actionKey,
      actionType: this.params.actionType,
      resolved: false,
      outcome: 'unchanged_credit_still_blocked',
      message: 'Unresolved transaction retained. Confirm wallet activity has no pending transaction to release lock.',
    };
  }


  public async estimateFee(kit: TransactionKit): Promise<PolicyQuote> {
    const validation = this.validate();
    if (!validation.isValid || !validation.submitInput || !validation.policyInput) {
      const err = validation.error || new TransactionServiceError('INVALID_INPUT_BOUNDS', 'Preconditions failed');
      this.state.phase = 'error';
      this.state.quoteError = err.message;
      this.notify();
      throw err;
    }

    this.state.phase = 'estimating';
    this.state.quoteError = null;
    this.notify();

    try {
      const quote = await estimateFees(kit, validation.submitInput, validation.policyInput);
      this.state.quote = quote;
      this.state.quotedSubmitInput = validation.submitInput;
      this.state.quotedPolicyInput = validation.policyInput;
      this.state.quotedWalletAddress = this.params.walletState.address ?? null;
      this.state.phase = 'ready_to_confirm';
      this.state.canConfirm = WRITES_ENABLED;
      this.notify();
      return quote;
    } catch (err) {
      const msg = (err as Error)?.message || 'Fee estimation failed';
      this.state.phase = 'error';
      this.state.quoteError = msg;
      this.state.canConfirm = false;
      this.notify();
      throw err instanceof TransactionServiceError
        ? err
        : new TransactionServiceError('FEE_ESTIMATION_FAILED', msg, err);
    }
  }

  /**
   * Submits transaction through centrally gated dispatch.
   * If WRITES_ENABLED is false, unconditionally rejects with WRITE_GATE_DISABLED.
   * When enabled, re-validates preconditions and obtains fresh fee quote before dispatch.
   */
  public async submit(kit: TransactionKit): Promise<{ txId: `0x${string}`; explorerLink: string }> {
    // 1. Guard against duplicate submission while in flight / unresolved
    if (this.state.isDuplicateBlocked) {
      throw new TransactionServiceError(
        'DISPATCH_FAILED',
        `A transaction for action "${this.params.actionType}" is already in flight (${this.state.txId ?? 'unresolved'}). Wait for confirmation or reconciliation before retrying.`
      );
    }

    // 2. Pre-submission Rechecks: current wallet connection & chain
    if (!this.params.walletState.isConnected || !this.params.walletState.address) {
      throw new TransactionServiceError(
        'NO_WALLET',
        'Wallet is not connected. Connect an EVM-compatible wallet on Studio Next to proceed.'
      );
    }

    if (this.params.walletState.chainId !== NETWORK_CONFIG.chainId) {
      throw new TransactionServiceError(
        'WRONG_CHAIN',
        `Wallet is on chain ${this.params.walletState.chainId ?? 'unknown'}. Please switch network to GenLayer Studio Next (Chain ${NETWORK_CONFIG.chainId}).`
      );
    }

    const resolvedContract = this.params.contractAddress || CONTRACT_ADDRESS;
    if (!resolvedContract) {
      throw new TransactionServiceError(
        'CONTRACT_ADDRESS_MISSING',
        'VITE_BRIEF_ARENA_CONTRACT_ADDRESS is not set. Cannot dispatch transaction without a contract address.'
      );
    }

    // 3. Re-validate parameters and live contract preconditions
    const freshValidation = this.validate();
    if (!freshValidation.isValid || !freshValidation.submitInput || !freshValidation.policyInput) {
      throw freshValidation.error || new TransactionServiceError('INVALID_INPUT_BOUNDS', 'Precondition re-validation failed.');
    }

    // Ensure the quoted action, arguments, userValue, wallet, and contract still match what user confirms
    if (this.state.quote || this.state.quotedSubmitInput || this.state.quotedWalletAddress) {
      if (
        this.state.quotedWalletAddress &&
        this.params.walletState.address &&
        this.state.quotedWalletAddress.toLowerCase() !== this.params.walletState.address.toLowerCase()
      ) {
        throw new TransactionServiceError(
          'INVALID_INPUT_BOUNDS',
          'Connected wallet address changed after fee quote was generated. Please re-estimate.'
        );
      }

      if (this.state.quotedSubmitInput) {
        if (this.state.quotedSubmitInput.kind !== freshValidation.submitInput.kind) {
          throw new TransactionServiceError('INVALID_INPUT_BOUNDS', 'Transaction kind mismatch between fee quote and submission confirmation.');
        }
        if (
          this.state.quotedSubmitInput.kind === 'write' &&
          freshValidation.submitInput.kind === 'write'
        ) {
          if (this.state.quotedSubmitInput.method !== freshValidation.submitInput.method) {
            throw new TransactionServiceError('INVALID_INPUT_BOUNDS', 'Contract method mismatch between fee quote and confirmation.');
          }
          if (
            !safeArgsEqual(this.state.quotedSubmitInput.args, freshValidation.submitInput.args)
          ) {
            throw new TransactionServiceError('INVALID_INPUT_BOUNDS', 'Transaction arguments changed after fee quote was generated. Please re-estimate.');
          }
          if (
            this.state.quotedSubmitInput.address.toLowerCase() !==
            freshValidation.submitInput.address.toLowerCase()
          ) {
            throw new TransactionServiceError('INVALID_INPUT_BOUNDS', 'Contract address mismatch between quote and confirmation.');
          }
        }
      }
      if (this.state.quotedPolicyInput) {
        const quotedVal = this.state.quotedPolicyInput.userValue ?? 0n;
        const freshVal = freshValidation.policyInput.userValue ?? 0n;
        if (quotedVal !== freshVal) {
          throw new TransactionServiceError('INVALID_INPUT_BOUNDS', 'Attached userValue mismatch between fee quote and confirmation.');
        }
      }
    }

    // 4. Central Write Gate check
    // dispatchTransaction unconditionally throws WRITE_GATE_DISABLED while WRITES_ENABLED is false.
    if (!WRITES_ENABLED) {
      throw new TransactionServiceError(
        'WRITE_GATE_DISABLED',
        'Transaction dispatch is disabled. WRITES_ENABLED must be build-enabled to submit on-chain transactions.'
      );
    }

    const quoteToUse = this.state.quote || await this.estimateFee(kit);

    this.state.phase = 'submitting';
    this.notify();

    let dispatched: { genlayerTxId: `0x${string}`; explorerLink: string };
    try {
      dispatched = await dispatchTransaction(kit, quoteToUse, freshValidation.submitInput);
    } catch (err) {
      const classification = classifyWalletDispatchError(err);

      // Proven pre-broadcast wallet failure / rejection (e.g. MetaMask "Send failed" with no txId, code 4001, etc.)
      if (classification.isPreBroadcastFailure) {
        // Release ONLY that action's lock and do not save ambiguous transaction record
        clearPersistedTransaction(this.actionKey);
        this.state.phase = 'error';
        this.state.isDuplicateBlocked = false;
        this.state.txId = null;
        this.state.explorerLink = null;
        this.state.unresolvedMessage = null;
        this.state.errorMessage = classification.userMessage;
        this.notify();

        throw new TransactionServiceError(
          'DISPATCH_FAILED',
          classification.userMessage,
          err
        );
      }

      // Genuinely ambiguous cases: keep the duplicate block and persist ambiguous record
      const returnedTxId =
        (err as any)?.genlayerTxId ||
        (err as any)?.txId ||
        (err as any)?.hash ||
        null;
      this.state.phase = 'unknown';
      this.state.isDuplicateBlocked = true;
      this.state.txId = returnedTxId;
      this.state.explorerLink = returnedTxId ? makeTxExplorerLink(returnedTxId) : null;
      this.state.unresolvedMessage = classification.userMessage;

      persistTransactionRecord({
        txId: returnedTxId,
        actionKey: this.actionKey,
        rpcUrl: this.params.rpcUrl || NETWORK_CONFIG.rpcUrl,
        chainId: this.params.walletState.chainId || NETWORK_CONFIG.chainId,
        contractAddress: this.params.contractAddress || CONTRACT_ADDRESS || 'unconfigured',
        walletAddress: this.params.walletState.address || 'anonymous',
        actionType: this.params.actionType,
        args: freshValidation.submitInput.args ?? [],
        userValueWei: (freshValidation.policyInput.userValue ?? 0n).toString(),
        claimableCreditWei:
          this.params.claimableCreditWei !== undefined && this.params.claimableCreditWei !== null
            ? this.params.claimableCreditWei.toString()
            : null,
        submittedAt: Date.now(),
        status: 'ambiguous',
        error: (err as Error)?.message || String(err),
        errorMessage: classification.userMessage,
        explorerLink: this.state.explorerLink,
      });
      this.notify();
      throw new TransactionServiceError(
        'DISPATCH_FAILED',
        `Transaction submission resulted in ambiguous broadcast status: ${(err as Error)?.message || String(err)}. Duplicate submission is blocked. Verify receipt before retrying.`,
        err
      );
    }

    // Immediate Persistence on confirmed dispatch
    this.state.txId = dispatched.genlayerTxId;
    this.state.explorerLink = dispatched.explorerLink;
    this.state.phase = 'tracking';
    this.state.isDuplicateBlocked = true;

    persistTransactionRecord({
      txId: dispatched.genlayerTxId,
      actionKey: this.actionKey,
      rpcUrl: this.params.rpcUrl || NETWORK_CONFIG.rpcUrl,
      chainId: this.params.walletState.chainId || NETWORK_CONFIG.chainId,
      contractAddress: this.params.contractAddress || CONTRACT_ADDRESS || 'unconfigured',
      walletAddress: this.params.walletState.address || 'anonymous',
      actionType: this.params.actionType,
      args: freshValidation.submitInput.args ?? [],
      userValueWei: (freshValidation.policyInput.userValue ?? 0n).toString(),
      claimableCreditWei: this.params.claimableCreditWei !== undefined && this.params.claimableCreditWei !== null
        ? this.params.claimableCreditWei.toString()
        : null,
      submittedAt: Date.now(),
      status: 'submitted',
      explorerLink: dispatched.explorerLink,
      childTransferStatus: this.params.actionType === 'withdraw' ? 'pending' : 'idle',
    });
    this.notify();

    // Catch and surface asynchronous tracking errors instead of starting an unobserved promise
    this.track(kit, dispatched.genlayerTxId).catch((trackErr) => {
      console.error(`Asynchronous tracking error for ${dispatched.genlayerTxId}:`, trackErr);
      this.state.phase = 'error';
      this.state.unresolvedMessage = `Tracking error for transaction ${dispatched.genlayerTxId}: ${(trackErr as Error)?.message || String(trackErr)}`;
      this.notify();
    });

    return { txId: dispatched.genlayerTxId, explorerLink: dispatched.explorerLink };
  }

  public async track(kit: any, txId: `0x${string}`): Promise<TrackedStatus> {
    this.state.phase = 'tracking';
    this.state.txId = txId;
    this.state.explorerLink = makeTxExplorerLink(txId);
    this.notify();

    const onUpdate = (status: TrackedStatus) => {
      this.state.trackedStatus = status;
      const existing = getPersistedTransaction(this.actionKey);
      if (existing) {
        existing.status = status.phase as any;
        existing.executionResultName = status.executionResultName;
        persistTransactionRecord(existing);
      }
      this.notify();
    };

    try {
      const finalStatus = await trackTransaction(kit, txId, onUpdate, 'finalized');
      this.state.trackedStatus = finalStatus;

      // CRITICAL CONSENSUS & OUTCOME EVALUATION
      if (isExecutionSuccessful(finalStatus)) {
        if (this.params.actionType === 'withdraw') {
          // A successful parent withdraw execution does NOT prove child GEN delivery!
          // We verify actual child transaction evidence
          await this.verifyWithdrawChildTransfer(finalStatus, kit, txId);
        }

        this.state.phase = 'success';
        const existing = getPersistedTransaction(this.actionKey);
        persistTransactionRecord({
          txId,
          actionKey: this.actionKey,
          rpcUrl: this.params.rpcUrl || NETWORK_CONFIG.rpcUrl,
          chainId: this.params.walletState.chainId || NETWORK_CONFIG.chainId,
          contractAddress: this.params.contractAddress || CONTRACT_ADDRESS || 'unconfigured',
          walletAddress: this.params.walletState.address || 'anonymous',
          actionType: this.params.actionType,
          args: existing?.args ?? [],
          userValueWei: existing?.userValueWei ?? '0',
          claimableCreditWei: existing?.claimableCreditWei ?? (this.params.claimableCreditWei !== undefined && this.params.claimableCreditWei !== null ? this.params.claimableCreditWei.toString() : null),
          submittedAt: existing?.submittedAt ?? Date.now(),
          status: 'success',
          executionResultName: finalStatus.executionResultName,
          childTransferStatus: this.state.childTransferStatus,
          childTxId: this.state.childTxId || undefined,
          observedChildFields: this.state.observedChildFields || undefined,
          explorerLink: this.state.explorerLink!,
        });

        await this.triggerStateRefresh();
      } else if (isExecutionProvenFailed(finalStatus)) {
        this.state.phase = 'execution_failed';
        const existing = getPersistedTransaction(this.actionKey);
        persistTransactionRecord({
          txId,
          actionKey: this.actionKey,
          rpcUrl: this.params.rpcUrl || NETWORK_CONFIG.rpcUrl,
          chainId: this.params.walletState.chainId || NETWORK_CONFIG.chainId,
          contractAddress: this.params.contractAddress || CONTRACT_ADDRESS || 'unconfigured',
          walletAddress: this.params.walletState.address || 'anonymous',
          actionType: this.params.actionType,
          args: existing?.args ?? [],
          userValueWei: existing?.userValueWei ?? '0',
          claimableCreditWei: existing?.claimableCreditWei ?? (this.params.claimableCreditWei !== undefined && this.params.claimableCreditWei !== null ? this.params.claimableCreditWei.toString() : null),
          submittedAt: existing?.submittedAt ?? Date.now(),
          status: 'failed',
          executionResultName: finalStatus.executionResultName,
          explorerLink: this.state.explorerLink!,
        });
      } else if (isExecutionInconclusive(finalStatus)) {
        this.state.phase = 'unknown';
      } else {
        this.state.phase = 'unknown';
      }

      this.notify();
      return finalStatus;
    } catch (err) {
      this.state.phase = 'error';
      this.notify();
      throw err;
    }
  }

  /**
   * Correct withdrawal tracking:
   * A successful parent withdraw execution does NOT prove child GEN delivery.
   * Compares parent withdraw receipt (is_eth_send, recipient, amount) with
   * the matching value-bearing child transaction from the BriefArena contract.
   *
   * Strict proof guarantees:
   * 1. Fetches actual finalized parent receipt if tracked status lacks messages.
   * 2. Requires successful parent execution and a parent is_eth_send message
   *    identifying expected recipient and exact credit amount.
   * 3. Inspects ALL triggered child transactions, not just the first.
   * 4. Confirms ONLY when one child matches parent message, BriefArena contract sender,
   *    recipient, exact wei value, and an explicit successful value-credit indicator.
   * 5. Booleans parsed strictly (e.g. "false" never counts as true).
   * 6. Missing fields or contradictory evidence remain unverified.
   * 7. AgentPay Studio Next NOT_VOTED child supported when matching value_credited=true.
   */
  private async verifyWithdrawChildTransfer(
    parentStatus: TrackedStatus | any,
    kitOrClient: any,
    parentTxId: `0x${string}`
  ): Promise<void> {
    try {
      // 1. Fetch finalized parent receipt if parentStatus lacks message fields
      let parentReceipt: any = parentStatus;
      const hasParentMessages =
        (Array.isArray(parentReceipt?.messages) && parentReceipt.messages.length > 0) ||
        (Array.isArray(parentReceipt?.receipt?.messages) && parentReceipt.receipt.messages.length > 0);

      if (!hasParentMessages) {
        if (kitOrClient && typeof kitOrClient.getTransaction === 'function') {
          try {
            const fetched = await kitOrClient.getTransaction({ hash: parentTxId });
            if (fetched) parentReceipt = fetched;
          } catch {
            // retain parentStatus
          }
        } else if (kitOrClient?.client && typeof kitOrClient.client.getTransaction === 'function') {
          try {
            const fetched = await kitOrClient.client.getTransaction({ hash: parentTxId });
            if (fetched) parentReceipt = fetched;
          } catch {
            // retain parentStatus
          }
        } else if (readOnlyClient && typeof readOnlyClient.getTransaction === 'function') {
          try {
            const fetched = await (readOnlyClient as any).getTransaction({ hash: parentTxId });
            if (fetched) parentReceipt = fetched;
          } catch {
            // retain parentStatus
          }
        }
      }

      // 2. Require successful parent execution
      const parentExecSuccess =
        (parentReceipt?.executionResultName === 'FINISHED_WITH_RETURN' ||
         parentReceipt?.txExecutionResultName === 'FINISHED_WITH_RETURN' ||
         parentStatus?.executionResultName === 'FINISHED_WITH_RETURN' ||
         parentStatus?.txExecutionResultName === 'FINISHED_WITH_RETURN' ||
         parentReceipt?.receipt?.executionResultName === 'FINISHED_WITH_RETURN' ||
         parentReceipt?.receipt?.execution_result === 'FINISHED_WITH_RETURN') &&
        parentReceipt?.successful !== false &&
        parentStatus?.successful !== false &&
        parentReceipt?.statusName !== 'CANCELED' &&
        parentReceipt?.status !== 'FAILED';

      if (!parentExecSuccess) {
        this.state.childTransferStatus = 'unverified';
        this.state.childTxId = null;
        this.state.observedChildFields = null;
        return;
      }

      // 3. Expected parameters resolved from pre-submit persisted record or active params
      const persisted = getPersistedTransaction(this.actionKey) || (parentTxId ? getPersistedTransaction(parentTxId) : null);
      const expectedRecipient = persisted?.walletAddress || this.params.walletState.address;
      const expectedContract = persisted?.contractAddress || this.params.contractAddress || CONTRACT_ADDRESS;
      const expectedAmountWei =
        persisted?.claimableCreditWei ??
        (this.params.claimableCreditWei !== undefined && this.params.claimableCreditWei !== null
          ? this.params.claimableCreditWei.toString()
          : null);

      if (!expectedRecipient || !expectedContract || expectedAmountWei === null) {
        // Missing sender/recipient/value parameters: remain unverified
        this.state.childTransferStatus = 'unverified';
        this.state.childTxId = null;
        this.state.observedChildFields = null;
        return;
      }

      // 4. Require parent is_eth_send message identifying expected recipient and exact credit amount
      // Inspect top-level messages, nested receipt messages, leader votes, and active message generation
      const parentMessages: any[] = [
        ...(Array.isArray(parentReceipt?.messages) ? parentReceipt.messages : []),
        ...(Array.isArray(parentReceipt?.receipt?.messages) ? parentReceipt.receipt.messages : []),
        ...(Array.isArray(parentReceipt?.consensus_data?.final_votes)
          ? parentReceipt.consensus_data.final_votes.map((v: any) => v?.receipt?.messages).filter(Boolean).flat()
          : []),
        ...(Array.isArray(parentReceipt?.data?.active_message_generation?.messages)
          ? parentReceipt.data.active_message_generation.messages
          : []),
      ];

      if (parentMessages.length === 0) {
        this.state.childTransferStatus = 'unverified';
        this.state.childTxId = null;
        this.state.observedChildFields = null;
        return;
      }

      const matchingParentMessage = parentMessages.find((m: any) => {
        const isEthSend =
          parseStrictBoolean(m?.is_eth_send) ||
          parseStrictBoolean(m?.isEthSend) ||
          m?.messageType === '0' ||
          m?.messageType === 0 ||
          (parseStrictBoolean(parentReceipt?.is_eth_send) && (m?.to || m?.recipient));
        if (!isEthSend) return false;

        const to = m?.to || m?.to_address || m?.recipient;
        if (!to || typeof to !== 'string' || to.toLowerCase() !== expectedRecipient.toLowerCase()) {
          return false;
        }

        const val =
          m?.value !== undefined
            ? String(m.value)
            : m?.amount !== undefined
            ? String(m.amount)
            : m?.value_wei !== undefined
            ? String(m.value_wei)
            : null;
        if (val === null || val !== expectedAmountWei) {
          return false;
        }

        return true;
      });

      if (!matchingParentMessage) {
        this.state.childTransferStatus = 'unverified';
        this.state.childTxId = null;
        this.state.observedChildFields = null;
        return;
      }

      // 5. Gather all child transactions to inspect
      // Includes live Studio Next occurrences paths, effect mappings, childTransactions, and SDK triggers
      const candidateSet = new Set<`0x${string}`>();
      const addCandidateHash = (h: any) => {
        if (typeof h === 'string' && h.startsWith('0x') && h.length === 66) {
          candidateSet.add(h as `0x${string}`);
        }
      };

      if (Array.isArray(parentReceipt?.data?.active_message_generation?.occurrences)) {
        for (const id of parentReceipt.data.active_message_generation.occurrences) addCandidateHash(id);
      }
      if (Array.isArray(parentReceipt?.data?.fee_accounting?.active_message_generation?.occurrences)) {
        for (const id of parentReceipt.data.fee_accounting.active_message_generation.occurrences) addCandidateHash(id);
      }
      if (parentReceipt?.data?.message_effect_delivered && typeof parentReceipt.data.message_effect_delivered === 'object') {
        for (const id of Object.keys(parentReceipt.data.message_effect_delivered)) addCandidateHash(id);
      }
      if (parentReceipt?.data?.message_effect_descriptors && typeof parentReceipt.data.message_effect_descriptors === 'object') {
        for (const id of Object.keys(parentReceipt.data.message_effect_descriptors)) addCandidateHash(id);
      }
      if (Array.isArray(parentReceipt?.childTransactions)) {
        for (const id of parentReceipt.childTransactions) addCandidateHash(id);
      }
      if (Array.isArray(parentReceipt?.triggered_transactions)) {
        for (const id of parentReceipt.triggered_transactions) addCandidateHash(id);
      }
      for (const m of parentMessages) {
        addCandidateHash(m?.child_tx_hash || m?.childTxHash || m?.tx_hash || m?.hash);
      }
      if (kitOrClient && typeof kitOrClient.getTriggeredTransactionIds === 'function') {
        try {
          const ids = await kitOrClient.getTriggeredTransactionIds({ hash: parentTxId });
          if (Array.isArray(ids)) {
            for (const id of ids) addCandidateHash(id);
          }
        } catch {
          // ignore
        }
      } else if (kitOrClient?.client && typeof kitOrClient.client.getTriggeredTransactionIds === 'function') {
        try {
          const ids = await kitOrClient.client.getTriggeredTransactionIds({ hash: parentTxId });
          if (Array.isArray(ids)) {
            for (const id of ids) addCandidateHash(id);
          }
        } catch {
          // ignore
        }
      } else if (readOnlyClient && typeof (readOnlyClient as any).getTriggeredTransactionIds === 'function') {
        try {
          const ids = await (readOnlyClient as any).getTriggeredTransactionIds({ hash: parentTxId });
          if (Array.isArray(ids)) {
            for (const id of ids) addCandidateHash(id);
          }
        } catch {
          // ignore
        }
      }

      const childTxIds: `0x${string}`[] = Array.from(candidateSet);

      if (!childTxIds || childTxIds.length === 0) {
        this.state.childTransferStatus = 'unverified';
        this.state.childTxId = null;
        this.state.observedChildFields = null;
        return;
      }

      // 6. Inspect ALL triggered child transactions, not just the first
      let matchingChildConfirmed = false;
      let matchingChildFailed = false;
      let firstObservedChild: ObservedChildTransferFields | null = null;

      for (const candidateChildTxId of childTxIds) {
        let childTx: any = null;
        try {
          if (typeof kitOrClient.getTransaction === 'function') {
            childTx = await kitOrClient.getTransaction({ hash: candidateChildTxId });
          } else if (kitOrClient?.client && typeof kitOrClient.client.getTransaction === 'function') {
            childTx = await kitOrClient.client.getTransaction({ hash: candidateChildTxId });
          } else if (typeof kitOrClient.track === 'function') {
            childTx = await kitOrClient.track(candidateChildTxId, () => {}, { until: 'finalized' });
          } else if (readOnlyClient && typeof readOnlyClient.getTransaction === 'function') {
            childTx = await (readOnlyClient as any).getTransaction({ hash: candidateChildTxId });
          }
        } catch {
          continue;
        }

        if (!childTx) continue;

        const triggeredBy =
          childTx.triggered_by ||
          childTx.triggeredBy ||
          childTx.parent_hash ||
          childTx.parentTxHash ||
          (childTx.receipt && (childTx.receipt.triggered_by ?? childTx.receipt.parent_hash)) ||
          null;
        if (triggeredBy && typeof triggeredBy === 'string' && parentTxId) {
          if (triggeredBy.toLowerCase() !== parentTxId.toLowerCase()) {
            continue;
          }
        }

        const from =
          childTx.from ||
          childTx.from_address ||
          childTx.sender ||
          (childTx.message && (childTx.message.from || childTx.message.sender)) ||
          null;
        const recipient =
          childTx.to ||
          childTx.to_address ||
          childTx.recipient ||
          (childTx.message && (childTx.message.to || childTx.message.recipient)) ||
          null;
        const amountWei =
          childTx.value !== undefined
            ? String(childTx.value)
            : childTx.amount !== undefined
            ? String(childTx.amount)
            : (childTx.message && childTx.message.value !== undefined)
            ? String(childTx.message.value)
            : null;

        const rawChildIsEthSend =
          childTx.is_eth_send !== undefined
            ? childTx.is_eth_send
            : childTx.isEthSend !== undefined
            ? childTx.isEthSend
            : (childTx.receipt && (childTx.receipt.is_eth_send ?? childTx.receipt.isEthSend));

        const isEthSend =
          parseStrictBoolean(rawChildIsEthSend) ||
          parseStrictBoolean(matchingParentMessage?.is_eth_send) ||
          parseStrictBoolean(matchingParentMessage?.isEthSend) ||
          matchingParentMessage?.messageType === '0' ||
          matchingParentMessage?.messageType === 0;

        const rawValueCredited =
          childTx.value_credited !== undefined
            ? childTx.value_credited
            : childTx.valueCredited !== undefined
            ? childTx.valueCredited
            : (childTx.receipt && (childTx.receipt.value_credited ?? childTx.receipt.valueCredited));

        const valueCreditedStrict = parseStrictBoolean(rawValueCredited);

        const statusName = childTx.statusName || childTx.status || childTx.consensus_result || null;
        const executionResultName =
          childTx.executionResultName ||
          childTx.txExecutionResultName ||
          (childTx.receipt && (childTx.receipt.executionResultName || childTx.receipt.execution_result)) ||
          null;

        const observedFields: ObservedChildTransferFields = {
          childTxId: candidateChildTxId,
          from: typeof from === 'string' ? from : null,
          recipient: typeof recipient === 'string' ? recipient : null,
          amountWei,
          isEthSend,
          valueCredited: rawValueCredited === true ? true : (rawValueCredited === false || rawValueCredited === 'false') ? false : null,
          statusName: typeof statusName === 'string' ? statusName : null,
          executionResultName: typeof executionResultName === 'string' ? executionResultName : null,
        };

        if (!firstObservedChild) {
          firstObservedChild = observedFields;
        }

        // Check if this child matches contract sender, recipient, and exact wei value
        const matchesSender = typeof from === 'string' && from.toLowerCase() === expectedContract.toLowerCase();
        const matchesRecipient = typeof recipient === 'string' && recipient.toLowerCase() === expectedRecipient.toLowerCase();
        const matchesAmount = amountWei !== null && amountWei === expectedAmountWei;

        if (!matchesSender || !matchesRecipient || !matchesAmount) {
          // Does not match required transfer properties; inspect next child
          continue;
        }

        // Check if child explicitly failed
        const isChildFailed =
          executionResultName === 'FINISHED_WITH_ERROR' ||
          childTx.successful === false ||
          statusName === 'CANCELED' ||
          statusName === 'FAILED' ||
          childTx.status === 'FAILED';

        if (isChildFailed) {
          matchingChildFailed = true;
          this.state.childTxId = candidateChildTxId;
          this.state.observedChildFields = observedFields;
          continue;
        }

        // Strict delivery proof: native delivery requires explicit value_credited === true.
        // FINISHED_WITH_RETURN alone without value_credited === true is insufficient to confirm delivery.
        const isValueCreditedConfirmed = valueCreditedStrict === true;

        if (isValueCreditedConfirmed) {
          matchingChildConfirmed = true;
          this.state.childTxId = candidateChildTxId;
          this.state.observedChildFields = observedFields;
          break; // Found matching confirmed child!
        } else {
          this.state.childTxId = candidateChildTxId;
          this.state.observedChildFields = observedFields;
        }
      }

      if (matchingChildConfirmed) {
        this.state.childTransferStatus = 'confirmed';
      } else if (matchingChildFailed) {
        this.state.childTransferStatus = 'failed';
      } else {
        this.state.childTransferStatus = 'unverified';
        if (!this.state.childTxId && childTxIds.length > 0) {
          this.state.childTxId = childTxIds[0];
        }
        if (!this.state.observedChildFields && firstObservedChild) {
          this.state.observedChildFields = firstObservedChild;
        }
      }
    } catch {
      this.state.childTransferStatus = 'unverified';
    }
  }

  private async triggerStateRefresh(): Promise<void> {
    try {
      if (this.onSuccessRefresh) {
        await this.onSuccessRefresh();
      }
      this.state.isRefreshed = true;
    } catch (err) {
      console.warn('Post-transaction state refresh encountered an error:', err);
      this.state.isRefreshed = false;
    }
    this.notify();
  }

  /**
   * Resets controller state.
   * Does NOT silently erase an unresolved transaction unless force=true is explicitly provided.
   */
  public reset(options?: { force?: boolean }): void {
    const existing = getPersistedTransaction(this.actionKey);
    const isUnresolved = existing && existing.status !== 'success' && existing.status !== 'failed';
    if (isUnresolved && !options?.force) {
      throw new TransactionServiceError(
        'DISPATCH_FAILED',
        `Cannot reset controller: transaction ${existing.txId ?? 'ambiguous'} is still unresolved on-chain (status: ${existing.status}). Wait for consensus or resolve manually.`
      );
    }

    clearPersistedTransaction(this.actionKey);
    this.state = {
      phase: 'idle',
      validationError: null,
      submitInput: null,
      policyInput: null,
      quotedSubmitInput: null,
      quotedPolicyInput: null,
      quotedWalletAddress: null,
      quote: null,
      quoteError: null,
      txId: null,
      explorerLink: null,
      trackedStatus: null,
      childTransferStatus: 'idle',
      childTxId: null,
      observedChildFields: null,
      isDuplicateBlocked: false,
      isRefreshed: false,
      canConfirm: false,
      writesEnabled: WRITES_ENABLED,
      unresolvedMessage: null,
      errorMessage: null,
    };
    this.notify();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// React Hook for Component Integration
// ─────────────────────────────────────────────────────────────────────────────
export function useTransactionController(
  params: ActionPreconditionParams,
  passedKit: TransactionKit | null = null,
  onSuccessRefresh?: () => Promise<void> | void
) {
  const { kit: hookKit } = useTransactionKit(passedKit);
  const kit = passedKit ?? hookKit;

  const controllerRef = useRef<TransactionController | null>(null);

  if (!controllerRef.current) {
    controllerRef.current = new TransactionController(params, onSuccessRefresh);
  } else {
    controllerRef.current.updateParams(params);
  }

  const [state, setState] = useState<TransactionControllerState>(
    controllerRef.current.getState()
  );

  useEffect(() => {
    if (!controllerRef.current) return;
    const unsubscribe = controllerRef.current.subscribe(setState);

    // Automatic read-only reconciliation on load and on wallet reconnect if saved unresolved transaction exists
    const actionKey = controllerRef.current.getActionKey();
    const existing = getPersistedTransaction(actionKey);
    if (existing && existing.status !== 'success' && existing.status !== 'failed') {
      controllerRef.current.reconcile(kit || readOnlyClient).catch((err) => {
        console.warn('Auto-reconciliation on load/reconnect failed:', err);
      });
    }

    return () => unsubscribe();
  }, [kit, params.walletState.address, params.walletState.isConnected]);

  const validate = useCallback(() => {
    return controllerRef.current?.validate();
  }, []);

  const estimateFee = useCallback(async () => {
    if (!kit) {
      throw new TransactionServiceError('NO_WALLET', 'Transaction kit is not available.');
    }
    return controllerRef.current?.estimateFee(kit);
  }, [kit]);

  const submit = useCallback(async () => {
    if (!kit) {
      throw new TransactionServiceError('NO_WALLET', 'Transaction kit is not available.');
    }
    return controllerRef.current?.submit(kit);
  }, [kit]);

  const reconcile = useCallback(
    async (client?: any, evidence?: ReconciliationEvidence) => {
      return controllerRef.current?.reconcile(client || kit || readOnlyClient, evidence);
    },
    [kit]
  );

  const reconcileAmbiguous = useCallback(
    async (evidence?: ReconciliationEvidence) => {
      return controllerRef.current?.reconcileAmbiguous(evidence);
    },
    []
  );

  const reset = useCallback((options?: { force?: boolean }) => {
    controllerRef.current?.reset(options);
  }, []);

  return {
    state,
    validate,
    estimateFee,
    submit,
    reconcile,
    reconcileAmbiguous,
    reset,
    controller: controllerRef.current,
  };
}

/**
 * Hook to connect a real TransactionKit instance in the enabled path,
 * while preventing kit creation, wallet signatures, or fee estimation when write gate is closed.
 */
export function useTransactionKit(injectedKit?: TransactionKit | null) {
  const wallet = useWallet();
  const candidateKit = injectedKit ?? wallet.kit ?? null;
  const [kit, setKit] = useState<TransactionKit | null>(candidateKit);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (candidateKit) {
      setKit(candidateKit);
      return;
    }

    // Do NOT create a kit, request a wallet signature, or estimate fees while write gate is closed!
    if (!WRITES_ENABLED) {
      setKit(null);
      return;
    }

    // Enabled path: when WRITES_ENABLED=true and wallet is connected on Studio Next
    if (wallet.isConnected && wallet.isCorrectNetwork && wallet.address) {
      let isCancelled = false;
      createKit(wallet.chainId, {
        account: wallet.address as `0x${string}`,
      })
        .then((k) => {
          if (!isCancelled) {
            setKit(k);
            setError(null);
          }
        })
        .catch((err) => {
          if (!isCancelled) {
            setError((err as Error)?.message || 'Failed to initialize transaction kit');
            setKit(null);
          }
        });
      return () => {
        isCancelled = true;
      };
    } else {
      setKit(null);
    }
  }, [injectedKit, candidateKit, wallet.isConnected, wallet.isCorrectNetwork, wallet.chainId, wallet.address]);

  return { kit, error };
}

export { WRITES_ENABLED };
