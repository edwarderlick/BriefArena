import { createClient, chains } from 'genlayer-js';
import { CalldataAddress } from 'genlayer-js/types';
import { hexToBytes } from 'viem';
import { Challenge, ChallengeStatus, Entry, Decision } from '../types';

export type Address = `0x${string}`;

export function toCalldataAddress(address: string): CalldataAddress {
  const clean = address.startsWith('0x') ? address : `0x${address}`;
  return new CalldataAddress(hexToBytes(clean as `0x${string}`));
}

// Optional contract address configured via environment variable
const RAW_CONTRACT_ADDRESS = (
  (import.meta.env.VITE_BRIEF_ARENA_CONTRACT_ADDRESS as string | undefined) ||
  (import.meta.env.VITE_CONTRACT_ADDRESS as string | undefined) ||
  ''
).trim();

export const CONTRACT_ADDRESS: Address | null =
  RAW_CONTRACT_ADDRESS && RAW_CONTRACT_ADDRESS.startsWith('0x')
    ? (RAW_CONTRACT_ADDRESS as Address)
    : null;

export const isContractConfigured = (): boolean => Boolean(CONTRACT_ADDRESS);

export function sanitizeUserFacingRpcError(rawErr: unknown): { userMessage: string; devDetails: string } {
  const errStr = typeof rawErr === 'string'
    ? rawErr
    : (rawErr as any)?.message || String(rawErr || '');

  const devDetails = errStr
    .replace(/(?:secret(?:_key)?|private_key|password|api_key|token)[=:\s]+[^\s,;&]+/gi, '[REDACTED_SECRET]')
    .replace(/0x[a-fA-F0-9]{64}/g, '[REDACTED_HASH]')
    .replace(/(?:SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|CREATE\s+TABLE)[\s\S]*?(?:;|\n|$)/gi, '[REDACTED_SQL_QUERY] ')
    .replace(/\[SQL:[\s\S]*?\]/gi, '[REDACTED_SQL_QUERY]')
    .trim();

  let userMessage = 'The Studio Next contract read is currently failing; retry or inspect the error.';
  if (/(503|502|500|Service Unavailable|Bad Gateway)/i.test(errStr)) {
    const codeMatch = errStr.match(/\b(503|502|500)\b/);
    const codeStr = codeMatch ? ` (HTTP ${codeMatch[1]})` : '';
    userMessage = `The Studio Next contract read is currently failing${codeStr}; retry or inspect the error.`;
  }

  return { userMessage, devDetails };
}

export class RpcReadError extends Error {
  readonly isRpcFailure = true;
  readonly cause?: unknown;
  readonly devDetails?: string;

  constructor(message: string, cause?: unknown) {
    const sanitized = sanitizeUserFacingRpcError(cause || message);
    super(sanitized.userMessage);
    this.name = 'RpcReadError';
    this.devDetails = sanitized.devDetails;
    this.cause = cause;
  }
}

/**
 * Read-only GenLayer client instance pinned to Studio Next (Chain 61997).
 * Preserves all official SDK consensus metadata while configuring the requested
 * https://studio-next.genlayer.com/api endpoint.
 * Strictly read-only: no signer, keys, or write capabilities are attached.
 */
export const studioNextChain = {
  ...chains.studioDevnet,
  rpcUrls: {
    ...chains.studioDevnet.rpcUrls,
    default: { http: ['https://studio-next.genlayer.com/api'] },
  },
};

export const readOnlyClient = createClient({
  chain: studioNextChain,
});

function mapChallengeStatus(statusNum: number | bigint): ChallengeStatus {
  switch (Number(statusNum)) {
    case 0: return 'open';
    case 1: return 'closed';
    case 2: return 'judging';
    case 3: return 'awarded';
    case 4: return 'no-winner';
    case 5: return 'canceled';
    default: return 'open';
  }
}

function mapEntryStatus(statusNum: number | bigint): 'pending' | 'qualifying' | 'non-qualifying' | 'disqualified' | 'winner' {
  switch (Number(statusNum)) {
    case 0: return 'pending';
    case 1: return 'qualifying';
    case 2: return 'non-qualifying';
    case 3: return 'disqualified';
    case 4: return 'winner';
    default: return 'pending';
  }
}

function formatDeadline(
  timestampSec: number | bigint | undefined | null,
  status?: ChallengeStatus
): { display: string; iso: string; remaining: string } {
  if (status === 'canceled') {
    return {
      display: 'Cancelled',
      iso: '',
      remaining: 'Cancelled (Prize Refunded to Sponsor)',
    };
  }
  if (status === 'awarded') {
    return {
      display: 'Settled',
      iso: '',
      remaining: 'Settled (Winner Awarded)',
    };
  }
  if (status === 'no-winner') {
    return {
      display: 'Settled',
      iso: '',
      remaining: 'Settled (No Winner — Refunded)',
    };
  }
  if (status === 'closed') {
    return {
      display: 'Submissions Closed',
      iso: '',
      remaining: 'Submission Window Closed',
    };
  }
  if (status === 'judging') {
    return {
      display: 'In Deliberation',
      iso: '',
      remaining: 'In Consensus Deliberation',
    };
  }

  if (timestampSec === undefined || timestampSec === null) {
    return {
      display: 'Unset',
      iso: '',
      remaining: 'Unverified deadline',
    };
  }
  const sec = Number(timestampSec);
  if (!Number.isFinite(sec)) {
    return {
      display: 'Malformed',
      iso: '',
      remaining: 'Unverified deadline',
    };
  }
  const date = new Date(sec * 1000);
  const now = Date.now();
  const diffMs = date.getTime() - now;

  let remaining: string;
  if (diffMs <= 0) {
    remaining = 'Deadline passed (local clock estimate)';
  } else {
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);
    if (days > 0) {
      remaining = `${days}d ${hours % 24}h remaining (local estimate)`;
    } else {
      const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      remaining = `${hours}h ${mins}m remaining (local estimate)`;
    }
  }

  return {
    display: date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }),
    iso: date.toISOString(),
    remaining,
  };
}

// =========================================================================
// Real Reads Mapped Exclusively to Implemented Contract View Getters
// =========================================================================

export async function getContractChallengeCount(contractAddress: Address): Promise<bigint> {
  try {
    const count: any = await readOnlyClient.readContract({
      address: contractAddress,
      functionName: 'get_challenge_count',
      args: [],
    });
    return BigInt(count || 0);
  } catch (err: any) {
    if (err instanceof RpcReadError) throw err;
    throw new RpcReadError(`RPC failure reading challenge count: ${err?.message || err}`, err);
  }
}

export async function getContractChallengeIdsPaginated(
  contractAddress: Address,
  offset: bigint,
  limit: bigint
): Promise<bigint[]> {
  try {
    const ids: any = await readOnlyClient.readContract({
      address: contractAddress,
      functionName: 'get_challenge_ids_paginated',
      args: [offset, limit],
    });
    if (!Array.isArray(ids)) return [];
    return ids.map((x: any) => BigInt(x));
  } catch (err: any) {
    if (err instanceof RpcReadError) throw err;
    throw new RpcReadError(`RPC failure reading challenge IDs paginated: ${err?.message || err}`, err);
  }
}

export function mapRawContractChallenge(
  raw: any,
  challengeId: bigint,
  contractAddress?: string,
): Challenge {
  const mappedStatus = mapChallengeStatus(raw.status);
  const { display, iso, remaining } = formatDeadline(raw.deadline, mappedStatus);

  const deadlineNum = raw.deadline !== undefined && raw.deadline !== null ? Number(raw.deadline) : undefined;
  const judgingNum = raw.judgingStartedAt !== undefined && raw.judgingStartedAt !== null ? Number(raw.judgingStartedAt) : undefined;
  const createdNum = raw.createdAt !== undefined && raw.createdAt !== null ? Number(raw.createdAt) : undefined;

  return {
    id: challengeId.toString(),
    code: raw.code || `#BRIEF-${challengeId.toString().padStart(3, '0')}`,
    title: String(raw.title || ''),
    category: String(raw.category || ''),
    synopsis: String(raw.synopsis || ''),
    mandatoryRequirements: Array.from(raw.mandatoryRequirements || []).map(String),
    prohibitedTerms: Array.from(raw.prohibitedTerms || []).map(String),
    prizeAmount: Number(BigInt(raw.prizeAmount || 0)) / 1e18,
    prizeCurrency: 'test GEN',
    sponsorAddress: String(raw.sponsorAddress || ''),
    deadlineDisplay: display,
    deadlineIso: iso,
    status: mappedStatus,
    maxSlots: 3,
    filledSlots: Number(raw.filledSlots || 0),
    remainingTime: remaining,
    isFixture: false,
    contractAddress,
    deadlineTimestamp: deadlineNum !== undefined && Number.isFinite(deadlineNum) ? deadlineNum : undefined,
    judgingStartedAtTimestamp: judgingNum !== undefined && Number.isFinite(judgingNum) ? judgingNum : undefined,
    createdAtTimestamp: createdNum !== undefined && Number.isFinite(createdNum) ? createdNum : undefined,
  };
}

export async function getContractChallenge(
  contractAddress: Address,
  challengeId: bigint
): Promise<Challenge | null> {
  try {
    const raw: any = await readOnlyClient.readContract({
      address: contractAddress,
      functionName: 'get_challenge',
      args: [challengeId],
    });
    if (!raw) return null;
    return mapRawContractChallenge(raw, challengeId, contractAddress);
  } catch (err: any) {
    const errStr = `${err?.message || ''} ${err?.details || ''} ${err?.shortMessage || ''} ${err?.data || ''}`;
    if (errStr.includes('CHALLENGE_NOT_FOUND')) {
      return null;
    }
    throw new RpcReadError(`RPC failure reading challenge #${challengeId.toString()}: ${err?.message || err}`, err);
  }
}

export async function getContractEntries(
  contractAddress: Address,
  challengeId: bigint
): Promise<Entry[]> {
  try {
    const rawList: any = await readOnlyClient.readContract({
      address: contractAddress,
      functionName: 'get_entries',
      args: [challengeId],
    });
    if (!Array.isArray(rawList)) return [];

    return rawList.map((e: any, idx: number) => {
      const submittedDate = new Date(Number(e.submittedAt || 0) * 1000);
      return {
        id: `${challengeId.toString()}-${e.entryNumber ?? idx + 1}`,
        challengeId: challengeId.toString(),
        entryNumber: Number(e.entryNumber ?? idx + 1),
        authorAddress: String(e.authorAddress || ''),
        submittedAtDisplay: submittedDate.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }),
        tagline: String(e.tagline || ''),
        paragraph: String(e.paragraph || ''),
        status: mapEntryStatus(e.status),
        defectReason: e.defectReason ? String(e.defectReason) : undefined,
        isFixture: false,
      };
    });
  } catch (err: any) {
    const errStr = `${err?.message || ''} ${err?.details || ''} ${err?.shortMessage || ''} ${err?.data || ''}`;
    if (errStr.includes('CHALLENGE_NOT_FOUND')) {
      return [];
    }
    throw new RpcReadError(`RPC failure reading entries for challenge #${challengeId.toString()}: ${err?.message || err}`, err);
  }
}

export async function getContractDecision(
  contractAddress: Address,
  challengeId: bigint
): Promise<Decision | null> {
  let raw: any;
  try {
    raw = await readOnlyClient.readContract({
      address: contractAddress,
      functionName: 'get_decision',
      args: [challengeId],
    });
  } catch (err: any) {
    const errStr = `${err?.message || ''} ${err?.details || ''} ${err?.shortMessage || ''} ${err?.data || ''}`;
    if (errStr.includes('DECISION_NOT_FOUND')) {
      return null;
    }
    throw new RpcReadError(`RPC failure reading decision for challenge #${challengeId.toString()}: ${err?.message || err}`, err);
  }

  if (!raw) return null;

  const settledDate = new Date(Number(raw.settledAt || 0) * 1000);
  const transparencyLog = Array.isArray(raw.transparencyLog)
    ? raw.transparencyLog.map((item: any) => ({
        entryNumber: Number(item.entryNumber),
        authorAddress: String(item.authorAddress || ''),
        tagline: String(item.tagline || ''),
        status: mapEntryStatus(item.status) as 'qualifying' | 'non-qualifying' | 'disqualified' | 'winner',
        defectReason: item.defectReason ? String(item.defectReason) : undefined,
      }))
    : [];

  return {
    id: `decision-${challengeId.toString()}`,
    challengeId: challengeId.toString(),
    outcome: raw.outcome === 'winner' ? 'winner' : 'no-winner',
    winningEntryNumber: raw.winningEntryNumber ? Number(raw.winningEntryNumber) : undefined,
    winningEntryId: raw.winningEntryNumber ? `${challengeId.toString()}-${raw.winningEntryNumber}` : undefined,
    winnerAddress: raw.winnerAddress ? String(raw.winnerAddress) : undefined,
    winningTagline: raw.winningTagline ? String(raw.winningTagline) : undefined,
    winningParagraph: raw.winningParagraph ? String(raw.winningParagraph) : undefined,
    boundedReason: raw.boundedReason ? String(raw.boundedReason) : 'Evaluated under frozen specification constraints.',
    transparencyLog,
    // Explicit unknown/needs-account-read state: a decision alone does not prove withdrawal
    settlementState: 'credit_allocated_unverified',
    settledAtDisplay: settledDate.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }),
    isFixture: false,
  };
}

export async function getContractCredit(contractAddress: Address, user: string): Promise<bigint> {
  const credit: any = await readOnlyClient.readContract({
    address: contractAddress,
    functionName: 'get_credit',
    args: [toCalldataAddress(user)],
  });
  return BigInt(credit || 0);
}

export async function getContractWithdrawn(contractAddress: Address, user: string): Promise<bigint> {
  const withdrawn: any = await readOnlyClient.readContract({
    address: contractAddress,
    functionName: 'get_withdrawn',
    args: [toCalldataAddress(user)],
  });
  return BigInt(withdrawn || 0);
}

export async function getContractTotalLockedEscrow(contractAddress: Address): Promise<bigint> {
  const escrow: any = await readOnlyClient.readContract({
    address: contractAddress,
    functionName: 'get_total_locked_escrow',
    args: [],
  });
  return BigInt(escrow || 0);
}

export async function getContractTotalClaimableCredits(contractAddress: Address): Promise<bigint> {
  const credits: any = await readOnlyClient.readContract({
    address: contractAddress,
    functionName: 'get_total_claimable_credits',
    args: [],
  });
  return BigInt(credits || 0);
}

export async function getContractSponsoredChallengeIds(
  contractAddress: Address,
  sponsor: string,
  offset: bigint = 0n,
  limit: bigint = 1000n
): Promise<bigint[]> {
  const ids: any = await readOnlyClient.readContract({
    address: contractAddress,
    functionName: 'get_sponsored_challenge_ids_paginated',
    args: [toCalldataAddress(sponsor), offset, limit],
  });
  if (!Array.isArray(ids)) return [];
  return ids.map((x: any) => BigInt(x));
}

export async function getContractEnteredChallengeIds(
  contractAddress: Address,
  author: string,
  offset: bigint = 0n,
  limit: bigint = 1000n
): Promise<bigint[]> {
  const ids: any = await readOnlyClient.readContract({
    address: contractAddress,
    functionName: 'get_entered_challenge_ids_paginated',
    args: [toCalldataAddress(author), offset, limit],
  });
  if (!Array.isArray(ids)) return [];
  return ids.map((x: any) => BigInt(x));
}

export async function hasContractUserEntered(
  contractAddress: Address,
  challengeId: bigint,
  author: string
): Promise<boolean> {
  const entered: any = await readOnlyClient.readContract({
    address: contractAddress,
    functionName: 'has_user_entered',
    args: [challengeId, toCalldataAddress(author)],
  });
  return Boolean(entered);
}
