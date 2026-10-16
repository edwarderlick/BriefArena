/**
 * test_transaction_controller.js
 *
 * Real TypeScript module integration tests for BriefArena transactionController.ts.
 *
 * Verifies:
 *   1. Wrong Chain: rejects wallet on chain other than 61997 with WRONG_CHAIN.
 *   2. Missing Address: rejects null/invalid contract address with CONTRACT_ADDRESS_MISSING.
 *   3. Action Preconditions: validates all action-specific rules (prize < 10 GEN,
 *      sponsor self-entry block, slot capacity, cancel non-sponsor block, zero credit block,
 *      and fixture blocking).
 *   4. Quote Failure: handles kit.estimate failures, surfaces typed FEE_ESTIMATION_FAILED,
 *      and blocks confirmation.
 *   5. Successful Quote: calculates PolicyQuote with exact userValue and breakdown.
 *   6. Closed Write Gate: dispatchTransaction / controller.submit unconditionally blocks
 *      on WRITES_ENABLED = false (WRITE_GATE_DISABLED).
 *   7. Duplicate Prevention: prevents in-flight duplicate submissions on retry / timeout.
 *   8. Execution Failure: distinguishes consensus 'finalized' from execution 'FINISHED_WITH_ERROR'
 *      (never claims success from finalized alone).
 *   9. Successful State Refresh: triggers onSuccessRefresh callback upon confirmed success
 *      (FINISHED_WITH_RETURN and successful === true).
 *  10. Withdraw Child-Transfer Separation: treats parent withdraw execution and child
 *      transfer confirmation as separate tracking stages.
 *
 * Run: node tests/test_transaction_controller.js
 */

'use strict';

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

const DETERMINISTIC_TEST_CONTRACT_ADDRESS = '0x5614108eDBdAb6c0b6313725EDe8f1029F74F4F9';
process.env.VITE_BRIEF_ARENA_CONTRACT_ADDRESS =
  process.env.VITE_BRIEF_ARENA_CONTRACT_ADDRESS || DETERMINISTIC_TEST_CONTRACT_ADDRESS;

async function runSuite() {
  console.log('================================================================');
  console.log('BRIEFARENA TRANSACTION CONTROLLER TESTS');
  console.log('================================================================\n');

  // Load real Vite server to transpile and load app/src/services/transactionController.ts
  const viteEntry = pathToFileURL(path.resolve(__dirname, '../app/node_modules/vite/dist/node/index.js')).href;
  const { createServer } = await import(viteEntry);
  const viteServer = await createServer({
    root: path.resolve(__dirname, '../app'),
    server: { middlewareMode: true },
  });

  let controllerModule;
  let serviceModule;
  try {
    controllerModule = await viteServer.ssrLoadModule('/src/services/transactionController.ts');
    serviceModule = await viteServer.ssrLoadModule('/src/services/transactionService.ts');
  } catch (err) {
    console.error('Failed to load modules via Vite SSR:', err);
    await viteServer.close();
    process.exit(1);
  }

  let {
    validateActionPreconditions,
    TransactionController,
    persistTransactionRecord,
    getPersistedTransaction,
    clearPersistedTransaction,
    computeActionKey,
  } = controllerModule;
  const DefaultTransactionController = TransactionController;

  const {
    WRITES_ENABLED,
    TransactionServiceError,
    isExecutionSuccessful,
  } = serviceModule;

  const validContractAddress = DETERMINISTIC_TEST_CONTRACT_ADDRESS;
  const testWallet = '0x1E47d7d7079FE4aD599B184559ffCDC56278fb54';

  let passedTests = 0;

  // -------------------------------------------------------------
  // Test 1: Wrong Chain Validation
  // -------------------------------------------------------------
  console.log('[Test 1] Precondition Check: Wrong Chain (Wallet on Chain 1 vs Expected 61997)');
  const wrongChainParams = {
    actionType: 'challenge_creation',
    walletState: {
      isConnected: true,
      address: testWallet,
      chainId: 1, // Mainnet instead of 61997
      isCorrectNetwork: false,
    },
    contractAddress: validContractAddress,
    createChallengeValues: {
      title: 'Valid Title Here',
      category: 'Design Systems',
      synopsis: 'A valid synopsis that easily satisfies the minimum forty character limit.',
      mandatoryRequirements: ['Tenet One'],
      prohibitedTerms: ['hype'],
      durationHours: 48,
      prizeAmountGen: 20,
    },
  };

  const wrongChainRes = validateActionPreconditions(wrongChainParams);
  assert.strictEqual(wrongChainRes.isValid, false, 'Validation must fail for wrong chain');
  assert.ok(wrongChainRes.error instanceof TransactionServiceError, 'Must return TransactionServiceError');
  assert.strictEqual(wrongChainRes.error.code, 'WRONG_CHAIN', 'Error code must be WRONG_CHAIN');
  assert.ok(wrongChainRes.error.message.includes('61997'), 'Error message must specify expected chain 61997');

  const controllerWrongChain = new TransactionController(wrongChainParams);
  const ctrlValidation = controllerWrongChain.validate();
  assert.strictEqual(ctrlValidation.isValid, false);
  assert.strictEqual(controllerWrongChain.getState().phase, 'error');
  assert.strictEqual(controllerWrongChain.getState().validationError.code, 'WRONG_CHAIN');
  console.log('✓ PASS: Wrong chain rejected with typed WRONG_CHAIN error.\n');
  passedTests++;

  // -------------------------------------------------------------
  // Test 2: Missing or Invalid Contract Address
  // -------------------------------------------------------------
  console.log('[Test 2] Precondition Check: Missing or Invalid Contract Address');
  const missingAddrParams = {
    ...wrongChainParams,
    walletState: {
      isConnected: true,
      address: testWallet,
      chainId: 61997,
      isCorrectNetwork: true,
    },
    contractAddress: '0xInvalidAddress',
  };

  const missingAddrRes = validateActionPreconditions(missingAddrParams);
  assert.strictEqual(missingAddrRes.isValid, false, 'Validation must fail for invalid address');
  assert.strictEqual(missingAddrRes.error.code, 'CONTRACT_ADDRESS_MISSING', 'Error code must be CONTRACT_ADDRESS_MISSING');

  try {
    serviceModule.resolveContractAddress('0x0000000000000000000000000000000000000000_malformed');
    assert.fail('Should have thrown CONTRACT_ADDRESS_MISSING');
  } catch (err) {
    assert.strictEqual(err.code, 'CONTRACT_ADDRESS_MISSING');
  }
  console.log('✓ PASS: Missing and invalid contract addresses reject with CONTRACT_ADDRESS_MISSING.\n');
  passedTests++;

  // -------------------------------------------------------------
  // Test 3: Action-Specific Precondition Guards
  // -------------------------------------------------------------
  console.log('[Test 3] Action Preconditions: Fixtures, Slot Capacity, Sponsor Self-Entry, and Cancellation');
  const validWallet = {
    isConnected: true,
    address: testWallet,
    chainId: 61997,
    isCorrectNetwork: true,
  };

  // 3a: Fixture Challenge Block
  const fixtureBlockRes = validateActionPreconditions({
    actionType: 'entry_submission',
    walletState: validWallet,
    contractAddress: validContractAddress,
    currentChallenge: {
      id: 'fixture-001',
      code: '#FIX-001',
      title: 'Fixture Challenge',
      category: 'Design',
      synopsis: 'A design preview fixture that has no on-chain record.',
      mandatoryRequirements: ['Req 1'],
      prohibitedTerms: ['Term 1'],
      prizeAmount: 50,
      prizeCurrency: 'test GEN',
      sponsorAddress: '0x9999999999999999999999999999999999999999',
      deadlineDisplay: '2 days',
      deadlineIso: '',
      status: 'open',
      maxSlots: 3,
      filledSlots: 1,
      remainingTime: '2 days',
      isFixture: true,
    },
    submitEntryValues: {
      challengeId: 1n,
      tagline: 'A solid tagline for entry testing.',
      paragraph: 'A deterministic copywriting paragraph that comfortably exceeds the minimum thirty character limit for BriefArena.',
    },
  });
  assert.strictEqual(fixtureBlockRes.isValid, false);
  assert.strictEqual(fixtureBlockRes.error.code, 'INVALID_INPUT_BOUNDS');
  assert.ok(fixtureBlockRes.error.message.includes('fixture without an on-chain record'));

  // 3b: Sponsor Self-Entry Block
  const sponsorSelfEntryRes = validateActionPreconditions({
    actionType: 'entry_submission',
    walletState: validWallet,
    contractAddress: validContractAddress,
    currentChallenge: {
      id: '42',
      code: '#GEN-042',
      title: 'Live Challenge',
      category: 'Design',
      synopsis: 'A live on-chain challenge to test sponsor entry blocking.',
      mandatoryRequirements: ['Req 1'],
      prohibitedTerms: ['Term 1'],
      prizeAmount: 50,
      prizeCurrency: 'test GEN',
      sponsorAddress: testWallet, // SAME ADDRESS
      deadlineDisplay: '2 days',
      deadlineIso: '',
      status: 'open',
      maxSlots: 3,
      filledSlots: 1,
      remainingTime: '2 days',
      isFixture: false,
    },
    submitEntryValues: {
      challengeId: 42n,
      tagline: 'Sponsor attempting entry.',
      paragraph: 'This entry should be blocked because sponsors are strictly barred from entering their own challenges.',
    },
  });
  assert.strictEqual(sponsorSelfEntryRes.isValid, false);
  assert.ok(sponsorSelfEntryRes.error.message.includes('Sponsors cannot submit entries to their own briefs'));

  // 3c: Cancel Challenge Non-Sponsor Block
  const cancelNonSponsorRes = validateActionPreconditions({
    actionType: 'cancel_challenge',
    walletState: { ...validWallet, address: '0x2222222222222222222222222222222222222222' },
    contractAddress: validContractAddress,
    currentChallenge: {
      id: '42',
      code: '#GEN-042',
      title: 'Live Challenge',
      category: 'Design',
      synopsis: 'A live challenge for testing cancellation permissions.',
      mandatoryRequirements: ['Req 1'],
      prohibitedTerms: ['Term 1'],
      prizeAmount: 50,
      prizeCurrency: 'test GEN',
      sponsorAddress: testWallet, // DIFFERENT SPONSOR
      deadlineDisplay: '2 days',
      deadlineIso: '',
      status: 'open',
      maxSlots: 3,
      filledSlots: 0,
      remainingTime: '2 days',
      isFixture: false,
    },
    cancelChallengeValues: { challengeId: 42n },
  });
  assert.strictEqual(cancelNonSponsorRes.isValid, false);
  assert.ok(cancelNonSponsorRes.error.message.includes('Only the sponsor'));

  // 3d: Withdraw Zero Credit Block
  const withdrawZeroRes = validateActionPreconditions({
    actionType: 'withdraw',
    walletState: validWallet,
    contractAddress: validContractAddress,
    claimableCreditWei: 0n,
  });
  assert.strictEqual(withdrawZeroRes.isValid, false);
  assert.ok(withdrawZeroRes.error.message.includes('No claimable credits available'));

  console.log('✓ PASS: All action-specific preconditions and safety bounds verified.\n');
  passedTests++;

  // -------------------------------------------------------------
  // Test 4: Fee Quote Failure Handling
  // -------------------------------------------------------------
  console.log('[Test 4] Fee Quote Failure: kit.estimate fails, surfaces FEE_ESTIMATION_FAILED and blocks confirm');
  const validCreateParams = {
    actionType: 'challenge_creation',
    walletState: validWallet,
    contractAddress: validContractAddress,
    createChallengeValues: {
      title: 'Minimalist Architecture Protocol',
      category: 'Design Systems',
      synopsis: 'A brief focused on restraint, whitespace, and structural harmony in digital products.',
      mandatoryRequirements: ['Must include high-contrast mode'],
      prohibitedTerms: ['clutter'],
      durationHours: 72,
      prizeAmountGen: 25,
    },
  };

  const failingKit = {
    estimate: async () => {
      throw new Error('Studio Next RPC timeout while reading gas table');
    },
    submit: async () => {
      throw new Error('Should not be called');
    },
    track: async () => {},
  };

  // -------------------------------------------------------------
  // Test 4: Closed Write Gate Blocks Fee Estimation & Confirmation Controls
  // -------------------------------------------------------------
  console.log('[Test 4] Closed Write Gate: controller.estimateFee throws WRITE_GATE_DISABLED while WRITES_ENABLED=false');
  assert.strictEqual(WRITES_ENABLED, false, 'WRITES_ENABLED must be strictly false');
  const controllerClosed = new DefaultTransactionController(validCreateParams);
  assert.strictEqual(controllerClosed.getState().writesEnabled, false);
  assert.strictEqual(controllerClosed.getState().canConfirm, false);

  let caughtEstimateGateError = null;
  try {
    await controllerClosed.estimateFee(failingKit);
  } catch (err) {
    caughtEstimateGateError = err;
  }
  assert.ok(caughtEstimateGateError instanceof TransactionServiceError, 'estimateFee must throw TransactionServiceError');
  assert.strictEqual(caughtEstimateGateError.code, 'WRITE_GATE_DISABLED', 'Error must be WRITE_GATE_DISABLED');
  assert.strictEqual(controllerClosed.getState().canConfirm, false, 'canConfirm must remain strictly false');
  console.log('✓ PASS: Fee estimation and confirmation controls blocked by closed write gate (WRITE_GATE_DISABLED).\n');
  passedTests++;

  // -------------------------------------------------------------
  // Test 5: Closed Write Gate Blocks Submission & Console Tamper Resistance
  // -------------------------------------------------------------
  console.log('[Test 5] Closed Write Gate: controller.submit throws WRITE_GATE_DISABLED and resists console tampering');
  let caughtSubmitGateError = null;
  try {
    await controllerClosed.submit(failingKit);
  } catch (err) {
    caughtSubmitGateError = err;
  }
  assert.ok(caughtSubmitGateError instanceof TransactionServiceError);
  assert.strictEqual(caughtSubmitGateError.code, 'WRITE_GATE_DISABLED');

  // Console tampering proof: attempting window/global overrides
  globalThis.__BRIEFARENA_TEST_WRITES_ENABLED__ = true;
  let tamperError = null;
  try {
    await controllerClosed.submit(failingKit);
  } catch (err) {
    tamperError = err;
  }
  assert.ok(tamperError instanceof TransactionServiceError);
  assert.strictEqual(tamperError.code, 'WRITE_GATE_DISABLED', 'globalThis override must have zero effect');
  delete globalThis.__BRIEFARENA_TEST_WRITES_ENABLED__;

  console.log('✓ PASS: Submission blocked by closed write gate; console/global tampering cannot open the gate.\n');
  passedTests++;

  // -------------------------------------------------------------
  // Enable Build Gate for Isolated In-Memory Tests (proving enabled build reaches real code path)
  // -------------------------------------------------------------
  console.log('[Setup] Loading intentionally enabled isolated test build (VITE_WRITES_ENABLED=true)...');
  process.env.VITE_WRITES_ENABLED = 'true';
  viteServer.moduleGraph.invalidateAll();
  const enabledControllerModule = await viteServer.ssrLoadModule('/src/services/transactionController.ts');
  const enabledServiceModule = await viteServer.ssrLoadModule('/src/services/transactionService.ts');
  assert.strictEqual(enabledServiceModule.WRITES_ENABLED, true, 'WRITES_ENABLED must be true in enabled build');
  TransactionController = enabledControllerModule.TransactionController;
  persistTransactionRecord = enabledControllerModule.persistTransactionRecord;
  getPersistedTransaction = enabledControllerModule.getPersistedTransaction;
  clearPersistedTransaction = enabledControllerModule.clearPersistedTransaction;
  computeActionKey = enabledControllerModule.computeActionKey;

  // -------------------------------------------------------------
  // Test 6: Enabled Build: kit.estimate failure surfaces FEE_ESTIMATION_FAILED and blocks confirm
  // -------------------------------------------------------------
  console.log('[Test 6] Enabled Build: kit.estimate failure surfaces FEE_ESTIMATION_FAILED and blocks confirm');
  const controllerQuoteFail = new TransactionController(validCreateParams);
  let caughtQuoteError = null;
  try {
    await controllerQuoteFail.estimateFee(failingKit);
  } catch (err) {
    caughtQuoteError = err;
  }
  assert.ok(caughtQuoteError, 'estimateFee must throw on failure');
  assert.strictEqual(caughtQuoteError.code, 'FEE_ESTIMATION_FAILED', 'Must wrap in FEE_ESTIMATION_FAILED');
  assert.ok(caughtQuoteError.message.includes('Studio Next RPC timeout'));
  const stateQuoteFail = controllerQuoteFail.getState();
  assert.strictEqual(stateQuoteFail.phase, 'error', 'Phase must be error');
  assert.strictEqual(stateQuoteFail.canConfirm, false, 'canConfirm must be false');
  console.log('✓ PASS: In enabled build, quote estimation failure correctly delegates and surfaces.\n');
  passedTests++;

  // -------------------------------------------------------------
  // Test 6b: Enabled Build: Successful Fee Quoting & Value Attachment
  // -------------------------------------------------------------
  console.log('[Test 6b] Enabled Build: Fee quote succeeds with exact attached prize and calldata arguments');
  const mockQuoteResult = {
    distribution: {},
    feeValue: 5000000000000000n, // 0.005 GEN
    userValue: 25000000000000000000n, // 25 GEN attached escrow
    total: 25005000000000000000n,
    source: 'network-default',
    verification: { status: 'verified' },
    breakdown: {
      timeUnitFees: 1000000000000000n,
      executionBudget: 3500000000000000n,
      messageFees: 500000000000000n,
    },
    caps: { genPerTimeUnit: 1000n, storagePrice: 1000n, receiptPrice: 500n },
    refundable: true,
  };

  let capturedPolicyInput = null;
  let capturedSubmitInput = null;
  const successfulKit = {
    estimate: async (policyInput, submitInput) => {
      capturedPolicyInput = policyInput;
      capturedSubmitInput = submitInput;
      return mockQuoteResult;
    },
    submit: async () => ({
      genlayerTxId: '0x1111222233334444555566667777888899990000111122223333444455556666',
    }),
    track: async () => {},
  };

  const controllerSuccessQuote = new TransactionController(validCreateParams);
  const quote = await controllerSuccessQuote.estimateFee(successfulKit);
  assert.strictEqual(quote.userValue, 25n * 10n ** 18n, 'PolicyQuote must carry 25 GEN userValue');
  assert.strictEqual(capturedPolicyInput.userValue, 25n * 10n ** 18n, 'PolicyInput must receive attached prize');
  assert.strictEqual(capturedSubmitInput.args.length, 6, 'create_challenge calldata has exactly 6 args');
  assert.strictEqual(controllerSuccessQuote.getState().phase, 'ready_to_confirm');
  assert.strictEqual(controllerSuccessQuote.getState().canConfirm, true, 'canConfirm must be true in enabled build');
  console.log('✓ PASS: Fee quote succeeds with exact attached prize and calldata arguments in enabled build.\n');
  passedTests++;

  // -------------------------------------------------------------
  // Test 7: Duplicate Prevention on Re-Submission & Fail-Closed Persistence
  // -------------------------------------------------------------
  console.log('[Test 7] Duplicate Prevention: in-flight transactions block duplicate submission and retain block beyond 5 minutes');
  const tempCtrl = new TransactionController(validCreateParams);
  const actionKey = tempCtrl.getActionKey();
  clearPersistedTransaction(actionKey);

  // Simulate an in-flight persisted record submitted 10 minutes ago
  persistTransactionRecord({
    txId: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd',
    actionKey,
    rpcUrl: 'https://studio-next.genlayer.com/rpc',
    chainId: 61997,
    contractAddress: validContractAddress,
    walletAddress: validWallet.address,
    actionType: 'challenge_creation',
    args: ['arg1'],
    userValueWei: '25000000000000000000',
    submittedAt: Date.now() - 600000, // 10 minutes ago - proving 5 minutes does NOT release block!
    status: 'submitted',
    explorerLink: 'https://studio-next.genlayer.com/explorer/tx/0xabcdef...',
  });

  const persisted = getPersistedTransaction(actionKey);
  assert.ok(persisted, 'Persisted record must be retrievable');
  assert.strictEqual(persisted.txId, '0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd');

  // New controller instantiated with same actionKey detects in-flight transaction
  const controllerDuplicate = new TransactionController(validCreateParams);
  assert.strictEqual(controllerDuplicate.getState().isDuplicateBlocked, true, 'Must detect duplicate in-flight even after 10 minutes');

  let caughtDupError = null;
  try {
    await controllerDuplicate.submit(successfulKit);
  } catch (err) {
    caughtDupError = err;
  }
  assert.ok(caughtDupError, 'Must reject duplicate submission');
  assert.strictEqual(caughtDupError.code, 'DISPATCH_FAILED');
  assert.ok(caughtDupError.message.includes('already in flight'));

  clearPersistedTransaction(actionKey);
  console.log('✓ PASS: In-flight duplicate submission rejected and block retained beyond 5 minutes.\n');
  passedTests++;

  // -------------------------------------------------------------
  // Test 8: Execution Failure vs Consensus Finalized Separation
  // -------------------------------------------------------------
  console.log('[Test 8] Consensus Separation: FINISHED_WITH_ERROR must resolve to execution_failed (never success)');
  const executionFailedStatus = {
    phase: 'finalized',
    statusName: 'FINALIZED',
    executionResultName: 'FINISHED_WITH_ERROR',
    successful: false,
    genlayerTxId: '0x2222333344445555666677778888999900001111222233334444555566667777',
  };

  assert.strictEqual(isExecutionSuccessful(executionFailedStatus), false, 'FINISHED_WITH_ERROR must NOT be execution successful');

  const kitWithFailedExecution = {
    track: async (txId, onUpdate) => {
      onUpdate(executionFailedStatus);
      return executionFailedStatus;
    },
  };

  const controllerExecFail = new TransactionController(validCreateParams);
  await controllerExecFail.track(kitWithFailedExecution, executionFailedStatus.genlayerTxId);

  const finalExecFailState = controllerExecFail.getState();
  assert.strictEqual(finalExecFailState.phase, 'execution_failed', 'Phase must resolve to execution_failed');
  assert.strictEqual(finalExecFailState.trackedStatus.executionResultName, 'FINISHED_WITH_ERROR');
  console.log('✓ PASS: Reverted/errored transactions correctly resolve to execution_failed regardless of consensus finalization.\n');
  passedTests++;

  // -------------------------------------------------------------
  // Test 9: Confirmed Success and State Refresh
  // -------------------------------------------------------------
  console.log('[Test 9] Confirmed Success: FINISHED_WITH_RETURN triggers onSuccessRefresh and updates state');
  const executionSuccessStatus = {
    phase: 'finalized',
    statusName: 'FINALIZED',
    executionResultName: 'FINISHED_WITH_RETURN',
    successful: true,
    genlayerTxId: '0x3333444455556666777788889999000011112222333344445555666677778888',
  };

  assert.strictEqual(isExecutionSuccessful(executionSuccessStatus), true, 'FINISHED_WITH_RETURN + successful must be true');

  let refreshCalled = false;
  const mockRefreshCallback = async () => {
    refreshCalled = true;
  };

  const kitWithSuccessfulExecution = {
    track: async (txId, onUpdate) => {
      onUpdate(executionSuccessStatus);
      return executionSuccessStatus;
    },
  };

  const controllerSuccess = new TransactionController(validCreateParams, mockRefreshCallback);
  await controllerSuccess.track(kitWithSuccessfulExecution, executionSuccessStatus.genlayerTxId);

  const finalSuccessState = controllerSuccess.getState();
  assert.strictEqual(finalSuccessState.phase, 'success', 'Phase must be success');
  assert.strictEqual(refreshCalled, true, 'onSuccessRefresh callback must be triggered');
  assert.strictEqual(finalSuccessState.isRefreshed, true, 'isRefreshed must be true');
  console.log('✓ PASS: Confirmed success triggers state refresh and updates tracking.\n');
  passedTests++;

  // -------------------------------------------------------------
  // Test 10: Withdraw Parent-Success Without Child Evidence (Delivery Unverified)
  // -------------------------------------------------------------
  console.log('[Test 10] Withdraw Flow: Parent success without child evidence resolves to "delivery unverified" (never confirmed)');
  const withdrawParams = {
    actionType: 'withdraw',
    walletState: validWallet,
    contractAddress: validContractAddress,
    claimableCreditWei: 10000000000000000000n, // 10 GEN credit
  };

  const withdrawSuccessStatusNoChild = {
    phase: 'finalized',
    statusName: 'FINALIZED',
    executionResultName: 'FINISHED_WITH_RETURN',
    successful: true,
    genlayerTxId: '0x4444555566667777888899990000111122223333444455556666777788889999',
  };

  const kitWithdrawNoChild = {
    track: async (txId, onUpdate) => {
      onUpdate({ phase: 'processing', statusName: 'PROCESSING' });
      onUpdate(withdrawSuccessStatusNoChild);
      return withdrawSuccessStatusNoChild;
    },
    // No triggered transactions available
  };

  const controllerWithdrawNoChild = new TransactionController(withdrawParams);
  await controllerWithdrawNoChild.track(kitWithdrawNoChild, withdrawSuccessStatusNoChild.genlayerTxId);

  const finalWithdrawStateNoChild = controllerWithdrawNoChild.getState();
  assert.strictEqual(finalWithdrawStateNoChild.phase, 'success', 'Parent call succeeds');
  assert.strictEqual(
    finalWithdrawStateNoChild.childTransferStatus,
    'unverified',
    'Child transfer status must be "unverified" when child transaction evidence is unavailable; never "confirmed"'
  );
  assert.strictEqual(
    finalWithdrawStateNoChild.observedChildFields,
    null,
    'Observed child fields must be null when no child receipt exists (do not label expected fields as observed evidence)'
  );
  console.log('✓ PASS: Parent success without child evidence correctly marks childTransferStatus as "unverified" (never confirmed) and observedChildFields as null.\n');
  passedTests++;

  // -------------------------------------------------------------
  // Test 11: Withdraw Flow: FINISHED_WITH_RETURN alone is insufficient; requires explicit value_credited === true
  // -------------------------------------------------------------
  console.log('[Test 11] Strict Native Delivery Proof: FINISHED_WITH_RETURN alone is insufficient; requires explicit value_credited === true');
  const childTxHash = '0x9999888877776666555544443333222211110000999988887777666655554444';
  const parentWithEthSendMsg = {
    ...withdrawSuccessStatusNoChild,
    messages: [
      {
        is_eth_send: true,
        to: validWallet.address,
        value: '10000000000000000000',
        child_tx_hash: childTxHash,
      },
    ],
  };

  // 11a: Child has FINISHED_WITH_RETURN, but lacks value_credited === true
  const kitWithdrawNoValueCredited = {
    track: async (txId, onUpdate) => {
      onUpdate(parentWithEthSendMsg);
      return parentWithEthSendMsg;
    },
    getTriggeredTransactionIds: async () => [childTxHash],
    getTransaction: async ({ hash }) => {
      if (hash === childTxHash) {
        return {
          from: validContractAddress,
          to: validWallet.address,
          value: '10000000000000000000',
          executionResultName: 'FINISHED_WITH_RETURN',
          statusName: 'FINALIZED',
          successful: true,
          is_eth_send: true,
          // value_credited is missing / undefined!
        };
      }
      return null;
    },
  };

  const controllerWithdrawNoValueCredited = new TransactionController(withdrawParams);
  await controllerWithdrawNoValueCredited.track(kitWithdrawNoValueCredited, withdrawSuccessStatusNoChild.genlayerTxId);

  const finalNoValueCreditedState = controllerWithdrawNoValueCredited.getState();
  assert.strictEqual(
    finalNoValueCreditedState.childTransferStatus,
    'unverified',
    'Child transfer status must remain unverified when child lacks explicit value_credited === true, even with FINISHED_WITH_RETURN'
  );
  console.log('  - Sub-test 11a: FINISHED_WITH_RETURN alone without value_credited=true strictly resolves to unverified.');

  // 11b: Child has explicit value_credited === true
  const kitWithdrawWithChild = {
    track: async (txId, onUpdate) => {
      onUpdate(parentWithEthSendMsg);
      return parentWithEthSendMsg;
    },
    getTriggeredTransactionIds: async () => [childTxHash],
    getTransaction: async ({ hash }) => {
      if (hash === childTxHash) {
        return {
          from: validContractAddress,
          to: validWallet.address,
          value: '10000000000000000000',
          executionResultName: 'FINISHED_WITH_RETURN',
          statusName: 'FINALIZED',
          successful: true,
          is_eth_send: true,
          value_credited: true,
        };
      }
      return null;
    },
  };

  const controllerWithdrawConfirmed = new TransactionController(withdrawParams);
  await controllerWithdrawConfirmed.track(kitWithdrawWithChild, withdrawSuccessStatusNoChild.genlayerTxId);

  const finalConfirmedState = controllerWithdrawConfirmed.getState();
  assert.strictEqual(finalConfirmedState.childTransferStatus, 'confirmed', 'Child transfer status must be confirmed with explicit value_credited === true');
  assert.strictEqual(finalConfirmedState.childTxId, childTxHash, 'Child transaction ID must be captured');
  console.log('✓ PASS: Child transfer delivery confirmed only with explicit value_credited === true; FINISHED_WITH_RETURN alone is insufficient.\n');
  passedTests++;

  // -------------------------------------------------------------
  // Test 11b: Child Transfer Proof with FINALIZED + FINISHED_WITH_ERROR
  // -------------------------------------------------------------
  console.log('[Test 11b] Child Transfer Proof: FINALIZED + FINISHED_WITH_ERROR strictly resolves to failed (never confirmed)');
  const childFailedTxHash = '0xaaaa111122223333444455556666777788889999aaaabbbbccccddddeeeeffff';
  const kitWithdrawFailedChild = {
    track: async (txId, onUpdate) => {
      onUpdate(parentWithEthSendMsg);
      return parentWithEthSendMsg;
    },
    getTriggeredTransactionIds: async () => [childFailedTxHash],
    getTransaction: async ({ hash }) => {
      if (hash === childFailedTxHash) {
        return {
          from: validContractAddress,
          to: validWallet.address,
          value: '10000000000000000000',
          executionResultName: 'FINISHED_WITH_ERROR',
          statusName: 'FINALIZED',
          successful: false,
        };
      }
      return null;
    },
  };

  const controllerWithdrawFailed = new TransactionController(withdrawParams);
  await controllerWithdrawFailed.track(kitWithdrawFailedChild, withdrawSuccessStatusNoChild.genlayerTxId);

  const finalFailedChildState = controllerWithdrawFailed.getState();
  assert.strictEqual(finalFailedChildState.childTransferStatus, 'failed', 'Child transfer status must be failed when executionResultName is FINISHED_WITH_ERROR');
  assert.notStrictEqual(finalFailedChildState.childTransferStatus, 'confirmed', 'FINALIZED alone must never result in confirmed');
  console.log('✓ PASS: FINALIZED + FINISHED_WITH_ERROR child receipt strictly resolves to failed (never confirmed).\n');
  passedTests++;

  // -------------------------------------------------------------
  // Test 11c: Studio Next Behavior (REVIEWER_EVIDENCE.md) - Genuine matching Studio Next native transfer
  // -------------------------------------------------------------
  console.log('[Test 11c] Studio Next Child Proof: NOT_VOTED / NO_MAJORITY with value_credited=true resolves to confirmed');
  const childStudioNextHash = '0x9999888877776666555544443333222211110000aaaabbbbccccddddeeeeffff';
  const kitWithdrawStudioNextChild = {
    track: async (txId, onUpdate) => {
      // Track returns parent status without message fields, forcing parent receipt fetch
      onUpdate(withdrawSuccessStatusNoChild);
      return withdrawSuccessStatusNoChild;
    },
    getTriggeredTransactionIds: async () => [childStudioNextHash],
    getTransaction: async ({ hash }) => {
      if (hash === withdrawSuccessStatusNoChild.genlayerTxId) {
        // Return full parent receipt with messages
        return {
          executionResultName: 'FINISHED_WITH_RETURN',
          statusName: 'FINALIZED',
          successful: true,
          messages: [
            {
              is_eth_send: true,
              to: validWallet.address,
              value: '10000000000000000000',
              child_tx_hash: childStudioNextHash,
            },
          ],
        };
      }
      if (hash === childStudioNextHash) {
        return {
          from: validContractAddress,
          to: validWallet.address,
          value: '10000000000000000000',
          is_eth_send: true,
          value_credited: true,
          statusName: 'NOT_VOTED',
          executionResultName: 'NOT_VOTED',
          successful: true,
        };
      }
      return null;
    },
  };

  const controllerWithdrawStudioNext = new TransactionController(withdrawParams);
  await controllerWithdrawStudioNext.track(kitWithdrawStudioNextChild, withdrawSuccessStatusNoChild.genlayerTxId);

  const finalStudioNextState = controllerWithdrawStudioNext.getState();
  assert.strictEqual(finalStudioNextState.childTransferStatus, 'confirmed', 'Studio Next child transfer must resolve to confirmed when value_credited is true');
  assert.strictEqual(finalStudioNextState.childTxId, childStudioNextHash, 'Child transaction ID must be captured');
  assert.ok(finalStudioNextState.observedChildFields, 'Observed child fields must be populated');
  assert.strictEqual(finalStudioNextState.observedChildFields.valueCredited, true);
  assert.strictEqual(finalStudioNextState.observedChildFields.statusName, 'NOT_VOTED');
  console.log('✓ PASS: Genuine matching Studio Next native transfer with NOT_VOTED + value_credited=true resolves to confirmed.\n');
  passedTests++;

  // -------------------------------------------------------------
  // Test 11d: Missing Parent Message Check
  // -------------------------------------------------------------
  console.log('[Test 11d] Strict Proof: Missing parent is_eth_send message strictly resolves to unverified');
  const kitMissingParentMsg = {
    track: async (txId, onUpdate) => {
      onUpdate(withdrawSuccessStatusNoChild); // lacks messages
      return withdrawSuccessStatusNoChild;
    },
    getTransaction: async ({ hash }) => {
      if (hash === withdrawSuccessStatusNoChild.genlayerTxId) {
        return {
          executionResultName: 'FINISHED_WITH_RETURN',
          statusName: 'FINALIZED',
          successful: true,
          messages: [], // empty messages
        };
      }
      return {
        from: validContractAddress,
        to: validWallet.address,
        value: '10000000000000000000',
        value_credited: true,
      };
    },
  };

  const ctrlMissingParentMsg = new TransactionController(withdrawParams);
  await ctrlMissingParentMsg.track(kitMissingParentMsg, withdrawSuccessStatusNoChild.genlayerTxId);
  assert.strictEqual(
    ctrlMissingParentMsg.getState().childTransferStatus,
    'unverified',
    'Must remain unverified when parent lacks matching is_eth_send message'
  );
  console.log('✓ PASS: Missing parent message strictly resolves to unverified.\n');
  passedTests++;

  // -------------------------------------------------------------
  // Test 11e: Missing Sender, Recipient, or Value Fields
  // -------------------------------------------------------------
  console.log('[Test 11e] Strict Proof: Missing sender, recipient, or value fields resolves to unverified');
  const childMissingFieldsHash = '0x1111222233334444555566667777888899990000111122223333444455556666';
  const kitMissingFields = {
    track: async (txId, onUpdate) => {
      onUpdate(parentWithEthSendMsg);
      return parentWithEthSendMsg;
    },
    getTriggeredTransactionIds: async () => [childMissingFieldsHash],
    getTransaction: async ({ hash }) => {
      if (hash === childMissingFieldsHash) {
        return {
          from: validContractAddress,
          // Missing recipient 'to'!
          value: '10000000000000000000',
          value_credited: true,
          statusName: 'NOT_VOTED',
        };
      }
      return null;
    },
  };

  const ctrlMissingFields = new TransactionController(withdrawParams);
  await ctrlMissingFields.track(kitMissingFields, withdrawSuccessStatusNoChild.genlayerTxId);
  assert.strictEqual(
    ctrlMissingFields.getState().childTransferStatus,
    'unverified',
    'Must remain unverified when child lacks required recipient field'
  );
  console.log('✓ PASS: Missing required child fields strictly resolves to unverified.\n');
  passedTests++;

  // -------------------------------------------------------------
  // Test 11f: Wrong Transfer Amount
  // -------------------------------------------------------------
  console.log('[Test 11f] Strict Proof: Wrong child wei amount strictly resolves to unverified');
  const childWrongAmountHash = '0x2222333344445555666677778888999900001111222233334444555566667777';
  const kitWrongAmount = {
    track: async (txId, onUpdate) => {
      onUpdate(parentWithEthSendMsg);
      return parentWithEthSendMsg;
    },
    getTriggeredTransactionIds: async () => [childWrongAmountHash],
    getTransaction: async ({ hash }) => {
      if (hash === childWrongAmountHash) {
        return {
          from: validContractAddress,
          to: validWallet.address,
          value: '5000000000000000000', // 5 GEN instead of 10 GEN!
          value_credited: true,
          statusName: 'NOT_VOTED',
        };
      }
      return null;
    },
  };

  const ctrlWrongAmount = new TransactionController(withdrawParams);
  await ctrlWrongAmount.track(kitWrongAmount, withdrawSuccessStatusNoChild.genlayerTxId);
  assert.strictEqual(
    ctrlWrongAmount.getState().childTransferStatus,
    'unverified',
    'Must remain unverified when child amount differs from expected credit'
  );
  console.log('✓ PASS: Wrong child transfer amount strictly resolves to unverified.\n');
  passedTests++;

  // -------------------------------------------------------------
  // Test 11g: Wrong Child Followed By Correct Child
  // -------------------------------------------------------------
  console.log('[Test 11g] Strict Proof: Wrong child followed by correct child confirms delivery on matching child');
  const childWrongHash = '0x3333444455556666777788889999000011112222333344445555666677778888';
  const childCorrectHash = '0x4444555566667777888899990000111122223333444455556666777788889999';
  const kitMultiChild = {
    track: async (txId, onUpdate) => {
      onUpdate(parentWithEthSendMsg);
      return parentWithEthSendMsg;
    },
    getTriggeredTransactionIds: async () => [childWrongHash, childCorrectHash],
    getTransaction: async ({ hash }) => {
      if (hash === childWrongHash) {
        // First child is unrelated or has wrong recipient
        return {
          from: validContractAddress,
          to: '0x0000000000000000000000000000000000000000',
          value: '10000000000000000000',
          value_credited: true,
          statusName: 'NOT_VOTED',
        };
      }
      if (hash === childCorrectHash) {
        // Second child is the exact matching transfer
        return {
          from: validContractAddress,
          to: validWallet.address,
          value: '10000000000000000000',
          value_credited: true,
          statusName: 'NOT_VOTED',
        };
      }
      return null;
    },
  };

  const ctrlMultiChild = new TransactionController(withdrawParams);
  await ctrlMultiChild.track(kitMultiChild, withdrawSuccessStatusNoChild.genlayerTxId);
  assert.strictEqual(
    ctrlMultiChild.getState().childTransferStatus,
    'confirmed',
    'Must confirm delivery when a subsequent triggered child matches all requirements'
  );
  assert.strictEqual(
    ctrlMultiChild.getState().childTxId,
    childCorrectHash,
    'Must capture the matching child transaction ID, not the wrong first child'
  );
  console.log('✓ PASS: All triggered child transactions inspected; confirmed on matching child.\n');
  passedTests++;

  // -------------------------------------------------------------
  // Test 11h: String value_credited="false" Must Never Count As True
  // -------------------------------------------------------------
  console.log('[Test 11h] Strict Proof: String value_credited="false" strictly parses as false (never confirmed)');
  const childFalseStringHash = '0x5555666677778888999900001111222233334444555566667777888899990000';
  const kitFalseString = {
    track: async (txId, onUpdate) => {
      onUpdate(parentWithEthSendMsg);
      return parentWithEthSendMsg;
    },
    getTriggeredTransactionIds: async () => [childFalseStringHash],
    getTransaction: async ({ hash }) => {
      if (hash === childFalseStringHash) {
        return {
          from: validContractAddress,
          to: validWallet.address,
          value: '10000000000000000000',
          value_credited: 'false', // string "false"
          statusName: 'NOT_VOTED',
          executionResultName: 'NOT_VOTED',
        };
      }
      return null;
    },
  };

  const ctrlFalseString = new TransactionController(withdrawParams);
  await ctrlFalseString.track(kitFalseString, withdrawSuccessStatusNoChild.genlayerTxId);
  assert.strictEqual(
    ctrlFalseString.getState().childTransferStatus,
    'unverified',
    'String "false" must never count as true; status must remain unverified'
  );
  console.log('✓ PASS: String value_credited="false" strictly parsed and rejected from confirming delivery.\n');
  passedTests++;

  // -------------------------------------------------------------
  // Test 11i: Lock Restoration and Stale Quote Clearing in updateParams
  // -------------------------------------------------------------
  console.log('[Test 11i] updateParams: Restores duplicate block from saved unresolved record and clears stale quotes on key change');
  const initialParams = {
    ...validCreateParams,
    createChallengeValues: {
      ...validCreateParams.createChallengeValues,
      title: 'Initial Title',
    },
  };
  const submittedParams = {
    ...validCreateParams,
    createChallengeValues: {
      ...validCreateParams.createChallengeValues,
      title: 'Submitted Form Title',
    },
  };

  const ctrlUpdateTest = new TransactionController(initialParams);
  const submittedActionKey = ctrlUpdateTest['deriveActionKey'](submittedParams);
  clearPersistedTransaction(submittedActionKey);

  // Set mock quote on initial state
  ctrlUpdateTest.getState().quote = { total: 100000n };
  ctrlUpdateTest.getState().canConfirm = true;

  // Persist unresolved transaction under submittedActionKey
  const savedTxId = '0x7777888899990000111122223333444455556666777788889999000011112222';
  persistTransactionRecord({
    txId: savedTxId,
    actionKey: submittedActionKey,
    rpcUrl: 'https://studio-next.genlayer.com/rpc',
    chainId: 61997,
    contractAddress: validContractAddress,
    walletAddress: validWallet.address,
    actionType: 'challenge_creation',
    args: ['Submitted Form Title'],
    userValueWei: '25000000000000000000',
    submittedAt: Date.now() - 1000,
    status: 'submitted',
  });

  // Call updateParams with submittedParams
  ctrlUpdateTest.updateParams(submittedParams);

  const updatedState = ctrlUpdateTest.getState();
  assert.strictEqual(updatedState.quote, null, 'Stale quote must be cleared when action identity changes');
  assert.strictEqual(updatedState.canConfirm, false, 'canConfirm must be reset to false');
  assert.strictEqual(updatedState.isDuplicateBlocked, true, 'isDuplicateBlocked must be restored from saved record');
  assert.strictEqual(updatedState.txId, savedTxId, 'Saved unresolved transaction ID must be restored');
  assert.strictEqual(updatedState.phase, 'tracking', 'Status/phase must be restored');

  // Verify submit() throws and blocks second submission
  await assert.rejects(
    async () => ctrlUpdateTest.submit({}),
    /already in flight/,
    'Second submit must be blocked when lock is restored'
  );

  // Transition to a third, clean params set: lock must be released
  const thirdParams = {
    ...validCreateParams,
    createChallengeValues: {
      ...validCreateParams.createChallengeValues,
      title: 'Third Fresh Title',
    },
  };
  ctrlUpdateTest.updateParams(thirdParams);
  assert.strictEqual(ctrlUpdateTest.getState().isDuplicateBlocked, false, 'Lock must be released for fresh action key');
  assert.strictEqual(ctrlUpdateTest.getState().txId, null, 'txId must be cleared');

  clearPersistedTransaction(submittedActionKey);
  console.log('✓ PASS: updateParams restores lock, blocks second submit, and clears stale quotes on identity change.\n');
  passedTests++;

  // -------------------------------------------------------------
  // Test 12: Fail-Closed Reconciliation and Reset Protections
  // -------------------------------------------------------------
  console.log('[Test 12] Fail-Closed Reconciliation: Unknown/failed lookup retains duplicate block; reset() refuses silent erasure');
  const testCtrlReconcile = new TransactionController(validCreateParams);
  const recActionKey = testCtrlReconcile.getActionKey();
  clearPersistedTransaction(recActionKey);

  const unresolvedTxId = '0x1234123412341234123412341234123412341234123412341234123412341234';
  persistTransactionRecord({
    txId: unresolvedTxId,
    actionKey: recActionKey,
    rpcUrl: 'https://studio-next.genlayer.com/rpc',
    chainId: 61997,
    contractAddress: validContractAddress,
    walletAddress: validWallet.address,
    actionType: 'challenge_creation',
    args: ['arg1'],
    userValueWei: '25000000000000000000',
    submittedAt: Date.now() - 3600000,
    status: 'submitted',
    explorerLink: `https://studio-next.genlayer.com/explorer/tx/${unresolvedTxId}`,
  });

  const reloadedCtrl = new TransactionController(validCreateParams);
  assert.strictEqual(reloadedCtrl.getState().isDuplicateBlocked, true, 'Reloaded controller detects persisted unresolved tx');
  assert.strictEqual(reloadedCtrl.getState().txId, unresolvedTxId);

  // 12a: reconcile with failing lookup retains block
  const failingClient = {
    getTransaction: async () => {
      throw new Error('Network timeout contacting Studio Next RPC');
    },
  };
  await reloadedCtrl.reconcile(failingClient);
  assert.strictEqual(reloadedCtrl.getState().isDuplicateBlocked, true, 'Duplicate block must be retained after failed lookup');
  assert.ok(reloadedCtrl.getState().unresolvedMessage.includes(unresolvedTxId), 'Must surface saved tx ID for manual review');

  // 12b: reset() without force fails closed
  assert.throws(
    () => reloadedCtrl.reset(),
    /Cannot reset controller: transaction 0x1234.*still unresolved/,
    'reset() must not silently erase an unresolved transaction'
  );
  assert.ok(getPersistedTransaction(recActionKey), 'Transaction record must remain in store');

  // 12c: reset({ force: true }) clears it
  reloadedCtrl.reset({ force: true });
  assert.strictEqual(getPersistedTransaction(recActionKey), null, 'force reset must clear transaction record');
  assert.strictEqual(reloadedCtrl.getState().isDuplicateBlocked, false, 'Duplicate block released after force reset');
  console.log('✓ PASS: Fail-closed reconciliation and reset protections verified.\n');
  passedTests++;

  // -------------------------------------------------------------
  // Test 13: Ambiguous Broadcast Handling
  // -------------------------------------------------------------
  console.log('[Test 13] Ambiguous Broadcast: Unresolved broadcast failure marks record ambiguous and retains block');
  const ambCtrl = new TransactionController(validCreateParams);
  const ambActionKey = ambCtrl.getActionKey();
  clearPersistedTransaction(ambActionKey);

  const ambiguousTxId = '0xbbbbccccdddd9999888877776666555544443333222211110000111122223333';
  persistTransactionRecord({
    txId: ambiguousTxId,
    actionKey: ambActionKey,
    rpcUrl: 'https://studio-next.genlayer.com/rpc',
    chainId: 61997,
    contractAddress: validContractAddress,
    walletAddress: validWallet.address,
    actionType: 'challenge_creation',
    args: ['arg1'],
    userValueWei: '25000000000000000000',
    submittedAt: Date.now(),
    status: 'ambiguous',
    explorerLink: `https://studio-next.genlayer.com/explorer/tx/${ambiguousTxId}`,
  });

  const reloadedAmbCtrl = new TransactionController(validCreateParams);
  assert.strictEqual(reloadedAmbCtrl.getState().isDuplicateBlocked, true, 'Ambiguous record must retain duplicate block');
  assert.strictEqual(reloadedAmbCtrl.getState().phase, 'unknown', 'Phase must be unknown for ambiguous status');
  assert.ok(reloadedAmbCtrl.getState().unresolvedMessage.includes(ambiguousTxId), 'Must show ambiguous tx ID');

  clearPersistedTransaction(ambActionKey);
  console.log('✓ PASS: Ambiguous broadcast persists as ambiguous, fails closed, and blocks retry.\n');
  passedTests++;

  // -------------------------------------------------------------
  // Test 13b: No-Hash Ambiguous Submission Handling
  // -------------------------------------------------------------
  console.log('[Test 13b] No-Hash Ambiguous Submission: Error without returned ID records txId: null without zero hash invention');
  const noHashCtrl = new TransactionController(validCreateParams);
  const noHashActionKey = noHashCtrl.getActionKey();
  clearPersistedTransaction(noHashActionKey);

  persistTransactionRecord({
    txId: null,
    actionKey: noHashActionKey,
    rpcUrl: 'https://studio-next.genlayer.com/rpc',
    chainId: 61997,
    contractAddress: validContractAddress,
    walletAddress: validWallet.address,
    actionType: 'challenge_creation',
    args: ['arg1'],
    userValueWei: '25000000000000000000',
    submittedAt: Date.now(),
    status: 'ambiguous',
    error: 'Network connection dropped after raw write packet',
    explorerLink: null,
  });

  const reloadedNoHashCtrl = new TransactionController(validCreateParams);
  const noHashState = reloadedNoHashCtrl.getState();
  assert.strictEqual(noHashState.isDuplicateBlocked, true, 'Duplicate submission must be blocked for no-hash ambiguous tx');
  assert.strictEqual(noHashState.txId, null, 'Must NOT invent a zero hash (txId must be null)');
  assert.strictEqual(noHashState.explorerLink, null, 'Must NOT invent an explorer link');
  assert.ok(noHashState.unresolvedMessage.includes('no returned transaction ID'), 'Must state no returned transaction ID');

  clearPersistedTransaction(noHashActionKey);
  console.log('✓ PASS: No-hash ambiguous submission records txId: null without zero hash or fake link.\n');
  passedTests++;

  // -------------------------------------------------------------
  // Test 14: Bound Records Verification
  // -------------------------------------------------------------
  console.log('[Test 14] Bound Records: Verifies actionKey binds RPC, chain ID, contract, wallet, action, args, and value');
  const key1 = computeActionKey({
    rpcUrl: 'https://studio-next.genlayer.com/rpc',
    chainId: 61997,
    contractAddress: validContractAddress,
    walletAddress: testWallet,
    actionType: 'challenge_creation',
    args: ['title1', 'cat1'],
    userValueWei: 10000000000000000000n,
  });

  const key2DifferentVal = computeActionKey({
    rpcUrl: 'https://studio-next.genlayer.com/rpc',
    chainId: 61997,
    contractAddress: validContractAddress,
    walletAddress: testWallet,
    actionType: 'challenge_creation',
    args: ['title1', 'cat1'],
    userValueWei: 20000000000000000000n, // Different value
  });

  const key3DifferentWallet = computeActionKey({
    rpcUrl: 'https://studio-next.genlayer.com/rpc',
    chainId: 61997,
    contractAddress: validContractAddress,
    walletAddress: '0x9999999999999999999999999999999999999999', // Different wallet
    actionType: 'challenge_creation',
    args: ['title1', 'cat1'],
    userValueWei: 10000000000000000000n,
  });

  assert.notStrictEqual(key1, key2DifferentVal, 'Different value must yield different actionKey');
  assert.notStrictEqual(key1, key3DifferentWallet, 'Different wallet must yield different actionKey');
  assert.ok(key1.includes('https://studio-next.genlayer.com/rpc'), 'Key must contain RPC URL');
  assert.ok(key1.includes('::61997::'), 'Key must contain chain ID');
  assert.ok(key1.includes(validContractAddress.toLowerCase()), 'Key must contain contract address');
  assert.ok(key1.includes(testWallet.toLowerCase()), 'Key must contain wallet address');
  assert.ok(key1.includes('challenge_creation'), 'Key must contain actionType');
  assert.ok(key1.includes('10000000000000000000'), 'Key must contain value in wei');
  console.log('✓ PASS: Records strictly bound to RPC, chain ID, contract, wallet, action, arguments, and value.\n');
  passedTests++;

  // -------------------------------------------------------------
  // Test 15: No Quote State and Zero Writes With Closed Gate
  // -------------------------------------------------------------
  console.log('[Test 15] Safety Invariants: No quote state has quote=null; closed gate rejects submit');
  const freshCtrl = new DefaultTransactionController(validCreateParams);
  const freshState = freshCtrl.getState();
  assert.strictEqual(freshState.quote, null, 'Initial quote must be null (no invented amounts)');
  assert.strictEqual(freshState.quoteError, null);
  assert.strictEqual(freshState.writesEnabled, false, 'WRITES_ENABLED must be false');
  assert.strictEqual(freshState.canConfirm, false, 'canConfirm must be false while writes disabled');

  // Verify submit() unconditionally throws WRITE_GATE_DISABLED
  let gateError = null;
  try {
    await freshCtrl.submit(failingKit);
  } catch (err) {
    gateError = err;
  }
  assert.ok(gateError, 'submit must reject with WRITE_GATE_DISABLED');
  assert.strictEqual(gateError.code, 'WRITE_GATE_DISABLED');
  console.log('✓ PASS: Zero writes enforced by closed gate; no fabricated quotes.\n');
  passedTests++;

  // -------------------------------------------------------------
  // Test 16: Pre-submission Parameter and Wallet Consistency Verification
  // -------------------------------------------------------------
  console.log('[Test 16] Pre-submission Match Verification: Argument or wallet mismatch rejects submission');
  const matchCtrl = new TransactionController(validCreateParams);
  const mockValidQuote = {
    feeValue: 5000000000000000n,
    userValue: 25000000000000000000n,
    total: 25005000000000000000n,
    distribution: {},
    breakdown: {},
    verification: { status: 'verified' },
  };
  const mockQuoteKit = {
    estimate: async () => mockValidQuote,
    submit: async () => ({ genlayerTxId: '0x123' }),
  };
  await matchCtrl.estimateFee(mockQuoteKit);
  assert.strictEqual(matchCtrl.getState().quote !== null, true);

  // Mutate arguments underneath to simulate user tampering or form changes after quoting
  matchCtrl.updateParams({
    ...validCreateParams,
    createChallengeValues: {
      ...validCreateParams.createChallengeValues,
      title: 'Completely Mutated Title After Quote',
    },
  });

  let mismatchError = null;
  try {
    await matchCtrl.submit(mockQuoteKit);
  } catch (err) {
    mismatchError = err;
  }
  assert.ok(mismatchError, 'submit must reject when parameters changed after quoting');
  assert.ok(
    mismatchError.message.includes('changed after fee quote'),
    'Must guard against parameter mismatch'
  );
  console.log('✓ PASS: Pre-submission parameter and wallet consistency verified.\n');
  passedTests++;

  // -------------------------------------------------------------
  // Test 17: Automatic Read-Only Reconciliation On Reload
  // -------------------------------------------------------------
  console.log('[Test 17] Automatic Read-Only Reconciliation: Reconciles saved unresolved tx on load');
  const tempAutoCtrl = new TransactionController(validCreateParams);
  const autoRecKey = tempAutoCtrl.getActionKey();
  clearPersistedTransaction(autoRecKey);

  const autoTxId = '0x7777888899990000111122223333444455556666777788889999000011112222';
  persistTransactionRecord({
    txId: autoTxId,
    actionKey: autoRecKey,
    rpcUrl: 'https://studio-next.genlayer.com/rpc',
    chainId: 61997,
    contractAddress: validContractAddress,
    walletAddress: validWallet.address,
    actionType: 'challenge_creation',
    args: [],
    userValueWei: '25000000000000000000',
    submittedAt: Date.now() - 1000,
    status: 'submitted',
    explorerLink: `https://studio-next.genlayer.com/explorer/tx/${autoTxId}`,
  });

  const mockReadOnlyClient = {
    getTransaction: async ({ hash }) => {
      if (hash === autoTxId) {
        return {
          executionResultName: 'FINISHED_WITH_RETURN',
          statusName: 'FINALIZED',
          successful: true,
        };
      }
      return null;
    },
  };

  const autoRecCtrl = new TransactionController(validCreateParams);
  assert.strictEqual(autoRecCtrl.getState().isDuplicateBlocked, true, 'Initially duplicate blocked on load');

  // Reconcile using read-only client
  await autoRecCtrl.reconcile(mockReadOnlyClient);
  assert.strictEqual(autoRecCtrl.getState().phase, 'success', 'Must resolve to success after reconciliation');
  assert.strictEqual(autoRecCtrl.getState().isDuplicateBlocked, false, 'Must unblock submission after success');
  clearPersistedTransaction(autoRecKey);
  console.log('✓ PASS: Automatic read-only reconciliation resolves terminal state and unblocks.\n');
  passedTests++;

  // -------------------------------------------------------------
  // Test 18: Wallet Reconnect Reconciliation
  // -------------------------------------------------------------
  console.log('[Test 18] Wallet Reconnect Reconciliation: Reconciles saved unresolved tx on address change');
  const reconnectWallet = {
    ...validWallet,
    address: '0x4444555566667777888899990000111122223333',
  };
  const reconnectParams = {
    ...validCreateParams,
    walletState: reconnectWallet,
  };
  const reconnectCtrl = new TransactionController(reconnectParams);
  const reconnectActionKey = reconnectCtrl.getActionKey();
  clearPersistedTransaction(reconnectActionKey);

  const reconnTxId = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
  persistTransactionRecord({
    txId: reconnTxId,
    actionKey: reconnectActionKey,
    rpcUrl: 'https://studio-next.genlayer.com/rpc',
    chainId: 61997,
    contractAddress: validContractAddress,
    walletAddress: reconnectWallet.address,
    actionType: 'challenge_creation',
    args: [],
    userValueWei: '10000000000000000000',
    submittedAt: Date.now() - 2000,
    status: 'submitted',
    explorerLink: `https://studio-next.genlayer.com/explorer/tx/${reconnTxId}`,
  });

  const mockReconnectClient = {
    getTransaction: async ({ hash }) => {
      if (hash === reconnTxId) {
        return {
          executionResultName: 'FINISHED_WITH_RETURN',
          statusName: 'FINALIZED',
          successful: true,
        };
      }
      return null;
    },
  };

  const ctrlBeforeReconn = new TransactionController(reconnectParams);
  assert.strictEqual(ctrlBeforeReconn.getState().isDuplicateBlocked, true, 'Block active for reconnect wallet');
  await ctrlBeforeReconn.reconcile(mockReconnectClient);
  assert.strictEqual(ctrlBeforeReconn.getState().phase, 'success');
  assert.strictEqual(ctrlBeforeReconn.getState().isDuplicateBlocked, false);
  clearPersistedTransaction(reconnectActionKey);
  // -------------------------------------------------------------
  // Test 19: Wei Precision Beyond JavaScript Safe Integer Range (> 2^53 - 1)
  // -------------------------------------------------------------
  console.log('[Test 19] Wei Precision: Exact credit amounts beyond Number.MAX_SAFE_INTEGER preserved without float rounding');
  const hugeWeiAmount = 15000000000000000001n; // 15 GEN + 1 wei (> 2^53 - 1 = 9007199254740991)
  const hugeWeiStr = '15000000000000000001';
  const floatRoundedStr = '15000000000000000000'; // What Number(hugeWeiAmount) would produce

  assert.ok(
    BigInt(hugeWeiAmount) > BigInt(Number.MAX_SAFE_INTEGER),
    'Test amount must be beyond Number.MAX_SAFE_INTEGER'
  );
  assert.notStrictEqual(
    String(Number(hugeWeiAmount)),
    hugeWeiStr,
    'JavaScript Number must lose precision on this amount'
  );

  const hugeWeiWithdrawParams = {
    actionType: 'withdraw',
    walletState: validWallet,
    contractAddress: validContractAddress,
    claimableCreditWei: hugeWeiAmount,
  };

  // Validate preconditions accepts exact bigint
  const hugePrecond = validateActionPreconditions(hugeWeiWithdrawParams);
  assert.strictEqual(hugePrecond.isValid, true, 'Exact huge wei amount must pass precondition check');

  const hugeCtrl = new TransactionController(hugeWeiWithdrawParams);
  const hugeActionKey = hugeCtrl.getActionKey();
  clearPersistedTransaction(hugeActionKey);

  const hugeParentTxId = '0xeeee111122223333444455556666777788889999000011112222333344445555';
  const hugeChildExactHash = '0xeeee66667777888899990000111122223333444455556666777788889999aaaa';
  const hugeChildRoundedHash = '0xeeee888899990000111122223333444455556666777788889999aaaabbbbcccc';

  // Persist record with exact wei string
  persistTransactionRecord({
    txId: hugeParentTxId,
    actionKey: hugeActionKey,
    rpcUrl: 'https://studio-next.genlayer.com/rpc',
    chainId: 61997,
    contractAddress: validContractAddress,
    walletAddress: validWallet.address,
    actionType: 'withdraw',
    args: [],
    userValueWei: '0',
    claimableCreditWei: hugeWeiStr,
    submittedAt: Date.now() - 1000,
    status: 'submitted',
  });

  // 19a: Rounded child transfer is strictly rejected as unverified
  const kitRoundedChild = {
    getTransaction: async ({ hash }) => {
      if (hash === hugeParentTxId) {
        return {
          executionResultName: 'FINISHED_WITH_RETURN',
          statusName: 'FINALIZED',
          successful: true,
          messages: [
            {
              is_eth_send: true,
              to: validWallet.address,
              value: floatRoundedStr, // Rounded value
              child_tx_hash: hugeChildRoundedHash,
            },
          ],
        };
      }
      if (hash === hugeChildRoundedHash) {
        return {
          from: validContractAddress,
          to: validWallet.address,
          value: floatRoundedStr,
          value_credited: true,
          statusName: 'NOT_VOTED',
        };
      }
      return null;
    },
  };

  const ctrlRoundedVerify = new TransactionController(hugeWeiWithdrawParams);
  await ctrlRoundedVerify.reconcile(kitRoundedChild);
  assert.strictEqual(
    ctrlRoundedVerify.getState().childTransferStatus,
    'unverified',
    'Rounded child transfer amount must NOT match exact wei expectation'
  );
  console.log('  - Sub-test 19a: Rounded child transfer strictly rejected as unverified.');

  // 19b: Exact wei child transfer confirms with exact wei precision
  const kitExactChild = {
    getTransaction: async ({ hash }) => {
      if (hash === hugeParentTxId) {
        return {
          executionResultName: 'FINISHED_WITH_RETURN',
          statusName: 'FINALIZED',
          successful: true,
          messages: [
            {
              is_eth_send: true,
              to: validWallet.address,
              value: hugeWeiStr, // Exact 15000000000000000001
              child_tx_hash: hugeChildExactHash,
            },
          ],
        };
      }
      if (hash === hugeChildExactHash) {
        return {
          from: validContractAddress,
          to: validWallet.address,
          value: hugeWeiStr,
          value_credited: true,
          statusName: 'NOT_VOTED',
        };
      }
      return null;
    },
  };

  const ctrlExactVerify = new TransactionController(hugeWeiWithdrawParams);
  await ctrlExactVerify.reconcile(kitExactChild);
  assert.strictEqual(
    ctrlExactVerify.getState().childTransferStatus,
    'confirmed',
    'Exact wei child transfer must confirm'
  );
  assert.strictEqual(
    ctrlExactVerify.getState().observedChildFields.amountWei,
    hugeWeiStr,
    'Observed child amount must match exact wei string without truncation'
  );
  clearPersistedTransaction(hugeActionKey);
  console.log('✓ PASS: Wei precision beyond MAX_SAFE_INTEGER preserved and verified exactly.\n');
  passedTests++;

  // -------------------------------------------------------------
  // Test 20: Successful Withdraw Followed by Credit Becoming Zero and Page Reload
  // -------------------------------------------------------------
  console.log('[Test 20] Withdraw Lifecycle: Pre-submit credit persisted and used for reconciliation after credit becomes 0 on reload');
  const preSubmitCreditWei = 10000000000000000000n; // 10 GEN
  const preSubmitCreditStr = '10000000000000000000';

  const initialWithdrawParams = {
    actionType: 'withdraw',
    walletState: validWallet,
    contractAddress: validContractAddress,
    claimableCreditWei: preSubmitCreditWei,
  };

  const initialWithdrawCtrl = new TransactionController(initialWithdrawParams);
  const withdrawLifecycleActionKey = initialWithdrawCtrl.getActionKey();
  clearPersistedTransaction(withdrawLifecycleActionKey);

  const withdrawParentTxId = '0xdddd111122223333444455556666777788889999000011112222333344445555';
  const withdrawChildTxId = '0xdddd66667777888899990000111122223333444455556666777788889999aaaa';

  // Simulate in-flight submission record saved before reload
  persistTransactionRecord({
    txId: withdrawParentTxId,
    actionKey: withdrawLifecycleActionKey,
    rpcUrl: 'https://studio-next.genlayer.com/rpc',
    chainId: 61997,
    contractAddress: validContractAddress,
    walletAddress: validWallet.address,
    actionType: 'withdraw',
    args: [],
    userValueWei: '0',
    claimableCreditWei: preSubmitCreditStr,
    submittedAt: Date.now() - 5000,
    status: 'submitted',
    childTransferStatus: 'pending',
  });

  // Now simulate page reload after on-chain withdraw executed:
  // On-chain get_credit() returns 0n, so MyArenaPage initializes controllerParams with claimableCreditWei: 0n!
  const reloadedWithdrawParams = {
    actionType: 'withdraw',
    walletState: validWallet,
    contractAddress: validContractAddress,
    claimableCreditWei: 0n, // REFRESHED CURRENT CREDIT IS ZERO
  };

  const reloadedWithdrawCtrl = new TransactionController(reloadedWithdrawParams);
  assert.strictEqual(
    reloadedWithdrawCtrl.getActionKey(),
    withdrawLifecycleActionKey,
    'Action key for withdraw must match across reload despite current credit being 0'
  );
  assert.strictEqual(
    reloadedWithdrawCtrl.getState().isDuplicateBlocked,
    true,
    'Unresolved submitted withdraw must block duplicate on reload'
  );
  assert.strictEqual(
    reloadedWithdrawCtrl.getState().childTransferStatus,
    'pending',
    'Pending child status must be restored on reload'
  );

  // Client returns parent with the pre-submit amount and child transfer
  const reloadMockClient = {
    getTransaction: async ({ hash }) => {
      if (hash === withdrawParentTxId) {
        return {
          executionResultName: 'FINISHED_WITH_RETURN',
          statusName: 'FINALIZED',
          successful: true,
          messages: [
            {
              is_eth_send: true,
              to: validWallet.address,
              value: preSubmitCreditStr,
              child_tx_hash: withdrawChildTxId,
            },
          ],
        };
      }
      if (hash === withdrawChildTxId) {
        return {
          from: validContractAddress,
          to: validWallet.address,
          value: preSubmitCreditStr,
          value_credited: true,
          statusName: 'NOT_VOTED',
        };
      }
      return null;
    },
  };

  // Reconcile on reload: Must use saved claimableCreditWei (10 GEN), NOT the current 0 credit!
  await reloadedWithdrawCtrl.reconcile(reloadMockClient);

  const reloadedState = reloadedWithdrawCtrl.getState();
  assert.strictEqual(
    reloadedState.phase,
    'success',
    'Parent withdraw execution must be marked success'
  );
  assert.strictEqual(
    reloadedState.childTransferStatus,
    'confirmed',
    'Child transfer must be confirmed using persisted pre-submit credit, even though current credit is 0'
  );
  assert.strictEqual(
    reloadedState.childTxId,
    withdrawChildTxId,
    'Child transaction ID must be captured'
  );

  // Now simulate a second page reload when transaction is already marked success
  const subsequentReloadCtrl = new TransactionController(reloadedWithdrawParams);
  const subsequentState = subsequentReloadCtrl.getState();
  assert.strictEqual(
    subsequentState.childTransferStatus,
    'confirmed',
    'Confirmed child transfer status must be restored on subsequent reload'
  );
  assert.strictEqual(
    subsequentState.childTxId,
    withdrawChildTxId,
    'Child transaction ID must be restored on subsequent reload'
  );
  assert.ok(
    subsequentState.observedChildFields,
    'Observed child fields must be restored on subsequent reload'
  );

  clearPersistedTransaction(withdrawLifecycleActionKey);
  console.log('✓ PASS: Successful withdraw followed by 0 credit and reload correctly verified.\n');
  passedTests++;

  // -------------------------------------------------------------
  // Test 21: Actual Observed Studio Next Receipt Shape (AgentPay Withdraw)
  // -------------------------------------------------------------
  console.log('[Test 21] Live Observed Studio Next Receipt Shape: Matches AgentPay documented parent and child');
  const agentPayParentHash = '0x063ea623194c0849c1ab8a89217458c84da37f5a05a2ef5636a032b1fb931736';
  const agentPayChildHash = '0x2bb58c62b1d0a90223c2661065227b4ccc01a213c0645a35434aff02b44e5163';
  const agentPayContract = '0x754E97a763ed0Ae12da496A68d7a47090F3f1c2F';
  const agentPayWallet = '0x9471C57aF9DF875d4D42EDb046e446E85D9CFE3A';
  const agentPayAmountWei = 5000000000000000n; // 0.005 GEN
  const agentPayAmountWeiStr = '5000000000000000';

  const agentPayParams = {
    actionType: 'withdraw',
    walletState: {
      isConnected: true,
      address: agentPayWallet,
      chainId: 61997,
      isCorrectNetwork: true,
    },
    contractAddress: agentPayContract,
    claimableCreditWei: agentPayAmountWei,
  };

  const agentPayCtrl = new TransactionController(agentPayParams);
  const agentPayActionKey = agentPayCtrl.getActionKey();
  clearPersistedTransaction(agentPayActionKey);

  persistTransactionRecord({
    txId: agentPayParentHash,
    actionKey: agentPayActionKey,
    rpcUrl: 'https://studio-next.genlayer.com/rpc',
    chainId: 61997,
    contractAddress: agentPayContract,
    walletAddress: agentPayWallet,
    actionType: 'withdraw',
    args: [],
    userValueWei: '0',
    claimableCreditWei: agentPayAmountWeiStr,
    submittedAt: Date.now() - 3000,
    status: 'submitted',
  });

  // Exact shape observed from read-only inspection of AgentPay's Studio Next withdraw:
  const liveAgentPayClient = {
    getTransaction: async ({ hash }) => {
      if (hash === agentPayParentHash) {
        return {
          hash: agentPayParentHash,
          statusName: 'FINALIZED',
          txExecutionResultName: 'FINISHED_WITH_RETURN',
          successful: true,
          // Top-level messages shape from Studio Next RPC
          messages: [
            {
              messageType: '0',
              recipient: agentPayWallet,
              value: 5000000000000000,
            },
          ],
          // Nested leader receipt shape in consensus_data.final_votes
          consensus_data: {
            final_votes: [
              {
                mode: 'LEADER',
                receipt: {
                  messages: [
                    {
                      is_eth_send: true,
                      recipient: agentPayWallet,
                      amount: 5000000000000000,
                    },
                  ],
                },
              },
            ],
          },
          // Child occurrence discovery paths in parent receipt
          data: {
            active_message_generation: {
              occurrences: [agentPayChildHash],
            },
            message_effect_delivered: {
              [agentPayChildHash]: true,
            },
          },
          // Studio Next returns empty triggered_transactions array
          triggered_transactions: [],
        };
      }
      if (hash === agentPayChildHash) {
        return {
          hash: agentPayChildHash,
          triggered_by: agentPayParentHash,
          from_address: agentPayContract,
          to_address: agentPayWallet,
          value: 5000000000000000,
          value_credited: true,
          statusName: 'FINALIZED',
          txExecutionResultName: 'NOT_VOTED',
          successful: true,
        };
      }
      return null;
    },
  };

  const agentPayVerifyCtrl = new TransactionController(agentPayParams);
  await agentPayVerifyCtrl.reconcile(liveAgentPayClient);

  const finalAgentPayState = agentPayVerifyCtrl.getState();
  assert.strictEqual(
    finalAgentPayState.childTransferStatus,
    'confirmed',
    'AgentPay Studio Next withdraw child transfer must be confirmed'
  );
  assert.strictEqual(
    finalAgentPayState.childTxId,
    agentPayChildHash,
    'Must capture exact child transaction hash'
  );
  assert.ok(
    finalAgentPayState.observedChildFields,
    'Observed child fields must be present'
  );
  assert.strictEqual(
    finalAgentPayState.observedChildFields.valueCredited,
    true,
    'valueCredited must be true'
  );
  assert.strictEqual(
    finalAgentPayState.observedChildFields.amountWei,
    agentPayAmountWeiStr,
    'amountWei must match 5000000000000000'
  );
  assert.strictEqual(
    finalAgentPayState.observedChildFields.from.toLowerCase(),
    agentPayContract.toLowerCase(),
    'from must match contract'
  );
  assert.strictEqual(
    finalAgentPayState.observedChildFields.recipient.toLowerCase(),
    agentPayWallet.toLowerCase(),
    'recipient must match wallet'
  );
  assert.strictEqual(
    finalAgentPayState.observedChildFields.isEthSend,
    true,
    'isEthSend must be resolved true from parent messageType: 0'
  );

  clearPersistedTransaction(agentPayActionKey);
  console.log('✓ PASS: Actual observed Studio Next AgentPay receipt shape verified.\n');
  passedTests++;

  delete process.env.VITE_WRITES_ENABLED;
  viteServer.moduleGraph.invalidateAll();
  await viteServer.close();

  console.log('================================================================');
  console.log(`ALL TRANSACTION CONTROLLER TESTS PASSED (${passedTests}/${passedTests})`);
  console.log('================================================================\n');
}

runSuite().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
