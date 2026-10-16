import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import type { SubmitInput, PolicyQuote, TrackedStatus } from '@genlayer/transaction-kit';
import { CONTRACT_ADDRESS } from '../services/contractClient';
import { WRITES_ENABLED, makeTxExplorerLink, isExecutionSuccessful, isExecutionProvenFailed } from '../services/transactionService';
import type { TransactionActionType, ChildTransferStatus, ObservedChildTransferFields } from '../services/transactionController';

export interface ContractPendingModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  actionType: TransactionActionType;
  submitInput?: SubmitInput;
  nativeValueGen?: string;
  nativeValueWei?: bigint;
  payload?: Record<string, any>;
  unsuitableReason?: string;
  extraContext?: {
    challengeCode?: string;
    durationHours?: number;
    sponsorAddress?: string | null;
  };
  // Transaction controller & fee quote props
  quote?: PolicyQuote | null;
  quoteError?: string | null;
  isEstimating?: boolean;
  txId?: `0x${string}` | null;
  trackedStatus?: TrackedStatus | null;
  childTransferStatus?: ChildTransferStatus;
  childTxId?: `0x${string}` | null;
  observedChildFields?: ObservedChildTransferFields | null;
  isSubmitting?: boolean;
  isDuplicateBlocked?: boolean;
  unresolvedMessage?: string | null;
  errorMessage?: string | null;
  walletAddress?: string | null;
  onConfirmSubmit?: () => Promise<void> | void;
  onRetryEstimate?: () => Promise<any> | void;
  onReconcileCheckContract?: () => Promise<{ creditWei: bigint | null; withdrawnWei: bigint | null; message?: string }>;
  onReconcileReleaseLock?: () => Promise<void> | void;
}

function safeJsonStringify(obj: any): string {
  return JSON.stringify(
    obj,
    (_key, value) => (typeof value === 'bigint' ? `${value.toString()}n` : value),
    2
  );
}

function formatWeiAmount(wei: bigint): string {
  const ONE_GEN = 10n ** 18n;
  const whole = wei / ONE_GEN;
  const remainder = wei % ONE_GEN;
  if (remainder === 0n) return `${whole.toString()} test GEN`;
  const remStr = remainder.toString().padStart(18, '0').slice(0, 4);
  return `${whole.toString()}.${remStr} test GEN`;
}

export const ContractPendingModal: React.FC<ContractPendingModalProps> = ({
  isOpen,
  onClose,
  title,
  actionType,
  submitInput,
  nativeValueGen,
  nativeValueWei,
  payload,
  unsuitableReason,
  extraContext,
  quote,
  quoteError,
  isEstimating,
  txId,
  trackedStatus,
  childTransferStatus = 'idle',
  childTxId = null,
  observedChildFields = null,
  isSubmitting = false,
  isDuplicateBlocked = false,
  unresolvedMessage = null,
  errorMessage = null,
  walletAddress = null,
  onConfirmSubmit,
  onRetryEstimate,
  onReconcileCheckContract,
  onReconcileReleaseLock,
}) => {
  const [showRawJson, setShowRawJson] = useState(false);
  const [isCheckingContract, setIsCheckingContract] = useState(false);
  const [contractCheckResult, setContractCheckResult] = useState<{
    creditWei: bigint | null;
    withdrawnWei: bigint | null;
    message?: string;
  } | null>(null);
  const [walletActivityConfirmed, setWalletActivityConfirmed] = useState(false);
  const [isReconcilingRelease, setIsReconcilingRelease] = useState(false);
  const [reconcileError, setReconcileError] = useState<string | null>(null);
  const writesEnabled = WRITES_ENABLED;

  if (!isOpen) return null;

  const targetContract = submitInput?.kind === 'write' ? submitInput.address : CONTRACT_ADDRESS;
  const explorerUrl = txId ? makeTxExplorerLink(txId) : null;

  const isSuccess = trackedStatus ? isExecutionSuccessful(trackedStatus) : false;
  const isFailed = trackedStatus ? isExecutionProvenFailed(trackedStatus) : false;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-primary/70 backdrop-blur-sm animate-fade-in">
      <div className="bg-surface-container-lowest max-w-2xl w-full rounded-2xl border-2 border-primary/20 shadow-2xl p-6 sm:p-8 space-y-6 max-h-[90vh] overflow-y-auto">
        
        {/* Top Header Badge */}
        <div className="flex items-center justify-between">
          <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-mono font-semibold ${
            writesEnabled ? 'bg-primary/10 text-primary' : 'bg-secondary-fixed/40 text-secondary-fixed-dim'
          }`}>
            <span className="material-symbols-outlined text-sm">{writesEnabled ? 'send' : 'lock'}</span>
            <span>{writesEnabled ? 'Transaction Confirmation' : 'Review draft — writes disabled'}</span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-on-surface-variant hover:bg-surface-container transition-colors cursor-pointer"
            title="Close review modal"
          >
            <span className="material-symbols-outlined text-xl">close</span>
          </button>
        </div>

        {/* Modal Title & State Statement */}
        <div className="space-y-1.5">
          <h3 className="font-serif text-2xl text-primary font-semibold">
            {title ||
              (actionType === 'challenge_creation'
                ? (writesEnabled ? 'Create Challenge: Confirm Submission' : 'Review Draft: Create Challenge')
                : actionType === 'cancel_challenge'
                ? (writesEnabled ? 'Cancel Challenge: Confirm Submission' : 'Review Draft: Cancel Challenge')
                : actionType === 'withdraw'
                ? (writesEnabled ? 'Withdraw Credit: Confirm Submission' : 'Review Draft: Withdraw Credit')
                : actionType === 'close_deadline'
                ? (writesEnabled ? 'Close Deadline: Confirm Submission' : 'Review Draft: Close Deadline')
                : actionType === 'expire_zero_entries'
                ? (writesEnabled ? 'Expire Zero Entries: Confirm Submission' : 'Review Draft: Expire Zero Entries')
                : actionType === 'commit_judging'
                ? (writesEnabled ? 'Commit Judging: Confirm Submission' : 'Review Draft: Commit Judging')
                : actionType === 'attempt_judgement'
                ? (writesEnabled ? 'Attempt Judgement: Confirm Submission' : 'Review Draft: Attempt Judgement')
                : actionType === 'timeout_judgement'
                ? (writesEnabled ? 'Timeout Judgement: Confirm Submission' : 'Review Draft: Timeout Judgement')
                : (writesEnabled ? 'Submit Entry: Confirm Submission' : 'Review Draft: Submit Entry'))}
          </h3>
          <p className="text-xs sm:text-sm text-on-surface-variant leading-relaxed">
            {(() => {
              const writesGateCopy = writesEnabled
                ? 'Real on-chain quoting and submission enabled. Review the exact calldata and fee breakdown before signing.'
                : 'Zero on-chain writes or wallet prompts are triggered while WRITES_ENABLED remains false.';

              return actionType === 'challenge_creation'
                ? `Your brief specification has passed all client-side validation rules. This preview reflects the exact six calldata arguments prepared for create_challenge. ${writesGateCopy}`
                : actionType === 'cancel_challenge'
                ? unsuitableReason
                  ? 'This challenge is a design fixture without an on-chain record. Chain-call drafts are unavailable for fixture challenges; fabricated calldata is strictly prohibited.'
                  : `Cancellation marks the brief as CANCELED and credits locked escrow to your internal sponsor credit ledger on-chain. It does not execute a native GEN transfer or refund. ${writesGateCopy}`
                : actionType === 'withdraw'
                ? `Calling withdraw requests the smart contract to emit a native GEN transfer for your claimable internal credit. External delivery requires a confirmed on-chain child receipt. ${writesGateCopy}`
                : actionType === 'close_deadline'
                ? `Permissionless deadline closure after submission window ends. GenLayer validators strictly enforce the deadline (now >= deadline) at transaction execution using deterministic consensus datetime. Transitions brief status from OPEN to CLOSED when at least one entry has been submitted. ${writesGateCopy}`
                : actionType === 'expire_zero_entries'
                ? `Permissionless expiration for a brief that reached deadline with zero submitted entries. GenLayer validators strictly enforce the deadline (now >= deadline) at transaction execution using deterministic consensus datetime. Transitions brief status from OPEN to NO_WINNER and reallocates 100% of prize escrow to the sponsor's internal credit ledger. Does not execute an external transfer. ${writesGateCopy}`
                : actionType === 'commit_judging'
                ? `Permissionless transition of a CLOSED brief into JUDGING. Commits the transaction timestamp on-chain as judgingStartedAt. Existing brief metadata and submitted entries remain strictly immutable. ${writesGateCopy}`
                : actionType === 'attempt_judgement'
                ? `Executes LLM consensus deliberation for a brief committed to JUDGING. Validators evaluate entries against the protocol rubric. If consensus succeeds, entries are scored, prize escrow is allocated to the winner (or sponsor credit if no-winner), and the decision is finalized. If consensus fails or remains undetermined, the transaction reverts with zero state change, escrow remains locked in the contract, and the challenge stays in JUDGING (retryable anytime). ${writesGateCopy}`
                : actionType === 'timeout_judgement'
                ? `Permissionless resolution of a brief stalled in JUDGING for at least 48 hours without validator consensus. GenLayer validators strictly enforce the 48-hour timeout (now >= judgingStartedAt + 172800) at transaction execution using deterministic consensus datetime. Concludes the challenge as NO_WINNER and reallocates 100% of prize escrow to the sponsor's internal credit ledger. Does not execute an external transfer. ${writesGateCopy}`
                : unsuitableReason
                ? 'This challenge is a design fixture without an on-chain record. Chain-call drafts are unavailable for fixture challenges; fabricated calldata is strictly prohibited.'
                : `Your copywriting entry has passed all client-side character count, formatting, and prohibited term checks. This preview reflects the exact calldata arguments prepared for submit_entry. ${writesGateCopy}`;
            })()}
          </p>
        </div>

        {/* Unsuitable ID / Fixture Challenge Explanation Banner */}
        {unsuitableReason && (
          <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-3 text-xs">
            <span className="material-symbols-outlined text-amber-600 text-lg shrink-0 mt-0.5">info</span>
            <div className="space-y-1">
              <strong className="text-on-surface font-semibold block">Design Preview Only — Chain Call Unavailable</strong>
              <p className="text-on-surface-variant leading-relaxed">
                {unsuitableReason}
              </p>
            </div>
          </div>
        )}

        {/* Pre-Broadcast Wallet Failure / Error Banner */}
        {errorMessage && (
          <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-start gap-3 text-xs animate-fade-in">
            <span className="material-symbols-outlined text-rose-600 text-lg shrink-0 mt-0.5">error</span>
            <div className="space-y-1 flex-1">
              <strong className="text-on-surface font-semibold block">Wallet / Pre-Broadcast Notification</strong>
              <p className="text-on-surface-variant leading-relaxed">
                {errorMessage}
              </p>
            </div>
          </div>
        )}

        {/* Duplicate In-Flight / Unresolved Transaction Warning */}
        {isDuplicateBlocked && (
          <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-3 text-xs">
            <span className="material-symbols-outlined text-amber-600 text-lg shrink-0 mt-0.5">warning</span>
            <div className="space-y-1.5 flex-1">
              <strong className="text-on-surface font-semibold block">Unresolved Transaction Detected — Submission Blocked</strong>
              <p className="text-on-surface-variant leading-relaxed">
                {unresolvedMessage || 'A transaction for this action is already pending or unresolved on-chain. Resubmission is blocked to protect your funds and prevent duplicate transactions.'}
              </p>
              {txId && (
                <div className="p-2.5 rounded-lg bg-surface-container font-mono text-[11px] text-primary flex items-center justify-between gap-2 border border-outline-variant/30">
                  <span className="truncate">Saved Tx ID: {txId}</span>
                  {explorerUrl && (
                    <a
                      href={explorerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-secondary hover:underline shrink-0 flex items-center gap-1 font-sans text-xs font-semibold"
                    >
                      <span>Manual Review</span>
                      <span className="material-symbols-outlined text-xs">open_in_new</span>
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Execution Time Unverified Warning Banner */}
        {(actionType === 'close_deadline' || actionType === 'expire_zero_entries' || actionType === 'timeout_judgement') && (
          <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-3 text-xs">
            <span className="material-symbols-outlined text-amber-600 text-lg shrink-0 mt-0.5">warning</span>
            <div className="space-y-1">
              <strong className="text-on-surface font-semibold block">Execution Time Unverified</strong>
              <p className="text-on-surface-variant leading-relaxed">
                Execution time unverified; an early transaction can fail and incur fees. GenLayer validators strictly enforce deadline and timeout preconditions at transaction execution using deterministic consensus datetime (<code>gl.message_raw["datetime"]</code>). Browser clock is a local estimate only.
              </p>
            </div>
          </div>
        )}

        {/* Contract & Method Identification Strip */}
        <div className="p-3.5 rounded-xl bg-surface-container-low border border-outline-variant/30 space-y-2 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-on-surface-variant font-medium">
              <span className="material-symbols-outlined text-sm text-secondary">deployed_code</span>
              <span>Target Contract:</span>
              <span className={`font-mono font-semibold truncate max-w-[220px] sm:max-w-none ${targetContract ? 'text-primary' : 'text-error'}`}>
                {targetContract || 'Not configured (CONTRACT_ADDRESS_MISSING)'}
              </span>
            </div>
            <span className="px-2 py-0.5 rounded bg-surface-container text-outline text-[10px] font-mono font-bold">
              Studio Next (Chain 61997)
            </span>
          </div>

          <div className="flex items-center gap-1.5 pt-1 border-t border-outline-variant/20 font-mono text-secondary font-semibold">
            <span className="material-symbols-outlined text-sm">code</span>
            <span>
              {actionType === 'challenge_creation'
                ? 'Method: create_challenge(title, category, synopsis, mandatory_reqs, prohibited_terms, duration_seconds)'
                : actionType === 'cancel_challenge'
                ? unsuitableReason
                  ? 'Target Method: cancel_challenge (Calldata omitted for design fixture)'
                  : 'Method: cancel_challenge(challenge_id)'
                : actionType === 'withdraw'
                ? 'Method: withdraw()'
                : actionType === 'close_deadline'
                ? 'Method: close_deadline(challenge_id)'
                : actionType === 'expire_zero_entries'
                ? 'Method: expire_zero_entries(challenge_id)'
                : actionType === 'commit_judging'
                ? 'Method: commit_judging(challenge_id)'
                : actionType === 'attempt_judgement'
                ? 'Method: attempt_judgement(challenge_id)'
                : actionType === 'timeout_judgement'
                ? 'Method: timeout_judgement(challenge_id)'
                : unsuitableReason
                ? 'Target Method: submit_entry (Calldata omitted for design fixture)'
                : 'Method: submit_entry(challenge_id, tagline, paragraph)'}
            </span>
          </div>
        </div>

        {/* Structured Arguments Display */}
        {submitInput && submitInput.kind === 'write' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wider font-semibold text-primary">
                {actionType === 'challenge_creation'
                  ? 'Prepared Contract Arguments (6 Parameters):'
                  : actionType === 'cancel_challenge' ||
                    actionType === 'close_deadline' ||
                    actionType === 'expire_zero_entries' ||
                    actionType === 'commit_judging' ||
                    actionType === 'attempt_judgement' ||
                    actionType === 'timeout_judgement'
                  ? 'Prepared Contract Arguments (1 Parameter):'
                  : actionType === 'withdraw'
                  ? 'Prepared Contract Arguments (0 Parameters):'
                  : 'Prepared Contract Arguments (3 Parameters):'}
              </span>
              <button
                type="button"
                onClick={() => setShowRawJson(!showRawJson)}
                className="text-[11px] text-secondary font-semibold hover:underline flex items-center gap-1"
              >
                <span>{showRawJson ? 'Hide Raw Calldata' : 'View Raw Calldata'}</span>
                <span className="material-symbols-outlined text-xs">
                  {showRawJson ? 'expand_less' : 'expand_more'}
                </span>
              </button>
            </div>

            {actionType === 'challenge_creation' && Array.isArray(submitInput.args) && (
              <div className="space-y-2 text-xs">
                {/* Arg 0: Title */}
                <div className="p-3 rounded-lg bg-surface-container-low border border-outline-variant/30 space-y-1">
                  <span className="text-[10px] font-mono font-bold uppercase text-on-surface-variant block">
                    [0] Title (str):
                  </span>
                  <p className="font-serif text-sm font-semibold text-primary">
                    {String(submitInput.args[0])}
                  </p>
                </div>

                {/* Arg 1: Category */}
                <div className="p-3 rounded-lg bg-surface-container-low border border-outline-variant/30 space-y-1">
                  <span className="text-[10px] font-mono font-bold uppercase text-on-surface-variant block">
                    [1] Category (str):
                  </span>
                  <p className="font-sans text-xs font-semibold text-primary">
                    {String(submitInput.args[1])}
                  </p>
                </div>

                {/* Arg 2: Synopsis */}
                <div className="p-3 rounded-lg bg-surface-container-low border border-outline-variant/30 space-y-1">
                  <span className="text-[10px] font-mono font-bold uppercase text-on-surface-variant block">
                    [2] Synopsis (str):
                  </span>
                  <p className="text-xs text-on-surface leading-relaxed">
                    {String(submitInput.args[2])}
                  </p>
                </div>

                {/* Arg 3: Mandatory Requirements */}
                <div className="p-3 rounded-lg bg-surface-container-low border border-outline-variant/30 space-y-1.5">
                  <span className="text-[10px] font-mono font-bold uppercase text-on-surface-variant block">
                    [3] Mandatory Requirements (list[str]):
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {Array.isArray(submitInput.args[3]) &&
                      (submitInput.args[3] as string[]).map((req, i) => (
                        <span
                          key={i}
                          className="px-2 py-1 rounded bg-surface-container text-primary font-mono text-[11px] border border-outline-variant/20"
                        >
                          {i + 1}. {req}
                        </span>
                      ))}
                  </div>
                </div>

                {/* Arg 4: Prohibited Terms */}
                <div className="p-3 rounded-lg bg-surface-container-low border border-outline-variant/30 space-y-1.5">
                  <span className="text-[10px] font-mono font-bold uppercase text-on-surface-variant block">
                    [4] Prohibited Terms (list[str]):
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {Array.isArray(submitInput.args[4]) &&
                      (submitInput.args[4] as string[]).map((term, i) => (
                        <span
                          key={i}
                          className="px-2 py-0.5 rounded bg-error-container/40 text-on-error-container font-mono text-[11px]"
                        >
                          &times; {term}
                        </span>
                      ))}
                  </div>
                </div>

                {/* Arg 5: Duration Seconds */}
                <div className="p-3 rounded-lg bg-surface-container-low border border-outline-variant/30 space-y-1">
                  <span className="text-[10px] font-mono font-bold uppercase text-on-surface-variant block">
                    [5] Duration Seconds (u256):
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-bold text-primary">
                      {String(submitInput.args[5])} seconds
                    </span>
                    <span className="text-on-surface-variant text-[11px]">
                      ({extraContext?.durationHours ? `${extraContext.durationHours} hours` : `${Number(submitInput.args[5]) / 3600} hours`} relative duration; not an absolute timestamp)
                    </span>
                  </div>
                </div>

                {/* Separate Attached Escrow Value */}
                <div className="p-3.5 rounded-lg bg-primary-container/20 border border-primary/30 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono font-bold uppercase text-primary block">
                      Attached Escrow Value (gl.message.value / userValue):
                    </span>
                    <span className="px-2 py-0.5 rounded bg-surface-container text-primary text-[10px] font-mono font-semibold">
                      msg.value
                    </span>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="font-serif text-lg font-bold text-primary">
                      {nativeValueGen || '0'} test GEN
                    </span>
                    {nativeValueWei && (
                      <span className="font-mono text-[11px] text-on-surface-variant">
                        ({nativeValueWei.toString()} wei)
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-on-surface-variant leading-relaxed">
                    Attached separately via Transaction Kit policy (<code className="font-mono">PolicyInput.userValue</code>). Strictly excluded from the six contract arguments.
                  </p>
                </div>
              </div>
            )}

            {actionType === 'entry_submission' && Array.isArray(submitInput.args) && (
              <div className="space-y-2 text-xs">
                {/* Arg 0: Challenge ID */}
                <div className="p-3 rounded-lg bg-surface-container-low border border-outline-variant/30 space-y-1">
                  <span className="text-[10px] font-mono font-bold uppercase text-on-surface-variant block">
                    [0] Challenge ID (u256):
                  </span>
                  <span className="font-mono text-sm font-bold text-primary">
                    #{String(submitInput.args[0])}
                  </span>
                </div>

                {/* Arg 1: Tagline */}
                <div className="p-3 rounded-lg bg-surface-container-low border border-outline-variant/30 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono font-bold uppercase text-on-surface-variant">
                      [1] Tagline (str):
                    </span>
                    <span className="font-mono text-[10px] text-outline">
                      {String(submitInput.args[1]).length} / 60 chars
                    </span>
                  </div>
                  <p className="font-serif text-sm font-semibold text-primary">
                    &ldquo;{String(submitInput.args[1])}&rdquo;
                  </p>
                </div>

                {/* Arg 2: Launch Paragraph */}
                <div className="p-3 rounded-lg bg-surface-container-low border border-outline-variant/30 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono font-bold uppercase text-on-surface-variant">
                      [2] Paragraph (str):
                    </span>
                    <span className="font-mono text-[10px] text-outline">
                      {String(submitInput.args[2]).length} / 280 chars
                    </span>
                  </div>
                  <p className="text-xs text-on-surface leading-relaxed">
                    {String(submitInput.args[2])}
                  </p>
                </div>

                {/* Attached Escrow Value */}
                <div className="p-3 rounded-lg bg-surface-container-low border border-outline-variant/30 flex items-center justify-between text-xs">
                  <span className="text-on-surface-variant font-medium">Attached Value:</span>
                  <span className="font-mono font-semibold text-primary">0 test GEN (non-payable)</span>
                </div>
              </div>
            )}

            {actionType === 'cancel_challenge' && Array.isArray(submitInput.args) && (
              <div className="space-y-2 text-xs">
                {/* Arg 0: Challenge ID */}
                <div className="p-3 rounded-lg bg-surface-container-low border border-outline-variant/30 space-y-1">
                  <span className="text-[10px] font-mono font-bold uppercase text-on-surface-variant block">
                    [0] Challenge ID (u256):
                  </span>
                  <span className="font-mono text-sm font-bold text-primary">
                    #{String(submitInput.args[0])}
                  </span>
                </div>

                {/* Credit Ledger Notice */}
                <div className="p-3 rounded-lg bg-surface-container-low border border-outline-variant/30 space-y-1">
                  <span className="text-[10px] font-mono font-bold uppercase text-on-surface-variant block">
                    Settlement Mechanism:
                  </span>
                  <p className="text-on-surface leading-relaxed text-xs">
                    Reallocates 100% of prize escrow to your internal sponsor credit ledger on-chain. Does not emit a native GEN transfer. Withdrawal is a separate user-initiated action.
                  </p>
                </div>

                <div className="p-3 rounded-lg bg-surface-container-low border border-outline-variant/30 flex items-center justify-between text-xs">
                  <span className="text-on-surface-variant font-medium">Attached Value:</span>
                  <span className="font-mono font-semibold text-primary">0 test GEN (non-payable)</span>
                </div>
              </div>
            )}

            {actionType === 'withdraw' && (
              <div className="space-y-2 text-xs">
                <div className="p-3 rounded-lg bg-surface-container-low border border-outline-variant/30 space-y-1">
                  <span className="text-[10px] font-mono font-bold uppercase text-on-surface-variant block">
                    Method Arguments:
                  </span>
                  <span className="font-mono text-xs text-on-surface-variant italic">
                    None (0 arguments; caller identified via gl.message.sender_address)
                  </span>
                </div>
                <div className="p-3 rounded-lg bg-surface-container-low border border-outline-variant/30 space-y-1">
                  <span className="text-[10px] font-mono font-bold uppercase text-on-surface-variant block">
                    Settlement & Delivery:
                  </span>
                  <p className="text-on-surface leading-relaxed text-xs">
                    Withdrawal requests the contract to emit a native GEN transfer for all claimable credits in your account. The parent transaction updates the contract ledger; GEN delivery requires a confirmed on-chain child transfer receipt.
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-surface-container-low border border-outline-variant/30 flex items-center justify-between text-xs">
                  <span className="text-on-surface-variant font-medium">Attached Value:</span>
                  <span className="font-mono font-semibold text-primary">0 test GEN (non-payable)</span>
                </div>
              </div>
            )}

            {actionType === 'close_deadline' && Array.isArray(submitInput.args) && (
              <div className="space-y-2 text-xs">
                <div className="p-3 rounded-lg bg-surface-container-low border border-outline-variant/30 space-y-1">
                  <span className="text-[10px] font-mono font-bold uppercase text-on-surface-variant block">
                    [0] Challenge ID (u256):
                  </span>
                  <span className="font-mono text-sm font-bold text-primary">
                    #{String(submitInput.args[0])}
                  </span>
                </div>
                <div className="p-3 rounded-lg bg-surface-container-low border border-outline-variant/30 space-y-1">
                  <span className="text-[10px] font-mono font-bold uppercase text-on-surface-variant block">
                    Settlement Mechanism:
                  </span>
                  <p className="text-on-surface leading-relaxed text-xs">
                    Transitions challenge from OPEN to CLOSED when at least one entry has been submitted. GenLayer validators strictly enforce the deadline (now &gt;= deadline) at transaction execution using deterministic consensus datetime.
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-surface-container-low border border-outline-variant/30 flex items-center justify-between text-xs">
                  <span className="text-on-surface-variant font-medium">Attached Value:</span>
                  <span className="font-mono font-semibold text-primary">0 test GEN (non-payable)</span>
                </div>
              </div>
            )}

            {actionType === 'expire_zero_entries' && Array.isArray(submitInput.args) && (
              <div className="space-y-2 text-xs">
                <div className="p-3 rounded-lg bg-surface-container-low border border-outline-variant/30 space-y-1">
                  <span className="text-[10px] font-mono font-bold uppercase text-on-surface-variant block">
                    [0] Challenge ID (u256):
                  </span>
                  <span className="font-mono text-sm font-bold text-primary">
                    #{String(submitInput.args[0])}
                  </span>
                </div>
                <div className="p-3 rounded-lg bg-surface-container-low border border-outline-variant/30 space-y-1">
                  <span className="text-[10px] font-mono font-bold uppercase text-on-surface-variant block">
                    Settlement Mechanism:
                  </span>
                  <p className="text-on-surface leading-relaxed text-xs">
                    Permissionless expiration when 0 entries were received before the deadline. Transitions brief from OPEN to NO_WINNER and reallocates 100% of escrow to sponsor credit ledger. GenLayer validators strictly enforce the deadline (now &gt;= deadline) at transaction execution using deterministic consensus datetime.
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-surface-container-low border border-outline-variant/30 flex items-center justify-between text-xs">
                  <span className="text-on-surface-variant font-medium">Attached Value:</span>
                  <span className="font-mono font-semibold text-primary">0 test GEN (non-payable)</span>
                </div>
              </div>
            )}

            {actionType === 'commit_judging' && Array.isArray(submitInput.args) && (
              <div className="space-y-2 text-xs">
                <div className="p-3 rounded-lg bg-surface-container-low border border-outline-variant/30 space-y-1">
                  <span className="text-[10px] font-mono font-bold uppercase text-on-surface-variant block">
                    [0] Challenge ID (u256):
                  </span>
                  <span className="font-mono text-sm font-bold text-primary">
                    #{String(submitInput.args[0])}
                  </span>
                </div>
                <div className="p-3 rounded-lg bg-surface-container-low border border-outline-variant/30 space-y-1">
                  <span className="text-[10px] font-mono font-bold uppercase text-on-surface-variant block">
                    Settlement Mechanism:
                  </span>
                  <p className="text-on-surface leading-relaxed text-xs">
                    Commits closed challenge to active comparative judging. Records on-chain judging start timestamp and transitions status to JUDGING. Unlocks permissionless attempt_judgement.
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-surface-container-low border border-outline-variant/30 flex items-center justify-between text-xs">
                  <span className="text-on-surface-variant font-medium">Attached Value:</span>
                  <span className="font-mono font-semibold text-primary">0 test GEN (non-payable)</span>
                </div>
              </div>
            )}

            {actionType === 'attempt_judgement' && Array.isArray(submitInput.args) && (
              <div className="space-y-2 text-xs">
                <div className="p-3 rounded-lg bg-surface-container-low border border-outline-variant/30 space-y-1">
                  <span className="text-[10px] font-mono font-bold uppercase text-on-surface-variant block">
                    [0] Challenge ID (u256):
                  </span>
                  <span className="font-mono text-sm font-bold text-primary">
                    #{String(submitInput.args[0])}
                  </span>
                </div>
                <div className="p-3 rounded-lg bg-surface-container-low border border-outline-variant/30 space-y-1">
                  <span className="text-[10px] font-mono font-bold uppercase text-on-surface-variant block">
                    Settlement Mechanism:
                  </span>
                  <p className="text-on-surface leading-relaxed text-xs">
                    Triggers AI comparative evaluation across all submissions. Contract requires validator consensus. If consensus fails or remains undetermined, the transaction reverts with zero state change and escrow stays locked in the contract (retryable anytime).
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-surface-container-low border border-outline-variant/30 flex items-center justify-between text-xs">
                  <span className="text-on-surface-variant font-medium">Attached Value:</span>
                  <span className="font-mono font-semibold text-primary">0 test GEN (non-payable)</span>
                </div>
              </div>
            )}

            {actionType === 'timeout_judgement' && Array.isArray(submitInput.args) && (
              <div className="space-y-2 text-xs">
                <div className="p-3 rounded-lg bg-surface-container-low border border-outline-variant/30 space-y-1">
                  <span className="text-[10px] font-mono font-bold uppercase text-on-surface-variant block">
                    [0] Challenge ID (u256):
                  </span>
                  <span className="font-mono text-sm font-bold text-primary">
                    #{String(submitInput.args[0])}
                  </span>
                </div>
                <div className="p-3 rounded-lg bg-surface-container-low border border-outline-variant/30 space-y-1">
                  <span className="text-[10px] font-mono font-bold uppercase text-on-surface-variant block">
                    Settlement Mechanism:
                  </span>
                  <p className="text-on-surface leading-relaxed text-xs">
                    Permits permissionless recovery if consensus judging has been active for at least 48 hours without resolution. GenLayer validators strictly enforce the 48-hour timeout (now &gt;= judgingStartedAt + 172800) at transaction execution using deterministic consensus datetime. Marks brief as NO_WINNER and refunds 100% of escrow to sponsor credit ledger.
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-surface-container-low border border-outline-variant/30 flex items-center justify-between text-xs">
                  <span className="text-on-surface-variant font-medium">Attached Value:</span>
                  <span className="font-mono font-semibold text-primary">0 test GEN (non-payable)</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Collapsible Raw Calldata Preview */}
        {showRawJson && (
          <div className="space-y-1.5 animate-fade-in">
            <div className="flex items-center justify-between text-xs font-medium text-on-surface-variant">
              <span>Raw SubmitInput Payload:</span>
              <span className="font-mono text-[10px]">Client Preview</span>
            </div>
            <div className="bg-surface-container-low p-3.5 rounded-lg font-mono text-[11px] text-on-surface max-h-48 overflow-y-auto border border-outline-variant/30">
              <pre className="whitespace-pre-wrap break-all">
                {safeJsonStringify(submitInput || payload)}
              </pre>
            </div>
          </div>
        )}

        {/* Fallback payload display if submitInput wasn't provided */}
        {!submitInput && payload && (
          <div className="space-y-1.5">
            <div className="bg-surface-container-low p-3.5 rounded-lg font-mono text-xs text-on-surface max-h-48 overflow-y-auto border border-outline-variant/30">
              <pre className="whitespace-pre-wrap break-all">
                {safeJsonStringify(payload)}
              </pre>
            </div>
          </div>
        )}

        {/* Notice when submitInput is omitted (e.g. fixture challenge) */}
        {!submitInput && !payload && (
          <div className="p-4 rounded-lg bg-surface-container-low border border-outline-variant/30 space-y-1.5 text-xs text-on-surface-variant">
            <span className="font-semibold text-primary block">Calldata Draft Excluded</span>
            <p className="leading-relaxed">
              No on-chain transaction arguments are constructed for fixture challenges. To inspect genuine calldata drafts, navigate to Explore and select an active on-chain brief.
            </p>
          </div>
        )}

        {/* Known Attached Escrow (Shown Separately from Fee Quote) */}
        <div className="p-4 rounded-xl bg-surface-container-low border border-outline-variant/30 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-primary">
              <span className="material-symbols-outlined text-sm text-secondary">account_balance_wallet</span>
              <span>Known Attached Escrow:</span>
            </div>
            <span className="px-2 py-0.5 rounded bg-surface-container text-primary text-[10px] font-mono font-bold">
              {(nativeValueWei ?? 0n) > 0n ? 'Payable Call' : 'Non-Payable Call'}
            </span>
          </div>
          <div className="flex items-center justify-between p-3 rounded-lg bg-surface-container/60 border border-outline-variant/20 text-xs">
            <span className="text-on-surface-variant font-medium">Attached Escrow Value:</span>
            <span className="font-mono font-bold text-primary text-sm">
              {nativeValueGen ? `${nativeValueGen} test GEN` : formatWeiAmount(nativeValueWei ?? 0n)}
            </span>
          </div>
          <p className="text-[10px] text-on-surface-variant leading-relaxed italic">
            {(nativeValueWei ?? 0n) > 0n
              ? 'This attached escrow will be locked in the smart contract as the prize bounty upon transaction execution.'
              : 'This contract call does not attach or transfer native GEN. Non-payable methods require zero attached value.'}
          </p>
        </div>

        {/* Estimated Transaction Fee & Policy Quote Breakdown Strip */}
        <div className="p-4 rounded-xl bg-surface-container-low border border-outline-variant/30 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-primary">
              <span className="material-symbols-outlined text-sm text-secondary">receipt_long</span>
              <span>Estimated Transaction Fee (PolicyQuote):</span>
            </div>
            {quote ? (
              <span className="px-2 py-0.5 rounded bg-surface-container text-secondary text-[10px] font-mono font-bold">
                {quote.verification?.status === 'verified' ? 'Policy Verified' : quote.verification?.status || 'Estimated'}
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded bg-surface-container text-outline text-[10px] font-mono font-bold">
                Not Estimated
              </span>
            )}
          </div>

          {isEstimating ? (
            <div className="flex items-center gap-2 text-xs text-on-surface-variant">
              <span className="material-symbols-outlined text-sm animate-spin text-secondary">sync</span>
              <span>Estimating execution fee on Studio Next...</span>
            </div>
          ) : quoteError ? (
            <div className="p-2.5 rounded-lg bg-error-container/30 border border-error/40 text-xs text-on-error-container space-y-1">
              <span className="font-semibold block">Fee Estimation Failed:</span>
              <p className="font-mono text-[11px]">{quoteError}</p>
              {onRetryEstimate && writesEnabled && (
                <button
                  type="button"
                  onClick={() => onRetryEstimate()}
                  className="mt-1.5 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-error/15 text-on-error-container hover:bg-error/25 text-[11px] font-semibold transition-colors cursor-pointer"
                >
                  <span className="material-symbols-outlined text-xs">sync</span>
                  <span>Retry Fee Estimation</span>
                </button>
              )}
            </div>
          ) : quote ? (
            <div className="space-y-2 text-xs">
              {quote.breakdown && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 p-2.5 rounded-lg bg-surface-container/60 border border-outline-variant/20">
                  <div>
                    <span className="text-[10px] font-mono uppercase text-on-surface-variant block">Execution Budget:</span>
                    <span className="font-mono font-medium text-on-surface">{formatWeiAmount(quote.breakdown.executionBudget)}</span>
                  </div>
                  <div>
                    <span className="text-[10px] font-mono uppercase text-on-surface-variant block">Timeunit Fees:</span>
                    <span className="font-mono font-medium text-on-surface">{formatWeiAmount(quote.breakdown.timeUnitFees)}</span>
                  </div>
                  <div>
                    <span className="text-[10px] font-mono uppercase text-on-surface-variant block">Message Fees:</span>
                    <span className="font-mono font-medium text-on-surface">{formatWeiAmount(quote.breakdown.messageFees)}</span>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between pt-1 gap-2 border-t border-outline-variant/20">
                <div className="flex items-center gap-2">
                  <span className="text-on-surface-variant font-medium">Estimated Network Fee:</span>
                  <span className="font-mono font-semibold text-primary">{formatWeiAmount(quote.feeValue)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-primary font-bold">Quoted Network Total:</span>
                  <span className="font-mono font-bold text-primary">{formatWeiAmount(quote.total)}</span>
                </div>
              </div>

              <p className="text-[10px] text-on-surface-variant leading-relaxed italic">
                Fees quoted from live validator estimation. Unused validator execution budget is refundable upon transaction resolution.
              </p>
            </div>
          ) : (
            <div className="p-3 rounded-lg bg-surface-container/60 border border-outline-variant/20 text-xs text-on-surface-variant space-y-1">
              <span className="font-semibold text-primary block">Fee quote unavailable / not estimated</span>
              <p className="leading-relaxed text-[11px]">
                {WRITES_ENABLED
                  ? 'No live fee estimate was returned by kit.estimate. Verify network connectivity and wallet state to receive an updated quote before submission. No default amounts or network fees are fabricated.'
                  : 'No live fee estimate was returned by kit.estimate. While write operations are gated (WRITES_ENABLED = false), RPC fee estimation is not dispatched to avoid unnecessary network calls. No default amounts or network fees are fabricated.'}
              </p>
              {onRetryEstimate && writesEnabled && (
                <button
                  type="button"
                  onClick={() => onRetryEstimate()}
                  className="mt-1.5 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 text-primary hover:bg-primary/20 text-[11px] font-semibold transition-colors cursor-pointer"
                >
                  <span className="material-symbols-outlined text-xs">sync</span>
                  <span>Request Fee Quote</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Unresolved / In-Flight Duplicate Block Banner & Explicit Reconciliation Flow */}
        {isDuplicateBlocked && (
          <div className="p-4 sm:p-5 rounded-xl bg-amber-500/10 border-2 border-amber-500/40 space-y-4 text-xs animate-fade-in">
            <div className="flex items-center gap-2 text-amber-800 font-semibold text-sm">
              <span className="material-symbols-outlined text-base text-amber-600">lock_clock</span>
              <span>Unresolved Transaction Detected — Submission Blocked</span>
            </div>

            <p className="text-on-surface-variant leading-relaxed text-xs">
              {unresolvedMessage || 'A transaction for this action is already pending or unresolved on-chain. Resubmission is blocked to protect your funds and prevent duplicate transactions.'}
            </p>

            {txId ? (
              <div className="flex flex-wrap items-center justify-between p-2.5 rounded-lg bg-surface-container font-mono text-[11px] border border-outline-variant/30 gap-2">
                <span className="text-on-surface-variant">Saved Transaction ID:</span>
                <span className="text-primary truncate font-bold">{txId}</span>
                {explorerUrl && (
                  <a
                    href={explorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-secondary hover:underline shrink-0 flex items-center gap-1 font-sans text-xs font-semibold"
                  >
                    <span>Review on Explorer</span>
                    <span className="material-symbols-outlined text-xs">open_in_new</span>
                  </a>
                )}
              </div>
            ) : (
              <div className="p-2.5 rounded-lg bg-surface-container/80 text-[11px] text-amber-900 border border-amber-500/30 font-medium">
                <span>Ambiguous submission with no returned transaction ID. A network disruption or wallet disconnect occurred after submission was initiated. Reconcile manually before attempting a new transaction.</span>
              </div>
            )}

            {/* Explicit 4-Step User Reconciliation Flow */}
            <div className="p-4 rounded-xl bg-surface-container-low border border-outline-variant/30 space-y-3.5">
              <div className="flex items-center justify-between">
                <div className="font-semibold text-primary flex items-center gap-1.5 text-xs">
                  <span className="material-symbols-outlined text-sm text-secondary">fact_check</span>
                  <span>Explicit Reconciliation Flow</span>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-surface-container font-medium text-on-surface-variant">
                  Safety Protocol
                </span>
              </div>

              <div className="space-y-3 text-xs text-on-surface-variant">
                {/* Step 1: Wallet Activity */}
                <div className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                    1
                  </span>
                  <div className="space-y-0.5 flex-1">
                    <span className="font-semibold text-on-surface block">Check Wallet Activity</span>
                    <p className="text-[11px] leading-relaxed">
                      Open your wallet extension (e.g. MetaMask Activity tab) for address <code className="font-mono text-[10px] bg-surface-container px-1 rounded">{walletAddress || 'connected wallet'}</code>. Ensure no pending, queued, or unconfirmed transaction exists for this action.
                    </p>
                  </div>
                </div>

                {/* Step 2: Explorer Evidence */}
                <div className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                    2
                  </span>
                  <div className="space-y-0.5 flex-1">
                    <span className="font-semibold text-on-surface block">Verify Explorer Activity</span>
                    <p className="text-[11px] leading-relaxed">
                      Confirm no transaction was broadcast from your account on the GenLayer Studio Explorer.
                    </p>
                    {walletAddress && (
                      <a
                        href={`https://explorer-studio-dev.genlayer.com/address/${walletAddress}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] text-secondary hover:underline font-semibold mt-1"
                      >
                        <span>Check Wallet on GenLayer Explorer</span>
                        <span className="material-symbols-outlined text-xs">open_in_new</span>
                      </a>
                    )}
                  </div>
                </div>

                {/* Step 3: Fresh Contract Read */}
                <div className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                    3
                  </span>
                  <div className="space-y-2 flex-1">
                    <span className="font-semibold text-on-surface block">Check Fresh Contract State</span>
                    <p className="text-[11px] leading-relaxed">
                      Query <code>get_credit(wallet)</code> and <code>get_withdrawn(wallet)</code> directly from the live contract to verify current balances.
                    </p>
                    {onReconcileCheckContract && (
                      <button
                        type="button"
                        onClick={async () => {
                          setIsCheckingContract(true);
                          try {
                            const res = await onReconcileCheckContract();
                            setContractCheckResult(res);
                          } catch (e: any) {
                            setContractCheckResult({ creditWei: null, withdrawnWei: null, message: e?.message || 'Read failed' });
                          } finally {
                            setIsCheckingContract(false);
                          }
                        }}
                        disabled={isCheckingContract}
                        className="px-3 py-1.5 rounded-lg bg-surface-container text-primary text-xs font-semibold hover:bg-surface-container-high transition-colors flex items-center gap-1.5 border border-outline-variant/30 disabled:opacity-50 cursor-pointer"
                      >
                        <span className={`material-symbols-outlined text-xs ${isCheckingContract ? 'animate-spin' : ''}`}>
                          {isCheckingContract ? 'refresh' : 'sync'}
                        </span>
                        <span>{isCheckingContract ? 'Reading Contract State...' : 'Query Live Contract'}</span>
                      </button>
                    )}

                    {contractCheckResult && (
                      <div className="p-2.5 rounded-lg bg-surface-container text-[11px] space-y-1 border border-outline-variant/20 font-mono">
                        <div className="flex justify-between">
                          <span className="text-on-surface-variant">Live get_credit:</span>
                          <span className="text-primary font-bold">
                            {contractCheckResult.creditWei !== null ? formatWeiAmount(contractCheckResult.creditWei) : 'Unavailable'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-on-surface-variant">Live genWithdrawn:</span>
                          <span className="text-primary font-bold">
                            {contractCheckResult.withdrawnWei !== null ? formatWeiAmount(contractCheckResult.withdrawnWei) : 'Unavailable'}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Strict safety invariant note about unchanged credit */}
                    <div className="p-2.5 rounded-lg bg-amber-500/15 border border-amber-500/30 text-[11px] text-amber-900 space-y-1">
                      <div className="flex items-center gap-1.5 font-semibold">
                        <span className="material-symbols-outlined text-xs text-amber-700">shield</span>
                        <span>Safety Invariant</span>
                      </div>
                      <p className="leading-tight">
                        An unchanged credit balance alone (e.g. 10 GEN remaining) does <strong>not</strong> silently unlock a possibly pending transaction. If the transaction was successfully broadcast, it could still be processed by validators. You must confirm that your wallet activity shows no pending transaction.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Step 4: User Confirmation & Release */}
                <div className="flex items-start gap-2.5 pt-2 border-t border-outline-variant/20">
                  <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                    4
                  </span>
                  <div className="space-y-2 flex-1">
                    <span className="font-semibold text-on-surface block">Confirm & Release Lock</span>
                    <label className="flex items-start gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={walletActivityConfirmed}
                        onChange={(e) => setWalletActivityConfirmed(e.target.checked)}
                        className="mt-0.5 accent-primary"
                      />
                      <span className="text-[11px] text-on-surface leading-tight">
                        I have checked my wallet activity and the GenLayer explorer, and confirmed that no transaction is pending or queued for this action.
                      </span>
                    </label>

                    {onReconcileReleaseLock && (
                      <button
                        type="button"
                        onClick={async () => {
                          if (!walletActivityConfirmed) return;
                          if (Boolean(onReconcileCheckContract) && (!contractCheckResult || contractCheckResult.creditWei === null)) {
                            setReconcileError('A successful fresh contract read (Step 3) is required before releasing the lock.');
                            return;
                          }
                          setIsReconcilingRelease(true);
                          setReconcileError(null);
                          try {
                            await onReconcileReleaseLock();
                          } catch (e: any) {
                            setReconcileError(e?.message || 'Failed to release lock');
                          } finally {
                            setIsReconcilingRelease(false);
                          }
                        }}
                        disabled={
                          !walletActivityConfirmed ||
                          isReconcilingRelease ||
                          (Boolean(onReconcileCheckContract) && (!contractCheckResult || contractCheckResult.creditWei === null))
                        }
                        className="w-full sm:w-auto px-4 py-2 rounded-lg bg-secondary text-on-secondary text-xs font-semibold hover:bg-secondary/90 transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-xs">lock_open</span>
                        <span>{isReconcilingRelease ? 'Releasing Lock...' : 'Confirm Verification & Release Lock'}</span>
                      </button>
                    )}

                    {Boolean(onReconcileCheckContract) && (!contractCheckResult || contractCheckResult.creditWei === null) && (
                      <p className="text-[11px] text-amber-700 font-medium">
                        Complete Step 3 (Query Live Contract) first to verify live on-chain credit before releasing the lock.
                      </p>
                    )}

                    {reconcileError && (
                      <p className="text-[11px] text-error font-medium">{reconcileError}</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Transaction Tracking Status Section (if tx submitted / tracking) */}
        {txId && (
          <div className="p-4 rounded-xl bg-surface-container-high border border-primary/30 space-y-3 animate-fade-in">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-primary flex items-center gap-1.5">
                <span className="material-symbols-outlined text-sm text-secondary">satellite_alt</span>
                <span>On-Chain Transaction Tracking</span>
              </span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                isSuccess
                  ? 'bg-emerald-500/20 text-emerald-700'
                  : isFailed
                  ? 'bg-rose-500/20 text-rose-700'
                  : 'bg-primary/20 text-primary'
              }`}>
                {isFailed ? 'FINALIZED_FAILED' : (trackedStatus?.phase || 'submitted')}
              </span>
            </div>

            {isFailed && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg text-xs space-y-1">
                <div className="flex items-center gap-1.5 font-semibold text-rose-700">
                  <span className="material-symbols-outlined text-sm">error</span>
                  <span>Transaction Terminal Outcome: FINALIZED_FAILED</span>
                </div>
                <p className="text-on-surface-variant text-[11px] leading-relaxed">
                  The on-chain transaction completed consensus with an execution error. No state changes were committed and no escrow was deducted. This terminal failure record is preserved for auditability and will not be automatically resubmitted.
                </p>
              </div>
            )}

            <div className="space-y-1.5 text-xs font-mono">
              <div className="flex items-center justify-between">
                <span className="text-on-surface-variant">Tx ID:</span>
                <span className="text-primary truncate max-w-[200px] sm:max-w-none">{txId}</span>
              </div>
              {explorerUrl && (
                <div className="flex items-center justify-between">
                  <span className="text-on-surface-variant">Explorer:</span>
                  <a
                    href={explorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-secondary hover:underline flex items-center gap-1 text-[11px]"
                  >
                    <span>View on Studio Next Explorer</span>
                    <span className="material-symbols-outlined text-xs">open_in_new</span>
                  </a>
                </div>
              )}
              {trackedStatus?.executionResultName && (
                <div className="flex items-center justify-between pt-1 border-t border-outline-variant/20">
                  <span className="text-on-surface-variant">Execution Result:</span>
                  <span className={`font-bold ${isSuccess ? 'text-emerald-700' : isFailed ? 'text-rose-700' : 'text-primary'}`}>
                    {trackedStatus.executionResultName}
                  </span>
                </div>
              )}
            </div>

            {/* Withdraw Child-Transfer Confirmation Tracked Separately */}
            {actionType === 'withdraw' && (
              <div className="p-3 rounded-lg bg-surface-container border border-outline-variant/30 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono font-bold uppercase text-on-surface-variant block">
                    Child GEN Transfer Delivery:
                  </span>
                  {childTxId && (
                    <span className="font-mono text-[10px] text-outline truncate max-w-[180px]">
                      Child: {childTxId.slice(0, 10)}...{childTxId.slice(-6)}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`w-2.5 h-2.5 rounded-full ${
                    childTransferStatus === 'confirmed'
                      ? 'bg-emerald-500'
                      : childTransferStatus === 'pending'
                      ? 'bg-amber-500 animate-pulse'
                      : childTransferStatus === 'failed'
                      ? 'bg-rose-500'
                      : 'bg-amber-600'
                  }`} />
                  <span className="font-medium text-on-surface">
                    {childTransferStatus === 'confirmed'
                      ? 'Confirmed: Native GEN delivered to wallet'
                      : childTransferStatus === 'failed'
                      ? 'Failed: Child GEN transfer failed on-chain'
                      : childTransferStatus === 'pending'
                      ? 'Parent finalized; awaiting child transfer delivery'
                      : 'delivery unverified'}
                  </span>
                </div>
                {observedChildFields && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 p-2 rounded bg-surface-container-low font-mono text-[10px] text-on-surface-variant border border-outline-variant/20">
                    {observedChildFields.recipient && (
                      <div className="truncate"><span className="text-outline font-semibold">Recipient:</span> {observedChildFields.recipient}</div>
                    )}
                    {observedChildFields.from && (
                      <div className="truncate"><span className="text-outline font-semibold">Contract Sender:</span> {observedChildFields.from}</div>
                    )}
                    {observedChildFields.amountWei && (
                      <div><span className="text-outline font-semibold">Transfer Value:</span> {formatWeiAmount(BigInt(observedChildFields.amountWei))}</div>
                    )}
                    {observedChildFields.valueCredited !== null && observedChildFields.valueCredited !== undefined && (
                      <div><span className="text-outline font-semibold">Value Credited:</span> {String(observedChildFields.valueCredited)}</div>
                    )}
                    {observedChildFields.statusName && (
                      <div><span className="text-outline font-semibold">Status:</span> {observedChildFields.statusName}</div>
                    )}
                    {observedChildFields.executionResultName && (
                      <div><span className="text-outline font-semibold">Execution Result:</span> {observedChildFields.executionResultName}</div>
                    )}
                  </div>
                )}
                <p className="text-[10px] text-on-surface-variant leading-relaxed">
                  A successful parent withdraw execution updates internal contract credit ledgers but does not prove child GEN delivery. External delivery is confirmed only when the child transaction execution receipt is verified. If child evidence is unavailable, delivery remains unverified.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Network Safety Guarantee */}
        <div className="p-3.5 bg-secondary-fixed/30 rounded-xl text-xs text-secondary-fixed-variant flex items-start gap-2.5">
          <span className="material-symbols-outlined text-base text-secondary shrink-0 mt-0.5">shield</span>
          <div className="space-y-0.5">
            <span className="font-semibold text-secondary-fixed-dim block">
              {writesEnabled ? 'On-Chain Broadcast Active' : 'Zero Chain Writes Broadcasted'}
            </span>
            <p className="leading-relaxed">
              {writesEnabled
                ? 'Transaction Kit dispatch and wallet signing are enabled. Submitting will prompt your connected wallet to sign and broadcast the transaction to GenLayer Studio Next.'
                : 'This preview operates strictly offline. Transaction Kit dispatch and wallet signing are gated behind WRITES_ENABLED = false. No funds debited, no gas quoted, and no blockchain state mutated.'}
            </p>
          </div>
        </div>

        {/* Action Controls: Confirmation control kept disabled while WRITES_ENABLED=false */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-3 border-t border-outline-variant/20">
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 rounded-full bg-surface-container-high border border-outline-variant/40 text-[11px] font-mono font-bold text-on-surface-variant flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${writesEnabled ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
              <span>{writesEnabled ? 'WRITES_ENABLED = true' : 'WRITES_ENABLED = false'}</span>
            </span>
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="w-full sm:w-auto px-5 py-2.5 rounded-full bg-surface-container text-primary text-xs font-semibold hover:bg-surface-container-high transition-colors text-center cursor-pointer"
            >
              Back to Form Editing
            </button>

            <button
              type="button"
              id="confirm-submit-tx-btn"
              disabled={!writesEnabled || isSubmitting || isDuplicateBlocked || !quote}
              onClick={async () => {
                if (onConfirmSubmit && writesEnabled && quote && !isDuplicateBlocked) {
                  await onConfirmSubmit();
                }
              }}
              className={`w-full sm:w-auto px-6 py-2.5 rounded-full text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
                !writesEnabled || isDuplicateBlocked || !quote
                  ? 'bg-surface-container-high text-on-surface-variant/60 cursor-not-allowed border border-outline-variant/40'
                  : 'bg-primary text-on-primary hover:bg-primary-container shadow-sm cursor-pointer'
              }`}
              title={
                !writesEnabled
                  ? 'Writes disabled by protocol gate (WRITES_ENABLED=false)'
                  : isDuplicateBlocked
                  ? 'Transaction already in flight'
                  : !quote
                  ? 'Awaiting fee quote from network before submission'
                  : 'Confirm and submit transaction'
              }
            >
              <span className="material-symbols-outlined text-sm">
                {!writesEnabled ? 'lock' : 'send'}
              </span>
              <span>
                {!writesEnabled
                  ? 'Confirm & Submit (Writes Disabled)'
                  : isSubmitting
                  ? 'Submitting...'
                  : !quote
                  ? 'Awaiting Fee Quote...'
                  : 'Confirm & Submit'}
              </span>
            </button>

            <Link
              to="/challenges"
              className="w-full sm:w-auto px-5 py-2.5 rounded-full bg-surface-container-low text-on-surface-variant text-xs font-semibold hover:bg-surface-container transition-colors text-center border border-outline-variant/30"
            >
              Explore Active Briefs
            </Link>
          </div>
        </div>

      </div>
    </div>
  );
};
