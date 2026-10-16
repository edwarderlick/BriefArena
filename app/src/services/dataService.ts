import { Challenge, ChallengeStatus, Entry, Decision, MoneyState } from '../types';
import {
  SAMPLE_CHALLENGES,
  SAMPLE_ENTRIES,
  SAMPLE_DECISION_KANSO,
  SAMPLE_DECISION_CHRONOS_NO_WINNER,
  SAMPLE_MONEY_STATE,
} from '../data/fixtures';
import {
  CONTRACT_ADDRESS,
  isContractConfigured,
  RpcReadError,
  sanitizeUserFacingRpcError,
  getContractChallengeCount,
  getContractChallengeIdsPaginated,
  getContractChallenge,
  getContractEntries,
  getContractDecision,
  getContractCredit,
  getContractWithdrawn,
  getContractSponsoredChallengeIds,
  getContractEnteredChallengeIds,
} from './contractClient';

export interface MyArenaOverviewData {
  contractDataAvailable: boolean;
  reason: string;
  sponsored: Challenge[];
  entered: { challenge: Challenge; entry: Entry }[];
  moneyState: MoneyState | null;
}

export interface IDataService {
  getChallenges(filter?: ChallengeStatus | 'all'): Promise<Challenge[]>;
  getChallengeById(id: string): Promise<Challenge | null>;
  getEntriesForChallenge(challengeId: string): Promise<Entry[]>;
  getDecisionForChallenge(challengeId: string): Promise<Decision | null>;
  getMyArenaOverview(walletAddress?: string | null): Promise<MyArenaOverviewData>;
  getMyArenaPreviewData(): Promise<{
    sponsored: Challenge[];
    entered: { challenge: Challenge; entry: Entry }[];
    moneyState: MoneyState;
  }>;
}

class HybridDataService implements IDataService {
  async getChallenges(filter?: ChallengeStatus | 'all'): Promise<Challenge[]> {
    const addr = CONTRACT_ADDRESS;
    if (isContractConfigured() && addr) {
      try {
        const count = await getContractChallengeCount(addr);
        if (count === 0n) return [];

        const ids = await getContractChallengeIdsPaginated(addr, 0n, count);
        const challenges = await Promise.all(
          ids.map(id => getContractChallenge(addr, id))
        );
        const valid = challenges.filter((c): c is Challenge => c !== null);

        if (!filter || filter === 'all') return valid;
        return valid.filter(c => c.status === filter);
      } catch (err: any) {
        console.error('Failed reading challenges from Studio Next contract:', err);
        if (err instanceof RpcReadError) {
          throw err;
        }
        throw new RpcReadError(
          `Failed to read challenges from contract on Studio Next (${addr}): ${(err as Error)?.message || 'RPC Error'}`,
          err
        );
      }
    }

    // Honest preview state when no contract is configured
    await new Promise(resolve => setTimeout(resolve, 80));
    if (!filter || filter === 'all') {
      return [...SAMPLE_CHALLENGES];
    }
    return SAMPLE_CHALLENGES.filter(c => c.status === filter);
  }

  async getChallengeById(id: string): Promise<Challenge | null> {
    const addr = CONTRACT_ADDRESS;
    if (isContractConfigured() && addr) {
      // Check if id is numeric or BRIEF-XXX
      let numericId: bigint | null = null;
      if (/^\d+$/.test(id)) {
        numericId = BigInt(id);
      } else if (/^brief-(\d+)$/i.test(id)) {
        const match = id.match(/^brief-(\d+)$/i);
        if (match) numericId = BigInt(Number(match[1]));
      }

      if (numericId !== null) {
        const chal = await getContractChallenge(addr, numericId);
        if (chal) return chal;
      }
    }

    // Fallback to sample fixtures for design preview slugs
    await new Promise(resolve => setTimeout(resolve, 80));
    const challenge = SAMPLE_CHALLENGES.find(c => c.id === id);
    return challenge ? { ...challenge } : null;
  }

  async getEntriesForChallenge(challengeId: string): Promise<Entry[]> {
    const addr = CONTRACT_ADDRESS;
    if (isContractConfigured() && addr) {
      let numericId: bigint | null = null;
      if (/^\d+$/.test(challengeId)) {
        numericId = BigInt(challengeId);
      } else if (/^brief-(\d+)$/i.test(challengeId)) {
        const match = challengeId.match(/^brief-(\d+)$/i);
        if (match) numericId = BigInt(Number(match[1]));
      }

      if (numericId !== null) {
        return getContractEntries(addr, numericId);
      }
    }

    await new Promise(resolve => setTimeout(resolve, 80));
    const entries = SAMPLE_ENTRIES[challengeId] || [];
    return [...entries];
  }

  async getDecisionForChallenge(challengeId: string): Promise<Decision | null> {
    const addr = CONTRACT_ADDRESS;
    if (isContractConfigured() && addr) {
      let numericId: bigint | null = null;
      if (/^\d+$/.test(challengeId)) {
        numericId = BigInt(challengeId);
      } else if (/^brief-(\d+)$/i.test(challengeId)) {
        const match = challengeId.match(/^brief-(\d+)$/i);
        if (match) numericId = BigInt(Number(match[1]));
      }

      if (numericId !== null) {
        return getContractDecision(addr, numericId);
      }
    }

    await new Promise(resolve => setTimeout(resolve, 80));
    if (challengeId === 'kanso-notebooks') {
      return { ...SAMPLE_DECISION_KANSO };
    }
    if (challengeId === 'chronos-zero') {
      return { ...SAMPLE_DECISION_CHRONOS_NO_WINNER };
    }
    return null;
  }

  async getMyArenaOverview(walletAddress?: string | null): Promise<MyArenaOverviewData> {
    const addr = CONTRACT_ADDRESS;
    if (isContractConfigured() && addr) {
      if (!walletAddress) {
        return {
          contractDataAvailable: true,
          reason: 'Connect your wallet to read your personal sponsored challenges, entries, and internal claimable credits.',
          sponsored: [],
          entered: [],
          moneyState: null,
        };
      }

      try {
        const [sponsoredResult, enteredResult, creditResult, withdrawnResult] = await Promise.allSettled([
          getContractSponsoredChallengeIds(addr, walletAddress),
          getContractEnteredChallengeIds(addr, walletAddress),
          getContractCredit(addr, walletAddress),
          getContractWithdrawn(addr, walletAddress),
        ]);

        const sponsoredIds = sponsoredResult.status === 'fulfilled' ? sponsoredResult.value : [];
        const enteredIds = enteredResult.status === 'fulfilled' ? enteredResult.value : [];

        const sponsoredList = (
          await Promise.all(sponsoredIds.map(id => getContractChallenge(addr, id)))
        ).filter((c): c is Challenge => c !== null);

        const enteredList: { challenge: Challenge; entry: Entry }[] = [];
        for (const cId of enteredIds) {
          const chal = await getContractChallenge(addr, cId);
          if (chal) {
            const entries = await getContractEntries(addr, cId);
            const userEntry = entries.find(e => e.authorAddress.toLowerCase() === walletAddress.toLowerCase());
            if (userEntry) {
              enteredList.push({ challenge: chal, entry: userEntry });
            }
          }
        }

        // Calculate locked escrow across user's active sponsored briefs
        const lockedTotal = sponsoredList
          .filter(c => c.status === 'open' || c.status === 'closed' || c.status === 'judging')
          .reduce((acc, c) => acc + c.prizeAmount, 0);

        // Credit state
        let creditAvailable: number | null = null;
        let creditAvailableWei: bigint | undefined = undefined;
        let creditAvailableWeiStr: string | undefined = undefined;
        let creditReadError: string | null = null;

        if (creditResult.status === 'fulfilled') {
          creditAvailableWei = creditResult.value;
          creditAvailable = Number(creditAvailableWei) / 1e18;
          creditAvailableWeiStr = creditAvailableWei.toString();
        } else {
          creditReadError = sanitizeUserFacingRpcError(creditResult.reason).userMessage;
          console.warn('Failed reading credit from contract:', creditResult.reason);
        }

        // Withdrawn state
        let genWithdrawn: number | null = null;
        let genWithdrawnWei: bigint | undefined = undefined;
        let genWithdrawnWeiStr: string | undefined = undefined;
        let withdrawnReadError: string | null = null;

        if (withdrawnResult.status === 'fulfilled') {
          genWithdrawnWei = withdrawnResult.value;
          genWithdrawn = Number(genWithdrawnWei) / 1e18;
          genWithdrawnWeiStr = genWithdrawnWei.toString();
        } else {
          withdrawnReadError = sanitizeUserFacingRpcError(withdrawnResult.reason).userMessage;
          console.warn('Failed reading withdrawn amount from contract:', withdrawnResult.reason);
        }

        const allFailed =
          creditResult.status === 'rejected' &&
          withdrawnResult.status === 'rejected' &&
          sponsoredResult.status === 'rejected' &&
          enteredResult.status === 'rejected';

        if (allFailed) {
          const sanitized = sanitizeUserFacingRpcError(
            creditResult.reason || withdrawnResult.reason || (sponsoredResult as any).reason || (enteredResult as any).reason
          );
          return {
            contractDataAvailable: false,
            reason: sanitized.userMessage,
            sponsored: [],
            entered: [],
            moneyState: null,
          };
        }

        return {
          contractDataAvailable: true,
          reason: '',
          sponsored: sponsoredList,
          entered: enteredList,
          moneyState: {
            prizeLocked: lockedTotal,
            creditAvailable,
            creditAvailableWei,
            creditAvailableWeiStr,
            creditReadError,
            genWithdrawn,
            genWithdrawnWei,
            genWithdrawnWeiStr,
            withdrawnReadError,
          },
        };
      } catch (err) {
        const sanitized = sanitizeUserFacingRpcError(err);
        console.warn('Failed reading MyArena overview from contract:', sanitized.devDetails);
        return {
          contractDataAvailable: false,
          reason: sanitized.userMessage,
          sponsored: [],
          entered: [],
          moneyState: null,
        };
      }
    }

    // Honest preview state when no contract address is configured
    await new Promise(resolve => setTimeout(resolve, 80));
    return {
      contractDataAvailable: false,
      reason: 'No deployed smart contract configured (VITE_BRIEF_ARENA_CONTRACT_ADDRESS unset). Local fixture balances are not presented as live chain data.',
      sponsored: [],
      entered: [],
      moneyState: null,
    };
  }

  async getMyArenaPreviewData(): Promise<{
    sponsored: Challenge[];
    entered: { challenge: Challenge; entry: Entry }[];
    moneyState: MoneyState;
  }> {
    await new Promise(resolve => setTimeout(resolve, 80));
    const kanso = SAMPLE_CHALLENGES.find(c => c.id === 'kanso-notebooks')!;
    const forma = SAMPLE_CHALLENGES.find(c => c.id === 'forma-furniture')!;
    const aether = SAMPLE_CHALLENGES.find(c => c.id === 'aether-os')!;

    return {
      sponsored: [kanso, forma],
      entered: [
        {
          challenge: aether,
          entry: SAMPLE_ENTRIES['aether-os'][1],
        },
        {
          challenge: kanso,
          entry: SAMPLE_ENTRIES['kanso-notebooks'][1],
        },
      ],
      moneyState: SAMPLE_MONEY_STATE,
    };
  }
}

export const dataService = new HybridDataService();
