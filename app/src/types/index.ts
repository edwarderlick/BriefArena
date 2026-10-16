export type ChallengeStatus = 
  | 'open' 
  | 'closed' 
  | 'judging' 
  | 'awarded' 
  | 'no-winner' 
  | 'canceled';

export interface Challenge {
  id: string;
  code: string; // e.g. "#GEN-042" or "#BRIEF-091"
  title: string;
  category: string;
  synopsis: string;
  mandatoryRequirements: string[];
  prohibitedTerms: string[];
  prizeAmount: number;
  prizeCurrency: 'test GEN';
  sponsorAddress: string;
  deadlineDisplay: string;
  deadlineIso: string;
  status: ChallengeStatus;
  maxSlots: number; // strictly 3 per product rules
  filledSlots: number;
  remainingTime: string;
  isFixture: boolean; // explicitly labeled as design preview fixture
  contractAddress?: string; // only for reference display
  deadlineTimestamp?: number; // precise on-chain deadline timestamp in seconds
  judgingStartedAtTimestamp?: number; // precise on-chain judgingStartedAt timestamp in seconds (0 if not started)
  createdAtTimestamp?: number; // precise on-chain createdAt timestamp in seconds
}

export interface Entry {
  id: string;
  challengeId: string;
  entryNumber: number; // 1, 2, or 3
  authorAddress: string;
  submittedAtDisplay: string;
  tagline: string;
  paragraph: string;
  status: 'pending' | 'qualifying' | 'non-qualifying' | 'disqualified' | 'winner';
  defectReason?: string;
  isFixture: boolean;
}

export interface Decision {
  id: string;
  challengeId: string;
  outcome: 'winner' | 'no-winner';
  winningEntryNumber?: number;
  winningEntryId?: string;
  winnerAddress?: string;
  winningTagline?: string;
  winningParagraph?: string;
  boundedReason: string;
  transparencyLog: {
    entryNumber: number;
    authorAddress: string;
    tagline: string;
    paragraph?: string;
    status: 'qualifying' | 'non-qualifying' | 'disqualified' | 'winner';
    defectReason?: string;
  }[];
  settlementState:
    | 'prize_locked'
    | 'credit_available'
    | 'gen_withdrawn'
    | 'credit_allocated_unverified'
    | 'unknown_needs_account_read';
  settledAtDisplay: string;
  isFixture: boolean;
}

export interface MoneyState {
  prizeLocked: number;          // Locked in escrow for ongoing/judging challenges
  creditAvailable: number | null;// Display formatted representation of credit in GEN (null if read error)
  creditAvailableWei?: bigint;   // Exact wei balance directly from contract get_credit()
  creditAvailableWeiStr?: string;// Decimal string representation of creditAvailableWei
  creditReadError?: string | null;// Explicit read error message if get_credit() failed
  genWithdrawn: number | null;   // Display formatted cumulative GEN dispatched/requested (null if read error)
  genWithdrawnWei?: bigint;      // Exact wei from get_withdrawn()
  genWithdrawnWeiStr?: string;   // Decimal string representation of genWithdrawnWei
  withdrawnReadError?: string | null;
}

export type SubmissionStatus = 
  | 'draft' 
  | 'validating' 
  | 'ready' 
  | 'contract_pending';

export interface WalletState {
  isConnected: boolean;
  address: string | null;
  chainId: number | null;
  isCorrectNetwork: boolean; // Studio Next Chain 61997
  balance: string | null;
  isConnecting: boolean;
  error: string | null;
}

export const NETWORK_CONFIG = {
  chainId: 61997,
  chainIdHex: '0xF22D',
  chainName: 'GenLayer Studio Next',
  rpcUrl: 'https://studio-next.genlayer.com/api',
  currencySymbol: 'GEN',
  explorerUrl: 'https://explorer-studio-dev.genlayer.com/',
};
