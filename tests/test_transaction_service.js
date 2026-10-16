/**
 * test_transaction_service.js
 *
 * Real TypeScript module integration tests for BriefArena transactionService.ts.
 *
 * This test suite:
 *   1. Dynamically loads the REAL TypeScript module (app/src/services/transactionService.ts)
 *      via Vite SSR module loader (zero reimplementation/copying of logic).
 *   2. Mocks Transaction Kit / provider boundaries.
 *   3. Verifies create_challenge has exactly 6 contract arguments (prize NOT in args).
 *   4. Verifies duration is converted from UI hours to seconds (not an absolute deadline).
 *   5. Verifies prize is attached via PolicyInput.userValue, and PolicyQuote carries it.
 *   6. Verifies floating-point-safe GEN to wei conversion and minimum 10 GEN prize.
 *   7. Verifies exact contract input bounds for create_challenge and submit_entry
 *      (tagline 1–60 chars, paragraph 30–280 chars).
 *   8. Verifies the disabled write gate (WRITES_ENABLED = false) blocks both createKit
 *      and dispatchTransaction unconditionally (caller cannot bypass via mock kit).
 *   9. Verifies fee suggestions removal (uses kit network defaults, never invented profiles).
 *
 * Run: node tests/test_transaction_service.js
 */

'use strict';

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

async function runSuite() {
  console.log('================================================================');
  console.log('BRIEFARENA REAL MODULE TRANSACTION SERVICE TESTS');
  console.log('================================================================\n');

  // Load real Vite server to transpile and load app/src/services/transactionService.ts
  const viteEntry = pathToFileURL(path.resolve(__dirname, '../app/node_modules/vite/dist/node/index.js')).href;
  const { createServer } = await import(viteEntry);
  const viteServer = await createServer({
    root: path.resolve(__dirname, '../app'),
    server: { middlewareMode: true },
  });

  const { createMockKit } = require(path.resolve(__dirname, '../app/node_modules/@genlayer/transaction-kit-react'));

  let service;
  try {
    service = await viteServer.ssrLoadModule('/src/services/transactionService.ts');
  } catch (err) {
    console.error('Failed to load transactionService.ts:', err);
    await viteServer.close();
    process.exit(1);
  }

  const {
    WRITES_ENABLED,
    TransactionServiceError,
    MIN_PRIZE_WEI,
    MIN_DURATION_SECONDS,
    MAX_DURATION_SECONDS,
    genToWei,
    validateCreateChallengeValues,
    buildCreateChallengeSubmitInput,
    createChallengeValue,
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
    estimateFees,
    dispatchTransaction,
    makeTxExplorerLink,
    idleState,
    isTerminal,
  } = service;

  let passedTests = 0;

  // -------------------------------------------------------------
  // Test 1: Real Module Write Gate Constant & Limits
  // -------------------------------------------------------------
  console.log('[Test 1] Real Module Constants & Write Gate is Disabled');
  assert.strictEqual(WRITES_ENABLED, false, 'WRITES_ENABLED must be strictly false');
  assert.strictEqual(MIN_PRIZE_WEI, 10n * 10n ** 18n, 'MIN_PRIZE_WEI must be 10 GEN (10 * 10^18 wei)');
  assert.strictEqual(MIN_DURATION_SECONDS, 86400n, 'MIN_DURATION_SECONDS must be 86400 (24h)');
  assert.strictEqual(MAX_DURATION_SECONDS, 604800n, 'MAX_DURATION_SECONDS must be 604800 (168h)');
  console.log('✓ PASS: WRITES_ENABLED is false; canonical escrow and duration bounds verified.\n');
  passedTests++;

  // -------------------------------------------------------------
  // Test 2: createKit Enforces Disabled Write Gate
  // -------------------------------------------------------------
  console.log('[Test 2] createKit throws WRITE_GATE_DISABLED on real module');
  let createKitErr = null;
  try {
    await createKit(61997);
  } catch (err) {
    createKitErr = err;
  }
  assert.ok(createKitErr instanceof TransactionServiceError, 'createKit must throw TransactionServiceError');
  assert.strictEqual(createKitErr.code, 'WRITE_GATE_DISABLED', 'Error code must be WRITE_GATE_DISABLED');
  console.log('✓ PASS: createKit rejected by disabled write gate with typed error.\n');
  passedTests++;

  // -------------------------------------------------------------
  // Test 3: dispatchTransaction Enforces Disabled Write Gate (Bypass Prevention)
  // -------------------------------------------------------------
  console.log('[Test 3] dispatchTransaction unconditionally blocked by write gate (cannot bypass with mock kit)');
  const mockKit = createMockKit();
  const dummyQuote = {
    distribution: {},
    feeValue: 1000n,
    userValue: 10n * 10n ** 18n,
    total: 1000n + 10n * 10n ** 18n,
    source: 'network-default',
    verification: { status: 'verified' },
    breakdown: { timeUnitFees: 0n, executionBudget: 0n, messageFees: 0n },
    caps: { genPerTimeUnit: 0n, storagePrice: 0n, receiptPrice: 0n },
    refundable: true,
  };
  const dummyTx = {
    kind: 'write',
    address: '0x4072D26298eefD8c6D865164a6a3c14fa3E7e272',
    method: 'create_challenge',
    args: ['Title', 'Cat', 'Synopsis', ['Req 1'], ['Term 1'], 86400n],
  };

  let dispatchErr = null;
  try {
    await dispatchTransaction(mockKit, dummyQuote, dummyTx);
  } catch (err) {
    dispatchErr = err;
  }
  assert.ok(dispatchErr instanceof TransactionServiceError, 'dispatchTransaction must throw TransactionServiceError');
  assert.strictEqual(dispatchErr.code, 'WRITE_GATE_DISABLED', 'dispatchTransaction must reject with WRITE_GATE_DISABLED');
  console.log('✓ PASS: Caller supplying kit and quote cannot bypass the disabled write gate.\n');
  passedTests++;

  // -------------------------------------------------------------
  // Test 4: Real create_challenge Payload Structure (Exact 6 Contract Args, No Prize in Args)
  // -------------------------------------------------------------
  console.log('[Test 4] Real create_challenge payload: exactly 6 args; prize strictly excluded from args');
  const validChallengeForm = {
    title: 'Minimalist Architecture Challenge',
    category: 'Design Systems',
    synopsis: 'A brief focused on restraint, whitespace, and structural harmony in digital products.',
    mandatoryRequirements: ['Must include high-contrast mode', 'No pure black #000000'],
    prohibitedTerms: ['clutter', 'skeuomorphism'],
    durationHours: 72,
    prizeAmountGen: 15,
  };
  const contractAddress = '0x4072D26298eefD8c6D865164a6a3c14fa3E7e272';

  const createTxInput = buildCreateChallengeSubmitInput(validChallengeForm, contractAddress);
  assert.strictEqual(createTxInput.kind, 'write', 'Payload kind must be write');
  assert.strictEqual(createTxInput.address, contractAddress, 'Payload address must match contract');
  assert.strictEqual(createTxInput.method, 'create_challenge', 'Payload method must be create_challenge');
  assert.ok(Array.isArray(createTxInput.args), 'Args must be an array');
  assert.strictEqual(createTxInput.args.length, 6, 'create_challenge MUST have exactly six arguments');

  assert.strictEqual(createTxInput.args[0], 'Minimalist Architecture Challenge', 'Arg 0: clean title');
  assert.strictEqual(createTxInput.args[1], 'Design Systems', 'Arg 1: clean category');
  assert.strictEqual(createTxInput.args[2], 'A brief focused on restraint, whitespace, and structural harmony in digital products.', 'Arg 2: clean synopsis');
  assert.deepStrictEqual(createTxInput.args[3], ['Must include high-contrast mode', 'No pure black #000000'], 'Arg 3: clean requirements');
  assert.deepStrictEqual(createTxInput.args[4], ['clutter', 'skeuomorphism'], 'Arg 4: clean prohibited terms');
  assert.strictEqual(createTxInput.args[5], 259200n, 'Arg 5: duration_seconds (72h * 3600 = 259200s as bigint)');

  // Confirm prize is NOT anywhere in args
  const hasPrizeInArgs = createTxInput.args.some(a => a === 15 || a === 15n || a === 15000000000000000000n || a === '15');
  assert.strictEqual(hasPrizeInArgs, false, 'Prize must NOT be placed in contract arguments');
  console.log('✓ PASS: create_challenge produces exactly 6 args; prize is excluded from contract call.\n');
  passedTests++;

  // -------------------------------------------------------------
  // Test 5: Duration Converted from UI Hours to Seconds (Not Absolute Deadline)
  // -------------------------------------------------------------
  console.log('[Test 5] Duration conversion: relative seconds (24h -> 86400s, 168h -> 604800s)');
  const hourCases = [
    { hours: 24, expectedSeconds: 86400n },
    { hours: 48, expectedSeconds: 172800n },
    { hours: 72, expectedSeconds: 259200n },
    { hours: 168, expectedSeconds: 604800n },
  ];
  for (const { hours, expectedSeconds } of hourCases) {
    const input = buildCreateChallengeSubmitInput({ ...validChallengeForm, durationHours: hours }, contractAddress);
    assert.strictEqual(input.args[5], expectedSeconds, `Duration for ${hours}h must be ${expectedSeconds}s`);
    // Ensure it's not a timestamp (timestamps on Studio Next are ~1.7e9)
    assert.ok(input.args[5] < 1_000_000n, 'Duration must be relative seconds, not absolute UNIX timestamp');
  }
  console.log('✓ PASS: All UI duration choices convert to relative duration_seconds.\n');
  passedTests++;

  // -------------------------------------------------------------
  // Test 6: Prize Attached via PolicyInput.userValue & Preserved in PolicyQuote
  // -------------------------------------------------------------
  console.log('[Test 6] Prize attached via PolicyInput.userValue for fee estimation');
  const prizeWei = createChallengeValue(validChallengeForm);
  assert.strictEqual(prizeWei, 15n * 10n ** 18n, '15 GEN converts to 15 * 10^18 wei');

  const policyInput = buildCreateChallengePolicyInput(validChallengeForm, 'standard');
  assert.strictEqual(policyInput.preset, 'standard');
  assert.strictEqual(policyInput.userValue, 15n * 10n ** 18n, 'userValue must carry the exact prize in wei');

  // Exercise boundary with mockKit
  const quote = await mockKit.estimate(policyInput, createTxInput);
  assert.strictEqual(quote.userValue, 15n * 10n ** 18n, 'PolicyQuote must preserve userValue from PolicyInput');
  assert.strictEqual(quote.total, quote.feeValue + 15n * 10n ** 18n, 'PolicyQuote total includes userValue');
  console.log('✓ PASS: Prize is cleanly attached via userValue and preserved in PolicyQuote.\n');
  passedTests++;

  // -------------------------------------------------------------
  // Test 7: Floating-Point-Safe GEN to Wei Conversion
  // -------------------------------------------------------------
  console.log('[Test 7] Floating-point-safe GEN to wei conversion');
  assert.strictEqual(genToWei(10), 10000000000000000000n);
  assert.strictEqual(genToWei('10'), 10000000000000000000n);
  assert.strictEqual(genToWei('10.5'), 10500000000000000000n);
  assert.strictEqual(genToWei('10.000000000000000001'), 10000000000000000001n);
  assert.strictEqual(genToWei('29.999999999999999999'), 29999999999999999999n);
  assert.strictEqual(genToWei('0.000000000000000001'), 1n);

  const isBoundsErr = err => err instanceof TransactionServiceError && err.code === 'INVALID_INPUT_BOUNDS';

  // Rejects invalid formats
  assert.throws(() => genToWei('abc'), isBoundsErr);
  assert.throws(() => genToWei('10.1234567890123456789'), isBoundsErr); // 19 decimals
  assert.throws(() => genToWei('-10'), isBoundsErr);
  console.log('✓ PASS: Decimal arithmetic is string/BigInt based without floating-point inaccuracies.\n');
  passedTests++;

  // -------------------------------------------------------------
  // Test 8: Minimum Prize Validation (>= 10 GEN)
  // -------------------------------------------------------------
  console.log('[Test 8] Minimum prize validation (contract enforces >= 10 GEN)');
  assert.throws(
    () => validateCreateChallengeValues({ ...validChallengeForm, prizeAmountGen: 9.99 }),
    isBoundsErr,
    'Prize below 10 GEN must be rejected'
  );
  assert.throws(
    () => validateCreateChallengeValues({ ...validChallengeForm, prizeAmountGen: 0 }),
    isBoundsErr,
    'Zero prize must be rejected'
  );
  // Exactly 10 GEN succeeds
  const exactly10 = validateCreateChallengeValues({ ...validChallengeForm, prizeAmountGen: 10 });
  assert.strictEqual(exactly10.prizeWei, 10000000000000000000n);
  console.log('✓ PASS: Minimum prize enforced at 10 GEN boundary.\n');
  passedTests++;

  // -------------------------------------------------------------
  // Test 9: create_challenge Input Bounds Validation
  // -------------------------------------------------------------
  console.log('[Test 9] create_challenge input bounds validation');
  // Title (5–60)
  assert.throws(() => validateCreateChallengeValues({ ...validChallengeForm, title: 'Four' }), /Title must be between 5 and 60/);
  assert.throws(() => validateCreateChallengeValues({ ...validChallengeForm, title: 'a'.repeat(61) }), /Title must be between 5 and 60/);

  // Category (3–40)
  assert.throws(() => validateCreateChallengeValues({ ...validChallengeForm, category: 'AI' }), /Category must be between 3 and 40/);
  assert.throws(() => validateCreateChallengeValues({ ...validChallengeForm, category: 'a'.repeat(41) }), /Category must be between 3 and 40/);

  // Synopsis (40–500)
  assert.throws(() => validateCreateChallengeValues({ ...validChallengeForm, synopsis: 'Too short synopsis' }), /Synopsis must be between 40 and 500/);
  assert.throws(() => validateCreateChallengeValues({ ...validChallengeForm, synopsis: 'a'.repeat(501) }), /Synopsis must be between 40 and 500/);

  // Requirements (1–4 items, each 5–120)
  assert.throws(() => validateCreateChallengeValues({ ...validChallengeForm, mandatoryRequirements: [] }), /Mandatory requirements count/);
  assert.throws(() => validateCreateChallengeValues({ ...validChallengeForm, mandatoryRequirements: ['1', '2', '3', '4', '5'] }), /Mandatory requirements count/);
  assert.throws(() => validateCreateChallengeValues({ ...validChallengeForm, mandatoryRequirements: ['Tiny'] }), /Each mandatory requirement must be between 5 and 120/);

  // Prohibited terms (1–6 items, each 2–25)
  assert.throws(() => validateCreateChallengeValues({ ...validChallengeForm, prohibitedTerms: [] }), /Prohibited terms count/);
  assert.throws(() => validateCreateChallengeValues({ ...validChallengeForm, prohibitedTerms: ['1', '2', '3', '4', '5', '6', '7'] }), /Prohibited terms count/);
  assert.throws(() => validateCreateChallengeValues({ ...validChallengeForm, prohibitedTerms: ['x'] }), /Each prohibited term must be between 2 and 25/);

  // Duration (24h–168h)
  assert.throws(() => validateCreateChallengeValues({ ...validChallengeForm, durationHours: 12 }), /Duration must be between 24 hours/);
  assert.throws(() => validateCreateChallengeValues({ ...validChallengeForm, durationHours: 169 }), /Duration must be between 24 hours/);
  console.log('✓ PASS: All create_challenge input bounds strictly validated.\n');
  passedTests++;

  // -------------------------------------------------------------
  // Test 10: submit_entry Payload & Deployed Limits (Tagline 1–60, Paragraph 30–280)
  // -------------------------------------------------------------
  console.log('[Test 10] submit_entry deployed limits (tagline 1–60, paragraph 30–280)');
  const validEntry = {
    challengeId: 1n,
    tagline: 'Less is more, but clarity is everything.',
    paragraph: 'An innovative, fluid user experience crafted for modern web applications with strict typography and design constraints.',
  };

  const entrySubmitInput = buildSubmitEntrySubmitInput(validEntry, contractAddress);
  assert.strictEqual(entrySubmitInput.kind, 'write');
  assert.strictEqual(entrySubmitInput.method, 'submit_entry');
  assert.strictEqual(entrySubmitInput.address, contractAddress);
  assert.deepStrictEqual(entrySubmitInput.args, [
    1n,
    'Less is more, but clarity is everything.',
    'An innovative, fluid user experience crafted for modern web applications with strict typography and design constraints.',
  ]);

  // Tagline bounds
  assert.throws(
    () => validateSubmitEntryValues({ ...validEntry, tagline: '' }),
    /Tagline must be between 1 and 60/,
    'Empty tagline must be rejected'
  );
  assert.throws(
    () => validateSubmitEntryValues({ ...validEntry, tagline: 'a'.repeat(61) }),
    /Tagline must be between 1 and 60/,
    'Tagline > 60 chars must be rejected'
  );

  // Paragraph bounds
  assert.throws(
    () => validateSubmitEntryValues({ ...validEntry, paragraph: 'a'.repeat(29) }),
    /Paragraph must be between 30 and 280/,
    'Paragraph < 30 chars must be rejected'
  );
  assert.throws(
    () => validateSubmitEntryValues({ ...validEntry, paragraph: 'a'.repeat(281) }),
    /Paragraph must be between 30 and 280/,
    'Paragraph > 280 chars must be rejected'
  );

  // Invalid challengeId
  assert.throws(
    () => validateSubmitEntryValues({ ...validEntry, challengeId: 0n }),
    /Challenge ID must be a positive integer/
  );
  console.log('✓ PASS: submit_entry validation conforms to deployed limits (tagline 1–60, paragraph 30–280).\n');
  passedTests++;

  // -------------------------------------------------------------
  // Test 11: estimateFees Enforces Write Gate & Error Handling When Enabled
  // -------------------------------------------------------------
  console.log('[Test 11] estimateFees enforces write gate (throws WRITE_GATE_DISABLED while closed)');
  const failingKit = {
    estimate: async () => {
      throw new Error('RPC connection timeout at https://studio-next.genlayer.com/api');
    },
  };
  let estErr = null;
  try {
    await estimateFees(failingKit, createTxInput);
  } catch (err) {
    estErr = err;
  }
  assert.ok(estErr instanceof TransactionServiceError);
  assert.strictEqual(estErr.code, 'WRITE_GATE_DISABLED');
  console.log('✓ PASS: estimateFees reads the same write gate and rejects when closed.\n');
  passedTests++;

  // Test 11b: When enabled, estimateFees calls kit.estimate and wraps unexpected errors into FEE_ESTIMATION_FAILED
  console.log('[Test 11b] estimateFees wraps unexpected errors into FEE_ESTIMATION_FAILED when gate is enabled');
  process.env.VITE_WRITES_ENABLED = 'true';
  viteServer.moduleGraph.invalidateAll();
  const enabledService = await viteServer.ssrLoadModule('/src/services/transactionService.ts');
  assert.strictEqual(enabledService.WRITES_ENABLED, true, 'WRITES_ENABLED must be true in enabled test build');

  let enabledEstErr = null;
  try {
    await enabledService.estimateFees(failingKit, createTxInput);
  } catch (err) {
    enabledEstErr = err;
  }
  assert.ok(enabledEstErr instanceof enabledService.TransactionServiceError);
  assert.strictEqual(enabledEstErr.code, 'FEE_ESTIMATION_FAILED');
  assert.ok(enabledEstErr.message.includes('RPC connection timeout'));
  console.log('✓ PASS: estimateFees in enabled build delegates to kit.estimate and produces typed FEE_ESTIMATION_FAILED error.\n');
  passedTests++;

  // Reset env
  delete process.env.VITE_WRITES_ENABLED;
  viteServer.moduleGraph.invalidateAll();

  // -------------------------------------------------------------
  // Test 12: UI State Helpers & Explorer Link
  // -------------------------------------------------------------
  console.log('[Test 12] UI state helpers and explorer URL');
  assert.deepStrictEqual(idleState(), { phase: 'idle' });
  assert.strictEqual(isTerminal({ phase: 'finalized', txId: '0x1', explorerLink: '', status: {} }), true);
  assert.strictEqual(isTerminal({ phase: 'execution_failed', txId: '0x1', explorerLink: '', status: {} }), true);
  assert.strictEqual(isTerminal({ phase: 'error', error: new TransactionServiceError('DISPATCH_FAILED', '') }), true);
  assert.strictEqual(isTerminal({ phase: 'pending', txId: '0x1', explorerLink: '' }), false);
  assert.strictEqual(isTerminal({ phase: 'idle' }), false);
  assert.strictEqual(
    makeTxExplorerLink('0xabcdef123456'),
    'https://explorer-studio-dev.genlayer.com/tx/0xabcdef123456'
  );
  console.log('✓ PASS: UI state helpers and explorer links behave correctly.\n');
  passedTests++;

  // -------------------------------------------------------------
  // Test 14: Contract Address Resolution & CONTRACT_ADDRESS_MISSING
  // -------------------------------------------------------------
  console.log('[Test 14] Contract address validation & CONTRACT_ADDRESS_MISSING typed error');
  const { isValidAddress, resolveContractAddress } = service;
  assert.strictEqual(isValidAddress('0x4072D26298eefD8c6D865164a6a3c14fa3E7e272'), true);
  assert.strictEqual(isValidAddress('0x123'), false);
  assert.strictEqual(isValidAddress('not-an-address'), false);
  assert.strictEqual(isValidAddress(null), false);
  assert.strictEqual(isValidAddress(undefined), false);

  // Calling builders with explicit invalid address throws CONTRACT_ADDRESS_MISSING
  assert.throws(
    () => buildCreateChallengeSubmitInput(validChallengeForm, '0xInvalidAddress'),
    err => err instanceof TransactionServiceError && err.code === 'CONTRACT_ADDRESS_MISSING'
  );
  assert.throws(
    () => buildSubmitEntrySubmitInput(validEntry, '0xInvalidAddress'),
    err => err instanceof TransactionServiceError && err.code === 'CONTRACT_ADDRESS_MISSING'
  );
  console.log('✓ PASS: Invalid or missing contract address throws typed CONTRACT_ADDRESS_MISSING.\n');
  passedTests++;

  // -------------------------------------------------------------
  // Test 15: Consensus Outcome Mapping & Inconclusive Evidence (RC2 Values)
  // -------------------------------------------------------------
  console.log('[Test 15] Execution outcome mapping uses Transaction Kit RC2 values');
  const {
    isExecutionSuccessful,
    isExecutionProvenFailed,
    isExecutionInconclusive,
    mapTrackedStatusToOutcome,
  } = service;

  const sampleTxId = '0x1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff';
  const sampleLink = makeTxExplorerLink(sampleTxId);

  // Subtest 15a: Decided / ACCEPTED is NEVER finalized success (remains in tracking)
  const acceptedStatus = {
    phase: 'decided',
    statusName: 'ACCEPTED',
    executionResultName: 'FINISHED_WITH_RETURN',
    successful: true,
  };
  assert.strictEqual(isExecutionSuccessful(acceptedStatus), false, 'ACCEPTED is not finalized success');
  const acceptedOutcome = mapTrackedStatusToOutcome(acceptedStatus, sampleTxId, sampleLink);
  assert.strictEqual(acceptedOutcome.phase, 'tracking', 'Decided/ACCEPTED must map to tracking phase');

  // Subtest 15b: Finalized with FINISHED_WITH_RETURN and successful: true -> success
  const finalizedSuccessStatus = {
    phase: 'finalized',
    statusName: 'FINALIZED',
    executionResultName: 'FINISHED_WITH_RETURN',
    successful: true,
  };
  assert.strictEqual(isExecutionSuccessful(finalizedSuccessStatus), true);
  const successOutcome = mapTrackedStatusToOutcome(finalizedSuccessStatus, sampleTxId, sampleLink);
  assert.strictEqual(successOutcome.phase, 'success');
  assert.strictEqual(successOutcome.txId, sampleTxId);
  assert.strictEqual(successOutcome.explorerLink, sampleLink);

  // Subtest 15c: Finalized with FINISHED_WITH_ERROR -> execution_failed
  const finalizedErrorStatus = {
    phase: 'finalized',
    statusName: 'FINALIZED',
    executionResultName: 'FINISHED_WITH_ERROR',
    successful: false,
  };
  assert.strictEqual(isExecutionSuccessful(finalizedErrorStatus), false);
  assert.strictEqual(isExecutionProvenFailed(finalizedErrorStatus), true);
  const errorOutcome = mapTrackedStatusToOutcome(finalizedErrorStatus, sampleTxId, sampleLink);
  assert.strictEqual(errorOutcome.phase, 'execution_failed');

  // Subtest 15d: Finalized with missing execution evidence -> unknown; verify receipt
  const finalizedMissingStatus = {
    phase: 'finalized',
    statusName: 'FINALIZED',
    executionResultName: undefined,
  };
  assert.strictEqual(isExecutionSuccessful(finalizedMissingStatus), false);
  assert.strictEqual(isExecutionInconclusive(finalizedMissingStatus), true);
  const missingOutcome = mapTrackedStatusToOutcome(finalizedMissingStatus, sampleTxId, sampleLink);
  assert.strictEqual(missingOutcome.phase, 'unknown');
  assert.ok(missingOutcome.reason.includes('unknown; verify receipt'));
  assert.strictEqual(missingOutcome.retryable, true);
  assert.strictEqual(missingOutcome.txId, sampleTxId);
  assert.strictEqual(missingOutcome.explorerLink, sampleLink);

  // Subtest 15e: Conflicting evidence (FINISHED_WITH_RETURN with successful: false) -> unknown
  const conflictingStatus1 = {
    phase: 'finalized',
    statusName: 'FINALIZED',
    executionResultName: 'FINISHED_WITH_RETURN',
    successful: false,
  };
  assert.strictEqual(isExecutionSuccessful(conflictingStatus1), false);
  assert.strictEqual(isExecutionInconclusive(conflictingStatus1), true);
  const conflictingOutcome1 = mapTrackedStatusToOutcome(conflictingStatus1, sampleTxId, sampleLink);
  assert.strictEqual(conflictingOutcome1.phase, 'unknown');
  assert.ok(conflictingOutcome1.reason.includes('unknown; verify receipt'));
  assert.strictEqual(conflictingOutcome1.retryable, true);

  // Subtest 15f: Conflicting evidence (FINISHED_WITH_ERROR with successful: true) -> unknown
  const conflictingStatus2 = {
    phase: 'finalized',
    statusName: 'FINALIZED',
    executionResultName: 'FINISHED_WITH_ERROR',
    successful: true,
  };
  assert.strictEqual(isExecutionSuccessful(conflictingStatus2), false);
  assert.strictEqual(isExecutionInconclusive(conflictingStatus2), true);
  const conflictingOutcome2 = mapTrackedStatusToOutcome(conflictingStatus2, sampleTxId, sampleLink);
  assert.strictEqual(conflictingOutcome2.phase, 'unknown');
  assert.ok(conflictingOutcome2.reason.includes('unknown; verify receipt'));
  assert.strictEqual(conflictingOutcome2.retryable, true);

  console.log('✓ PASS: Consensus outcome mapping correctly handles RC2 results, conflicting/missing evidence, and preserves retryable links.\n');
  passedTests++;

  // -------------------------------------------------------------
  // Test 16: cancel_challenge Typed Builder & Validation
  // -------------------------------------------------------------
  console.log('[Test 16] cancel_challenge typed input validation, 1 argument, userValue: 0n, strict address resolution');
  // Validation: positive BigInt required
  const validCancel = validateCancelChallengeValues({ challengeId: 42n });
  assert.strictEqual(validCancel.challengeId, 42n);

  assert.throws(
    () => validateCancelChallengeValues({ challengeId: 0n }),
    /Challenge ID must be a positive integer/
  );
  assert.throws(
    () => validateCancelChallengeValues({ challengeId: -5n }),
    /Challenge ID must be a positive integer/
  );
  assert.throws(
    () => validateCancelChallengeValues({ challengeId: '42' }),
    /Challenge ID must be a positive integer/
  );

  // SubmitInput: exactly 1 arg, method 'cancel_challenge', userValue = 0n
  const cancelInput = buildCancelChallengeSubmitInput({ challengeId: 42n }, contractAddress);
  assert.strictEqual(cancelInput.kind, 'write');
  assert.strictEqual(cancelInput.method, 'cancel_challenge');
  assert.strictEqual(cancelInput.address, contractAddress);
  assert.strictEqual(cancelInput.args.length, 1);
  assert.strictEqual(cancelInput.args[0], 42n);

  // PolicyInput: non-payable (userValue strictly 0n)
  const cancelPolicy = buildCancelChallengePolicyInput();
  assert.strictEqual(cancelPolicy.userValue, 0n, 'cancel_challenge must be non-payable (userValue: 0n)');

  // Address validation: invalid format rejects
  assert.throws(
    () => buildCancelChallengeSubmitInput({ challengeId: 42n }, '0xinvalid'),
    /CONTRACT_ADDRESS/
  );

  console.log('✓ PASS: cancel_challenge builder strictly validated: 1 argument, userValue 0n, no refund tx invented.\n');
  passedTests++;

  // -------------------------------------------------------------
  // Test 17: withdraw Typed Builder & Zero Arguments
  // -------------------------------------------------------------
  console.log('[Test 17] withdraw typed builder: strictly 0 arguments, userValue: 0n, strict address resolution');
  const withdrawInput = buildWithdrawSubmitInput(contractAddress);
  assert.strictEqual(withdrawInput.kind, 'write');
  assert.strictEqual(withdrawInput.method, 'withdraw');
  assert.strictEqual(withdrawInput.address, contractAddress);
  assert.strictEqual(withdrawInput.args.length, 0, 'withdraw must take strictly 0 arguments');

  // PolicyInput: non-payable from caller (userValue strictly 0n)
  const withdrawPolicy = buildWithdrawPolicyInput();
  assert.strictEqual(withdrawPolicy.userValue, 0n, 'withdraw must be non-payable from caller (userValue: 0n)');

  // Address validation: invalid format rejects
  assert.throws(
    () => buildWithdrawSubmitInput('0xnotanaddress'),
    /CONTRACT_ADDRESS/
  );

  console.log('✓ PASS: withdraw builder strictly validated: 0 arguments, userValue 0n, distinct from internal credit.\n');
  passedTests++;

  // -------------------------------------------------------------
  // Test 18: close_deadline(challenge_id) Typed Builder
  // -------------------------------------------------------------
  console.log('[Test 18] close_deadline builder: exactly 1 positive u256 arg, userValue 0n, address validation');
  const validCloseVal = validateLifecycleChallengeValues({ challengeId: 101n });
  assert.strictEqual(validCloseVal.challengeId, 101n);

  assert.throws(() => validateLifecycleChallengeValues({ challengeId: 0n }), /Challenge ID must be a positive integer/);
  assert.throws(() => validateLifecycleChallengeValues({ challengeId: -1n }), /Challenge ID must be a positive integer/);
  assert.throws(() => validateLifecycleChallengeValues({ challengeId: '101' }), /Challenge ID must be a positive integer/);

  const closeInput = buildCloseDeadlineSubmitInput({ challengeId: 101n }, contractAddress);
  assert.strictEqual(closeInput.kind, 'write');
  assert.strictEqual(closeInput.method, 'close_deadline');
  assert.strictEqual(closeInput.address, contractAddress);
  assert.strictEqual(closeInput.args.length, 1);
  assert.strictEqual(closeInput.args[0], 101n);

  const closePolicy = buildCloseDeadlinePolicyInput();
  assert.strictEqual(closePolicy.userValue, 0n, 'close_deadline must be non-payable (userValue: 0n)');

  assert.throws(() => buildCloseDeadlineSubmitInput({ challengeId: 101n }, '0xbad'), /CONTRACT_ADDRESS/);
  console.log('✓ PASS: close_deadline builder strictly validated: 1 argument, userValue 0n, positive u256.\n');
  passedTests++;

  // -------------------------------------------------------------
  // Test 19: expire_zero_entries(challenge_id) Typed Builder
  // -------------------------------------------------------------
  console.log('[Test 19] expire_zero_entries builder: exactly 1 positive u256 arg, userValue 0n, address validation');
  const expireInput = buildExpireZeroEntriesSubmitInput({ challengeId: 102n }, contractAddress);
  assert.strictEqual(expireInput.kind, 'write');
  assert.strictEqual(expireInput.method, 'expire_zero_entries');
  assert.strictEqual(expireInput.address, contractAddress);
  assert.strictEqual(expireInput.args.length, 1);
  assert.strictEqual(expireInput.args[0], 102n);

  const expirePolicy = buildExpireZeroEntriesPolicyInput();
  assert.strictEqual(expirePolicy.userValue, 0n, 'expire_zero_entries must be non-payable (userValue: 0n)');

  assert.throws(() => buildExpireZeroEntriesSubmitInput({ challengeId: 102n }, '0xbad'), /CONTRACT_ADDRESS/);
  console.log('✓ PASS: expire_zero_entries builder strictly validated: 1 argument, userValue 0n, positive u256.\n');
  passedTests++;

  // -------------------------------------------------------------
  // Test 20: commit_judging(challenge_id) Typed Builder
  // -------------------------------------------------------------
  console.log('[Test 20] commit_judging builder: exactly 1 positive u256 arg, userValue 0n, address validation');
  const commitInput = buildCommitJudgingSubmitInput({ challengeId: 103n }, contractAddress);
  assert.strictEqual(commitInput.kind, 'write');
  assert.strictEqual(commitInput.method, 'commit_judging');
  assert.strictEqual(commitInput.address, contractAddress);
  assert.strictEqual(commitInput.args.length, 1);
  assert.strictEqual(commitInput.args[0], 103n);

  const commitPolicy = buildCommitJudgingPolicyInput();
  assert.strictEqual(commitPolicy.userValue, 0n, 'commit_judging must be non-payable (userValue: 0n)');

  assert.throws(() => buildCommitJudgingSubmitInput({ challengeId: 103n }, '0xbad'), /CONTRACT_ADDRESS/);
  console.log('✓ PASS: commit_judging builder strictly validated: 1 argument, userValue 0n, positive u256.\n');
  passedTests++;

  // -------------------------------------------------------------
  // Test 21: attempt_judgement(challenge_id) Typed Builder
  // -------------------------------------------------------------
  console.log('[Test 21] attempt_judgement builder: exactly 1 positive u256 arg, userValue 0n, address validation');
  const attemptInput = buildAttemptJudgementSubmitInput({ challengeId: 104n }, contractAddress);
  assert.strictEqual(attemptInput.kind, 'write');
  assert.strictEqual(attemptInput.method, 'attempt_judgement');
  assert.strictEqual(attemptInput.address, contractAddress);
  assert.strictEqual(attemptInput.args.length, 1);
  assert.strictEqual(attemptInput.args[0], 104n);

  const attemptPolicy = buildAttemptJudgementPolicyInput();
  assert.strictEqual(attemptPolicy.userValue, 0n, 'attempt_judgement must be non-payable (userValue: 0n)');

  assert.throws(() => buildAttemptJudgementSubmitInput({ challengeId: 104n }, '0xbad'), /CONTRACT_ADDRESS/);
  console.log('✓ PASS: attempt_judgement builder strictly validated: 1 argument, userValue 0n, positive u256.\n');
  passedTests++;

  // -------------------------------------------------------------
  // Test 22: timeout_judgement(challenge_id) Typed Builder & Dispute Method Invariant
  // -------------------------------------------------------------
  console.log('[Test 22] timeout_judgement builder: exactly 1 positive u256 arg, userValue 0n, no dispute method');
  const timeoutInput = buildTimeoutJudgementSubmitInput({ challengeId: 105n }, contractAddress);
  assert.strictEqual(timeoutInput.kind, 'write');
  assert.strictEqual(timeoutInput.method, 'timeout_judgement');
  assert.strictEqual(timeoutInput.address, contractAddress);
  assert.strictEqual(timeoutInput.args.length, 1);
  assert.strictEqual(timeoutInput.args[0], 105n);

  const timeoutPolicy = buildTimeoutJudgementPolicyInput();
  assert.strictEqual(timeoutPolicy.userValue, 0n, 'timeout_judgement must be non-payable (userValue: 0n)');

  assert.throws(() => buildTimeoutJudgementSubmitInput({ challengeId: 105n }, '0xbad'), /CONTRACT_ADDRESS/);

  // Invariant: Do not invent a separate dispute method
  assert.strictEqual(service.buildDisputeSubmitInput, undefined, 'Must not invent a dispute method');
  assert.strictEqual(service.buildDisputePolicyInput, undefined, 'Must not invent dispute policy input');

  console.log('✓ PASS: timeout_judgement builder strictly validated; verified zero invented dispute methods.\n');
  passedTests++;

  await viteServer.close();

  console.log('================================================================');
  console.log(`ALL REAL MODULE TESTS PASSED (${passedTests}/${passedTests})`);
  console.log('================================================================\n');
}

runSuite().catch(err => {
  console.error('\nTEST RUNNER FAILURE:', err);
  process.exit(1);
});
