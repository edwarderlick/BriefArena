import { Challenge, Entry, Decision, MoneyState } from '../types';

export const SAMPLE_CHALLENGES: Challenge[] = [
  {
    id: 'aether-os',
    code: '#GEN-042',
    title: 'Aether OS — Micro-kernel for Spatial Computing',
    category: 'Spatial Computing',
    synopsis: 'Aether OS represents an architectural departure from monolithic spatial runtimes. Engineered as a deterministic, capability-based micro-kernel, Aether executes low-latency volumetric computing directly on spatial hardware silicon. By decoupling spatial windowing from user-space telemetry pipelines, it delivers instantaneous optical coherence, uncompromised real-time frame synthesis, and absolute architectural silence for high-stakes spatial environments.',
    mandatoryRequirements: [
      'Deterministic sub-millisecond task switching',
      'Zero telemetry and hardware-enforced privacy guarantees',
      'Direct spatial silicon capability isolation'
    ],
    prohibitedTerms: [
      'web3',
      'blockchain',
      'revolutionary',
      'ai-driven',
      'paradigm shift'
    ],
    prizeAmount: 300,
    prizeCurrency: 'test GEN',
    sponsorAddress: '0x94f2...3a81',
    deadlineDisplay: 'Open for 18 hours',
    deadlineIso: '2026-10-14T18:00:00Z',
    status: 'open',
    maxSlots: 3,
    filledSlots: 2,
    remainingTime: '18h 42m remaining',
    isFixture: true,
  },
  {
    id: 'lumina-type',
    code: '#BRIEF-092',
    title: 'Lumina Type Foundry — Revival of Gill Sans Serif',
    category: 'Typography & Editorial',
    synopsis: 'Position the newly digitalized grotesque typeface for editorial publishers. Strictly avoid claims of "AI-powered typography". Focus on optical kerning and human craft across 16 archival display weights.',
    mandatoryRequirements: [
      'Optical kerning craftsmanship',
      'Archival historical grounding',
      'High-contrast editorial publishing focus'
    ],
    prohibitedTerms: [
      'ai-powered',
      'automated font',
      'game-changer',
      'disruption'
    ],
    prizeAmount: 180,
    prizeCurrency: 'test GEN',
    sponsorAddress: '0x38b1...814e',
    deadlineDisplay: 'Open for 36 hours',
    deadlineIso: '2026-10-15T12:00:00Z',
    status: 'open',
    maxSlots: 3,
    filledSlots: 1,
    remainingTime: '36h remaining',
    isFixture: true,
  },
  {
    id: 'sylvan-audio',
    code: '#BRIEF-090',
    title: 'Sylvan Audio — Acoustic Spatial Headphone Identity',
    category: 'Industrial Acoustic Design',
    synopsis: 'Draft the product manifesto for open-back planar headphones turned from sustainable walnut and titanium. Convey organic sonic warmth and repairability without audiophile mysticism.',
    mandatoryRequirements: [
      'Acoustic planar driver precision',
      'Sustainably harvested walnut enclosure',
      'Modular user-repairable topology'
    ],
    prohibitedTerms: [
      'audiophile magic',
      'unmatched perfection',
      'miracle audio',
      'blockchain'
    ],
    prizeAmount: 220,
    prizeCurrency: 'test GEN',
    sponsorAddress: '0x49c2...77fa',
    deadlineDisplay: 'Submissions closed',
    deadlineIso: '2026-10-12T12:00:00Z',
    status: 'closed',
    maxSlots: 3,
    filledSlots: 3,
    remainingTime: 'Closed for entries',
    isFixture: true,
  },
  {
    id: 'forma-furniture',
    code: '#BRIEF-087',
    title: 'Forma Furniture — Modular Hardwood System',
    category: 'Sustainable Architecture',
    synopsis: 'Position a joinery-based solid oak shelving unit with zero mechanical fasteners or petroleum glues. Emphasize multi-generational repair and disassembly.',
    mandatoryRequirements: [
      'Friction-fit traditional joinery',
      'Certified zero petroleum additives',
      'Circular refurbishment guarantee'
    ],
    prohibitedTerms: [
      'lifestyle disruption',
      'eco-luxury',
      'flawless'
    ],
    prizeAmount: 160,
    prizeCurrency: 'test GEN',
    sponsorAddress: '0x811a...3c99',
    deadlineDisplay: 'Deliberation underway',
    deadlineIso: '2026-10-11T20:00:00Z',
    status: 'judging',
    maxSlots: 3,
    filledSlots: 3,
    remainingTime: 'In consensus evaluation',
    isFixture: true,
  },
  {
    id: 'kanso-notebooks',
    code: '#BRIEF-088',
    title: 'Kanso Notebooks: Identity & Bindery Design',
    category: 'Archival Publishing & Paper',
    synopsis: 'Articulate the tactile ethos of unbleached 120gsm bamboo fiber paper bound into a minimalist lay-flat journal for fountain pen permanence.',
    mandatoryRequirements: [
      '120gsm unbleached bamboo fiber specification',
      'Zero fountain pen ink feathering or bleed',
      'Archival lay-flat thread binding'
    ],
    prohibitedTerms: [
      'ultimate',
      'revolutionary',
      'perfection',
      'game-changer'
    ],
    prizeAmount: 120,
    prizeCurrency: 'test GEN',
    sponsorAddress: '0x15a9...44bf',
    deadlineDisplay: 'Consensus concluded',
    deadlineIso: '2026-10-09T18:00:00Z',
    status: 'awarded',
    maxSlots: 3,
    filledSlots: 3,
    remainingTime: 'Settled',
    isFixture: true,
  },
  {
    id: 'chronos-zero',
    code: '#BRIEF-085',
    title: 'Chronos Zero: Architectural Launch Narrative',
    category: 'Industrial Design Prose',
    synopsis: 'Chronos Zero is a titanium mechanical timepiece without hour indices or telemetry. It communicates temporal weight through single monophonic chimes.',
    mandatoryRequirements: [
      'Anti-accelerationist quietude',
      'Aeronautical titanium tactile grain',
      'Absence of urgent productivity metrics'
    ],
    prohibitedTerms: [
      'luxury status',
      'disruptive',
      'crypto',
      'hustle'
    ],
    prizeAmount: 100,
    prizeCurrency: 'test GEN',
    sponsorAddress: '0x77c2...5109',
    deadlineDisplay: 'Closed without winner',
    deadlineIso: '2026-10-05T12:00:00Z',
    status: 'no-winner',
    maxSlots: 3,
    filledSlots: 2,
    remainingTime: 'Ended with No Winner (Refund Credit Available)',
    isFixture: true,
  }
];

export const SAMPLE_ENTRIES: Record<string, Entry[]> = {
  'aether-os': [
    {
      id: 'entry-aether-1',
      challengeId: 'aether-os',
      entryNumber: 1,
      authorAddress: '0x31a8...94f1',
      submittedAtDisplay: '6 hrs ago',
      tagline: 'Instantaneous reality. Absolute architectural silence.',
      paragraph: 'Aether OS isolates spatial silicon matrices directly in hardware ring buffers, enabling deterministic sub-millisecond task switching without bloated telemetry. The operating environment enforces zero tracking across volumetric panes, allowing uninterrupted creative immersion.',
      status: 'qualifying',
      isFixture: true,
    },
    {
      id: 'entry-aether-2',
      challengeId: 'aether-os',
      entryNumber: 2,
      authorAddress: '0x71C4...4b92',
      submittedAtDisplay: '2 hrs ago',
      tagline: 'Spatial execution without telemetry: pure, deterministic silicon.',
      paragraph: 'Engineered for direct spatial silicon isolation, Aether OS guarantees sub-millisecond task switching at native frequencies. Telemetry pipelines are architecturally prohibited, ensuring complete user privacy and optical fidelity in high-stakes environments.',
      status: 'qualifying',
      isFixture: true,
    }
  ],
  'kanso-notebooks': [
    {
      id: 'entry-kanso-1',
      challengeId: 'kanso-notebooks',
      entryNumber: 1,
      authorAddress: '0x12c4...88ab',
      submittedAtDisplay: 'Sample archive',
      tagline: 'Your thoughts on paper that breathes.',
      paragraph: 'Kanso journals are made with sustainable fibers for fountain pen lovers who care about clarity and touch.',
      status: 'non-qualifying',
      defectReason: 'Omitted mandatory 120gsm bamboo fiber specification in submission copy.',
      isFixture: true,
    },
    {
      id: 'entry-kanso-2',
      challengeId: 'kanso-notebooks',
      entryNumber: 2,
      authorAddress: '0x48a1...e91d',
      submittedAtDisplay: 'Sample archive',
      tagline: 'Ink belongs on bamboo. Thoughts belong in permanence.',
      paragraph: 'Crafted with unbleached 120gsm bamboo fiber, Kanso absorbs fountain pen pigment without bleed-through or feathering. Engineered lay-flat binding creates an uninterrupted field for lifelong thought.',
      status: 'winner',
      isFixture: true,
    },
    {
      id: 'entry-kanso-3',
      challengeId: 'kanso-notebooks',
      entryNumber: 3,
      authorAddress: '0x77fe...21c9',
      submittedAtDisplay: 'Sample archive',
      tagline: 'The ultimate notebook for revolutionary thinkers.',
      paragraph: 'Kanso redefines note taking with unmatched precision bamboo engineering for revolutionary minds everywhere.',
      status: 'disqualified',
      defectReason: 'Contained prohibited terms "revolutionary" and "ultimate", violating rubric constraints.',
      isFixture: true,
    }
  ],
  'chronos-zero': [
    {
      id: 'entry-chronos-1',
      challengeId: 'chronos-zero',
      entryNumber: 1,
      authorAddress: '0x91b2...44f0',
      submittedAtDisplay: 'Sample archive',
      tagline: 'Disruptive temporal titanium for next-gen productivity.',
      paragraph: 'Chronos Zero disrupts traditional mechanical watchmaking with titanium tactile grain and real-time efficiency metrics.',
      status: 'disqualified',
      defectReason: 'Contained prohibited term "disruptive" and contradicted requirement by mentioning productivity metrics.',
      isFixture: true,
    },
    {
      id: 'entry-chronos-2',
      challengeId: 'chronos-zero',
      entryNumber: 2,
      authorAddress: '0x53d1...881a',
      submittedAtDisplay: 'Sample archive',
      tagline: 'Titanium chiming for the focused mind.',
      paragraph: 'Machined from aeronautical titanium, the timepiece chimes monophonically every hour without visual distractions.',
      status: 'non-qualifying',
      defectReason: 'Omitted mandatory anchor concept "Anti-accelerationist quietude" from launch paragraph copy.',
      isFixture: true,
    }
  ]
};

export const SAMPLE_DECISION_KANSO: Decision = {
  id: 'dec-kanso-088',
  challengeId: 'kanso-notebooks',
  outcome: 'winner',
  winningEntryNumber: 2,
  winningEntryId: 'entry-kanso-2',
  winnerAddress: '0x48a1...e91d',
  winningTagline: 'Ink belongs on bamboo. Thoughts belong in permanence.',
  winningParagraph: 'Crafted with unbleached 120gsm bamboo fiber, Kanso absorbs fountain pen pigment without bleed-through or feathering. Engineered lay-flat binding creates an uninterrupted field for lifelong thought.',
  boundedReason: 'GenLayer validators determined Entry #02 best satisfied the brief. It directly highlighted the 120gsm bamboo fiber specification, followed all paper bleed constraints, and strictly observed the prohibited claims list by omitting marketing superlatives.',
  transparencyLog: [
    {
      entryNumber: 1,
      authorAddress: '0x12c4...88ab',
      tagline: 'Your thoughts on paper that breathes.',
      status: 'non-qualifying',
      defectReason: 'Omitted mandatory specific paper grammage requirement (120gsm specification entirely missing from submission copy).'
    },
    {
      entryNumber: 2,
      authorAddress: '0x48a1...e91d',
      tagline: 'Ink belongs on bamboo. Thoughts belong in permanence.',
      status: 'qualifying'
    },
    {
      entryNumber: 3,
      authorAddress: '0x77fe...21c9',
      tagline: 'The ultimate notebook for revolutionary thinkers.',
      status: 'disqualified',
      defectReason: 'Contained prohibited term "revolutionary" and superlative "ultimate" expressly forbidden in section 4.1 of the frozen brief.'
    }
  ],
  settlementState: 'credit_available',
  settledAtDisplay: 'Sample archival verdict',
  isFixture: true,
};

export const SAMPLE_DECISION_CHRONOS_NO_WINNER: Decision = {
  id: 'dec-chronos-085',
  challengeId: 'chronos-zero',
  outcome: 'no-winner',
  boundedReason: 'Consensus evaluation concluded with no eligible winner. All submitted entries failed mandatory requirement adherence or contained prohibited lexicon tokens. Under protocol rules, no winner address or prize credit is assigned, and the 100 test GEN escrow is allocated for sponsor refund.',
  transparencyLog: [
    {
      entryNumber: 1,
      authorAddress: '0x91b2...44f0',
      tagline: 'Disruptive temporal titanium for next-gen productivity.',
      status: 'disqualified',
      defectReason: 'Contained prohibited term "disruptive" expressly forbidden in section 4.1 of the frozen brief.'
    },
    {
      entryNumber: 2,
      authorAddress: '0x53d1...881a',
      tagline: 'Titanium chiming for the focused mind.',
      status: 'non-qualifying',
      defectReason: 'Omitted mandatory anchor concept "Anti-accelerationist quietude" from submission copy.'
    }
  ],
  settlementState: 'credit_available',
  settledAtDisplay: 'Sample archival verdict',
  isFixture: true,
};

export const SAMPLE_MONEY_STATE: MoneyState = {
  prizeLocked: 300,       // 300 test GEN locked in ongoing Aether OS challenge
  creditAvailable: 120,   // 120 test GEN credited from winning Kanso Notebooks
  creditAvailableWei: 120n * 10n ** 18n,
  creditAvailableWeiStr: (120n * 10n ** 18n).toString(),
  genWithdrawn: 0,        // 0 test GEN dispatched/requested to date
  genWithdrawnWei: 0n,
  genWithdrawnWeiStr: '0',
};
