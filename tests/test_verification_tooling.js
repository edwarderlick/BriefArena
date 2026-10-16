const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execSync } = require('child_process');

const {
  categorizeAndSanitizeError,
  saveRedactedErrorReport,
  reconcileRecipientBalance,
  verifyChildTransactions,
  testSmallMoneyFlow,
  deployContract,
  parseCliArgs,
  validateCliOptions,
  updateEvidence,
  loadEvidence,
  main,
} = require('../scratch/run_studio_verification.js');

const {
  executeReadVerification,
  analyzeRpcError: analyzeVerifyRpcError,
  extractAuthoritativeAddress: extractVerifyAuthAddress,
  parseArgs: parseVerifyArgs,
} = require('../scratch/verify_deployed_contract.js');

const {
  runThreeEntrantScenario,
  verifyLiveGettersPreflight,
  parseCliArgs: parseThreeEntrantArgs,
  saveEvidenceAtomic,
  loadAndValidateEvidence,
  decodeReceiptReturnValue,
  computeScenarioCommitment,
  categorizeAndSanitizeError: sanitizeThreeEntrantError,
} = require('../scratch/run_three_entrant_verification.js');

function createMockParticipants(customHandlers = {}) {
  const accounts = {
    sponsor: '0x1E47d7d7079FE4aD599B184559ffCDC56278fb54',
    entrant1: '0x2222222222222222222222222222222222222222',
    entrant2: '0x3333333333333333333333333333333333333333',
    entrant3: '0x4444444444444444444444444444444444444444',
  };

  let stage = customHandlers.initialStage || 'INIT';
  let entriesList = customHandlers.initialEntries ? [...customHandlers.initialEntries] : [];

  const baseCredits = {
    [accounts.sponsor]: 0n,
    [accounts.entrant1]: 0n,
    [accounts.entrant2]: 0n,
    [accounts.entrant3]: 0n,
    ...(customHandlers.baseCredits || {}),
  };

  const createClientForRole = (role) => ({
    getChainId: async () => 61997,
    getBalance: async ({ address }) => {
      if (address === accounts.sponsor) return 15000000000000000000n;
      return 1000000000000000000n;
    },
    readContract: async (params) => {
      if (customHandlers.readContract) {
        const customRes = customHandlers.readContract(role, params, stage);
        if (customRes !== undefined) return customRes;
      }
      if (params.functionName === 'get_challenge_count') {
        return customHandlers.challengeCount ?? 1n;
      }
      if (params.functionName === 'get_total_locked_escrow') {
        if (['OPEN', 'ENTRY1', 'ENTRY2', 'CLOSED', 'JUDGING'].includes(stage)) {
          return 10000000000000000000n;
        }
        return 0n;
      }
      if (params.functionName === 'get_total_claimable_credits') {
        if (['AWARDED', 'NO_WINNER'].includes(stage)) {
          return 10000000000000000000n;
        }
        return 0n;
      }
      if (params.functionName === 'get_credit') {
        const user = params.args[0].toLowerCase();
        if (customHandlers.getCredit) {
          const res = customHandlers.getCredit(user, stage);
          if (res !== undefined) return res;
        }
        if (stage === 'AWARDED' && user === (customHandlers.winnerAddress || accounts.entrant1).toLowerCase()) {
          const delta = customHandlers.winnerDelta !== undefined ? customHandlers.winnerDelta : 10000000000000000000n;
          return (baseCredits[accounts.entrant1] || 0n) + delta;
        }
        if (stage === 'NO_WINNER' && user === accounts.sponsor.toLowerCase()) {
          const delta = customHandlers.sponsorDelta !== undefined ? customHandlers.sponsorDelta : 10000000000000000000n;
          return (baseCredits[accounts.sponsor] || 0n) + delta;
        }
        for (const [k, v] of Object.entries(baseCredits)) {
          if (k.toLowerCase() === user) return v;
        }
        return 0n;
      }
      if (params.functionName === 'get_challenge') {
        const statusMap = {
          INIT: 0n,
          OPEN: 0n,
          ENTRY1: 0n,
          ENTRY2: 0n,
          CLOSED: 1n,
          JUDGING: 2n,
          AWARDED: 3n,
          NO_WINNER: 4n,
        };
        const slotsMap = {
          INIT: 0n,
          OPEN: 0n,
          ENTRY1: 1n,
          ENTRY2: 2n,
          CLOSED: 3n,
          JUDGING: 3n,
          AWARDED: 3n,
          NO_WINNER: 3n,
        };
        return {
          id: customHandlers.createdChallengeId ? BigInt(customHandlers.createdChallengeId) : 1n,
          sponsorAddress: accounts.sponsor,
          title: 'DeFi Speed Protocol Tagline Challenge',
          category: 'Copywriting',
          synopsis: 'Craft an iconic tagline and launch paragraph for a next-generation decentralized liquidity network.',
          mandatoryRequirements: ['Must highlight sub-second settlement', 'Must convey institutional security'],
          prohibitedTerms: ['cheap', 'fastest', 'guaranteed'],
          prizeAmount: 10000000000000000000n,
          status: statusMap[stage] ?? 0n,
          filledSlots: slotsMap[stage] ?? 0n,
        };
      }
      if (params.functionName === 'get_entries') {
        if (entriesList.length > 0) return entriesList;
        if (stage === 'INIT' || stage === 'OPEN') return [];
        if (stage === 'ENTRY1') {
          return [
            { entryNumber: 1n, authorAddress: accounts.entrant1, tagline: 'Settlement at the speed of thought.', paragraph: 'Engineered for high-frequency algorithmic liquidity with zero compromise on institutional safety and cryptographic guarantees.' },
          ];
        }
        if (stage === 'ENTRY2') {
          return [
            { entryNumber: 1n, authorAddress: accounts.entrant1, tagline: 'Settlement at the speed of thought.', paragraph: 'Engineered for high-frequency algorithmic liquidity with zero compromise on institutional safety and cryptographic guarantees.' },
            { entryNumber: 2n, authorAddress: accounts.entrant2, tagline: 'Institutional depth meets instant finality.', paragraph: 'Bridging prime brokerage grade execution pipelines with trustless on-chain consensus for modern digital assets.' },
          ];
        }
        return [
          { entryNumber: 1n, authorAddress: accounts.entrant1, tagline: 'Settlement at the speed of thought.', paragraph: 'Engineered for high-frequency algorithmic liquidity with zero compromise on institutional safety and cryptographic guarantees.' },
          { entryNumber: 2n, authorAddress: accounts.entrant2, tagline: 'Institutional depth meets instant finality.', paragraph: 'Bridging prime brokerage grade execution pipelines with trustless on-chain consensus for modern digital assets.' },
          { entryNumber: 3n, authorAddress: accounts.entrant3, tagline: 'Uncompromising velocity for global capital.', paragraph: 'Next generation execution layer designed to process mission critical order flow with sub second finality.' },
        ];
      }
      if (params.functionName === 'get_decision') {
        if (stage === 'NO_WINNER') {
          return {
            challengeId: customHandlers.createdChallengeId ? BigInt(customHandlers.createdChallengeId) : 1n,
            outcome: 'no-winner',
            resolutionKind: 'CONSENSUS',
            winnerAddress: '0x0000000000000000000000000000000000000000',
            settledAt: 1700000000n,
          };
        }
        return {
          challengeId: customHandlers.createdChallengeId ? BigInt(customHandlers.createdChallengeId) : 1n,
          outcome: 'winner',
          resolutionKind: 'CONSENSUS',
          winnerAddress: customHandlers.winnerAddress || accounts.entrant1,
          settledAt: 1700000000n,
        };
      }
      return null;
    },
    writeContract: async (params) => {
      if (customHandlers.writeContract) {
        const customRes = customHandlers.writeContract(role, params, stage);
        if (customRes !== undefined) return customRes;
      }
      if (params.functionName === 'create_challenge') stage = 'OPEN';
      if (params.functionName === 'submit_entry') {
        if (role === 'entrant1') stage = 'ENTRY1';
        if (role === 'entrant2') stage = 'ENTRY2';
        if (role === 'entrant3') stage = 'CLOSED';
      }
      if (params.functionName === 'commit_judging') stage = 'JUDGING';
      if (params.functionName === 'attempt_judgement') stage = customHandlers.terminalStage || 'AWARDED';
      return `0xmock_tx_${role}_${params.functionName}`;
    },
    getTransaction: async (params) => {
      if (customHandlers.getTransaction) return customHandlers.getTransaction(role, params);
      const chId = customHandlers.createdChallengeId ? BigInt(customHandlers.createdChallengeId) : 1n;
      return {
        hash: params.hash,
        statusName: 'FINALIZED',
        txExecutionResultName: 'FINISHED_WITH_RETURN',
        consensus_data: {
          leader_receipt: [{
            execution_result: 'SUCCESS',
            result: {
              status: 'return',
              payload: {
                readable: chId.toString(),
                raw: [],
              },
            },
          }],
        },
      };
    },
    waitForTransactionReceipt: async () => {},
  });

  return {
    sponsor: { client: createClientForRole('sponsor'), account: { address: accounts.sponsor }, alias: 'sponsor' },
    entrant1: { client: createClientForRole('entrant1'), account: { address: accounts.entrant1 }, alias: 'entrant1' },
    entrant2: { client: createClientForRole('entrant2'), account: { address: accounts.entrant2 }, alias: 'entrant2' },
    entrant3: { client: createClientForRole('entrant3'), account: { address: accounts.entrant3 }, alias: 'entrant3' },
  };
}

async function runTests() {
  console.log('================================================================');
  console.log('STUDIO NEXT VERIFICATION TOOLING: LOCAL MOCK & FAILURE TESTS');
  console.log('================================================================');

  let passedTests = 0;
  const totalTests = 46;

  // -------------------------------------------------------------
  // Test 1: DiskFull Error Sanitization & Redaction
  // -------------------------------------------------------------
  console.log('\n[Test 1] DiskFull Error Sanitization & Redaction');
  {
    const rawDiskFullError = {
      message: 'An internal error was received.\n\nDetails: (psycopg2.errors.DiskFull) could not extend file "base/16415/16618.16": No space left on device\nHINT: Check free disk space.\n\n[SQL: INSERT INTO transactions (hash, status, from_address, to_address, input_data, data, sim_config) VALUES (%(hash)s, %(status)s, %(from_address)s, %(to_address)s, %(input_data)s::JSONB, %(data)s::JSONB, %(sim_config)s::JSONB)]\n[parameters: {\'hash\': \'0x12345\', \'data\': \'{"contract_code": "IyB7ICJEZXBlbmRzIjogInB5LWdl... (84000 chars truncated)"}\', \'sim_config\': \'{"signed_rollup_transaction": "0xf9a4b... (90000 chars truncated)"}\'}]',
      details: '(psycopg2.errors.DiskFull) could not extend file "base/16415/16618.16": No space left on device',
      shortMessage: 'An internal error was received.',
    };

    const { errorCategory, sanitizedSummary } = categorizeAndSanitizeError(rawDiskFullError);
    assert.strictEqual(errorCategory, 'RPC_DATABASE_DISK_FULL', 'Expected category RPC_DATABASE_DISK_FULL');
    assert.ok(!sanitizedSummary.includes('INSERT INTO'), 'Sanitized summary must not contain raw SQL');
    assert.ok(!sanitizedSummary.includes('signed_rollup_transaction'), 'Sanitized summary must not contain raw transactions');

    const testJsonPath = 'scratch/test_outage_report.json';
    const testMdPath = 'scratch/test_outage_report.md';

    saveRedactedErrorReport(
      rawDiskFullError,
      'CONTRACT_DEPLOYMENT',
      'https://studio-next.genlayer.com/api',
      61997,
      '0x1E47d7d7079FE4aD599B184559ffCDC56278fb54',
      testJsonPath,
      testMdPath
    );

    const savedJsonRaw = fs.readFileSync(testJsonPath, 'utf-8');
    assert.ok(!savedJsonRaw.includes('INSERT INTO'), 'JSON file must not contain raw SQL parameters');
    assert.ok(!savedJsonRaw.includes('signed_rollup_transaction'), 'JSON file must not contain transaction payload');
    assert.ok(!savedJsonRaw.includes('contract_code'), 'JSON file must not contain contract bytecode/source');
    assert.ok(savedJsonRaw.length < 600, `JSON report must be bounded and concise (<600 bytes), got ${savedJsonRaw.length}`);

    const savedMdRaw = fs.readFileSync(testMdPath, 'utf-8');
    assert.ok(!savedMdRaw.includes('INSERT INTO'), 'Markdown report must not contain SQL');
    assert.ok(savedMdRaw.includes('RPC_DATABASE_DISK_FULL'), 'Markdown must record bounded category');

    fs.unlinkSync(testJsonPath);
    fs.unlinkSync(testMdPath);

    console.log('✓ PASS: DiskFull error sanitized cleanly; raw SQL, payloads, and bytecode strictly excluded.');
    passedTests++;
  }

  // -------------------------------------------------------------
  // Test 2: Failed Child Result Detection
  // -------------------------------------------------------------
  console.log('\n[Test 2] Failed Child Execution Rejection');
  {
    const mockClient = {
      getTriggeredTransactionIds: async () => ['0xchild_failed_hash'],
      waitForFinalization: async () => {},
      getTransaction: async () => ({
        statusName: 'FINALIZED',
        txExecutionResultName: 'EXECUTION_FAILED',
      }),
    };

    const mockWithdrawTx = {
      messages: [{ recipient: '0x1E47d7d7079FE4aD599B184559ffCDC56278fb54', value: 10000000000000000000n }],
    };

    let caughtError = null;
    try {
      await verifyChildTransactions(mockClient, '0xparent_hash', mockWithdrawTx);
    } catch (err) {
      caughtError = err;
    }

    assert.ok(caughtError, 'Expected verifyChildTransactions to reject failed child execution');
    assert.ok(
      caughtError.message.includes('FAIL: Child delivery transaction') && caughtError.message.includes('failed on-chain'),
      `Expected failure message, got: ${caughtError.message}`
    );

    console.log('✓ PASS: Failed child transaction produced immediate FAIL and was not swallowed.');
    passedTests++;
  }

  // -------------------------------------------------------------
  // Test 3: Child Lookup Error & Sanitized Child Error Paths
  // -------------------------------------------------------------
  console.log('\n[Test 3] Child Lookup Error & Sanitized Error Logging');
  {
    const rawLookupError = new Error(
      'RPC Internal Error: [SQL: SELECT * FROM triggered_txs WHERE parent_hash = %(hash)s] DB timeout (5000ms)'
    );

    const mockClientLookupError = {
      getTriggeredTransactionIds: async () => {
        throw rawLookupError;
      },
    };

    const mockWithdrawTx = {
      messages: [{ recipient: '0x1E47d7d7079FE4aD599B184559ffCDC56278fb54', value: 10000000000000000000n }],
    };

    let caughtError = null;
    try {
      await verifyChildTransactions(mockClientLookupError, '0xparent_hash', mockWithdrawTx);
    } catch (err) {
      caughtError = err;
    }

    assert.ok(caughtError, 'Expected error when child lookup fails');
    assert.ok(
      caughtError.message.includes('FAIL/INCONCLUSIVE: Delivery UNVERIFIED'),
      `Expected Delivery UNVERIFIED, got: ${caughtError.message}`
    );
    assert.ok(
      !caughtError.message.includes('SELECT * FROM'),
      'Child lookup error must sanitize raw SQL and parameters'
    );
    assert.ok(
      caughtError.message.includes('RPC_CHILD_LOOKUP_ERROR') || caughtError.message.includes('RPC_TIMEOUT'),
      'Child error must contain bounded category'
    );

    console.log('✓ PASS: Child lookup failure sanitized without leaking internal RPC queries.');
    passedTests++;
  }

  // -------------------------------------------------------------
  // Test 4: Fee Reconciliation Grounded in Receipt & Tolerances
  // -------------------------------------------------------------
  console.log('\n[Test 4] Recipient Balance Reconciliation (Receipt-Grounded Check)');
  {
    const prizeWei = 10000000000000000000n; // 10 GEN
    const preBal = 100000000000000000000n;  // 100 GEN
    const feeBudget = 50000000000000000n;   // 0.05 GEN fee budget

    // Sub-case A: Fee refund only (+0.01 GEN balance bump, no 10 GEN payout)
    const postBalRefundOnly = preBal + 10000000000000000n; // +0.01 GEN
    let refundError = null;
    try {
      reconcileRecipientBalance(preBal, postBalRefundOnly, prizeWei, null, [], feeBudget);
    } catch (err) {
      refundError = err;
    }

    assert.ok(refundError, 'Expected balance reconciliation to reject micro fee refund');
    assert.ok(
      refundError.message.includes('RECONCILIATION_FAILED') && refundError.message.includes('Possible fee refund without actual payout delivery'),
      `Expected fee refund rejection message, got: ${refundError.message}`
    );

    // Sub-case B: When actual receipt fee is available on receipt
    const postBalWithKnownFee = preBal + 9980000000000000000n; // Net +9.98 GEN
    const mockWithdrawReceiptWithFee = { actualFee: 20000000000000000n }; // 0.02 GEN fee
    const exactResult = reconcileRecipientBalance(preBal, postBalWithKnownFee, prizeWei, mockWithdrawReceiptWithFee, [], feeBudget);

    assert.strictEqual(exactResult.reconciliationStatus, 'EXACT_RECEIPT_VERIFIED');
    assert.strictEqual(exactResult.actualReceiptFees, 20000000000000000n);
    assert.strictEqual(exactResult.reconciled, true);

    // Sub-case C: When actual receipt fee is unavailable on receipt
    const mockWithdrawReceiptNoFee = { statusName: 'FINALIZED' };
    const approxResult = reconcileRecipientBalance(preBal, postBalWithKnownFee, prizeWei, mockWithdrawReceiptNoFee, [], feeBudget);

    assert.strictEqual(approxResult.reconciliationStatus, 'APPROXIMATE_BOUNDED');
    assert.strictEqual(approxResult.actualReceiptFees, null);
    assert.strictEqual(approxResult.unaccountedBalanceDelta, 20000000000000000n);
    assert.strictEqual(approxResult.reconciled, true);
    // Crucial requirement: prize - balanceDelta is NOT labeled as observed fees
    assert.strictEqual(approxResult.observedFeeDeduction, undefined, 'Must not label prize - delta as observed fees');

    console.log('✓ PASS: Balance reconciliation grounded in receipt; distinguishes exact fees from bounded approximate reconciliation.');
    passedTests++;
  }

  // -------------------------------------------------------------
  // Test 5: Pre-existing Sponsor Credit Refusal
  // -------------------------------------------------------------
  console.log('\n[Test 5] Pre-existing Sponsor Credit Refusal');
  {
    const mockClientWithCredit = {
      readContract: async ({ functionName }) => {
        if (functionName === 'get_credit') {
          return 5000000000000000000n; // 5 GEN pre-existing credit!
        }
        if (functionName === 'get_total_locked_escrow') return 0n;
        if (functionName === 'get_total_claimable_credits') return 5000000000000000000n;
        if (functionName === 'get_sponsored_challenge_ids_paginated') return [];
        return 0n;
      },
      getBalance: async () => 100000000000000000000n,
    };

    const mockAccount = { address: '0x1E47d7d7079FE4aD599B184559ffCDC56278fb54' };
    const testEvidencePath = 'scratch/test_evidence_credit_refusal.json';

    if (fs.existsSync(testEvidencePath)) fs.unlinkSync(testEvidencePath);

    let caughtCreditError = null;
    try {
      await testSmallMoneyFlow(mockClientWithCredit, mockAccount, '0xmockcontract', {
        evidencePath: testEvidencePath,
      });
    } catch (err) {
      caughtCreditError = err;
    }

    assert.ok(caughtCreditError, 'Expected money flow test to be refused due to pre-existing sponsor credit');
    assert.ok(
      caughtCreditError.message.includes('REFUSED_PREEXISTING_CREDIT'),
      `Expected REFUSED_PREEXISTING_CREDIT, got: ${caughtCreditError.message}`
    );
    assert.ok(
      caughtCreditError.message.includes('pre-existing claimable credit'),
      'Must explain pre-existing credit prevents ambiguous withdrawal'
    );

    if (fs.existsSync(testEvidencePath)) fs.unlinkSync(testEvidencePath);
    console.log('✓ PASS: Pre-existing sponsor credit correctly caused immediate refusal.');
    passedTests++;
  }

  // -------------------------------------------------------------
  // Test 6: Timeout After Broadcast Handling (Unknown Outcome, Hash Saved)
  // -------------------------------------------------------------
  console.log('\n[Test 6] Timeout After Broadcast (Unknown Outcome, Hash Saved, No Resubmission)');
  {
    const testEvidencePath = 'scratch/test_evidence_timeout.json';
    if (fs.existsSync(testEvidencePath)) fs.unlinkSync(testEvidencePath);

    const broadcastTxHash = '0xabc123broadcastedhash';
    let hashSavedBeforeFinalize = false;

    const mockClientTimeout = {
      readContract: async ({ functionName }) => {
        if (functionName === 'get_credit') return 0n;
        if (functionName === 'get_total_locked_escrow') return 0n;
        if (functionName === 'get_total_claimable_credits') return 0n;
        if (functionName === 'get_sponsored_challenge_ids_paginated') return [];
        return 0n;
      },
      getBalance: async () => 100000000000000000000n,
      estimateTransactionFees: async () => ({ feeValue: 10000000000000000n }),
      writeContract: async () => {
        return broadcastTxHash;
      },
      waitForFinalization: async ({ hash }) => {
        // Verify evidence was written before waiting for finality
        assert.strictEqual(hash, broadcastTxHash);
        const onDisk = JSON.parse(fs.readFileSync(testEvidencePath, 'utf-8'));
        if (onDisk.createTxHash === broadcastTxHash && onDisk.createStage === 'SUBMITTED') {
          hashSavedBeforeFinalize = true;
        }
        throw new Error('Connection timeout (120000ms) waiting for finalization receipt');
      },
    };

    const mockAccount = { address: '0x1E47d7d7079FE4aD599B184559ffCDC56278fb54' };

    let caughtTimeoutError = null;
    try {
      await testSmallMoneyFlow(mockClientTimeout, mockAccount, '0xmockcontract', {
        evidencePath: testEvidencePath,
      });
    } catch (err) {
      caughtTimeoutError = err;
    }

    assert.ok(hashSavedBeforeFinalize, 'Transaction hash MUST be saved immediately upon broadcast before awaiting finalization');
    assert.ok(caughtTimeoutError, 'Expected timeout error after broadcast');
    assert.ok(
      caughtTimeoutError.message.includes('BROADCAST_TIMEOUT_UNKNOWN'),
      `Expected BROADCAST_TIMEOUT_UNKNOWN, got: ${caughtTimeoutError.message}`
    );
    assert.ok(
      caughtTimeoutError.message.includes('Do not resubmit'),
      'Error message must state that timeout is an unknown outcome and resubmission is prohibited'
    );

    const savedEvidence = JSON.parse(fs.readFileSync(testEvidencePath, 'utf-8'));
    assert.strictEqual(savedEvidence.createTxHash, broadcastTxHash, 'Saved evidence must retain broadcasted tx hash');
    assert.strictEqual(savedEvidence.createStage, 'SUBMITTED');

    if (fs.existsSync(testEvidencePath)) fs.unlinkSync(testEvidencePath);
    console.log('✓ PASS: Hash saved immediately on broadcast; timeout handled as unknown outcome with resubmission prohibited.');
    passedTests++;
  }

  // -------------------------------------------------------------
  // Test 7: Safe Resume Without Duplicate Create or Withdraw
  // -------------------------------------------------------------
  console.log('\n[Test 7] Safe Resume (Inspects Saved Hashes & State, Prevents Duplicates)');
  {
    const testEvidencePath = 'scratch/test_evidence_resume.json';
    const priorCreateHash = '0xprior_create_hash_456';
    const priorChallengeId = '42';

    // Seed evidence as if a previous run created the challenge and process restarted
    fs.writeFileSync(
      testEvidencePath,
      JSON.stringify({
        contractAddress: '0xmockcontract',
        accountAddress: '0x1E47d7d7079FE4aD599B184559ffCDC56278fb54',
        rpcUrl: 'https://studio-next.genlayer.com/api',
        chainId: 61997,
        createTxHash: priorCreateHash,
        challengeId: priorChallengeId,
        createStage: 'FINALIZED',
      })
    );

    let createCallCount = 0;
    let cancelCallCount = 0;
    let withdrawCallCount = 0;

    const mockClientResume = {
      readContract: async ({ functionName }) => {
        if (functionName === 'get_credit') return 0n;
        if (functionName === 'get_total_locked_escrow') return 10000000000000000000n;
        if (functionName === 'get_total_claimable_credits') return 0n;
        if (functionName === 'get_sponsored_challenge_ids_paginated') return [42n];
        if (functionName === 'get_challenge') return {
          id: 42n,
          sponsorAddress: '0x1E47d7d7079FE4aD599B184559ffCDC56278fb54',
          prizeAmount: 10000000000000000000n,
          status: 0n, // OPEN
        };
        return 0n;
      },
      getBalance: async () => 100000000000000000000n,
      getTransaction: async ({ hash }) => {
        if (hash === priorCreateHash) {
          return {
            statusName: 'FINALIZED',
            txExecutionResultName: 'FINISHED_WITH_RETURN',
            txDataDecoded: 42,
          };
        }
        if (hash === '0xcancel_hash_789') {
          return {
            statusName: 'FINALIZED',
            txExecutionResultName: 'FINISHED_WITH_RETURN',
          };
        }
        if (hash === '0xwithdraw_hash_999') {
          return {
            statusName: 'FINALIZED',
            txExecutionResultName: 'FINISHED_WITH_RETURN',
            messages: [{ recipient: '0x1E47d7d7079FE4aD599B184559ffCDC56278fb54', value: 10000000000000000000n }],
          };
        }
        return { statusName: 'FINALIZED', txExecutionResultName: 'FINISHED_WITH_RETURN' };
      },
      estimateTransactionFees: async () => ({ feeValue: 10000000000000000n }),
      writeContract: async ({ functionName }) => {
        if (functionName === 'create_challenge') {
          createCallCount++;
          return '0xnew_create_hash';
        }
        if (functionName === 'cancel_challenge') {
          cancelCallCount++;
          return '0xcancel_hash_789';
        }
        if (functionName === 'withdraw') {
          withdrawCallCount++;
          return '0xwithdraw_hash_999';
        }
        return '0xtx';
      },
      waitForFinalization: async () => {},
      getTriggeredTransactionIds: async () => ['0xchild_tx_1'],
    };

    // Make readContract dynamically return credit after cancel
    const originalReadContract = mockClientResume.readContract;
    mockClientResume.readContract = async (opts) => {
      if (cancelCallCount > 0 && opts.functionName === 'get_credit') {
        return 10000000000000000000n; // 10 GEN credit after cancel
      }
      return originalReadContract(opts);
    };

    // When balance is queried after withdraw, simulate payout received
    let balanceQueryCount = 0;
    mockClientResume.getBalance = async () => {
      balanceQueryCount++;
      if (withdrawCallCount > 0 && balanceQueryCount > 3) {
        return 109995000000000000000n; // +9.995 GEN (fee of 0.005 GEN within 0.01 GEN budget)
      }
      return 100000000000000000000n;
    };

    const mockAccount = { address: '0x1E47d7d7079FE4aD599B184559ffCDC56278fb54' };

    await testSmallMoneyFlow(mockClientResume, mockAccount, '0xmockcontract', {
      evidencePath: testEvidencePath,
    });

    assert.strictEqual(createCallCount, 0, 'create_challenge MUST NOT be called again when resuming from saved createTxHash');
    assert.strictEqual(cancelCallCount, 1, 'cancel_challenge should be called once');
    assert.strictEqual(withdrawCallCount, 1, 'withdraw should be called once');

    if (fs.existsSync(testEvidencePath)) fs.unlinkSync(testEvidencePath);
    console.log('✓ PASS: Resume inspected on-chain state; successfully skipped duplicate creation.');
    passedTests++;
  }

  // -------------------------------------------------------------
  // Test 8: Three-Entrant Script Write Gate (--execute Required)
  // -------------------------------------------------------------
  console.log('\n[Test 8] Three-Entrant Script Write Gate (--execute Required)');
  {
    const mockContractAddr = '0x4072D26298eefD8c6D865164a6a3c14fa3E7e272';
    const participants = createMockParticipants();
    let writeCalled = false;
    participants.sponsor.client.writeContract = async () => {
      writeCalled = true;
      return '0xunexpected_tx';
    };

    // Calling without --execute must halt at write gate with zero writes
    const report = await runThreeEntrantScenario(
      ['--contract', mockContractAddr],
      participants
    );

    assert.strictEqual(report.status, 'WRITE_GATE_BLOCKED', 'Report status must be WRITE_GATE_BLOCKED');
    assert.strictEqual(report.writesPerformed, 0, 'Writes performed must be 0');
    assert.strictEqual(writeCalled, false, 'No writeContract call should occur without --execute');

    // Calling with --preflight-only must halt at preflight with zero writes
    const preflightReport = await runThreeEntrantScenario(
      ['--contract', mockContractAddr, '--preflight-only'],
      participants
    );
    assert.strictEqual(preflightReport.status, 'PREFLIGHT_PASSED', 'Report status must be PREFLIGHT_PASSED');
    assert.strictEqual(preflightReport.writesPerformed, 0, 'Writes performed must be 0');
    assert.strictEqual(writeCalled, false, 'No writeContract call should occur with --preflight-only');

    console.log('✓ PASS: Write gate strictly enforced; without --execute, zero writes are performed.');
    passedTests++;
  }

  // -------------------------------------------------------------
  // Test 9: Saved deployment hash with unavailable/pending result: zero new deploy calls
  // -------------------------------------------------------------
  console.log('\n[Test 9] Saved Deployment Hash with Unavailable/Pending Result (Zero New Deploy Calls)');
  {
    const testEvidencePath = 'scratch/test_evidence_deploy_pending.json';
    fs.writeFileSync(
      testEvidencePath,
      JSON.stringify({
        deployTxHash: '0xsaved_deploy_hash_pending',
        deployStage: 'SUBMITTED',
        rpcUrl: 'https://studio-next.genlayer.com/api',
        chainId: 61997,
        accountAddress: '0x1E47d7d7079FE4aD599B184559ffCDC56278fb54',
      })
    );

    let deployCallCount = 0;
    const mockClientDeployPending = {
      getTransaction: async ({ hash }) => {
        // Pending status — outcome cannot be confirmed
        return {
          statusName: 'PENDING',
          txExecutionResultName: null,
        };
      },
      deployContract: async () => {
        deployCallCount++;
        return '0xnew_deploy_hash';
      },
    };

    const mockAccount = { address: '0x1E47d7d7079FE4aD599B184559ffCDC56278fb54' };
    let caughtDeployError = null;

    try {
      await deployContract(
        mockClientDeployPending,
        mockAccount,
        'code',
        {},
        'https://studio-next.genlayer.com/api',
        testEvidencePath
      );
    } catch (err) {
      caughtDeployError = err;
    }

    assert.ok(caughtDeployError, 'Expected deployment to halt on pending/unconfirmed saved tx');
    assert.ok(
      caughtDeployError.message.includes('UNKNOWN') && caughtDeployError.message.includes('Do not proceed to fresh deployment'),
      `Expected UNKNOWN halt message, got: ${caughtDeployError.message}`
    );
    assert.strictEqual(deployCallCount, 0, 'Zero new deploy calls allowed when saved deployment outcome cannot be confirmed');

    if (fs.existsSync(testEvidencePath)) fs.unlinkSync(testEvidencePath);

    // Subtest 9b: Saved deployment hash where lookup fails (RPC lookup error)
    {
      fs.writeFileSync(
        testEvidencePath,
        JSON.stringify({
          deployTxHash: '0xsaved_deploy_hash_lookup_fail',
          deployStage: 'SUBMITTED',
          rpcUrl: 'https://studio-next.genlayer.com/api',
          chainId: 61997,
          accountAddress: '0x1E47d7d7079FE4aD599B184559ffCDC56278fb54',
        })
      );

      let deployCalls = 0;
      const mockClientLookupFail = {
        getTransaction: async () => {
          throw new Error('Connection reset by peer');
        },
        deployContract: async () => {
          deployCalls++;
          return '0xunexpected_deploy_hash';
        },
      };

      let caughtErr = null;
      try {
        await deployContract(
          mockClientLookupFail,
          mockAccount,
          'code',
          {},
          'https://studio-next.genlayer.com/api',
          testEvidencePath
        );
      } catch (err) {
        caughtErr = err;
      }

      assert.ok(
        caughtErr && caughtErr.message.includes('UNKNOWN') && caughtErr.message.includes('lookup failed'),
        `Expected lookup failure UNKNOWN error, got: ${caughtErr?.message}`
      );
      assert.strictEqual(deployCalls, 0, 'Zero deploy calls on lookup failure');
      const preservedEvidence = JSON.parse(fs.readFileSync(testEvidencePath, 'utf-8'));
      assert.strictEqual(preservedEvidence.deployTxHash, '0xsaved_deploy_hash_lookup_fail', 'Original deployTxHash must be preserved');
      if (fs.existsSync(testEvidencePath)) fs.unlinkSync(testEvidencePath);
    }

    // Subtest 9c: Saved deployment hash with finalized execution failure (FINISHED_WITH_ERROR)
    {
      const originalFailedHash = '0x1f7b69db3fb6703afa49d971deb2d8dd8f558e4356ca801b172be760c6f06acd';
      fs.writeFileSync(
        testEvidencePath,
        JSON.stringify({
          deployTxHash: originalFailedHash,
          deployStage: 'SUBMITTED',
          rpcUrl: 'https://studio-next.genlayer.com/api',
          chainId: 61997,
          accountAddress: '0x1E47d7d7079FE4aD599B184559ffCDC56278fb54',
        })
      );

      let deployCalls = 0;
      const mockClientExecutionFailed = {
        getTransaction: async ({ hash }) => {
          return {
            hash,
            statusName: 'FINALIZED',
            txExecutionResultName: 'FINISHED_WITH_ERROR',
            consensus_data: {
              leader_receipt: [
                {
                  result: {
                    payload: 'invalid_contract runner malformed',
                  },
                },
              ],
            },
          };
        },
        deployContract: async () => {
          deployCalls++;
          return '0xunexpected_deploy_hash';
        },
      };

      let caughtErr = null;
      try {
        await deployContract(
          mockClientExecutionFailed,
          mockAccount,
          'code',
          {},
          'https://studio-next.genlayer.com/api',
          testEvidencePath
        );
      } catch (err) {
        caughtErr = err;
      }

      assert.ok(
        caughtErr && caughtErr.message.includes('DEPLOYMENT_FINALIZED_FAILED'),
        `Expected DEPLOYMENT_FINALIZED_FAILED on finalized execution error, got: ${caughtErr?.message}`
      );
      assert.ok(
        caughtErr.message.includes('invalid_contract runner malformed'),
        `Error message must include sanitized error summary, got: ${caughtErr?.message}`
      );
      assert.strictEqual(deployCalls, 0, 'Zero deploy calls on finalized execution failure');

      // Verify evidence file updated with terminal failed stage and preserved original hash
      const failedEvidence = JSON.parse(fs.readFileSync(testEvidencePath, 'utf-8'));
      assert.strictEqual(failedEvidence.deployTxHash, originalFailedHash, 'Failed hash must be permanently preserved');
      assert.strictEqual(failedEvidence.deployStage, 'FINALIZED_FAILED', 'deployStage must be FINALIZED_FAILED');
      assert.strictEqual(failedEvidence.deployResult, 'FINISHED_WITH_ERROR', 'deployResult must be FINISHED_WITH_ERROR');
      assert.ok(failedEvidence.deployError.includes('runner malformed'), 'deployError must record sanitized leader error');
      assert.ok(Array.isArray(failedEvidence.deploymentHistory), 'deploymentHistory must be an array');
      assert.strictEqual(failedEvidence.deploymentHistory[0].txHash, originalFailedHash, 'History must record original failed txHash');

      // Second resume on already-recorded FINALIZED_FAILED must still halt and make zero deploy calls
      let secondCaughtErr = null;
      try {
        await deployContract(
          mockClientExecutionFailed,
          mockAccount,
          'code',
          {},
          'https://studio-next.genlayer.com/api',
          testEvidencePath
        );
      } catch (err) {
        secondCaughtErr = err;
      }
      assert.ok(secondCaughtErr && secondCaughtErr.message.includes('DEPLOYMENT_FINALIZED_FAILED'));
      assert.strictEqual(deployCalls, 0, 'Zero deploy calls on second resume of finalized failure');

      if (fs.existsSync(testEvidencePath)) fs.unlinkSync(testEvidencePath);
    }

    // Subtest 9d: Evidence file contains money-flow hashes (create/cancel/withdraw) but no deployTxHash
    for (const txKey of ['createTxHash', 'cancelTxHash', 'withdrawTxHash']) {
      fs.writeFileSync(
        testEvidencePath,
        JSON.stringify({
          [txKey]: `0xsaved_${txKey}_sample`,
          rpcUrl: 'https://studio-next.genlayer.com/api',
          chainId: 61997,
          accountAddress: '0x1E47d7d7079FE4aD599B184559ffCDC56278fb54',
        })
      );

      let deployCalls = 0;
      const mockClientWithDeployTracker = {
        getTransaction: async () => {
          throw new Error('getTransaction should not be called');
        },
        deployContract: async () => {
          deployCalls++;
          return '0xunexpected_deploy_hash';
        },
      };

      let caughtErr = null;
      try {
        await deployContract(
          mockClientWithDeployTracker,
          mockAccount,
          'code',
          {},
          'https://studio-next.genlayer.com/api',
          testEvidencePath
        );
      } catch (err) {
        caughtErr = err;
      }

      assert.ok(
        caughtErr && caughtErr.message.includes('EVIDENCE_CONTEXT_MISMATCH') && caughtErr.message.includes('Manual review required'),
        `Expected EVIDENCE_CONTEXT_MISMATCH error when ${txKey} present without deployTxHash, got: ${caughtErr?.message}`
      );
      assert.strictEqual(deployCalls, 0, `deployContract must make zero deploy calls when ${txKey} exists without deployTxHash`);

      if (fs.existsSync(testEvidencePath)) fs.unlinkSync(testEvidencePath);
    }

    console.log('✓ PASS: Finalized execution failure, pending receipt, lookup failure, and hash preservation verified with zero deploy calls.');
    passedTests++;
  }

  // -------------------------------------------------------------
  // Test 10: Evidence Context Mismatch & Main-Path Wiring (Zero Writes)
  // -------------------------------------------------------------
  console.log('\n[Test 10] Evidence Context Mismatch & Real Main-Path Argument Wiring (Zero Writes)');
  {
    const testEvidencePath = 'scratch/test_evidence_mismatch.json';
    let writeCallCount = 0;
    const mockClient = {
      getChainId: async () => 61997,
      getBalance: async () => 100000000000000000000n,
      estimateTransactionFees: async () => ({ feeValue: 1000000000000000n }),
      readContract: async () => 0n,
      writeContract: async () => {
        writeCallCount++;
        return '0xtx';
      },
    };
    const mockAccount = { address: '0x1E47d7d7079FE4aD599B184559ffCDC56278fb54' };

    // Subtest 10a: Mismatched contract address
    fs.writeFileSync(
      testEvidencePath,
      JSON.stringify({
        contractAddress: '0xcontract_OLD_9999999999999999999999999999999999999999',
        accountAddress: '0x1E47d7d7079FE4aD599B184559ffCDC56278fb54',
        rpcUrl: 'https://studio-next.genlayer.com/api',
        chainId: 61997,
        createTxHash: '0xsaved_create_hash',
      })
    );

    let caughtErr = null;
    try {
      await testSmallMoneyFlow(
        mockClient,
        mockAccount,
        '0xcontract_NEW_1111111111111111111111111111111111111111',
        { evidencePath: testEvidencePath }
      );
    } catch (err) {
      caughtErr = err;
    }
    assert.ok(caughtErr && caughtErr.message.includes('EVIDENCE_CONTEXT_MISMATCH'));
    assert.strictEqual(writeCallCount, 0, 'Zero writes when contract address mismatches');

    // Subtest 10b: Mismatched account address
    fs.writeFileSync(
      testEvidencePath,
      JSON.stringify({
        contractAddress: '0xcontract_NEW_1111111111111111111111111111111111111111',
        accountAddress: '0xDIFFERENT_ACCOUNT_2222222222222222222222222222222222222222',
        rpcUrl: 'https://studio-next.genlayer.com/api',
        chainId: 61997,
        createTxHash: '0xsaved_create_hash',
      })
    );
    caughtErr = null;
    try {
      await testSmallMoneyFlow(
        mockClient,
        mockAccount,
        '0xcontract_NEW_1111111111111111111111111111111111111111',
        { evidencePath: testEvidencePath }
      );
    } catch (err) {
      caughtErr = err;
    }
    assert.ok(caughtErr && caughtErr.message.includes('EVIDENCE_CONTEXT_MISMATCH'));
    assert.strictEqual(writeCallCount, 0, 'Zero writes when account mismatches');

    // Subtest 10c: Missing context on legacy evidence with saved hash
    fs.writeFileSync(
      testEvidencePath,
      JSON.stringify({
        contractAddress: '0xcontract_NEW_1111111111111111111111111111111111111111',
        accountAddress: '0x1E47d7d7079FE4aD599B184559ffCDC56278fb54',
        createTxHash: '0xsaved_create_hash',
        // rpcUrl and chainId are missing!
      })
    );
    caughtErr = null;
    try {
      await testSmallMoneyFlow(
        mockClient,
        mockAccount,
        '0xcontract_NEW_1111111111111111111111111111111111111111',
        { evidencePath: testEvidencePath }
      );
    } catch (err) {
      caughtErr = err;
    }
    assert.ok(caughtErr && caughtErr.message.includes('EVIDENCE_CONTEXT_MISMATCH') && caughtErr.message.includes('rpcUrl context'));
    assert.strictEqual(writeCallCount, 0, 'Zero writes when legacy evidence lacks context');

    // Subtest 10d: Real main-path argument wiring with --rpc set to different endpoint
    fs.writeFileSync(
      testEvidencePath,
      JSON.stringify({
        contractAddress: '0xcontract_NEW_1111111111111111111111111111111111111111',
        accountAddress: '0x1E47d7d7079FE4aD599B184559ffCDC56278fb54',
        rpcUrl: 'https://studio-next.genlayer.com/api',
        chainId: 61997,
        createTxHash: '0xsaved_create_hash',
      })
    );
    caughtErr = null;
    try {
      await main(
        [
          '--account', 'test-deployer',
          '--rpc', 'https://other-devnet.genlayer.com/api',
          '--contract', '0xcontract_NEW_1111111111111111111111111111111111111111',
          '--execute-money-flow',
        ],
        {
          client: mockClient,
          account: mockAccount,
          evidencePath: testEvidencePath,
        }
      );
    } catch (err) {
      caughtErr = err;
    }
    assert.ok(caughtErr && caughtErr.message.includes('EVIDENCE_CONTEXT_MISMATCH'));
    assert.ok(caughtErr.message.includes('https://other-devnet.genlayer.com/api'), 'Error must note mismatched RPC URL');
    assert.strictEqual(writeCallCount, 0, 'Zero writes when real main-path --rpc differs from saved evidence');

    if (fs.existsSync(testEvidencePath)) fs.unlinkSync(testEvidencePath);
    console.log('✓ PASS: Evidence context mismatch, missing legacy context, and real main-path --rpc wiring proved zero writes.');
    passedTests++;
  }

  // -------------------------------------------------------------
  // Test 11: Resumed Challenge Verification (Missing & Mismatched Fields: Zero Writes)
  // -------------------------------------------------------------
  console.log('\n[Test 11] Resumed Challenge Verification (Missing/Mismatched id, sponsor, prize: Zero Writes)');
  {
    const testEvidencePath = 'scratch/test_evidence_challenge_verify.json';
    let writeCallCount = 0;
    const mockAccount = { address: '0x1E47d7d7079FE4aD599B184559ffCDC56278fb54' };

    const baseEvidence = {
      contractAddress: '0xmockcontract',
      accountAddress: '0x1E47d7d7079FE4aD599B184559ffCDC56278fb54',
      rpcUrl: 'https://studio-next.genlayer.com/api',
      chainId: 61997,
      createTxHash: '0xcreate_tx_ok',
      challengeId: '42',
    };

    const makeMockClient = (challengeReturn) => ({
      readContract: async ({ functionName }) => {
        if (functionName === 'get_credit') return 0n;
        if (functionName === 'get_total_locked_escrow') return 10000000000000000000n;
        if (functionName === 'get_total_claimable_credits') return 0n;
        if (functionName === 'get_sponsored_challenge_ids_paginated') return [42n];
        if (functionName === 'get_challenge') return challengeReturn;
        return 0n;
      },
      getBalance: async () => 100000000000000000000n,
      getTransaction: async () => ({
        statusName: 'FINALIZED',
        txExecutionResultName: 'FINISHED_WITH_RETURN',
      }),
      writeContract: async () => {
        writeCallCount++;
        return '0xshould_never_write';
      },
      estimateTransactionFees: async () => ({ feeValue: 1000000000000000n }),
    });

    const testCases = [
      {
        name: 'missing id',
        challenge: { sponsorAddress: '0x1E47d7d7079FE4aD599B184559ffCDC56278fb54', prizeAmount: 10000000000000000000n, status: 0n },
        expectedMatch: 'challenge id is missing',
      },
      {
        name: 'mismatched id',
        challenge: { id: 999n, sponsorAddress: '0x1E47d7d7079FE4aD599B184559ffCDC56278fb54', prizeAmount: 10000000000000000000n, status: 0n },
        expectedMatch: 'does not match expected (#42)',
      },
      {
        name: 'missing sponsorAddress',
        challenge: { id: 42n, prizeAmount: 10000000000000000000n, status: 0n },
        expectedMatch: 'sponsorAddress is missing',
      },
      {
        name: 'mismatched sponsorAddress',
        challenge: { id: 42n, sponsorAddress: '0xWRONG_SPONSOR_9999999999999999999999999999999999999999', prizeAmount: 10000000000000000000n, status: 0n },
        expectedMatch: 'does not match current account',
      },
      {
        name: 'missing prizeAmount',
        challenge: { id: 42n, sponsorAddress: '0x1E47d7d7079FE4aD599B184559ffCDC56278fb54', status: 0n },
        expectedMatch: 'prizeAmount is missing',
      },
      {
        name: 'mismatched prizeAmount',
        challenge: { id: 42n, sponsorAddress: '0x1E47d7d7079FE4aD599B184559ffCDC56278fb54', prizeAmount: 5000000000000000000n, status: 0n },
        expectedMatch: 'does not match expected (10000000000000000000)',
      },
    ];

    for (const tc of testCases) {
      writeCallCount = 0;
      fs.writeFileSync(testEvidencePath, JSON.stringify(baseEvidence));
      let caughtErr = null;
      try {
        await testSmallMoneyFlow(
          makeMockClient(tc.challenge),
          mockAccount,
          '0xmockcontract',
          { evidencePath: testEvidencePath }
        );
      } catch (err) {
        caughtErr = err;
      }
      assert.ok(caughtErr, `Expected error for ${tc.name}`);
      assert.ok(
        caughtErr.message.includes('CHALLENGE_VERIFICATION_FAILED') && caughtErr.message.includes(tc.expectedMatch),
        `Case ${tc.name} failed with wrong message: ${caughtErr.message}`
      );
      assert.strictEqual(writeCallCount, 0, `Zero writes expected for ${tc.name}`);
    }

    if (fs.existsSync(testEvidencePath)) fs.unlinkSync(testEvidencePath);
    console.log('✓ PASS: Resumed challenge verification strictly rejected missing and mismatched fields with zero cancel/withdraw writes.');
    passedTests++;
  }

  // -------------------------------------------------------------
  // Test 12: Resume after withdrawal: payout uses persisted pre-withdraw balance
  // -------------------------------------------------------------
  console.log('\n[Test 12] Resume After Withdrawal (Payout Uses Persisted Pre-Withdraw Balance)');
  {
    const testEvidencePath = 'scratch/test_evidence_resume_withdraw.json';
    const persistedPreBal = 100000000000000000000n; // 100 GEN
    const currentPostBal = 109995000000000000000n;  // 109.995 GEN (already received payout!)

    fs.writeFileSync(
      testEvidencePath,
      JSON.stringify({
        contractAddress: '0xmockcontract',
        accountAddress: '0x1E47d7d7079FE4aD599B184559ffCDC56278fb54',
        rpcUrl: 'https://studio-next.genlayer.com/api',
        chainId: 61997,
        createTxHash: '0xcreate_tx_ok',
        cancelTxHash: '0xcancel_tx_ok',
        withdrawTxHash: '0xwithdraw_tx_ok',
        challengeId: '101',
        sponsorBalPreWithdraw: persistedPreBal.toString(),
      })
    );

    const mockClientResumeWithdraw = {
      readContract: async ({ functionName }) => {
        if (functionName === 'get_credit') return 0n;
        if (functionName === 'get_total_locked_escrow') return 0n;
        if (functionName === 'get_total_claimable_credits') return 0n;
        if (functionName === 'get_sponsored_challenge_ids_paginated') return [101n];
        if (functionName === 'get_challenge') return { id: 101n, status: 5n, prizeAmount: 10000000000000000000n, sponsorAddress: '0x1E47d7d7079FE4aD599B184559ffCDC56278fb54' };
        return 0n;
      },
      getBalance: async () => currentPostBal,
      getTransaction: async () => ({
        statusName: 'FINALIZED',
        txExecutionResultName: 'FINISHED_WITH_RETURN',
        messages: [{ recipient: '0x1E47d7d7079FE4aD599B184559ffCDC56278fb54', value: 10000000000000000000n }],
      }),
      getTriggeredTransactionIds: async () => ['0xchild_101'],
      waitForFinalization: async () => {},
    };

    const mockAccount = { address: '0x1E47d7d7079FE4aD599B184559ffCDC56278fb54' };

    const flowResult = await testSmallMoneyFlow(
      mockClientResumeWithdraw,
      mockAccount,
      '0xmockcontract',
      { evidencePath: testEvidencePath }
    );

    assert.strictEqual(
      flowResult.sponsorNetDelta,
      9995000000000000000n,
      'Net delta must be calculated against persisted pre-withdraw balance (~9.995 GEN), not current balance'
    );
    assert.strictEqual(flowResult.deliveryConfirmed, true);

    if (fs.existsSync(testEvidencePath)) fs.unlinkSync(testEvidencePath);
    console.log('✓ PASS: Resume after withdrawal correctly used persisted pre-withdraw balance for payout reconciliation.');
    passedTests++;
  }

  // -------------------------------------------------------------
  // Test 13: Missing pre-withdraw baseline: result is inconclusive, never confirmed
  // -------------------------------------------------------------
  console.log('\n[Test 13] Missing Pre-Withdraw Baseline (Result is Inconclusive, Never Confirmed)');
  {
    const testEvidencePath = 'scratch/test_evidence_missing_baseline.json';

    // withdrawTxHash is present, but sponsorBalPreWithdraw was never persisted
    fs.writeFileSync(
      testEvidencePath,
      JSON.stringify({
        contractAddress: '0xmockcontract',
        accountAddress: '0x1E47d7d7079FE4aD599B184559ffCDC56278fb54',
        rpcUrl: 'https://studio-next.genlayer.com/api',
        chainId: 61997,
        createTxHash: '0xcreate_tx_ok',
        cancelTxHash: '0xcancel_tx_ok',
        withdrawTxHash: '0xwithdraw_tx_ok',
        challengeId: '102',
      })
    );

    const mockClientMissingBaseline = {
      readContract: async ({ functionName }) => {
        if (functionName === 'get_credit') return 0n;
        if (functionName === 'get_total_locked_escrow') return 0n;
        if (functionName === 'get_total_claimable_credits') return 0n;
        if (functionName === 'get_sponsored_challenge_ids_paginated') return [102n];
        if (functionName === 'get_challenge') return { id: 102n, status: 5n, prizeAmount: 10000000000000000000n, sponsorAddress: '0x1E47d7d7079FE4aD599B184559ffCDC56278fb54' };
        return 0n;
      },
      getBalance: async () => 109995000000000000000n,
      getTransaction: async () => ({
        statusName: 'FINALIZED',
        txExecutionResultName: 'FINISHED_WITH_RETURN',
        messages: [{ recipient: '0x1E47d7d7079FE4aD599B184559ffCDC56278fb54', value: 10000000000000000000n }],
      }),
      getTriggeredTransactionIds: async () => ['0xchild_102'],
      waitForFinalization: async () => {},
    };

    const mockAccount = { address: '0x1E47d7d7079FE4aD599B184559ffCDC56278fb54' };

    const flowResult = await testSmallMoneyFlow(
      mockClientMissingBaseline,
      mockAccount,
      '0xmockcontract',
      { evidencePath: testEvidencePath }
    );

    assert.strictEqual(
      flowResult.reconciliation.reconciliationStatus,
      'INCONCLUSIVE_MISSING_BASELINE',
      'Reconciliation status must be INCONCLUSIVE_MISSING_BASELINE'
    );
    assert.strictEqual(flowResult.deliveryConfirmed, false, 'deliveryConfirmed must be false when baseline is missing');
    assert.strictEqual(flowResult.sponsorNetDelta, null, 'Net delta must be null when baseline is missing');

    const onDiskEvidence = JSON.parse(fs.readFileSync(testEvidencePath, 'utf-8'));
    assert.strictEqual(onDiskEvidence.deliveryConfirmed, false, 'On-disk deliveryConfirmed must be false');
    assert.strictEqual(onDiskEvidence.reconciliationStatus, 'INCONCLUSIVE_MISSING_BASELINE');

    if (fs.existsSync(testEvidencePath)) fs.unlinkSync(testEvidencePath);
    console.log('✓ PASS: Missing pre-withdraw baseline marked INCONCLUSIVE and never confirmed.');
    passedTests++;
  }

  // -------------------------------------------------------------
  // Test 14: Partial fee fields: never labeled exact
  // -------------------------------------------------------------
  console.log('\n[Test 14] Partial Fee Fields / Balance Equation Mismatch (Never Labeled EXACT)');
  {
    const prizeWei = 10000000000000000000n; // 10 GEN
    const preBal = 100000000000000000000n;  // 100 GEN
    const postBal = preBal + 9970000000000000000n; // Net delta = 9.97 GEN -> discrepancy = 0.03 GEN

    // Case 1: Receipt has actualFee 0.02 GEN, but discrepancy is 0.03 GEN (equation mismatch!)
    const receiptFeeMismatch = { actualFee: 20000000000000000n }; // 0.02 GEN
    const resultMismatch = reconcileRecipientBalance(preBal, postBal, prizeWei, receiptFeeMismatch, [], 50000000000000000n);

    assert.notStrictEqual(resultMismatch.reconciliationStatus, 'EXACT_RECEIPT_VERIFIED');
    assert.ok(
      !resultMismatch.reconciliationStatus.includes('EXACT'),
      `Status must NOT contain EXACT when balance equation does not match (${resultMismatch.reconciliationStatus})`
    );
    assert.strictEqual(resultMismatch.reconciliationStatus, 'APPROXIMATE_PARTIAL_FEES');

    // Case 2: Withdraw receipt has fee, but child receipt fee is missing
    const postBalMatchingWithdrawOnly = preBal + 9980000000000000000n; // Net delta = 9.98 GEN
    const childReceiptNoFee = { statusName: 'FINALIZED' }; // Child receipt has no fee field
    const resultMissingChildFee = reconcileRecipientBalance(
      preBal,
      postBalMatchingWithdrawOnly,
      prizeWei,
      { actualFee: 20000000000000000n },
      [childReceiptNoFee],
      50000000000000000n
    );

    assert.notStrictEqual(resultMissingChildFee.reconciliationStatus, 'EXACT_RECEIPT_VERIFIED');
    assert.ok(
      !resultMissingChildFee.reconciliationStatus.includes('EXACT'),
      `Status must NOT contain EXACT when child fee fields are unknown`
    );

    console.log('✓ PASS: Partial or unmatching fee fields are strictly labeled APPROXIMATE, never EXACT.');
    passedTests++;
  }

  // -------------------------------------------------------------
  // Test 15: Live records: actual component rendering with no fixture banner
  // -------------------------------------------------------------
  console.log('\n[Test 15] Live Records (Actual Frontend Component Rendering: No Fixture Banner)');
  {
    const { pathToFileURL } = require('url');
    process.env.NODE_PATH = path.resolve(__dirname, '../app/node_modules');
    require('module').Module._initPaths();

    const viteEntry = pathToFileURL(path.resolve(__dirname, '../app/node_modules/vite/dist/node/index.js')).href;
    const { createServer } = await import(viteEntry);
    const viteServer = await createServer({
      root: path.resolve(__dirname, '../app'),
      server: { middlewareMode: true },
    });

    try {
      const { DesignPreviewBanner } = await viteServer.ssrLoadModule('/src/components/DesignPreviewBanner.tsx');
      const React = require('../app/node_modules/react');
      const ReactDOMServer = require('../app/node_modules/react-dom/server');

      // 1. Render Live Record
      const liveHtml = ReactDOMServer.renderToStaticMarkup(
        React.createElement(DesignPreviewBanner, {
          isFixture: false,
          contractAddress: '0x1E47d7d7079FE4aD599B184559ffCDC56278fb54',
        })
      );

      assert.ok(liveHtml.includes('Live Contract Record'), 'Live record must render "Live Contract Record" badge');
      assert.ok(!liveHtml.includes('Design preview'), 'Live record must NOT render "Design preview"');
      assert.ok(!liveHtml.includes('sample'), 'Live record must NOT render "sample"');
      assert.ok(!liveHtml.includes('Fixture Data'), 'Live record must NOT render "Fixture Data"');
      assert.ok(liveHtml.includes('Studio Next'), 'Live record must identify Studio Next');
      assert.ok(liveHtml.includes('0x1E47d7d7079FE4aD599B184559ffCDC56278fb54'), 'Live record must display contract address');
      assert.ok(liveHtml.includes('Read-only mode (chain writes disabled)'), 'Must declare read-only mode');

      // 2. Render Fixture Record
      const fixtureHtml = ReactDOMServer.renderToStaticMarkup(
        React.createElement(DesignPreviewBanner, {
          isFixture: true,
          message: 'Design preview — sample brief',
        })
      );

      assert.ok(fixtureHtml.includes('Fixture Data'), 'Fixture record must render "Fixture Data" badge');
      assert.ok(fixtureHtml.includes('Design preview — sample brief'), 'Fixture record must render preview text');
      assert.ok(!fixtureHtml.includes('Live Contract Record'), 'Fixture record must NOT render "Live Contract Record"');
    } finally {
      await viteServer.close();
    }

    console.log('✓ PASS: Actual DesignPreviewBanner component rendered; live records suppress fixture banner and display Studio Next contract details.');
    passedTests++;
  }

  // -------------------------------------------------------------
  // Test 16: RPC Read Failure Distinct From Genuinely Empty Result (Actual Frontend Code Import)
  // -------------------------------------------------------------
  console.log('\n[Test 16] RPC Read Failure Distinct From Genuinely Empty Result (Actual Frontend Services)');
  {
    const { pathToFileURL } = require('url');
    process.env.NODE_PATH = path.resolve(__dirname, '../app/node_modules');
    require('module').Module._initPaths();

    const viteEntry = pathToFileURL(path.resolve(__dirname, '../app/node_modules/vite/dist/node/index.js')).href;
    const { createServer } = await import(viteEntry);
    const viteServer = await createServer({
      root: path.resolve(__dirname, '../app'),
      server: { middlewareMode: true },
    });

    try {
      const contractClient = await viteServer.ssrLoadModule('/src/services/contractClient.ts');
      const {
        getContractChallenge,
        getContractEntries,
        getContractDecision,
        getContractChallengeCount,
        readOnlyClient,
        RpcReadError,
      } = contractClient;

      const originalReadContract = readOnlyClient.readContract;

      // 1. Genuine Empty State: Count = 0, get_entries returns [], get_challenge throws CHALLENGE_NOT_FOUND
      readOnlyClient.readContract = async ({ functionName }) => {
        if (functionName === 'get_challenge_count') return 0n;
        if (functionName === 'get_entries') return [];
        if (functionName === 'get_challenge') {
          const err = new Error('Execution reverted: assert challenge_id in self.challenges, "CHALLENGE_NOT_FOUND"');
          throw err;
        }
        if (functionName === 'get_decision') {
          const err = new Error('Execution reverted: assert challenge_id in self.decisions, "DECISION_NOT_FOUND"');
          throw err;
        }
        return null;
      };

      const emptyCount = await getContractChallengeCount('0xmock');
      assert.strictEqual(emptyCount, 0n, 'Genuinely empty challenge count is 0');

      const emptyEntries = await getContractEntries('0xmock', 1n);
      assert.deepStrictEqual(emptyEntries, [], 'Empty entries array on valid zero-entry challenge');

      const notFoundChallenge = await getContractChallenge('0xmock', 999n);
      assert.strictEqual(notFoundChallenge, null, 'Explicit CHALLENGE_NOT_FOUND returns null');

      const notFoundDecision = await getContractDecision('0xmock', 999n);
      assert.strictEqual(notFoundDecision, null, 'Explicit DECISION_NOT_FOUND returns null');

      // 2. RPC Read Failures: Rate limits (429), timeouts, server errors, unfamiliar errors
      const rpcErrorCases = [
        new Error('fetch failed: connect ECONNREFUSED https://studio-next.genlayer.com/api'),
        new Error('HTTP 429: Too Many Requests (rate limit exceeded)'),
        new Error('RPC error: Server overloaded / DiskFull'),
        new Error('Unfamiliar upstream RPC connection reset by peer'),
      ];

      for (const errCase of rpcErrorCases) {
        readOnlyClient.readContract = async () => {
          throw errCase;
        };

        // getContractEntries must THROW RpcReadError; it must NEVER swallow error as []
        let caughtEntriesError = null;
        try {
          await getContractEntries('0xmock', 1n);
        } catch (e) {
          caughtEntriesError = e;
        }
        assert.ok(caughtEntriesError, `getContractEntries must throw on ${errCase.message}`);
        assert.ok(caughtEntriesError instanceof RpcReadError, `Error must be instance of RpcReadError`);
        assert.strictEqual(caughtEntriesError.isRpcFailure, true);

        // getContractChallenge must THROW RpcReadError; must NOT return null
        let caughtChallengeError = null;
        try {
          await getContractChallenge('0xmock', 1n);
        } catch (e) {
          caughtChallengeError = e;
        }
        assert.ok(caughtChallengeError, `getContractChallenge must throw on ${errCase.message}`);
        assert.ok(caughtChallengeError instanceof RpcReadError);

        // getContractDecision must THROW RpcReadError; must NOT return null
        let caughtDecisionError = null;
        try {
          await getContractDecision('0xmock', 1n);
        } catch (e) {
          caughtDecisionError = e;
        }
        assert.ok(caughtDecisionError, `getContractDecision must throw on ${errCase.message}`);
        assert.ok(caughtDecisionError instanceof RpcReadError);

        // getContractChallengeCount must THROW RpcReadError
        let caughtCountError = null;
        try {
          await getContractChallengeCount('0xmock');
        } catch (e) {
          caughtCountError = e;
        }
        assert.ok(caughtCountError, `getContractChallengeCount must throw on ${errCase.message}`);
        assert.ok(caughtCountError instanceof RpcReadError);
      }

      // Restore original
      readOnlyClient.readContract = originalReadContract;
    } finally {
      await viteServer.close();
    }

    console.log('✓ PASS: Actual frontend services imported; RPC read failures strictly throw RpcReadError and are never masked as empty results.');
    passedTests++;
  }

  // -------------------------------------------------------------
  // Test 17: Getter Failure After Deployment Preserves Address; --deploy-only Never Prints Verified
  // -------------------------------------------------------------
  console.log('\n[Test 17] Getter Failure After Successful Deployment Preserves Address; --deploy-only Never Prints Verified');
  {
    const testEvidencePath = 'scratch/test_evidence_getter_fail.json';
    if (fs.existsSync(testEvidencePath)) fs.unlinkSync(testEvidencePath);

    const mockDeployTxHash = '0xdeploy_tx_success_getters_fail';
    const mockContractAddr = '0x4072D26298eefD8c6D865164a6a3c14fa3E7e272';
    const mockAccount = { address: '0x1E47d7d7079FE4aD599B184559ffCDC56278fb54' };

    let deployCallCount = 0;
    const mockClient = {
      deployContract: async () => {
        deployCallCount++;
        return mockDeployTxHash;
      },
      waitForFinalization: async () => {},
      getTransaction: async ({ hash }) => {
        return {
          hash,
          statusName: 'FINALIZED',
          txExecutionResultName: 'FINISHED_WITH_RETURN',
          data: {
            contract_code: 'IyB7ICJEZXBlbmRzIjogInB5LWdlbmxheWVy... (mock code)',
            contract_address: mockContractAddr,
          },
          to_address: mockContractAddr,
          consensus_data: {
            leader_receipt: [{ execution_result: 'SUCCESS', contract_state_hash: '0xmockhash' }],
          },
        };
      },
      readContract: async () => {
        throw new Error(
          "Can't reconnect until invalid transaction is rolled back. Please rollback() fully before proceeding (Background on this error at: https://sqlalche.me/e/20/8s2b)"
        );
      },
    };

    // 1. Run deployContract with failing getters
    const deployResult = await deployContract(
      mockClient,
      mockAccount,
      '# sample code',
      {},
      'https://studio-next.genlayer.com/api',
      testEvidencePath
    );

    // Verify returned result preserves address and records unverified getter status
    assert.strictEqual(deployResult.contractAddress, mockContractAddr, 'Deployed address must be returned');
    assert.strictEqual(deployResult.deployTxHash, mockDeployTxHash, 'Deployed tx hash must be returned');
    assert.strictEqual(deployResult.getterReadStatus, 'BLOCKED_BY_NODE_SQLALCHEMY_SESSION', 'Getter status must be BLOCKED_BY_NODE_SQLALCHEMY_SESSION');
    assert.strictEqual(deployResult.initialGetters, null, 'initialGetters must be null when reads fail');

    // Verify evidence file on disk
    const savedEvidence = JSON.parse(fs.readFileSync(testEvidencePath, 'utf-8'));
    assert.strictEqual(savedEvidence.contractAddress, mockContractAddr, 'Contract address must be saved in evidence');
    assert.strictEqual(savedEvidence.deployTxHash, mockDeployTxHash, 'deployTxHash must be saved');
    assert.strictEqual(savedEvidence.deployStatus, 'FINALIZED', 'deployStatus must remain FINALIZED');
    assert.strictEqual(savedEvidence.deployResult, 'FINISHED_WITH_RETURN', 'deployResult must remain FINISHED_WITH_RETURN');
    assert.strictEqual(savedEvidence.deployStage, 'DEPLOYED_GETTER_READ_BLOCKED_BY_RPC', 'Stage must reflect blocked reads, NOT unknown');
    assert.strictEqual(savedEvidence.getterReadStatus, 'BLOCKED_BY_NODE_SQLALCHEMY_SESSION', 'getterReadStatus must be tracked separately');
    assert.ok(savedEvidence.contractCodeSHA256, 'Source SHA-256 must be persisted');
    assert.ok(Array.isArray(savedEvidence.deploymentHistory) && savedEvidence.deploymentHistory.length === 1, 'Attempt history must be preserved');

    // 2. Test --deploy-only behavior: intercept logs and verify it NEVER prints "verified"
    const capturedLogs = [];
    const origLog = console.log;
    console.log = (...args) => {
      capturedLogs.push(args.join(' '));
      origLog(...args);
    };

    try {
      await main(
        ['--account', 'test-alias', '--deploy-only'],
        {
          client: {
            ...mockClient,
            getChainId: async () => 61997,
            getBalance: async () => 100000000000000000000n,
            estimateTransactionFees: async () => ({
              feeValue: 100000000000000000n,
              distribution: {
                leaderTimeunitsAllocation: 10,
                validatorTimeunitsAllocation: 20,
                executionBudgetPerRound: 1000,
                maxPriceGenPerTimeUnit: 100,
                rotations: [],
              },
            }),
          },
          account: mockAccount,
          evidencePath: testEvidencePath,
        }
      );
    } finally {
      console.log = origLog;
    }

    const allOutput = capturedLogs.join('\n');
    assert.ok(!allOutput.includes('Deployment completed and verified'), '--deploy-only must NEVER print "Deployment completed and verified" while getters are unverified');
    assert.ok(!allOutput.includes('Verified contract address:'), '--deploy-only must NEVER print "Verified contract address" while getters are unverified');
    assert.ok(allOutput.includes('initial getters remain unverified'), '--deploy-only must explicitly declare getters remain unverified');
    assert.ok(allOutput.includes('[HALT] --deploy-only requires verified getters'), '--deploy-only must halt on unverified getters');

    if (fs.existsSync(testEvidencePath)) fs.unlinkSync(testEvidencePath);

    console.log('✓ PASS: Getter failure after successful deployment permanently preserves deployed address and history; --deploy-only never prints verified.');
    passedTests++;
  }

  // -------------------------------------------------------------
  // Test 18: Resume on Deployed Contract Performs Only Missing Reads, Makes Zero Deploy Calls
  // -------------------------------------------------------------
  console.log('\n[Test 18] Resume on Deployed Contract Performs Only Missing Reads, Makes Zero Deploy Calls');
  {
    const testEvidencePath = 'scratch/test_evidence_resume_zero_deploy.json';
    const mockDeployTxHash = '0xd7739824f3d777bbcbfa1e630dfa6f16724ae92534e06886508586ad82d3072a';
    const mockContractAddr = '0x4072D26298eefD8c6D865164a6a3c14fa3E7e272';
    const mockAccount = { address: '0x1E47d7d7079FE4aD599B184559ffCDC56278fb54' };

    fs.writeFileSync(
      testEvidencePath,
      JSON.stringify({
        contractAddress: mockContractAddr,
        deployTxHash: mockDeployTxHash,
        deployStatus: 'FINALIZED',
        deployResult: 'FINISHED_WITH_RETURN',
        deployStage: 'DEPLOYED_GETTER_READ_BLOCKED_BY_RPC',
        rpcUrl: 'https://studio-next.genlayer.com/api',
        chainId: 61997,
        accountAddress: mockAccount.address,
        getterReadStatus: 'BLOCKED_BY_NODE_SQLALCHEMY_SESSION',
        deploymentHistory: [
          {
            attempt: 1,
            txHash: '0xfailed_hash',
            status: 'FINALIZED',
            result: 'FINISHED_WITH_ERROR',
          },
          {
            attempt: 2,
            txHash: mockDeployTxHash,
            status: 'FINALIZED',
            result: 'FINISHED_WITH_RETURN',
            contractAddress: mockContractAddr,
          },
        ],
      })
    );

    let deployCalls = 0;
    let getterCalls = 0;

    const mockClient = {
      deployContract: async () => {
        deployCalls++;
        throw new Error('deployContract must NEVER be called on resume!');
      },
      getTransaction: async ({ hash }) => {
        assert.strictEqual(hash, mockDeployTxHash, 'Must inspect saved deployment transaction');
        return {
          hash,
          statusName: 'FINALIZED',
          txExecutionResultName: 'FINISHED_WITH_RETURN',
          data: {
            contract_code: 'IyB7...',
            contract_address: mockContractAddr,
          },
          to_address: mockContractAddr,
          consensus_data: {
            leader_receipt: [{ execution_result: 'SUCCESS', contract_state_hash: '0xstate' }],
          },
        };
      },
      readContract: async ({ functionName }) => {
        getterCalls++;
        if (functionName === 'get_challenge_count') return 0n;
        if (functionName === 'get_total_locked_escrow') return 0n;
        if (functionName === 'get_total_claimable_credits') return 0n;
        return null;
      },
    };

    // Execute resume
    const resumeResult = await deployContract(
      mockClient,
      mockAccount,
      'code',
      {},
      'https://studio-next.genlayer.com/api',
      testEvidencePath
    );

    // Verify zero deploy calls
    assert.strictEqual(deployCalls, 0, 'Zero deployContract calls must be made on resume');
    assert.strictEqual(getterCalls, 3, 'All 3 missing getters must be read');
    assert.strictEqual(resumeResult.contractAddress, mockContractAddr, 'Resumed address must match saved contract address');
    assert.strictEqual(resumeResult.getterReadStatus, 'VERIFIED', 'Getter status must transition to VERIFIED');
    assert.deepStrictEqual(resumeResult.initialGetters, {
      challengeCount: '0',
      totalLockedEscrow: '0',
      totalClaimableCredits: '0',
    });

    // Verify updated evidence on disk
    const updatedEvidence = JSON.parse(fs.readFileSync(testEvidencePath, 'utf-8'));
    assert.strictEqual(updatedEvidence.deployTxHash, mockDeployTxHash, 'Original deployment txHash must be preserved');
    assert.strictEqual(updatedEvidence.getterReadStatus, 'VERIFIED', 'getterReadStatus must be updated to VERIFIED');
    assert.strictEqual(updatedEvidence.deployStage, 'FINALIZED', 'deployStage must transition to FINALIZED');
    assert.strictEqual(updatedEvidence.deploymentHistory.length, 2, 'Attempt history must be preserved with 2 attempts');

    // Subtest 18b: Authoritative address validation rejection
    // If transaction returns an arbitrary to_address without contract_code / data.contract_address, it MUST reject
    const mockClientNoAuthAddress = {
      deployContract: async () => {
        deployCalls++;
      },
      getTransaction: async () => ({
        hash: '0xambiguous_tx',
        statusName: 'FINALIZED',
        txExecutionResultName: 'FINISHED_WITH_RETURN',
        // to_address is present, but NO contract_code, NO contract_address, NO tx.contractAddress
        to_address: '0x9999999999999999999999999999999999999999',
      }),
    };

    const testEvidenceNoAuth = 'scratch/test_evidence_no_auth.json';
    fs.writeFileSync(
      testEvidenceNoAuth,
      JSON.stringify({
        deployTxHash: '0xambiguous_tx',
        rpcUrl: 'https://studio-next.genlayer.com/api',
        chainId: 61997,
        accountAddress: mockAccount.address,
      })
    );

    let caughtAuthErr = null;
    try {
      await deployContract(
        mockClientNoAuthAddress,
        mockAccount,
        'code',
        {},
        'https://studio-next.genlayer.com/api',
        testEvidenceNoAuth
      );
    } catch (err) {
      caughtAuthErr = err;
    }

    assert.ok(caughtAuthErr, 'Must reject when authoritative contract deployment address is missing');
    assert.ok(caughtAuthErr.message.includes('AUTHORITATIVE_ADDRESS_MISSING'), `Error must be AUTHORITATIVE_ADDRESS_MISSING, got: ${caughtAuthErr.message}`);
    assert.strictEqual(deployCalls, 0, 'Zero deploy calls when authoritative address is missing');

    if (fs.existsSync(testEvidencePath)) fs.unlinkSync(testEvidencePath);
    if (fs.existsSync(testEvidenceNoAuth)) fs.unlinkSync(testEvidenceNoAuth);

    console.log('✓ PASS: Resume on deployed contract performs only missing reads, validates authoritative address, and makes ZERO deployContract calls.');
    passedTests++;
  }

  // -------------------------------------------------------------
  // Test 19: Code Mismatch Blocks Verification Even If Getters Succeed
  // -------------------------------------------------------------
  console.log('\n[Test 19] Code Mismatch Blocks Deployment Verification');
  {
    const mockContractAddr = '0x4072D26298eefD8c6D865164a6a3c14fa3E7e272';
    const mockTxHash = '0xd7739824f3d777bbcbfa1e630dfa6f16724ae92534e06886508586ad82d3072a';
    let getterCalled = false;

    const mockPrimaryClient = {
      getChainId: async () => 61997,
      getTransaction: async () => ({
        hash: mockTxHash,
        statusName: 'FINALIZED',
        txExecutionResultName: 'FINISHED_WITH_RETURN',
        data: {
          contract_code: 'IyB7...',
          contract_address: mockContractAddr,
        },
        consensus_data: {
          leader_receipt: [{ execution_result: 'SUCCESS', contract_state_hash: '0xstate' }],
        },
      }),
      request: async ({ method }) => {
        if (method === 'gen_getContractCode') {
          return Buffer.from('different contract code here that does not match').toString('base64');
        }
        return null;
      },
      readContract: async () => {
        getterCalled = true;
        return 0n;
      },
    };

    let caughtErr = null;
    try {
      await executeReadVerification(
        ['--contract', mockContractAddr, '--tx', mockTxHash, '--compare-rpc', 'https://studio-next.genlayer.com/api'],
        { primaryClient: mockPrimaryClient }
      );
    } catch (err) {
      caughtErr = err;
    }

    assert.ok(caughtErr, 'Execution must halt with error on code mismatch');
    assert.ok(
      caughtErr.message.includes('CODE_CHECK_FAILED') || caughtErr.message.includes('CODE_MISMATCH'),
      `Error must reflect code check failure, got: ${caughtErr.message}`
    );
    assert.strictEqual(getterCalled, false, 'Getters must not be read when code check fails');

    console.log('✓ PASS: Code mismatch strictly blocks deployment verification before any getter reads.');
    passedTests++;
  }

  // -------------------------------------------------------------
  // Test 20: ACCEPTED Status (Not FINALIZED) Blocks Deployment Verification
  // -------------------------------------------------------------
  console.log('\n[Test 20] ACCEPTED Status (Not FINALIZED) Blocks Verification');
  {
    const mockContractAddr = '0x4072D26298eefD8c6D865164a6a3c14fa3E7e272';
    const mockTxHash = '0xd7739824f3d777bbcbfa1e630dfa6f16724ae92534e06886508586ad82d3072a';

    const mockPrimaryClient = {
      getChainId: async () => 61997,
      getTransaction: async () => ({
        hash: mockTxHash,
        statusName: 'ACCEPTED', // Not FINALIZED
        txExecutionResultName: 'FINISHED_WITH_RETURN',
        data: {
          contract_code: 'IyB7...',
          contract_address: mockContractAddr,
        },
      }),
    };

    let caughtErr = null;
    try {
      await executeReadVerification(
        ['--contract', mockContractAddr, '--tx', mockTxHash, '--compare-rpc', 'https://studio-next.genlayer.com/api'],
        { primaryClient: mockPrimaryClient }
      );
    } catch (err) {
      caughtErr = err;
    }

    assert.ok(caughtErr, 'Execution must halt when status is ACCEPTED instead of FINALIZED');
    assert.ok(
      caughtErr.message.includes('FINALIZED') && caughtErr.message.includes('ACCEPTED'),
      `Error must specify ACCEPTED is not FINALIZED, got: ${caughtErr.message}`
    );

    console.log('✓ PASS: ACCEPTED deployment status strictly rejected; FINALIZED is required.');
    passedTests++;
  }

  // -------------------------------------------------------------
  // Test 21: Missing Evidence Context Without Fallback
  // -------------------------------------------------------------
  console.log('\n[Test 21] Missing Evidence Context Without Fallback Throws Error');
  {
    // Case A: Missing evidence file completely
    let caughtA = null;
    try {
      parseVerifyArgs(['--evidence', 'scratch/non_existent_evidence_file_123.json']);
    } catch (err) {
      caughtA = err;
    }
    assert.ok(caughtA, 'parseVerifyArgs must throw when evidence is missing and no CLI args provided');
    assert.ok(
      caughtA.message.includes('MISSING_EVIDENCE_CONTEXT'),
      `Error must be MISSING_EVIDENCE_CONTEXT, got: ${caughtA.message}`
    );

    // Case B: Evidence file with invalid/missing contractAddress
    const testMalformedPath = 'scratch/test_malformed_evidence.json';
    fs.writeFileSync(
      testMalformedPath,
      JSON.stringify({
        deployTxHash: '0xd7739824f3d777bbcbfa1e630dfa6f16724ae92534e06886508586ad82d3072a',
        contractAddress: 'not-a-valid-hex-address',
      })
    );

    let caughtB = null;
    try {
      parseVerifyArgs(['--evidence', testMalformedPath]);
    } catch (err) {
      caughtB = err;
    }
    assert.ok(caughtB, 'parseVerifyArgs must throw when evidence has invalid contractAddress');
    assert.ok(
      caughtB.message.includes('MISSING_EVIDENCE_CONTEXT'),
      `Error must be MISSING_EVIDENCE_CONTEXT, got: ${caughtB.message}`
    );

    if (fs.existsSync(testMalformedPath)) fs.unlinkSync(testMalformedPath);

    console.log('✓ PASS: Hardcoded fallbacks strictly prevented; missing evidence throws MISSING_EVIDENCE_CONTEXT.');
    passedTests++;
  }

  // -------------------------------------------------------------
  // Test 22: RPC Failure Records Sanitized Summary Without rawError and Preserves Evidence
  // -------------------------------------------------------------
  console.log('\n[Test 22] RPC Failure Records Sanitized Summary Without rawError and Preserves Evidence');
  {
    const mockContractAddr = '0x4072D26298eefD8c6D865164a6a3c14fa3E7e272';
    const mockTxHash = '0xd7739824f3d777bbcbfa1e630dfa6f16724ae92534e06886508586ad82d3072a';
    const localContent = fs.readFileSync(path.resolve(__dirname, '../contracts/brief_arena.py'), 'utf-8');
    const localBase64 = Buffer.from(localContent, 'utf-8').toString('base64');

    const testEvidencePath = 'scratch/test_verify_preserves_evidence.json';
    const testReportPath = 'scratch/test_verify_sanitized_report.json';

    // Seed initial evidence with 2 historical attempts
    fs.writeFileSync(
      testEvidencePath,
      JSON.stringify({
        contractAddress: mockContractAddr,
        deployTxHash: mockTxHash,
        deployStatus: 'FINALIZED',
        deployResult: 'FINISHED_WITH_RETURN',
        deployStage: 'FINALIZED',
        rpcUrl: 'https://studio-next.genlayer.com/api',
        chainId: 61997,
        contractCodeSHA256: 'cdab81a806cf52753bf764ad8780f883705191893ed968f3951e6884bb764e19',
        getterReadStatus: 'PENDING',
        deploymentHistory: [
          { attempt: 1, txHash: '0x1f7b...hash1', status: 'FINALIZED', result: 'FINISHED_WITH_ERROR' },
          { attempt: 2, txHash: mockTxHash, status: 'FINALIZED', result: 'FINISHED_WITH_RETURN' },
        ],
      }, null, 2)
    );

    const mockPrimaryClient = {
      getChainId: async () => 61997,
      getTransaction: async () => ({
        hash: mockTxHash,
        statusName: 'FINALIZED',
        txExecutionResultName: 'FINISHED_WITH_RETURN',
        data: {
          contract_code: localBase64,
          contract_address: mockContractAddr,
        },
        consensus_data: {
          leader_receipt: [{ execution_result: 'SUCCESS', contract_state_hash: '0xstate' }],
        },
      }),
      request: async ({ method }) => {
        if (method === 'gen_getContractCode') return localBase64;
        return null;
      },
      readContract: async () => {
        throw new Error(
          "Can't reconnect until invalid transaction is rolled back. Please rollback() fully before proceeding (Background on this error at: https://sqlalche.me/e/20/8s2b)"
        );
      },
    };

    const report = await executeReadVerification(
      [
        '--contract', mockContractAddr,
        '--tx', mockTxHash,
        '--evidence', testEvidencePath,
        '--report', testReportPath,
        '--compare-rpc', 'https://studio-next.genlayer.com/api', // prevent compare retry
        '--retries', '1',
      ],
      { primaryClient: mockPrimaryClient }
    );

    // Verify report fields
    assert.strictEqual(report.deploymentVerified, true, 'Deployment itself must be verified');
    assert.strictEqual(report.allReadsVerified, false, 'Reads must be unverified');
    assert.strictEqual(report.getterReadStatus, 'BLOCKED_BY_NODE_SQLALCHEMY_SESSION');
    assert.strictEqual(report.structuredError.category, 'RPC_NODE_SQLALCHEMY_TRANSACTION_ABORT');
    assert.strictEqual(report.structuredError.rawError, undefined, 'rawError must NOT be present on structuredError');

    // Verify saved report file on disk
    const reportFileJson = JSON.parse(fs.readFileSync(testReportPath, 'utf-8'));
    const reportRawStr = fs.readFileSync(testReportPath, 'utf-8');
    assert.ok(!reportRawStr.includes('"rawError"'), 'Persisted sanitized report JSON must NOT contain rawError key');
    assert.strictEqual(reportFileJson.getterReadStatus, 'BLOCKED_BY_NODE_SQLALCHEMY_SESSION');

    // Verify preserved evidence file on disk
    const updatedEvidence = JSON.parse(fs.readFileSync(testEvidencePath, 'utf-8'));
    assert.strictEqual(updatedEvidence.deployTxHash, mockTxHash, 'Original deployment tx hash must be preserved');
    assert.strictEqual(updatedEvidence.contractCodeSHA256, 'cdab81a806cf52753bf764ad8780f883705191893ed968f3951e6884bb764e19', 'SHA-256 must be preserved');
    assert.strictEqual(updatedEvidence.deploymentHistory.length, 2, 'All 2 deployment attempts must be preserved');
    assert.strictEqual(updatedEvidence.getterReadStatus, 'BLOCKED_BY_NODE_SQLALCHEMY_SESSION');
    assert.strictEqual(updatedEvidence.deployStage, 'DEPLOYED_GETTER_READ_BLOCKED_BY_RPC');

    // Clean up test files
    if (fs.existsSync(testEvidencePath)) fs.unlinkSync(testEvidencePath);
    if (fs.existsSync(testReportPath)) fs.unlinkSync(testReportPath);

    console.log('✓ PASS: RPC failure report strictly sanitized without rawError, and all evidence/history preserved.');
    passedTests++;
  }

  // -------------------------------------------------------------
  // Test 23: Failed Getter Preflight Halts with Zero Writes
  // -------------------------------------------------------------
  console.log('\n[Test 23] Failed Getter Preflight Halts with Zero Writes');
  {
    const mockContractAddr = '0x4072D26298eefD8c6D865164a6a3c14fa3E7e272';
    const testReportPath = 'scratch/test_preflight_fail_report.json';
    let writeCalled = false;

    const participants = createMockParticipants({
      readContract: (role, params) => {
        if (params.functionName === 'get_challenge_count') {
          throw new Error("Can't reconnect until invalid transaction is rolled back (SQLAlchemy pool abort)");
        }
        return 0n;
      },
      writeContract: () => {
        writeCalled = true;
        return '0xshould_not_happen';
      },
    });

    let caughtErr = null;
    try {
      await runThreeEntrantScenario(
        ['--contract', mockContractAddr, '--execute', '--report', testReportPath],
        participants
      );
    } catch (err) {
      caughtErr = err;
    }

    assert.ok(caughtErr, 'Must throw when live getter preflight fails');
    assert.ok(caughtErr.message.includes('PREFLIGHT_GETTER_READ_FAILED'), `Error must be PREFLIGHT_GETTER_READ_FAILED, got: ${caughtErr.message}`);
    assert.strictEqual(writeCalled, false, 'Zero writeContract calls when getter preflight fails');

    const reportFile = JSON.parse(fs.readFileSync(testReportPath, 'utf-8'));
    assert.strictEqual(reportFile.status, 'PREFLIGHT_GETTER_READ_BLOCKED');
    assert.strictEqual(reportFile.writesPerformed, 0);

    if (fs.existsSync(testReportPath)) fs.unlinkSync(testReportPath);

    console.log('✓ PASS: Live getter read failure during preflight halts execution before any writes.');
    passedTests++;
  }

  // -------------------------------------------------------------
  // Test 24: Corrupt/Unreadable Evidence File Halts Before Any Write
  // -------------------------------------------------------------
  console.log('\n[Test 24] Corrupt/Unreadable Evidence Halts Before Any Write');
  {
    const mockContractAddr = '0x4072D26298eefD8c6D865164a6a3c14fa3E7e272';
    const testEvidencePath = 'scratch/test_corrupt_evidence.json';
    const testReportPath = 'scratch/test_corrupt_report.json';
    let writeCalled = false;

    // Write unreadable/corrupt JSON to disk
    fs.writeFileSync(testEvidencePath, '{ this is corrupted json payload... [broken');

    const participants = createMockParticipants({
      writeContract: () => {
        writeCalled = true;
        return '0xshould_not_write';
      },
    });

    let caughtErr = null;
    try {
      await runThreeEntrantScenario(
        ['--contract', mockContractAddr, '--execute', '--evidence', testEvidencePath, '--report', testReportPath],
        participants
      );
    } catch (err) {
      caughtErr = err;
    }

    assert.ok(caughtErr, 'Must throw on corrupt evidence file');
    assert.ok(caughtErr.message.includes('CORRUPT_EVIDENCE_FILE'), `Expected CORRUPT_EVIDENCE_FILE error, got: ${caughtErr.message}`);
    assert.strictEqual(writeCalled, false, 'Zero writes performed when evidence is corrupt');

    // Confirm corrupt file was NOT overwritten
    const rawContent = fs.readFileSync(testEvidencePath, 'utf-8');
    assert.ok(rawContent.includes('corrupted json'), 'Corrupt evidence must not be overwritten');

    if (fs.existsSync(testEvidencePath)) fs.unlinkSync(testEvidencePath);
    if (fs.existsSync(testReportPath)) fs.unlinkSync(testReportPath);

    console.log('✓ PASS: Corrupt/unreadable evidence halts execution before any write without overwriting.');
    passedTests++;
  }

  // -------------------------------------------------------------
  // Test 25: Context & Commitment Mismatches Halt Without Overwriting Evidence
  // -------------------------------------------------------------
  console.log('\n[Test 25] Context & Commitment Mismatches Halt Without Overwriting');
  {
    const mockContractAddr = '0x4072D26298eefD8c6D865164a6a3c14fa3E7e272';
    const testEvidencePath = 'scratch/test_mismatch_evidence.json';
    const testReportPath = 'scratch/test_mismatch_report.json';
    let writeCalled = false;

    const participants = createMockParticipants({
      writeContract: () => {
        writeCalled = true;
        return '0xshould_not_write';
      },
    });

    // Sub-case A: Evidence with DIFFERENT CONTRACT address
    fs.writeFileSync(
      testEvidencePath,
      JSON.stringify({
        contractAddress: '0x1111111111111111111111111111111111111111',
        rpcUrl: 'https://studio-next.genlayer.com/api',
        chainId: 61997,
        commitment: 'test_commitment',
        participants: {
          sponsor: participants.sponsor.account.address,
          entrant1: participants.entrant1.account.address,
          entrant2: participants.entrant2.account.address,
          entrant3: participants.entrant3.account.address,
        },
        stage: 'INIT',
        transactions: {},
      }, null, 2)
    );

    let contractMismatchErr = null;
    try {
      await runThreeEntrantScenario(
        ['--contract', mockContractAddr, '--execute', '--evidence', testEvidencePath, '--report', testReportPath],
        participants
      );
    } catch (err) {
      contractMismatchErr = err;
    }

    assert.ok(contractMismatchErr, 'Must halt when evidence contract differs');
    assert.ok(contractMismatchErr.message.includes('EVIDENCE_CONTEXT_MISMATCH'), `Expected EVIDENCE_CONTEXT_MISMATCH, got: ${contractMismatchErr.message}`);
    assert.ok(contractMismatchErr.message.includes('Never replacing existing evidence'), 'Must declare never replacing existing evidence');
    assert.strictEqual(writeCalled, false, 'Zero writes on contract mismatch');

    // Confirm file was preserved with original contract
    const savedEvA = JSON.parse(fs.readFileSync(testEvidencePath, 'utf-8'));
    assert.strictEqual(savedEvA.contractAddress, '0x1111111111111111111111111111111111111111');

    // Sub-case B: Evidence with DIFFERENT CHAIN ID
    fs.writeFileSync(
      testEvidencePath,
      JSON.stringify({
        contractAddress: mockContractAddr,
        rpcUrl: 'https://studio-next.genlayer.com/api',
        chainId: 1, // Mainnet chain ID instead of 61997
        commitment: 'test_commitment',
        participants: {
          sponsor: participants.sponsor.account.address,
          entrant1: participants.entrant1.account.address,
          entrant2: participants.entrant2.account.address,
          entrant3: participants.entrant3.account.address,
        },
        stage: 'INIT',
        transactions: {},
      }, null, 2)
    );

    let chainMismatchErr = null;
    try {
      await runThreeEntrantScenario(
        ['--contract', mockContractAddr, '--execute', '--evidence', testEvidencePath, '--report', testReportPath],
        participants
      );
    } catch (err) {
      chainMismatchErr = err;
    }
    assert.ok(chainMismatchErr && chainMismatchErr.message.includes('EVIDENCE_CONTEXT_MISMATCH'), 'Must halt on chain ID mismatch');

    // Sub-case C: Evidence with DIFFERENT PARTICIPANT
    fs.writeFileSync(
      testEvidencePath,
      JSON.stringify({
        contractAddress: mockContractAddr,
        rpcUrl: 'https://studio-next.genlayer.com/api',
        chainId: 61997,
        commitment: 'test_commitment',
        participants: {
          sponsor: participants.sponsor.account.address,
          entrant1: '0x9999999999999999999999999999999999999999',
          entrant2: participants.entrant2.account.address,
          entrant3: participants.entrant3.account.address,
        },
        stage: 'INIT',
        transactions: {},
      }, null, 2)
    );

    let participantMismatchErr = null;
    try {
      await runThreeEntrantScenario(
        ['--contract', mockContractAddr, '--execute', '--evidence', testEvidencePath, '--report', testReportPath],
        participants
      );
    } catch (err) {
      participantMismatchErr = err;
    }
    assert.ok(participantMismatchErr && participantMismatchErr.message.includes('EVIDENCE_CONTEXT_MISMATCH'), 'Must halt on participant mismatch');

    // Sub-case D: Evidence with DIFFERENT COMMITMENT
    fs.writeFileSync(
      testEvidencePath,
      JSON.stringify({
        contractAddress: mockContractAddr,
        rpcUrl: 'https://studio-next.genlayer.com/api',
        chainId: 61997,
        commitment: 'completely_different_commitment_hash',
        participants: {
          sponsor: participants.sponsor.account.address,
          entrant1: participants.entrant1.account.address,
          entrant2: participants.entrant2.account.address,
          entrant3: participants.entrant3.account.address,
        },
        stage: 'INIT',
        transactions: {},
      }, null, 2)
    );

    let commitmentMismatchErr = null;
    try {
      await runThreeEntrantScenario(
        ['--contract', mockContractAddr, '--execute', '--evidence', testEvidencePath, '--report', testReportPath],
        participants
      );
    } catch (err) {
      commitmentMismatchErr = err;
    }
    assert.ok(commitmentMismatchErr && commitmentMismatchErr.message.includes('EVIDENCE_COMMITMENT_MISMATCH'), 'Must halt on commitment mismatch');

    if (fs.existsSync(testEvidencePath)) fs.unlinkSync(testEvidencePath);
    if (fs.existsSync(testReportPath)) fs.unlinkSync(testReportPath);

    console.log('✓ PASS: Context and commitment mismatches halt cleanly without overwriting existing evidence.');
    passedTests++;
  }

  // -------------------------------------------------------------
  // Test 26: Missing Required Fields in Legacy Evidence Halts for Reconciliation
  // -------------------------------------------------------------
  console.log('\n[Test 26] Missing Required Fields in Legacy Evidence Halts for Reconciliation');
  {
    const mockContractAddr = '0x4072D26298eefD8c6D865164a6a3c14fa3E7e272';
    const testEvidencePath = 'scratch/test_legacy_evidence.json';
    const testReportPath = 'scratch/test_legacy_report.json';
    let writeCalled = false;

    // Seed legacy evidence missing 'commitment' and 'transactions'
    fs.writeFileSync(
      testEvidencePath,
      JSON.stringify({
        contractAddress: mockContractAddr,
        rpcUrl: 'https://studio-next.genlayer.com/api',
        chainId: 61997,
        participants: {
          sponsor: '0x1E47d7d7079FE4aD599B184559ffCDC56278fb54',
          entrant1: '0x2222222222222222222222222222222222222222',
          entrant2: '0x3333333333333333333333333333333333333333',
          entrant3: '0x4444444444444444444444444444444444444444',
        },
        stage: 'INIT',
      }, null, 2)
    );

    const participants = createMockParticipants({
      writeContract: () => {
        writeCalled = true;
        return '0xshould_not_write';
      },
    });

    let caughtErr = null;
    try {
      await runThreeEntrantScenario(
        ['--contract', mockContractAddr, '--execute', '--evidence', testEvidencePath, '--report', testReportPath],
        participants
      );
    } catch (err) {
      caughtErr = err;
    }

    assert.ok(caughtErr, 'Must halt when required fields are missing');
    assert.ok(caughtErr.message.includes('MISSING_EVIDENCE_FIELDS'), `Expected MISSING_EVIDENCE_FIELDS, got: ${caughtErr.message}`);
    assert.ok(caughtErr.message.includes('Manual reconciliation required'), 'Must require manual reconciliation');
    assert.strictEqual(writeCalled, false, 'Zero writes performed on missing legacy fields');

    if (fs.existsSync(testEvidencePath)) fs.unlinkSync(testEvidencePath);
    if (fs.existsSync(testReportPath)) fs.unlinkSync(testReportPath);

    console.log('✓ PASS: Missing legacy fields trigger fail-closed halt requiring manual reconciliation.');
    passedTests++;
  }

  // -------------------------------------------------------------
  // Test 27: Concurrent Challenge-Count Change Derives ID Authoritatively from Receipt
  // -------------------------------------------------------------
  console.log('\n[Test 27] Concurrent Challenge-Count Change Derives ID Authoritatively from Receipt');
  {
    const mockContractAddr = '0x4072D26298eefD8c6D865164a6a3c14fa3E7e272';
    const testEvidencePath = 'scratch/test_concurrent_count_evidence.json';
    const testReportPath = 'scratch/test_concurrent_count_report.json';
    if (fs.existsSync(testEvidencePath)) fs.unlinkSync(testEvidencePath);
    if (fs.existsSync(testReportPath)) fs.unlinkSync(testReportPath);

    // Simulate concurrent challenges created on-chain:
    // get_challenge_count returns 7n, but our receipt authoritative return value is 2n
    const participants = createMockParticipants({
      challengeCount: 7n,
      createdChallengeId: 2n,
    });

    const report = await runThreeEntrantScenario(
      ['--contract', mockContractAddr, '--execute', '--evidence', testEvidencePath, '--report', testReportPath],
      participants
    );

    assert.strictEqual(report.status, 'COMPLETE');
    assert.strictEqual(report.challengeId, '2', 'Must derive ID 2 from receipt return value, NOT 7 from challenge count');

    const savedEv = JSON.parse(fs.readFileSync(testEvidencePath, 'utf-8'));
    assert.strictEqual(savedEv.challengeId, '2');

    // Sub-case: Receipt without decodable return value halts with UNDECODABLE_RETURN_VALUE
    const undecodableParticipants = createMockParticipants({
      getTransaction: () => ({
        statusName: 'FINALIZED',
        txExecutionResultName: 'FINISHED_WITH_RETURN',
        consensus_data: { leader_receipt: [{ result: { status: 'return', payload: null } }] },
      }),
    });

    if (fs.existsSync(testEvidencePath)) fs.unlinkSync(testEvidencePath);
    let undecodableErr = null;
    try {
      await runThreeEntrantScenario(
        ['--contract', mockContractAddr, '--execute', '--evidence', testEvidencePath, '--report', testReportPath],
        undecodableParticipants
      );
    } catch (err) {
      undecodableErr = err;
    }
    assert.ok(undecodableErr, 'Must halt if return value cannot be decoded');
    assert.ok(undecodableErr.message.includes('UNDECODABLE_RETURN_VALUE'), `Expected UNDECODABLE_RETURN_VALUE, got: ${undecodableErr.message}`);

    if (fs.existsSync(testEvidencePath)) fs.unlinkSync(testEvidencePath);
    if (fs.existsSync(testReportPath)) fs.unlinkSync(testReportPath);

    console.log('✓ PASS: Created challenge ID derived authoritatively from receipt return value, immune to concurrent count increments.');
    passedTests++;
  }

  // -------------------------------------------------------------
  // Test 28: Ambiguous Pre-Hash Broadcast Persists AMBIGUOUS_SUBMISSION and Halts Without Retry
  // -------------------------------------------------------------
  console.log('\n[Test 28] Ambiguous Pre-Hash Broadcast Persists AMBIGUOUS_SUBMISSION and Halts');
  {
    const mockContractAddr = '0x4072D26298eefD8c6D865164a6a3c14fa3E7e272';
    const testEvidencePath = 'scratch/test_ambiguous_evidence.json';
    const testReportPath = 'scratch/test_ambiguous_report.json';
    if (fs.existsSync(testEvidencePath)) fs.unlinkSync(testEvidencePath);
    if (fs.existsSync(testReportPath)) fs.unlinkSync(testReportPath);

    let writeAttempts = 0;
    const participantsThrowing = createMockParticipants({
      writeContract: () => {
        writeAttempts++;
        throw new Error('Socket hang up / network dropped after POST /api');
      },
    });

    // Run 1: Broadcast throws before returning hash
    let caughtRun1 = null;
    try {
      await runThreeEntrantScenario(
        ['--contract', mockContractAddr, '--execute', '--evidence', testEvidencePath, '--report', testReportPath],
        participantsThrowing
      );
    } catch (err) {
      caughtRun1 = err;
    }

    assert.ok(caughtRun1, 'Run 1 must halt on ambiguous submission');
    assert.ok(caughtRun1.message.includes('AMBIGUOUS_SUBMISSION'), `Expected AMBIGUOUS_SUBMISSION, got: ${caughtRun1.message}`);
    assert.strictEqual(writeAttempts, 1);

    // Verify AMBIGUOUS_SUBMISSION persisted to disk
    assert.ok(fs.existsSync(testEvidencePath), 'Evidence file must exist');
    const savedAmbEv = JSON.parse(fs.readFileSync(testEvidencePath, 'utf-8'));
    assert.strictEqual(savedAmbEv.stage, 'AMBIGUOUS_SUBMISSION');
    assert.strictEqual(savedAmbEv.transactions.createChallenge.status, 'AMBIGUOUS_SUBMISSION');

    // Run 2: Resume attempt MUST HALT IMMEDIATELY without attempting to write again
    let caughtRun2 = null;
    try {
      await runThreeEntrantScenario(
        ['--contract', mockContractAddr, '--execute', '--evidence', testEvidencePath, '--report', testReportPath],
        participantsThrowing
      );
    } catch (err) {
      caughtRun2 = err;
    }

    assert.ok(caughtRun2, 'Run 2 must halt immediately on AMBIGUOUS_SUBMISSION');
    assert.ok(
      caughtRun2.message.includes('AMBIGUOUS_SUBMISSION_REQUIRES_MANUAL_RECONCILIATION'),
      `Expected reconciliation error on resume, got: ${caughtRun2.message}`
    );
    assert.strictEqual(writeAttempts, 1, 'Run 2 must NEVER retry an ambiguous step');

    if (fs.existsSync(testEvidencePath)) fs.unlinkSync(testEvidencePath);
    if (fs.existsSync(testReportPath)) fs.unlinkSync(testReportPath);

    console.log('✓ PASS: Ambiguous pre-hash broadcast persisted to disk and halts future runs without automatic retry.');
    passedTests++;
  }

  // -------------------------------------------------------------
  // Test 29: Forged CONFIRMED Step Rejected on Resume
  // -------------------------------------------------------------
  console.log('\n[Test 29] Forged CONFIRMED Step Rejected on Resume');
  {
    const mockContractAddr = '0x4072D26298eefD8c6D865164a6a3c14fa3E7e272';
    const testEvidencePath = 'scratch/test_forged_confirmed_evidence.json';
    const testReportPath = 'scratch/test_forged_confirmed_report.json';

    const participants = createMockParticipants();
    const commitment = computeScenarioCommitment({
      contract: mockContractAddr.toLowerCase(),
      sponsor: participants.sponsor.account.address.toLowerCase(),
      entrant1: participants.entrant1.account.address.toLowerCase(),
      entrant2: participants.entrant2.account.address.toLowerCase(),
      entrant3: participants.entrant3.account.address.toLowerCase(),
      challengeInput: {
        title: 'DeFi Speed Protocol Tagline Challenge',
        category: 'Copywriting',
        synopsis: 'Craft an iconic tagline and launch paragraph for a next-generation decentralized liquidity network.',
        requirements: ['Must highlight sub-second settlement', 'Must convey institutional security'],
        prohibited_terms: ['cheap', 'fastest', 'guaranteed'],
        duration_seconds: 86400,
        prizeAmount: '10000000000000000000',
      },
      entry1Input: {
        tagline: 'Settlement at the speed of thought.',
        paragraph: 'Engineered for high-frequency algorithmic liquidity with zero compromise on institutional safety and cryptographic guarantees.',
      },
      entry2Input: {
        tagline: 'Institutional depth meets instant finality.',
        paragraph: 'Bridging prime brokerage grade execution pipelines with trustless on-chain consensus for modern digital assets.',
      },
      entry3Input: {
        tagline: 'Uncompromising velocity for global capital.',
        paragraph: 'Next generation execution layer designed to process mission critical order flow with sub second finality.',
      },
    });

    // Sub-case A: Evidence says createChallenge is CONFIRMED, but receipt was FINISHED_WITH_ERROR
    fs.writeFileSync(
      testEvidencePath,
      JSON.stringify({
        contractAddress: mockContractAddr,
        rpcUrl: 'https://studio-next.genlayer.com/api',
        chainId: 61997,
        commitment,
        participants: {
          sponsor: participants.sponsor.account.address,
          entrant1: participants.entrant1.account.address,
          entrant2: participants.entrant2.account.address,
          entrant3: participants.entrant3.account.address,
        },
        baselines: {
          sponsorCredit: '0',
          entrant1Credit: '0',
          entrant2Credit: '0',
          entrant3Credit: '0',
          totalLockedEscrow: '0',
          totalClaimableCredits: '0',
        },
        stage: 'CHALLENGE_CREATED',
        challengeId: '1',
        transactions: {
          createChallenge: { txHash: '0xforged_hash', status: 'CONFIRMED' },
        },
      }, null, 2)
    );

    const participantsErrorReceipt = createMockParticipants({
      getTransaction: () => ({
        statusName: 'FINALIZED',
        txExecutionResultName: 'FINISHED_WITH_ERROR', // Failed on-chain
      }),
    });

    let forgedReceiptErr = null;
    try {
      await runThreeEntrantScenario(
        ['--contract', mockContractAddr, '--execute', '--evidence', testEvidencePath, '--report', testReportPath],
        participantsErrorReceipt
      );
    } catch (err) {
      forgedReceiptErr = err;
    }

    assert.ok(forgedReceiptErr, 'Must reject forged confirmed step with failed receipt');
    assert.ok(forgedReceiptErr.message.includes('EXECUTION_FAILED'), `Expected EXECUTION_FAILED, got: ${forgedReceiptErr.message}`);

    // Sub-case B: Receipt is FINISHED_WITH_RETURN, but on-chain sponsor does not match
    const participantsWrongSponsor = createMockParticipants({
      readContract: (role, params) => {
        if (params.functionName === 'get_challenge') {
          return {
            id: 1n,
            sponsorAddress: '0x9999999999999999999999999999999999999999', // Different sponsor!
            title: 'DeFi Speed Protocol Tagline Challenge',
            prizeAmount: 10000000000000000000n,
            mandatoryRequirements: ['Must highlight sub-second settlement', 'Must convey institutional security'],
            status: 0n,
            filledSlots: 0n,
          };
        }
        return undefined;
      },
    });

    fs.writeFileSync(
      testEvidencePath,
      JSON.stringify({
        contractAddress: mockContractAddr,
        rpcUrl: 'https://studio-next.genlayer.com/api',
        chainId: 61997,
        commitment,
        participants: {
          sponsor: participants.sponsor.account.address,
          entrant1: participants.entrant1.account.address,
          entrant2: participants.entrant2.account.address,
          entrant3: participants.entrant3.account.address,
        },
        baselines: {
          sponsorCredit: '0',
          entrant1Credit: '0',
          entrant2Credit: '0',
          entrant3Credit: '0',
          totalLockedEscrow: '0',
          totalClaimableCredits: '0',
        },
        stage: 'CHALLENGE_CREATED',
        challengeId: '1',
        transactions: {
          createChallenge: { txHash: '0xsome_hash', status: 'CONFIRMED' },
        },
      }, null, 2)
    );

    let forgedStateErr = null;
    try {
      await runThreeEntrantScenario(
        ['--contract', mockContractAddr, '--execute', '--evidence', testEvidencePath, '--report', testReportPath],
        participantsWrongSponsor
      );
    } catch (err) {
      forgedStateErr = err;
    }

    assert.ok(forgedStateErr, 'Must reject forged step with mismatched on-chain state');
    assert.ok(forgedStateErr.message.includes('CHALLENGE_STATE_MISMATCH'), `Expected CHALLENGE_STATE_MISMATCH, got: ${forgedStateErr.message}`);

    if (fs.existsSync(testEvidencePath)) fs.unlinkSync(testEvidencePath);
    if (fs.existsSync(testReportPath)) fs.unlinkSync(testReportPath);

    console.log('✓ PASS: Forged CONFIRMED step rejected on resume by verifying receipt AND on-chain state.');
    passedTests++;
  }

  // -------------------------------------------------------------
  // Test 30: Wrong Entrant / Ordering Halts Final Verification as INCONCLUSIVE
  // -------------------------------------------------------------
  console.log('\n[Test 30] Wrong Entrant / Ordering Halts Final Verification as INCONCLUSIVE');
  {
    const mockContractAddr = '0x4072D26298eefD8c6D865164a6a3c14fa3E7e272';
    const testEvidencePath = 'scratch/test_wrong_entrant_evidence.json';
    const testReportPath = 'scratch/test_wrong_entrant_report.json';
    if (fs.existsSync(testEvidencePath)) fs.unlinkSync(testEvidencePath);
    if (fs.existsSync(testReportPath)) fs.unlinkSync(testReportPath);

    const baseParticipants = createMockParticipants();
    // Simulate swapped / out of order entries on-chain (entrant 2 is first instead of entrant 1)
    const swappedEntries = [
      { entryNumber: 1n, authorAddress: baseParticipants.entrant2.account.address, tagline: 'Settlement at the speed of thought.', paragraph: 'Engineered for high-frequency algorithmic liquidity with zero compromise on institutional safety and cryptographic guarantees.' },
      { entryNumber: 2n, authorAddress: baseParticipants.entrant1.account.address, tagline: 'Institutional depth meets instant finality.', paragraph: 'Bridging prime brokerage grade execution pipelines with trustless on-chain consensus for modern digital assets.' },
      { entryNumber: 3n, authorAddress: baseParticipants.entrant3.account.address, tagline: 'Uncompromising velocity for global capital.', paragraph: 'Next generation execution layer designed to process mission critical order flow with sub second finality.' },
    ];

    const participantsSwapped = createMockParticipants({
      terminalStage: 'AWARDED',
      readContract: (role, params, stage) => {
        if (params.functionName === 'get_entries' && stage === 'AWARDED') {
          return swappedEntries;
        }
        return undefined;
      },
    });

    let caughtErr = null;
    try {
      await runThreeEntrantScenario(
        ['--contract', mockContractAddr, '--execute', '--evidence', testEvidencePath, '--report', testReportPath],
        participantsSwapped
      );
    } catch (err) {
      caughtErr = err;
    }

    assert.ok(caughtErr, 'Must halt when entries are out of order');
    assert.ok(caughtErr.message.includes('FINAL_VERIFICATION_INCONCLUSIVE'), `Expected INCONCLUSIVE, got: ${caughtErr.message}`);

    const reportFile = JSON.parse(fs.readFileSync(testReportPath, 'utf-8'));
    assert.strictEqual(reportFile.status, 'INCONCLUSIVE', 'Report status must be INCONCLUSIVE, never COMPLETE');

    const evFile = JSON.parse(fs.readFileSync(testEvidencePath, 'utf-8'));
    assert.strictEqual(evFile.stage, 'INCONCLUSIVE');

    if (fs.existsSync(testEvidencePath)) fs.unlinkSync(testEvidencePath);
    if (fs.existsSync(testReportPath)) fs.unlinkSync(testReportPath);

    console.log('✓ PASS: Wrong entrant or entry order halts final verification and records INCONCLUSIVE.');
    passedTests++;
  }

  // -------------------------------------------------------------
  // Test 31: Incorrect Credit Delta Halts Final Verification as INCONCLUSIVE
  // -------------------------------------------------------------
  console.log('\n[Test 31] Incorrect Credit Delta Halts Final Verification as INCONCLUSIVE');
  {
    const mockContractAddr = '0x4072D26298eefD8c6D865164a6a3c14fa3E7e272';
    const testEvidencePath = 'scratch/test_bad_delta_evidence.json';
    const testReportPath = 'scratch/test_bad_delta_report.json';
    if (fs.existsSync(testEvidencePath)) fs.unlinkSync(testEvidencePath);
    if (fs.existsSync(testReportPath)) fs.unlinkSync(testReportPath);

    // Sub-case A: Winner only credited 5 GEN instead of 10 GEN
    const participantsShortCredit = createMockParticipants({
      terminalStage: 'AWARDED',
      winnerDelta: 5000000000000000000n, // Only 5 GEN delta!
    });

    let caughtShortErr = null;
    try {
      await runThreeEntrantScenario(
        ['--contract', mockContractAddr, '--execute', '--evidence', testEvidencePath, '--report', testReportPath],
        participantsShortCredit
      );
    } catch (err) {
      caughtShortErr = err;
    }

    assert.ok(caughtShortErr, 'Must halt on incorrect credit delta');
    assert.ok(caughtShortErr.message.includes('FINAL_VERIFICATION_INCONCLUSIVE'), `Expected INCONCLUSIVE, got: ${caughtShortErr.message}`);

    const reportA = JSON.parse(fs.readFileSync(testReportPath, 'utf-8'));
    assert.strictEqual(reportA.status, 'INCONCLUSIVE', 'Must record INCONCLUSIVE, never COMPLETE');

    // Sub-case B: NO_WINNER outcome, but sponsor delta is 0 (refund missing)
    if (fs.existsSync(testEvidencePath)) fs.unlinkSync(testEvidencePath);
    const participantsNoRefund = createMockParticipants({
      terminalStage: 'NO_WINNER',
      sponsorDelta: 0n, // Refund failed!
    });

    let caughtRefundErr = null;
    try {
      await runThreeEntrantScenario(
        ['--contract', mockContractAddr, '--execute', '--evidence', testEvidencePath, '--report', testReportPath],
        participantsNoRefund
      );
    } catch (err) {
      caughtRefundErr = err;
    }

    assert.ok(caughtRefundErr, 'Must halt on missing sponsor refund delta');
    assert.ok(caughtRefundErr.message.includes('FINAL_VERIFICATION_INCONCLUSIVE'));

    const reportB = JSON.parse(fs.readFileSync(testReportPath, 'utf-8'));
    assert.strictEqual(reportB.status, 'INCONCLUSIVE');

    if (fs.existsSync(testEvidencePath)) fs.unlinkSync(testEvidencePath);
    if (fs.existsSync(testReportPath)) fs.unlinkSync(testReportPath);

    console.log('✓ PASS: Incorrect credit deltas strictly halt final verification and record INCONCLUSIVE.');
    passedTests++;
  }

  // -------------------------------------------------------------
  // Test 32: Terminal Outcome 1: AWARDED (Winner Elected & Baseline Delta Verified)
  // -------------------------------------------------------------
  console.log('\n[Test 32] Terminal Outcome 1: AWARDED (Winner Elected & Baseline Delta Verified)');
  {
    const mockContractAddr = '0x4072D26298eefD8c6D865164a6a3c14fa3E7e272';
    const testEvidencePath = 'scratch/test_awarded_evidence.json';
    const testReportPath = 'scratch/test_awarded_report.json';
    if (fs.existsSync(testEvidencePath)) fs.unlinkSync(testEvidencePath);
    if (fs.existsSync(testReportPath)) fs.unlinkSync(testReportPath);

    const participants = createMockParticipants({
      terminalStage: 'AWARDED',
      baseCredits: {
        '0x1E47d7d7079FE4aD599B184559ffCDC56278fb54': 2000000000000000000n, // Prior 2 GEN credit
        '0x2222222222222222222222222222222222222222': 3000000000000000000n, // Prior 3 GEN credit
      },
    });

    const report = await runThreeEntrantScenario(
      ['--contract', mockContractAddr, '--execute', '--evidence', testEvidencePath, '--report', testReportPath],
      participants
    );

    assert.strictEqual(report.status, 'COMPLETE');
    assert.strictEqual(report.resolution.terminalKind, 'AWARDED');
    assert.strictEqual(report.resolution.winnerAddress, '0x2222222222222222222222222222222222222222');
    assert.strictEqual(report.resolution.accountingDeltas.winnerDelta, '10000000000000000000');
    assert.strictEqual(report.resolution.accountingDeltas.sponsorDelta, '0');
    assert.strictEqual(report.writesPerformed, 6);

    const savedEvidence = JSON.parse(fs.readFileSync(testEvidencePath, 'utf-8'));
    assert.strictEqual(savedEvidence.stage, 'VERIFIED_COMPLETE');
    assert.strictEqual(savedEvidence.resolution.terminalKind, 'AWARDED');
    assert.strictEqual(savedEvidence.baselines.sponsorCredit, '2000000000000000000');
    assert.strictEqual(savedEvidence.baselines.entrant1Credit, '3000000000000000000');

    if (fs.existsSync(testEvidencePath)) fs.unlinkSync(testEvidencePath);
    if (fs.existsSync(testReportPath)) fs.unlinkSync(testReportPath);

    console.log('✓ PASS: AWARDED terminal consensus resolution verified with exact baseline delta (+10 GEN).');
    passedTests++;
  }

  // -------------------------------------------------------------
  // Test 33: Terminal Outcome 2: NO_WINNER (Consensus Refund & Baseline Delta Verified)
  // -------------------------------------------------------------
  console.log('\n[Test 33] Terminal Outcome 2: NO_WINNER (Consensus Refund & Baseline Delta Verified)');
  {
    const mockContractAddr = '0x4072D26298eefD8c6D865164a6a3c14fa3E7e272';
    const testEvidencePath = 'scratch/test_no_winner_evidence.json';
    const testReportPath = 'scratch/test_no_winner_report.json';
    if (fs.existsSync(testEvidencePath)) fs.unlinkSync(testEvidencePath);
    if (fs.existsSync(testReportPath)) fs.unlinkSync(testReportPath);

    const participants = createMockParticipants({
      terminalStage: 'NO_WINNER',
      baseCredits: {
        '0x1E47d7d7079FE4aD599B184559ffCDC56278fb54': 1000000000000000000n, // Prior 1 GEN credit
      },
    });

    const report = await runThreeEntrantScenario(
      ['--contract', mockContractAddr, '--execute', '--evidence', testEvidencePath, '--report', testReportPath],
      participants
    );

    assert.strictEqual(report.status, 'COMPLETE');
    assert.strictEqual(report.resolution.terminalKind, 'NO_WINNER');
    assert.strictEqual(report.resolution.outcome, 'no-winner');
    assert.strictEqual(report.resolution.accountingDeltas.sponsorDelta, '10000000000000000000');
    assert.strictEqual(report.resolution.accountingDeltas.e1Delta, '0');
    assert.strictEqual(report.writesPerformed, 6);

    const savedEvidence = JSON.parse(fs.readFileSync(testEvidencePath, 'utf-8'));
    assert.strictEqual(savedEvidence.stage, 'VERIFIED_COMPLETE');
    assert.strictEqual(savedEvidence.resolution.terminalKind, 'NO_WINNER');
    assert.strictEqual(savedEvidence.baselines.sponsorCredit, '1000000000000000000');

    if (fs.existsSync(testEvidencePath)) fs.unlinkSync(testEvidencePath);
    if (fs.existsSync(testReportPath)) fs.unlinkSync(testReportPath);

    console.log('✓ PASS: NO_WINNER terminal consensus resolution verified with exact sponsor refund delta (+10 GEN).');
    passedTests++;
  }

  // Helper for computing commitment in tests 34-42
  const getTestCommitment = (mockContractAddr, participants) => {
    const challengeInput = {
      title: 'DeFi Speed Protocol Tagline Challenge',
      category: 'Copywriting',
      synopsis: 'Craft an iconic tagline and launch paragraph for a next-generation decentralized liquidity network.',
      requirements: ['Must highlight sub-second settlement', 'Must convey institutional security'],
      prohibited_terms: ['cheap', 'fastest', 'guaranteed'],
      duration_seconds: 86400,
      prizeAmount: '10000000000000000000',
    };
    const entry1Input = {
      tagline: 'Settlement at the speed of thought.',
      paragraph: 'Engineered for high-frequency algorithmic liquidity with zero compromise on institutional safety and cryptographic guarantees.',
    };
    const entry2Input = {
      tagline: 'Institutional depth meets instant finality.',
      paragraph: 'Bridging prime brokerage grade execution pipelines with trustless on-chain consensus for modern digital assets.',
    };
    const entry3Input = {
      tagline: 'Uncompromising velocity for global capital.',
      paragraph: 'Next generation execution layer designed to process mission critical order flow with sub second finality.',
    };

    return computeScenarioCommitment({
      contract: mockContractAddr.toLowerCase(),
      sponsor: participants.sponsor.account.address.toLowerCase(),
      entrant1: participants.entrant1.account.address.toLowerCase(),
      entrant2: participants.entrant2.account.address.toLowerCase(),
      entrant3: participants.entrant3.account.address.toLowerCase(),
      challengeInput,
      entry1Input,
      entry2Input,
      entry3Input,
    });
  };

  const defaultBaselines = {
    sponsorCredit: '0',
    entrant1Credit: '0',
    entrant2Credit: '0',
    entrant3Credit: '0',
    totalLockedEscrow: '0',
    totalClaimableCredits: '0',
  };

  // -------------------------------------------------------------
  // Test 34: Restart After Entry 1 Proves No Duplicate Writes
  // -------------------------------------------------------------
  console.log('\n[Test 34] Restart After Entry 1 Proves No Duplicate Writes');
  {
    const mockContractAddr = '0x4072D26298eefD8c6D865164a6a3c14fa3E7e272';
    const testEvidencePath = 'scratch/test_restart_entry1_evidence.json';
    const testReportPath = 'scratch/test_restart_entry1_report.json';
    if (fs.existsSync(testEvidencePath)) fs.unlinkSync(testEvidencePath);
    if (fs.existsSync(testReportPath)) fs.unlinkSync(testReportPath);

    const writesCalled = [];
    const participants = createMockParticipants({
      initialStage: 'ENTRY1',
      writeContract: (role, params) => {
        writesCalled.push({ role, fn: params.functionName });
        return undefined;
      },
    });

    const commitment = getTestCommitment(mockContractAddr, participants);
    fs.writeFileSync(
      testEvidencePath,
      JSON.stringify({
        contractAddress: mockContractAddr,
        rpcUrl: 'https://studio-next.genlayer.com/api',
        chainId: 61997,
        commitment,
        participants: {
          sponsor: participants.sponsor.account.address,
          entrant1: participants.entrant1.account.address,
          entrant2: participants.entrant2.account.address,
          entrant3: participants.entrant3.account.address,
        },
        baselines: defaultBaselines,
        stage: 'ENTRY_1_CONFIRMED',
        challengeId: '1',
        transactions: {
          createChallenge: { txHash: '0xmock_tx_create', status: 'CONFIRMED' },
          submitEntry1: { txHash: '0xmock_tx_entry1', status: 'CONFIRMED' },
        },
      }, null, 2)
    );

    const report = await runThreeEntrantScenario(
      ['--contract', mockContractAddr, '--execute', '--evidence', testEvidencePath, '--report', testReportPath],
      participants
    );

    assert.strictEqual(report.status, 'COMPLETE');
    assert.strictEqual(report.writesPerformed, 6);
    assert.strictEqual(report.transactionsSubmitted, 6);

    // Verify createChallenge and submitEntry1 were NOT re-executed
    assert.strictEqual(writesCalled.some(w => w.fn === 'create_challenge'), false, 'create_challenge must not be re-executed');
    assert.strictEqual(writesCalled.some(w => w.fn === 'submit_entry' && w.role === 'entrant1'), false, 'submit_entry 1 must not be re-executed');
    assert.strictEqual(writesCalled.some(w => w.fn === 'submit_entry' && w.role === 'entrant2'), true, 'submit_entry 2 must be executed');
    assert.strictEqual(writesCalled.some(w => w.fn === 'submit_entry' && w.role === 'entrant3'), true, 'submit_entry 3 must be executed');
    assert.strictEqual(writesCalled.some(w => w.fn === 'commit_judging'), true, 'commit_judging must be executed');
    assert.strictEqual(writesCalled.some(w => w.fn === 'attempt_judgement'), true, 'attempt_judgement must be executed');

    if (fs.existsSync(testEvidencePath)) fs.unlinkSync(testEvidencePath);
    if (fs.existsSync(testReportPath)) fs.unlinkSync(testReportPath);

    console.log('✓ PASS: Restart after entry 1 verified on-chain state and executed only subsequent steps without duplicate writes.');
    passedTests++;
  }

  // -------------------------------------------------------------
  // Test 35: Restart After Entry 2 Proves No Duplicate Writes
  // -------------------------------------------------------------
  console.log('\n[Test 35] Restart After Entry 2 Proves No Duplicate Writes');
  {
    const mockContractAddr = '0x4072D26298eefD8c6D865164a6a3c14fa3E7e272';
    const testEvidencePath = 'scratch/test_restart_entry2_evidence.json';
    const testReportPath = 'scratch/test_restart_entry2_report.json';
    if (fs.existsSync(testEvidencePath)) fs.unlinkSync(testEvidencePath);
    if (fs.existsSync(testReportPath)) fs.unlinkSync(testReportPath);

    const writesCalled = [];
    const participants = createMockParticipants({
      initialStage: 'ENTRY2',
      writeContract: (role, params) => {
        writesCalled.push({ role, fn: params.functionName });
        return undefined;
      },
    });

    const commitment = getTestCommitment(mockContractAddr, participants);
    fs.writeFileSync(
      testEvidencePath,
      JSON.stringify({
        contractAddress: mockContractAddr,
        rpcUrl: 'https://studio-next.genlayer.com/api',
        chainId: 61997,
        commitment,
        participants: {
          sponsor: participants.sponsor.account.address,
          entrant1: participants.entrant1.account.address,
          entrant2: participants.entrant2.account.address,
          entrant3: participants.entrant3.account.address,
        },
        baselines: defaultBaselines,
        stage: 'ENTRY_2_CONFIRMED',
        challengeId: '1',
        transactions: {
          createChallenge: { txHash: '0xmock_tx_create', status: 'CONFIRMED' },
          submitEntry1: { txHash: '0xmock_tx_entry1', status: 'CONFIRMED' },
          submitEntry2: { txHash: '0xmock_tx_entry2', status: 'CONFIRMED' },
        },
      }, null, 2)
    );

    const report = await runThreeEntrantScenario(
      ['--contract', mockContractAddr, '--execute', '--evidence', testEvidencePath, '--report', testReportPath],
      participants
    );

    assert.strictEqual(report.status, 'COMPLETE');
    assert.strictEqual(writesCalled.some(w => w.fn === 'create_challenge'), false, 'create_challenge must not be re-executed');
    assert.strictEqual(writesCalled.some(w => w.fn === 'submit_entry' && w.role === 'entrant1'), false, 'submit_entry 1 must not be re-executed');
    assert.strictEqual(writesCalled.some(w => w.fn === 'submit_entry' && w.role === 'entrant2'), false, 'submit_entry 2 must not be re-executed');
    assert.strictEqual(writesCalled.some(w => w.fn === 'submit_entry' && w.role === 'entrant3'), true, 'submit_entry 3 must be executed');
    assert.strictEqual(writesCalled.some(w => w.fn === 'commit_judging'), true, 'commit_judging must be executed');
    assert.strictEqual(writesCalled.some(w => w.fn === 'attempt_judgement'), true, 'attempt_judgement must be executed');

    if (fs.existsSync(testEvidencePath)) fs.unlinkSync(testEvidencePath);
    if (fs.existsSync(testReportPath)) fs.unlinkSync(testReportPath);

    console.log('✓ PASS: Restart after entry 2 verified both earlier entries and executed subsequent steps without duplicate writes.');
    passedTests++;
  }

  // -------------------------------------------------------------
  // Test 36: Restart After Entry 3 Proves No Duplicate Writes
  // -------------------------------------------------------------
  console.log('\n[Test 36] Restart After Entry 3 Proves No Duplicate Writes');
  {
    const mockContractAddr = '0x4072D26298eefD8c6D865164a6a3c14fa3E7e272';
    const testEvidencePath = 'scratch/test_restart_entry3_evidence.json';
    const testReportPath = 'scratch/test_restart_entry3_report.json';
    if (fs.existsSync(testEvidencePath)) fs.unlinkSync(testEvidencePath);
    if (fs.existsSync(testReportPath)) fs.unlinkSync(testReportPath);

    const writesCalled = [];
    const participants = createMockParticipants({
      initialStage: 'CLOSED',
      writeContract: (role, params) => {
        writesCalled.push({ role, fn: params.functionName });
        return undefined;
      },
    });

    const commitment = getTestCommitment(mockContractAddr, participants);
    fs.writeFileSync(
      testEvidencePath,
      JSON.stringify({
        contractAddress: mockContractAddr,
        rpcUrl: 'https://studio-next.genlayer.com/api',
        chainId: 61997,
        commitment,
        participants: {
          sponsor: participants.sponsor.account.address,
          entrant1: participants.entrant1.account.address,
          entrant2: participants.entrant2.account.address,
          entrant3: participants.entrant3.account.address,
        },
        baselines: defaultBaselines,
        stage: 'ENTRY_3_CONFIRMED',
        challengeId: '1',
        transactions: {
          createChallenge: { txHash: '0xmock_tx_create', status: 'CONFIRMED' },
          submitEntry1: { txHash: '0xmock_tx_entry1', status: 'CONFIRMED' },
          submitEntry2: { txHash: '0xmock_tx_entry2', status: 'CONFIRMED' },
          submitEntry3: { txHash: '0xmock_tx_entry3', status: 'CONFIRMED' },
        },
      }, null, 2)
    );

    const report = await runThreeEntrantScenario(
      ['--contract', mockContractAddr, '--execute', '--evidence', testEvidencePath, '--report', testReportPath],
      participants
    );

    assert.strictEqual(report.status, 'COMPLETE');
    assert.strictEqual(writesCalled.some(w => w.fn === 'submit_entry'), false, 'Zero submit_entry calls allowed on restart after entry 3');
    assert.strictEqual(writesCalled.some(w => w.fn === 'commit_judging'), true, 'commit_judging must be executed');
    assert.strictEqual(writesCalled.some(w => w.fn === 'attempt_judgement'), true, 'attempt_judgement must be executed');

    if (fs.existsSync(testEvidencePath)) fs.unlinkSync(testEvidencePath);
    if (fs.existsSync(testReportPath)) fs.unlinkSync(testReportPath);

    console.log('✓ PASS: Restart after entry 3 verified all three ordered entries and executed commit_judging without duplicate writes.');
    passedTests++;
  }

  // -------------------------------------------------------------
  // Test 37: Restart After commit_judging Proves No Duplicate Writes
  // -------------------------------------------------------------
  console.log('\n[Test 37] Restart After commit_judging Proves No Duplicate Writes');
  {
    const mockContractAddr = '0x4072D26298eefD8c6D865164a6a3c14fa3E7e272';
    const testEvidencePath = 'scratch/test_restart_commit_evidence.json';
    const testReportPath = 'scratch/test_restart_commit_report.json';
    if (fs.existsSync(testEvidencePath)) fs.unlinkSync(testEvidencePath);
    if (fs.existsSync(testReportPath)) fs.unlinkSync(testReportPath);

    const writesCalled = [];
    const participants = createMockParticipants({
      initialStage: 'JUDGING',
      writeContract: (role, params) => {
        writesCalled.push({ role, fn: params.functionName });
        return undefined;
      },
    });

    const commitment = getTestCommitment(mockContractAddr, participants);
    fs.writeFileSync(
      testEvidencePath,
      JSON.stringify({
        contractAddress: mockContractAddr,
        rpcUrl: 'https://studio-next.genlayer.com/api',
        chainId: 61997,
        commitment,
        participants: {
          sponsor: participants.sponsor.account.address,
          entrant1: participants.entrant1.account.address,
          entrant2: participants.entrant2.account.address,
          entrant3: participants.entrant3.account.address,
        },
        baselines: defaultBaselines,
        stage: 'JUDGING_COMMITTED',
        challengeId: '1',
        transactions: {
          createChallenge: { txHash: '0xmock_tx_create', status: 'CONFIRMED' },
          submitEntry1: { txHash: '0xmock_tx_entry1', status: 'CONFIRMED' },
          submitEntry2: { txHash: '0xmock_tx_entry2', status: 'CONFIRMED' },
          submitEntry3: { txHash: '0xmock_tx_entry3', status: 'CONFIRMED' },
          commitJudging: { txHash: '0xmock_tx_commit', status: 'CONFIRMED' },
        },
      }, null, 2)
    );

    const report = await runThreeEntrantScenario(
      ['--contract', mockContractAddr, '--execute', '--evidence', testEvidencePath, '--report', testReportPath],
      participants
    );

    assert.strictEqual(report.status, 'COMPLETE');
    assert.strictEqual(writesCalled.length, 1, 'Exactly one write must be performed on restart after commit_judging');
    assert.strictEqual(writesCalled[0].fn, 'attempt_judgement', 'Only attempt_judgement must be called');

    if (fs.existsSync(testEvidencePath)) fs.unlinkSync(testEvidencePath);
    if (fs.existsSync(testReportPath)) fs.unlinkSync(testReportPath);

    console.log('✓ PASS: Restart after commit_judging verified JUDGING status and executed only attempt_judgement.');
    passedTests++;
  }

  // -------------------------------------------------------------
  // Test 38: Restart After Finalized Judgement Proves Zero Writes
  // -------------------------------------------------------------
  console.log('\n[Test 38] Restart After Finalized Judgement Proves Zero Writes');
  {
    const mockContractAddr = '0x4072D26298eefD8c6D865164a6a3c14fa3E7e272';
    const testEvidencePath = 'scratch/test_restart_finalized_evidence.json';
    const testReportPath = 'scratch/test_restart_finalized_report.json';
    if (fs.existsSync(testEvidencePath)) fs.unlinkSync(testEvidencePath);
    if (fs.existsSync(testReportPath)) fs.unlinkSync(testReportPath);

    const writesCalled = [];
    const participants = createMockParticipants({
      initialStage: 'AWARDED',
      writeContract: (role, params) => {
        writesCalled.push({ role, fn: params.functionName });
        return undefined;
      },
    });

    const commitment = getTestCommitment(mockContractAddr, participants);
    fs.writeFileSync(
      testEvidencePath,
      JSON.stringify({
        contractAddress: mockContractAddr,
        rpcUrl: 'https://studio-next.genlayer.com/api',
        chainId: 61997,
        commitment,
        participants: {
          sponsor: participants.sponsor.account.address,
          entrant1: participants.entrant1.account.address,
          entrant2: participants.entrant2.account.address,
          entrant3: participants.entrant3.account.address,
        },
        baselines: defaultBaselines,
        stage: 'JUDGEMENT_CONFIRMED',
        challengeId: '1',
        transactions: {
          createChallenge: { txHash: '0xmock_tx_create', status: 'CONFIRMED' },
          submitEntry1: { txHash: '0xmock_tx_entry1', status: 'CONFIRMED' },
          submitEntry2: { txHash: '0xmock_tx_entry2', status: 'CONFIRMED' },
          submitEntry3: { txHash: '0xmock_tx_entry3', status: 'CONFIRMED' },
          commitJudging: { txHash: '0xmock_tx_commit', status: 'CONFIRMED' },
          attemptJudgement: { txHash: '0xmock_tx_judge', status: 'CONFIRMED' },
        },
      }, null, 2)
    );

    const report = await runThreeEntrantScenario(
      ['--contract', mockContractAddr, '--execute', '--evidence', testEvidencePath, '--report', testReportPath],
      participants
    );

    assert.strictEqual(report.status, 'COMPLETE');
    assert.strictEqual(writesCalled.length, 0, 'Zero writes must be performed on restart after finalized judgement');
    assert.strictEqual(report.writesPerformed, 6);
    assert.strictEqual(report.transactionsSubmitted, 6);

    if (fs.existsSync(testEvidencePath)) fs.unlinkSync(testEvidencePath);
    if (fs.existsSync(testReportPath)) fs.unlinkSync(testReportPath);

    console.log('✓ PASS: Restart after finalized judgement performed zero writes and verified final state.');
    passedTests++;
  }

  // -------------------------------------------------------------
  // Test 39: Missing Pre-Scenario Baseline with Existing Transactions Halts
  // -------------------------------------------------------------
  console.log('\n[Test 39] Missing Pre-Scenario Baseline with Existing Transactions Halts');
  {
    const mockContractAddr = '0x4072D26298eefD8c6D865164a6a3c14fa3E7e272';
    const testEvidencePath = 'scratch/test_missing_baseline_evidence.json';
    const testReportPath = 'scratch/test_missing_baseline_report.json';
    if (fs.existsSync(testEvidencePath)) fs.unlinkSync(testEvidencePath);
    if (fs.existsSync(testReportPath)) fs.unlinkSync(testReportPath);

    const writesCalled = [];
    const participants = createMockParticipants({
      writeContract: (role, params) => {
        writesCalled.push({ role, fn: params.functionName });
        return undefined;
      },
    });

    const commitment = getTestCommitment(mockContractAddr, participants);
    fs.writeFileSync(
      testEvidencePath,
      JSON.stringify({
        contractAddress: mockContractAddr,
        rpcUrl: 'https://studio-next.genlayer.com/api',
        chainId: 61997,
        commitment,
        participants: {
          sponsor: participants.sponsor.account.address,
          entrant1: participants.entrant1.account.address,
          entrant2: participants.entrant2.account.address,
          entrant3: participants.entrant3.account.address,
        },
        baselines: null, // MISSING BASELINES AFTER WRITES
        stage: 'ENTRY_1_CONFIRMED',
        challengeId: '1',
        transactions: {
          createChallenge: { txHash: '0xmock_tx_create', status: 'CONFIRMED' },
        },
      }, null, 2)
    );

    let caughtErr = null;
    try {
      await runThreeEntrantScenario(
        ['--contract', mockContractAddr, '--execute', '--evidence', testEvidencePath, '--report', testReportPath],
        participants
      );
    } catch (err) {
      caughtErr = err;
    }

    assert.ok(caughtErr, 'Must halt when transactions exist but baselines are missing');
    assert.ok(
      caughtErr.message.includes('MISSING_PRE_SCENARIO_BASELINES_AFTER_WRITES'),
      `Expected MISSING_PRE_SCENARIO_BASELINES_AFTER_WRITES, got: ${caughtErr.message}`
    );
    assert.strictEqual(writesCalled.length, 0, 'Zero writes must be performed when missing pre-scenario baseline');

    const evOnDisk = JSON.parse(fs.readFileSync(testEvidencePath, 'utf-8'));
    assert.strictEqual(evOnDisk.baselines, null, 'Must never capture a new baseline after writes');

    if (fs.existsSync(testEvidencePath)) fs.unlinkSync(testEvidencePath);
    if (fs.existsSync(testReportPath)) fs.unlinkSync(testReportPath);

    console.log('✓ PASS: Missing pre-scenario baseline with existing transactions halted immediately with zero new writes.');
    passedTests++;
  }

  // -------------------------------------------------------------
  // Test 40: Entry Tagline and Paragraph Verification Against Committed Scenario
  // -------------------------------------------------------------
  console.log('\n[Test 40] Entry Tagline and Paragraph Verification Against Committed Scenario');
  {
    const mockContractAddr = '0x4072D26298eefD8c6D865164a6a3c14fa3E7e272';
    const testEvidencePath = 'scratch/test_entry_text_mismatch_evidence.json';
    const testReportPath = 'scratch/test_entry_text_mismatch_report.json';
    if (fs.existsSync(testEvidencePath)) fs.unlinkSync(testEvidencePath);
    if (fs.existsSync(testReportPath)) fs.unlinkSync(testReportPath);

    const baseParticipants = createMockParticipants();

    // Sub-case A: Before entry 3 write, verify both earlier authors and texts.
    // Simulate entry 1 paragraph mismatch on-chain when queried prior to entry 3.
    const writesCalled = [];
    const participantsBadE1Text = createMockParticipants({
      initialStage: 'ENTRY2',
      writeContract: (role, params) => {
        writesCalled.push({ role, fn: params.functionName });
        return undefined;
      },
      readContract: (role, params, stage) => {
        if (params.functionName === 'get_entries' && stage === 'ENTRY2') {
          return [
            {
              entryNumber: 1n,
              authorAddress: baseParticipants.entrant1.account.address,
              tagline: 'Settlement at the speed of thought.',
              paragraph: 'Tampered paragraph that differs from committed scenario text.',
            },
            {
              entryNumber: 2n,
              authorAddress: baseParticipants.entrant2.account.address,
              tagline: 'Institutional depth meets instant finality.',
              paragraph: 'Bridging prime brokerage grade execution pipelines with trustless on-chain consensus for modern digital assets.',
            },
          ];
        }
        return undefined;
      },
    });

    const commitment = getTestCommitment(mockContractAddr, baseParticipants);
    fs.writeFileSync(
      testEvidencePath,
      JSON.stringify({
        contractAddress: mockContractAddr,
        rpcUrl: 'https://studio-next.genlayer.com/api',
        chainId: 61997,
        commitment,
        participants: {
          sponsor: baseParticipants.sponsor.account.address,
          entrant1: baseParticipants.entrant1.account.address,
          entrant2: baseParticipants.entrant2.account.address,
          entrant3: baseParticipants.entrant3.account.address,
        },
        baselines: defaultBaselines,
        stage: 'ENTRY_2_CONFIRMED',
        challengeId: '1',
        transactions: {
          createChallenge: { txHash: '0xmock_tx_create', status: 'CONFIRMED' },
          submitEntry1: { txHash: '0xmock_tx_entry1', status: 'CONFIRMED' },
          submitEntry2: { txHash: '0xmock_tx_entry2', status: 'CONFIRMED' },
        },
      }, null, 2)
    );

    let caughtErr = null;
    try {
      await runThreeEntrantScenario(
        ['--contract', mockContractAddr, '--execute', '--evidence', testEvidencePath, '--report', testReportPath],
        participantsBadE1Text
      );
    } catch (err) {
      caughtErr = err;
    }

    assert.ok(caughtErr, 'Must halt when earlier entry paragraph text differs');
    assert.ok(
      caughtErr.message.includes('ENTRY_VERIFICATION_FAILED') && caughtErr.message.includes('paragraph'),
      `Expected paragraph mismatch error, got: ${caughtErr.message}`
    );
    assert.strictEqual(writesCalled.length, 0, 'Entry 3 write must not proceed if earlier texts are invalid');

    if (fs.existsSync(testEvidencePath)) fs.unlinkSync(testEvidencePath);
    if (fs.existsSync(testReportPath)) fs.unlinkSync(testReportPath);

    console.log('✓ PASS: Pre-entry 3 check verified both earlier entries texts and halted with zero writes on mismatch.');
    passedTests++;
  }

  // -------------------------------------------------------------
  // Test 41: Failed Final Read Overwrites Stale COMPLETE Report as INCONCLUSIVE
  // -------------------------------------------------------------
  console.log('\n[Test 41] Failed Final Read Overwrites Stale COMPLETE Report as INCONCLUSIVE');
  {
    const mockContractAddr = '0x4072D26298eefD8c6D865164a6a3c14fa3E7e272';
    const testEvidencePath = 'scratch/test_stale_overwrite_evidence.json';
    const testReportPath = 'scratch/test_stale_overwrite_report.json';
    if (fs.existsSync(testEvidencePath)) fs.unlinkSync(testEvidencePath);
    if (fs.existsSync(testReportPath)) fs.unlinkSync(testReportPath);

    // Write a pre-existing STALE COMPLETE report from an earlier run
    const staleReport = {
      timestamp: '2026-01-01T00:00:00.000Z',
      contractAddress: mockContractAddr,
      rpcUrl: 'https://studio-next.genlayer.com/api',
      chainId: 61997,
      status: 'COMPLETE',
      writesPerformed: 6,
      transactionsSubmitted: 6,
    };
    fs.writeFileSync(testReportPath, JSON.stringify(staleReport, null, 2));

    // Simulate final read failure in Step 7 (e.g. get_decision throws RPC error)
    const participants = createMockParticipants({
      terminalStage: 'AWARDED',
      readContract: (role, params, stage) => {
        if (params.functionName === 'get_decision' && stage === 'AWARDED') {
          throw new Error('RPC_DATABASE_INTERNAL_ERROR: connection to database failed during get_decision');
        }
        return undefined;
      },
    });

    let caughtErr = null;
    try {
      await runThreeEntrantScenario(
        ['--contract', mockContractAddr, '--execute', '--evidence', testEvidencePath, '--report', testReportPath],
        participants
      );
    } catch (err) {
      caughtErr = err;
    }

    assert.ok(caughtErr, 'Must throw when final read fails');
    assert.ok(caughtErr.message.includes('FINAL_VERIFICATION_INCONCLUSIVE'));

    // Verify report on disk was overwritten from COMPLETE to INCONCLUSIVE
    const reportOnDisk = JSON.parse(fs.readFileSync(testReportPath, 'utf-8'));
    assert.strictEqual(reportOnDisk.status, 'INCONCLUSIVE', 'Stale COMPLETE report must be overwritten with INCONCLUSIVE');
    assert.strictEqual(reportOnDisk.transactionsSubmitted, 6, 'Must report actual submitted transactions count (6)');
    assert.strictEqual(reportOnDisk.writesPerformed, 6);

    // Verify saved evidence on disk
    const evidenceOnDisk = JSON.parse(fs.readFileSync(testEvidencePath, 'utf-8'));
    assert.strictEqual(evidenceOnDisk.stage, 'INCONCLUSIVE');
    assert.strictEqual(evidenceOnDisk.resolution.status, 'INCONCLUSIVE');

    if (fs.existsSync(testEvidencePath)) fs.unlinkSync(testEvidencePath);
    if (fs.existsSync(testReportPath)) fs.unlinkSync(testReportPath);

    console.log('✓ PASS: Failed final read overwrote stale COMPLETE report with INCONCLUSIVE and reported dynamic transaction count.');
    passedTests++;
  }

  // -------------------------------------------------------------
  // Test 42: Sensitive Secret Token and SQL Statement Redaction
  // -------------------------------------------------------------
  console.log('\n[Test 42] Sensitive Secret Token and SQL Statement Redaction');
  {
    const fakeSecretHex = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
    const fakeSecretToken = 'super_secret_agent_token_999xyz';
    const fakeSqlText = "INSERT INTO internal_vault (id, secret) VALUES (1, 'leak_test');";
    const fakePath = 'D:\\BriefArena\\scratch\\secret_keys.json';

    const rawError = {
      message: `Transaction submission failed with SECRET_KEY=${fakeSecretHex} and token: ${fakeSecretToken}`,
      details: `[SQL: ${fakeSqlText}] (psycopg2.errors.InternalError) syntax error at ${fakePath}`,
      shortMessage: `Database execution error on ${fakeSqlText}`,
    };

    // 1. Check unit sanitization
    const { category, sanitizedSummary } = sanitizeThreeEntrantError(rawError);
    assert.strictEqual(category, 'RPC_DATABASE_INTERNAL_ERROR');
    assert.strictEqual(sanitizedSummary.includes(fakeSecretHex), false, 'Private key hex must be redacted');
    assert.strictEqual(sanitizedSummary.includes(fakeSecretToken), false, 'Secret token must be redacted');
    assert.strictEqual(sanitizedSummary.includes(fakeSqlText), false, 'Internal SQL text must be redacted');
    assert.strictEqual(sanitizedSummary.includes(fakePath), false, 'Filesystem path must be redacted');
    assert.ok(sanitizedSummary.includes('[REDACTED_SECRET]') || sanitizedSummary.includes('[REDACTED_KEY]'));
    assert.ok(sanitizedSummary.includes('[REDACTED_SQL_QUERY]'));

    // 2. Check persistence in evidence and report files when error occurs in execution
    const mockContractAddr = '0x4072D26298eefD8c6D865164a6a3c14fa3E7e272';
    const testEvidencePath = 'scratch/test_redaction_evidence.json';
    const testReportPath = 'scratch/test_redaction_report.json';
    if (fs.existsSync(testEvidencePath)) fs.unlinkSync(testEvidencePath);
    if (fs.existsSync(testReportPath)) fs.unlinkSync(testReportPath);

    const participants = createMockParticipants({
      writeContract: () => {
        throw new Error(`writeContract failed: SECRET_KEY=${fakeSecretHex} ${fakeSqlText}`);
      },
    });

    let caughtErr = null;
    try {
      await runThreeEntrantScenario(
        ['--contract', mockContractAddr, '--execute', '--evidence', testEvidencePath, '--report', testReportPath],
        participants
      );
    } catch (err) {
      caughtErr = err;
    }

    assert.ok(caughtErr, 'Must halt on writeContract failure');

    const evRaw = fs.readFileSync(testEvidencePath, 'utf-8');
    assert.strictEqual(evRaw.includes(fakeSecretHex), false, 'Evidence JSON must not contain fake secret hex');
    assert.strictEqual(evRaw.includes(fakeSqlText), false, 'Evidence JSON must not contain fake SQL text');

    if (fs.existsSync(testReportPath)) {
      const repRaw = fs.readFileSync(testReportPath, 'utf-8');
      assert.strictEqual(repRaw.includes(fakeSecretHex), false, 'Report JSON must not contain fake secret hex');
      assert.strictEqual(repRaw.includes(fakeSqlText), false, 'Report JSON must not contain fake SQL text');
    }

    if (fs.existsSync(testEvidencePath)) fs.unlinkSync(testEvidencePath);
    if (fs.existsSync(testReportPath)) fs.unlinkSync(testReportPath);

    console.log('✓ PASS: Sensitive fake secret and internal SQL text proved strictly redacted from persistent evidence and error summaries.');
    passedTests++;
  }

  // -------------------------------------------------------------
  // Test 43: CLI Flag Incompatibility Validation & Read-Only Execution Gate
  // -------------------------------------------------------------
  console.log('\n[Test 43] CLI Flag Incompatibility Validation & Read-Only Execution Gate');
  {
    // Subtest 43a: Incompatible flag combinations must throw INCOMPATIBLE_FLAGS
    const incompatibleSets = [
      { preflightOnly: true, deploy: true, deployOnly: false, executeMoneyFlow: false, contractAddress: null },
      { preflightOnly: true, deployOnly: true, deploy: false, executeMoneyFlow: false, contractAddress: null },
      { preflightOnly: true, executeMoneyFlow: true, deploy: false, deployOnly: false, contractAddress: null },
      { deployOnly: true, deploy: true, preflightOnly: false, executeMoneyFlow: false, contractAddress: null },
      { deployOnly: true, executeMoneyFlow: true, preflightOnly: false, deploy: false, contractAddress: null },
      { contractAddress: '0x123', deploy: true, preflightOnly: false, deployOnly: false, executeMoneyFlow: false },
      { contractAddress: '0x123', deployOnly: true, preflightOnly: false, deploy: false, executeMoneyFlow: false },
      { executeMoneyFlow: true, contractAddress: null, deploy: false, deployOnly: false, preflightOnly: false },
      { deploy: true, executeMoneyFlow: false, contractAddress: null, deployOnly: false, preflightOnly: false },
    ];

    for (const flags of incompatibleSets) {
      assert.throws(
        () => validateCliOptions(flags),
        /INCOMPATIBLE_FLAGS/,
        `Should throw INCOMPATIBLE_FLAGS for ${JSON.stringify(flags)}`
      );
    }

    // Subtest 43b: Valid combinations must pass without error
    const validSets = [
      { preflightOnly: true, deploy: false, deployOnly: false, executeMoneyFlow: false, contractAddress: null },
      { deployOnly: true, deploy: false, preflightOnly: false, executeMoneyFlow: false, contractAddress: null },
      { contractAddress: '0x4072D26298eefD8c6D865164a6a3c14fa3E7e272', deploy: false, deployOnly: false, preflightOnly: false, executeMoneyFlow: false },
      { contractAddress: '0x4072D26298eefD8c6D865164a6a3c14fa3E7e272', executeMoneyFlow: true, deploy: false, deployOnly: false, preflightOnly: false },
      { deploy: true, executeMoneyFlow: true, deployOnly: false, preflightOnly: false, contractAddress: null },
    ];

    for (const flags of validSets) {
      assert.doesNotThrow(
        () => validateCliOptions(flags),
        `Should not throw for valid flags ${JSON.stringify(flags)}`
      );
    }

    // Subtest 43c: --contract alone in main() executes read-only inspection with zero writes
    let writeCalls = 0;
    let getterCalls = 0;
    const readOnlyClient = {
      getChainId: async () => 61997,
      getBalance: async () => 100000000000000000000n,
      estimateTransactionFees: async () => ({ feeValue: 1000000000000000n }),
      readContract: async (params) => {
        getterCalls++;
        if (params.functionName === 'get_challenge_count') return 0n;
        if (params.functionName === 'get_total_locked_escrow') return 0n;
        if (params.functionName === 'get_total_claimable_credits') return 0n;
        return 0n;
      },
      writeContract: async () => {
        writeCalls++;
        return '0xunexpected_write_hash';
      },
      deployContract: async () => {
        writeCalls++;
        return '0xunexpected_deploy_hash';
      },
    };
    const mockAccount = { address: '0x1E47d7d7079FE4aD599B184559ffCDC56278fb54' };

    const mainResult = await main(
      ['--account', 'test-deployer', '--contract', '0x4072D26298eefD8c6D865164a6a3c14fa3E7e272'],
      {
        client: readOnlyClient,
        account: mockAccount,
      }
    );

    assert.strictEqual(mainResult.mode, 'READ_ONLY');
    assert.strictEqual(mainResult.writesPerformed, 0);
    assert.strictEqual(writeCalls, 0, 'Zero writes must be performed when --contract is passed alone');
    assert.ok(getterCalls >= 3, 'Getter verification must run for read-only inspection');
    assert.strictEqual(mainResult.getterResult.allVerified, true);

    console.log('✓ PASS: CLI flag validation rejects incompatible combinations; --contract alone is strictly read-only with zero writes.');
    passedTests++;
  }

  // -------------------------------------------------------------
  // Test 44: Strict Rejection of ACCEPTED Status Across All Write & Child Gates
  // -------------------------------------------------------------
  console.log('\n[Test 44] Strict Rejection of ACCEPTED Status Across All Write & Child Gates');
  {
    const mockContractAddr = '0x4072D26298eefD8c6D865164a6a3c14fa3E7e272';
    const mockAccount = { address: '0x1E47d7d7079FE4aD599B184559ffCDC56278fb54' };
    const testEvidencePath = 'scratch/test_accepted_gate_evidence.json';

    // Subtest 44a: deployContract resume rejects ACCEPTED status
    if (fs.existsSync(testEvidencePath)) fs.unlinkSync(testEvidencePath);
    fs.writeFileSync(
      testEvidencePath,
      JSON.stringify({
        deployTxHash: '0xaccepted_deploy_resume_hash',
        rpcUrl: 'https://studio-next.genlayer.com/api',
        chainId: 61997,
        accountAddress: mockAccount.address,
      })
    );

    const clientAcceptedDeployResume = {
      getChainId: async () => 61997,
      getBalance: async () => 100000000000000000000n,
      getTransaction: async () => ({
        statusName: 'ACCEPTED',
        txExecutionResultName: 'FINISHED_WITH_RETURN',
        to_address: mockContractAddr,
        data: { contract_address: mockContractAddr, contract_code: 'code' },
      }),
    };

    let caughtErr = null;
    try {
      await deployContract(clientAcceptedDeployResume, mockAccount, 'code', { feeValue: 1000n }, 'https://studio-next.genlayer.com/api', testEvidencePath);
    } catch (err) {
      caughtErr = err;
    }
    assert.ok(caughtErr, 'deployContract resume must reject ACCEPTED status');
    assert.ok(
      caughtErr.message.includes('TRANSACTION_NOT_FINALIZED') && caughtErr.message.includes('ACCEPTED is not final; status must be FINALIZED'),
      `Expected TRANSACTION_NOT_FINALIZED, got: ${caughtErr.message}`
    );

    // Subtest 44b: Fresh deployContract rejects ACCEPTED status
    if (fs.existsSync(testEvidencePath)) fs.unlinkSync(testEvidencePath);
    const clientAcceptedFreshDeploy = {
      getChainId: async () => 61997,
      getBalance: async () => 100000000000000000000n,
      deployContract: async () => '0xfresh_deploy_hash_accepted',
      waitForFinalization: async () => {},
      getTransaction: async () => ({
        statusName: 'ACCEPTED',
        txExecutionResultName: 'FINISHED_WITH_RETURN',
        data: { contract_address: mockContractAddr, contract_code: 'code' },
      }),
    };

    caughtErr = null;
    try {
      await deployContract(clientAcceptedFreshDeploy, mockAccount, 'code', { feeValue: 1000n }, 'https://studio-next.genlayer.com/api', testEvidencePath);
    } catch (err) {
      caughtErr = err;
    }
    assert.ok(caughtErr, 'Fresh deployContract must reject ACCEPTED status');
    assert.ok(
      caughtErr.message.includes('TRANSACTION_NOT_FINALIZED') && caughtErr.message.includes('ACCEPTED is not final; status must be FINALIZED'),
      `Expected TRANSACTION_NOT_FINALIZED, got: ${caughtErr.message}`
    );

    // Subtest 44c: verifyChildTransactions rejects ACCEPTED status
    const clientAcceptedChild = {
      getTriggeredTransactionIds: async () => ['0xchild_hash_accepted'],
      waitForFinalization: async () => {},
      getTransaction: async () => ({
        statusName: 'ACCEPTED',
        txExecutionResultName: 'FINISHED_WITH_RETURN',
      }),
    };

    caughtErr = null;
    try {
      await verifyChildTransactions(clientAcceptedChild, '0xwithdraw_tx_hash', {
        messages: [{ recipient: mockAccount.address, value: 10000000000000000000n }],
      });
    } catch (err) {
      caughtErr = err;
    }
    assert.ok(caughtErr, 'verifyChildTransactions must reject ACCEPTED child receipt');
    assert.ok(
      caughtErr.message.includes('ACCEPTED is not final; status must be FINALIZED'),
      `Expected child rejection, got: ${caughtErr.message}`
    );

    // Subtest 44d: testSmallMoneyFlow resume create_challenge rejects ACCEPTED
    if (fs.existsSync(testEvidencePath)) fs.unlinkSync(testEvidencePath);
    fs.writeFileSync(
      testEvidencePath,
      JSON.stringify({
        contractAddress: mockContractAddr,
        accountAddress: mockAccount.address,
        rpcUrl: 'https://studio-next.genlayer.com/api',
        chainId: 61997,
        createTxHash: '0xsaved_create_hash_accepted',
      })
    );

    const clientAcceptedResumeCreate = {
      getChainId: async () => 61997,
      getBalance: async () => 100000000000000000000n,
      readContract: async (params) => {
        if (params.functionName === 'get_credit') return 0n;
        if (params.functionName === 'get_total_locked_escrow') return 0n;
        if (params.functionName === 'get_total_claimable_credits') return 0n;
        if (params.functionName === 'get_sponsored_challenge_ids_paginated') return [];
        return 0n;
      },
      getTransaction: async () => ({
        statusName: 'ACCEPTED',
        txExecutionResultName: 'FINISHED_WITH_RETURN',
      }),
    };

    caughtErr = null;
    try {
      await testSmallMoneyFlow(clientAcceptedResumeCreate, mockAccount, mockContractAddr, {
        rpcUrl: 'https://studio-next.genlayer.com/api',
        evidencePath: testEvidencePath,
      });
    } catch (err) {
      caughtErr = err;
    }
    assert.ok(caughtErr, 'Resumed create_challenge must reject ACCEPTED status');
    assert.ok(
      caughtErr.message.includes('TRANSACTION_NOT_FINALIZED') && caughtErr.message.includes('ACCEPTED is not final; status must be FINALIZED'),
      `Expected TRANSACTION_NOT_FINALIZED, got: ${caughtErr.message}`
    );

    // Subtest 44e: testSmallMoneyFlow fresh create_challenge rejects ACCEPTED
    if (fs.existsSync(testEvidencePath)) fs.unlinkSync(testEvidencePath);
    const clientAcceptedFreshCreate = {
      getChainId: async () => 61997,
      getBalance: async () => 100000000000000000000n,
      readContract: async (params) => {
        if (params.functionName === 'get_credit') return 0n;
        if (params.functionName === 'get_total_locked_escrow') return 0n;
        if (params.functionName === 'get_total_claimable_credits') return 0n;
        if (params.functionName === 'get_sponsored_challenge_ids_paginated') return [];
        return 0n;
      },
      estimateTransactionFees: async () => ({ feeValue: 1000n }),
      writeContract: async () => '0xfresh_create_hash',
      waitForFinalization: async () => {},
      getTransaction: async () => ({
        statusName: 'ACCEPTED',
        txExecutionResultName: 'FINISHED_WITH_RETURN',
      }),
    };

    caughtErr = null;
    try {
      await testSmallMoneyFlow(clientAcceptedFreshCreate, mockAccount, mockContractAddr, {
        rpcUrl: 'https://studio-next.genlayer.com/api',
        evidencePath: testEvidencePath,
      });
    } catch (err) {
      caughtErr = err;
    }
    assert.ok(caughtErr, 'Fresh create_challenge must reject ACCEPTED status');
    assert.ok(
      caughtErr.message.includes('TRANSACTION_NOT_FINALIZED') && caughtErr.message.includes('ACCEPTED is not final; status must be FINALIZED'),
      `Expected TRANSACTION_NOT_FINALIZED, got: ${caughtErr.message}`
    );

    // Subtest 44f: testSmallMoneyFlow resume cancel_challenge rejects ACCEPTED
    if (fs.existsSync(testEvidencePath)) fs.unlinkSync(testEvidencePath);
    fs.writeFileSync(
      testEvidencePath,
      JSON.stringify({
        contractAddress: mockContractAddr,
        accountAddress: mockAccount.address,
        rpcUrl: 'https://studio-next.genlayer.com/api',
        chainId: 61997,
        createTxHash: '0xsaved_create_hash_final',
        challengeId: '1',
        cancelTxHash: '0xsaved_cancel_hash_accepted',
      })
    );

    const clientAcceptedResumeCancel = {
      getChainId: async () => 61997,
      getBalance: async () => 100000000000000000000n,
      readContract: async (params) => {
        if (params.functionName === 'get_credit') return 0n;
        if (params.functionName === 'get_total_locked_escrow') return 10000000000000000000n;
        if (params.functionName === 'get_total_claimable_credits') return 0n;
        if (params.functionName === 'get_sponsored_challenge_ids_paginated') return [1n];
        if (params.functionName === 'get_challenge') {
          return { id: 1n, sponsorAddress: mockAccount.address, prizeAmount: 10000000000000000000n, status: 0n };
        }
        return 0n;
      },
      getTransaction: async (params) => {
        if (params.hash === '0xsaved_create_hash_final') {
          return { statusName: 'FINALIZED', txExecutionResultName: 'FINISHED_WITH_RETURN', result: 1n };
        }
        return { statusName: 'ACCEPTED', txExecutionResultName: 'FINISHED_WITH_RETURN' };
      },
    };

    caughtErr = null;
    try {
      await testSmallMoneyFlow(clientAcceptedResumeCancel, mockAccount, mockContractAddr, {
        rpcUrl: 'https://studio-next.genlayer.com/api',
        evidencePath: testEvidencePath,
      });
    } catch (err) {
      caughtErr = err;
    }
    assert.ok(caughtErr, 'Resumed cancel_challenge must reject ACCEPTED status');
    assert.ok(
      caughtErr.message.includes('TRANSACTION_NOT_FINALIZED') && caughtErr.message.includes('ACCEPTED is not final; status must be FINALIZED'),
      `Expected TRANSACTION_NOT_FINALIZED, got: ${caughtErr.message}`
    );

    // Subtest 44g: testSmallMoneyFlow fresh cancel_challenge rejects ACCEPTED
    if (fs.existsSync(testEvidencePath)) fs.unlinkSync(testEvidencePath);
    fs.writeFileSync(
      testEvidencePath,
      JSON.stringify({
        contractAddress: mockContractAddr,
        accountAddress: mockAccount.address,
        rpcUrl: 'https://studio-next.genlayer.com/api',
        chainId: 61997,
        createTxHash: '0xsaved_create_hash_final',
        challengeId: '1',
      })
    );

    const clientAcceptedFreshCancel = {
      getChainId: async () => 61997,
      getBalance: async () => 100000000000000000000n,
      readContract: async (params) => {
        if (params.functionName === 'get_credit') return 0n;
        if (params.functionName === 'get_total_locked_escrow') return 10000000000000000000n;
        if (params.functionName === 'get_total_claimable_credits') return 0n;
        if (params.functionName === 'get_sponsored_challenge_ids_paginated') return [1n];
        if (params.functionName === 'get_challenge') {
          return { id: 1n, sponsorAddress: mockAccount.address, prizeAmount: 10000000000000000000n, status: 0n };
        }
        return 0n;
      },
      estimateTransactionFees: async () => ({ feeValue: 1000n }),
      writeContract: async () => '0xfresh_cancel_hash',
      waitForFinalization: async () => {},
      getTransaction: async (params) => {
        if (params.hash === '0xsaved_create_hash_final') {
          return { statusName: 'FINALIZED', txExecutionResultName: 'FINISHED_WITH_RETURN', result: 1n };
        }
        return { statusName: 'ACCEPTED', txExecutionResultName: 'FINISHED_WITH_RETURN' };
      },
    };

    caughtErr = null;
    try {
      await testSmallMoneyFlow(clientAcceptedFreshCancel, mockAccount, mockContractAddr, {
        rpcUrl: 'https://studio-next.genlayer.com/api',
        evidencePath: testEvidencePath,
      });
    } catch (err) {
      caughtErr = err;
    }
    assert.ok(caughtErr, 'Fresh cancel_challenge must reject ACCEPTED status');
    assert.ok(
      caughtErr.message.includes('TRANSACTION_NOT_FINALIZED') && caughtErr.message.includes('ACCEPTED is not final; status must be FINALIZED'),
      `Expected TRANSACTION_NOT_FINALIZED, got: ${caughtErr.message}`
    );

    // Subtest 44h: testSmallMoneyFlow resume withdraw rejects ACCEPTED
    if (fs.existsSync(testEvidencePath)) fs.unlinkSync(testEvidencePath);
    fs.writeFileSync(
      testEvidencePath,
      JSON.stringify({
        contractAddress: mockContractAddr,
        accountAddress: mockAccount.address,
        rpcUrl: 'https://studio-next.genlayer.com/api',
        chainId: 61997,
        createTxHash: '0xsaved_create_hash_final',
        challengeId: '1',
        cancelTxHash: '0xsaved_cancel_hash_final',
        withdrawTxHash: '0xsaved_withdraw_hash_accepted',
      })
    );

    const clientAcceptedResumeWithdraw = {
      getChainId: async () => 61997,
      getBalance: async () => 100000000000000000000n,
      readContract: async (params) => {
        if (params.functionName === 'get_credit') return 10000000000000000000n;
        if (params.functionName === 'get_total_locked_escrow') return 0n;
        if (params.functionName === 'get_total_claimable_credits') return 10000000000000000000n;
        if (params.functionName === 'get_sponsored_challenge_ids_paginated') return [1n];
        if (params.functionName === 'get_challenge') {
          return { id: 1n, sponsorAddress: mockAccount.address, prizeAmount: 10000000000000000000n, status: 5n };
        }
        return 0n;
      },
      getTransaction: async (params) => {
        if (params.hash === '0xsaved_create_hash_final' || params.hash === '0xsaved_cancel_hash_final') {
          return { statusName: 'FINALIZED', txExecutionResultName: 'FINISHED_WITH_RETURN', result: 1n };
        }
        return { statusName: 'ACCEPTED', txExecutionResultName: 'FINISHED_WITH_RETURN' };
      },
    };

    caughtErr = null;
    try {
      await testSmallMoneyFlow(clientAcceptedResumeWithdraw, mockAccount, mockContractAddr, {
        rpcUrl: 'https://studio-next.genlayer.com/api',
        evidencePath: testEvidencePath,
      });
    } catch (err) {
      caughtErr = err;
    }
    assert.ok(caughtErr, 'Resumed withdraw must reject ACCEPTED status');
    assert.ok(
      caughtErr.message.includes('TRANSACTION_NOT_FINALIZED') && caughtErr.message.includes('ACCEPTED is not final; status must be FINALIZED'),
      `Expected TRANSACTION_NOT_FINALIZED, got: ${caughtErr.message}`
    );

    // Subtest 44i: testSmallMoneyFlow fresh withdraw rejects ACCEPTED
    if (fs.existsSync(testEvidencePath)) fs.unlinkSync(testEvidencePath);
    fs.writeFileSync(
      testEvidencePath,
      JSON.stringify({
        contractAddress: mockContractAddr,
        accountAddress: mockAccount.address,
        rpcUrl: 'https://studio-next.genlayer.com/api',
        chainId: 61997,
        createTxHash: '0xsaved_create_hash_final',
        challengeId: '1',
        cancelTxHash: '0xsaved_cancel_hash_final',
      })
    );

    const clientAcceptedFreshWithdraw = {
      getChainId: async () => 61997,
      getBalance: async () => 100000000000000000000n,
      readContract: async (params) => {
        if (params.functionName === 'get_credit') return 10000000000000000000n;
        if (params.functionName === 'get_total_locked_escrow') return 0n;
        if (params.functionName === 'get_total_claimable_credits') return 10000000000000000000n;
        if (params.functionName === 'get_sponsored_challenge_ids_paginated') return [1n];
        if (params.functionName === 'get_challenge') {
          return { id: 1n, sponsorAddress: mockAccount.address, prizeAmount: 10000000000000000000n, status: 5n };
        }
        return 0n;
      },
      estimateTransactionFees: async () => ({ feeValue: 1000n }),
      writeContract: async () => '0xfresh_withdraw_hash',
      waitForFinalization: async () => {},
      getTransaction: async (params) => {
        if (params.hash === '0xsaved_create_hash_final' || params.hash === '0xsaved_cancel_hash_final') {
          return { statusName: 'FINALIZED', txExecutionResultName: 'FINISHED_WITH_RETURN', result: 1n };
        }
        return { statusName: 'ACCEPTED', txExecutionResultName: 'FINISHED_WITH_RETURN' };
      },
    };

    caughtErr = null;
    try {
      await testSmallMoneyFlow(clientAcceptedFreshWithdraw, mockAccount, mockContractAddr, {
        rpcUrl: 'https://studio-next.genlayer.com/api',
        evidencePath: testEvidencePath,
      });
    } catch (err) {
      caughtErr = err;
    }
    assert.ok(caughtErr, 'Fresh withdraw must reject ACCEPTED status');
    assert.ok(
      caughtErr.message.includes('TRANSACTION_NOT_FINALIZED') && caughtErr.message.includes('ACCEPTED is not final; status must be FINALIZED'),
      `Expected TRANSACTION_NOT_FINALIZED, got: ${caughtErr.message}`
    );

    if (fs.existsSync(testEvidencePath)) fs.unlinkSync(testEvidencePath);
    console.log('✓ PASS: Strict rejection of ACCEPTED status verified across all write and child transaction gates.');
    passedTests++;
  }

  // -------------------------------------------------------------
  // Test 45: Preservation of Deployment Evidence and Ambiguous Submission
  // -------------------------------------------------------------
  console.log('\n[Test 45] Preservation of Deployment Evidence and Ambiguous Submission');
  {
    const testEvidencePath = 'scratch/test_evidence_preservation.json';
    if (fs.existsSync(testEvidencePath)) fs.unlinkSync(testEvidencePath);

    // Initial deployment evidence with two distinct attempts (Attempt 1: failed, Attempt 2: finalized)
    const initialEvidence = {
      contractAddress: '0x4072D26298eefD8c6D865164a6a3c14fa3E7e272',
      deployTxHash: '0xd7739824f3d777bbcbfa1e630dfa6f16724ae92534e06886508586ad82d3072a',
      deployStatus: 'FINALIZED',
      deployResult: 'FINISHED_WITH_RETURN',
      deployStage: 'DEPLOYED_GETTER_READ_BLOCKED_BY_RPC',
      rpcUrl: 'https://studio-next.genlayer.com/api',
      chainId: 61997,
      accountAddress: '0x1E47d7d7079FE4aD599B184559ffCDC56278fb54',
      deploymentHistory: [
        {
          attempt: 1,
          txHash: '0x1f7b69db3fb6703afa49d971deb2d8dd8f558e4356ca801b172be760c6f06acd',
          status: 'FINALIZED',
          result: 'FINISHED_WITH_ERROR',
          error: 'contract_error: invalid_contract runner malformed',
          stage: 'FINALIZED_FAILED',
          timestamp: '2026-10-13T07:34:35.231Z',
        },
        {
          attempt: 2,
          txHash: '0xd7739824f3d777bbcbfa1e630dfa6f16724ae92534e06886508586ad82d3072a',
          contractAddress: '0x4072D26298eefD8c6D865164a6a3c14fa3E7e272',
          status: 'FINALIZED',
          result: 'FINISHED_WITH_RETURN',
          stage: 'FINALIZED',
          timestamp: '2026-10-13T09:40:23.418Z',
        },
      ],
    };
    fs.writeFileSync(testEvidencePath, JSON.stringify(initialEvidence, null, 2));

    // Subtest 45a: Money-flow updates preserve both deployment attempts intact
    updateEvidence({ createTxHash: '0xmoney_create_hash', challengeId: '99' }, testEvidencePath);
    updateEvidence({ cancelTxHash: '0xmoney_cancel_hash' }, testEvidencePath);
    updateEvidence({ withdrawTxHash: '0xmoney_withdraw_hash' }, testEvidencePath);

    const preservedEvidence = loadEvidence(testEvidencePath);
    assert.strictEqual(preservedEvidence.deployTxHash, '0xd7739824f3d777bbcbfa1e630dfa6f16724ae92534e06886508586ad82d3072a');
    assert.strictEqual(preservedEvidence.deploymentHistory.length, 2);
    assert.strictEqual(preservedEvidence.deploymentHistory[0].attempt, 1);
    assert.strictEqual(preservedEvidence.deploymentHistory[0].txHash, '0x1f7b69db3fb6703afa49d971deb2d8dd8f558e4356ca801b172be760c6f06acd');
    assert.strictEqual(preservedEvidence.deploymentHistory[0].result, 'FINISHED_WITH_ERROR');
    assert.strictEqual(preservedEvidence.deploymentHistory[1].attempt, 2);
    assert.strictEqual(preservedEvidence.deploymentHistory[1].txHash, '0xd7739824f3d777bbcbfa1e630dfa6f16724ae92534e06886508586ad82d3072a');
    assert.strictEqual(preservedEvidence.deploymentHistory[1].result, 'FINISHED_WITH_RETURN');
    assert.strictEqual(preservedEvidence.createTxHash, '0xmoney_create_hash');
    assert.strictEqual(preservedEvidence.cancelTxHash, '0xmoney_cancel_hash');
    assert.strictEqual(preservedEvidence.withdrawTxHash, '0xmoney_withdraw_hash');

    // Subtest 45b: Update attempting to truncate or drop deployment attempts throws EVIDENCE_INTEGRITY_VIOLATION
    assert.throws(
      () => updateEvidence({ deploymentHistory: [initialEvidence.deploymentHistory[1]] }, testEvidencePath),
      /EVIDENCE_INTEGRITY_VIOLATION/
    );

    // Subtest 45c: Update attempting to overwrite deployTxHash without history record throws EVIDENCE_INTEGRITY_VIOLATION
    assert.throws(
      () => updateEvidence({ deployTxHash: '0xunrecorded_deploy_hash' }, testEvidencePath),
      /EVIDENCE_INTEGRITY_VIOLATION/
    );

    // Subtest 45d: Ambiguous submission halt is preserved and halts before any write
    updateEvidence({
      ambiguousSubmission: {
        stage: 'create_challenge',
        timestamp: '2026-10-13T12:00:00.000Z',
        error: 'BROADCAST_TIMEOUT',
      },
    }, testEvidencePath);

    const mockClient = {
      getChainId: async () => 61997,
      getBalance: async () => 100000000000000000000n,
      readContract: async () => 0n,
      writeContract: async () => { throw new Error('writeContract called during ambiguous resume'); },
    };
    const mockAccount = { address: '0x1E47d7d7079FE4aD599B184559ffCDC56278fb54' };

    let caughtErr = null;
    try {
      await testSmallMoneyFlow(mockClient, mockAccount, '0x4072D26298eefD8c6D865164a6a3c14fa3E7e272', {
        rpcUrl: 'https://studio-next.genlayer.com/api',
        evidencePath: testEvidencePath,
      });
    } catch (err) {
      caughtErr = err;
    }
    assert.ok(caughtErr, 'Must throw when ambiguous submission exists in evidence');
    assert.ok(caughtErr.message.includes('AMBIGUOUS_SUBMISSION'));
    assert.ok(caughtErr.message.includes('create_challenge'));

    if (fs.existsSync(testEvidencePath)) fs.unlinkSync(testEvidencePath);
    console.log('✓ PASS: Evidence integrity protects deployment attempts and preserves ambiguous outcomes with zero writes.');
    passedTests++;
  }

  // -------------------------------------------------------------
  // Test 46: loadEvidence (run_studio_verification.js) Fail-Closed on Corrupt/Unreadable JSON
  // -------------------------------------------------------------
  console.log('\n[Test 46] loadEvidence Fails Closed on Corrupt/Unreadable JSON (Zero Writes, File Preserved)');
  {
    const corruptPath = 'scratch/test_studio_corrupt_evidence.json';
    const missingPath = 'scratch/test_studio_missing_evidence_nonexistent_xyz.json';

    // Ensure no leftovers from a prior run
    if (fs.existsSync(corruptPath)) fs.unlinkSync(corruptPath);
    if (fs.existsSync(missingPath)) fs.unlinkSync(missingPath);

    // ── Subtest 46a: Missing file returns {} without throwing ──────────────────
    const emptyResult = loadEvidence(missingPath);
    assert.deepStrictEqual(emptyResult, {}, 'Missing evidence file must return {} without throwing');
    assert.ok(!fs.existsSync(missingPath), 'loadEvidence must NOT create the missing file');

    // ── Subtest 46b: Corrupt JSON throws CORRUPT_EVIDENCE_FILE ─────────────────
    const corruptContent = '{ this is broken json payload [unclosed';
    fs.writeFileSync(corruptPath, corruptContent, 'utf-8');

    let caughtErr = null;
    try {
      loadEvidence(corruptPath);
    } catch (err) {
      caughtErr = err;
    }

    assert.ok(caughtErr, 'loadEvidence must throw on corrupt JSON');
    assert.ok(
      caughtErr.message.includes('CORRUPT_EVIDENCE_FILE'),
      `Expected CORRUPT_EVIDENCE_FILE in error, got: ${caughtErr.message}`
    );
    assert.ok(
      caughtErr.message.includes(corruptPath),
      `Error message must reference the file path, got: ${caughtErr.message}`
    );
    assert.ok(
      caughtErr.message.includes('Halting for manual reconciliation'),
      `Error must instruct manual reconciliation, got: ${caughtErr.message}`
    );

    // ── Subtest 46c: Corrupt file is NOT overwritten ───────────────────────────
    const afterContent = fs.readFileSync(corruptPath, 'utf-8');
    assert.strictEqual(afterContent, corruptContent, 'Corrupt evidence file must NOT be modified by loadEvidence');

    // ── Subtest 46d: updateEvidence propagates the throw (zero writes) ─────────
    //   updateEvidence calls loadEvidence internally; a corrupt file must prevent
    //   any write reaching the temp path or the target path.
    let updateCaughtErr = null;
    const tempGlob = corruptPath + '.tmp.';
    try {
      updateEvidence({ someNewField: 'must-not-land' }, corruptPath);
    } catch (err) {
      updateCaughtErr = err;
    }
    assert.ok(updateCaughtErr, 'updateEvidence must propagate CORRUPT_EVIDENCE_FILE without writing');
    assert.ok(
      updateCaughtErr.message.includes('CORRUPT_EVIDENCE_FILE'),
      `Expected CORRUPT_EVIDENCE_FILE from updateEvidence, got: ${updateCaughtErr.message}`
    );

    // Confirm the target file still contains only the original corrupt content (no tmp file leaked in)
    const afterUpdateContent = fs.readFileSync(corruptPath, 'utf-8');
    assert.strictEqual(afterUpdateContent, corruptContent, 'Corrupt file must be byte-identical after failed updateEvidence');

    // Verify no .tmp.* files were left behind for this evidence path
    const dir = require('path').dirname(corruptPath);
    const base = require('path').basename(corruptPath);
    const leaked = fs.readdirSync(dir).filter(f => f.startsWith(base + '.tmp.'));
    assert.strictEqual(leaked.length, 0, `No tmp files must be left behind, found: ${leaked.join(', ')}`);

    // ── Subtest 46e: Valid JSON still parses correctly (regression guard) ──────
    const validPath = 'scratch/test_studio_valid_evidence.json';
    const validPayload = { contractAddress: '0x4072D26298eefD8c6D865164a6a3c14fa3E7e272', deployStatus: 'FINALIZED' };
    fs.writeFileSync(validPath, JSON.stringify(validPayload, null, 2), 'utf-8');
    const parsed = loadEvidence(validPath);
    assert.strictEqual(parsed.contractAddress, validPayload.contractAddress, 'Valid evidence file must parse correctly');
    assert.strictEqual(parsed.deployStatus, 'FINALIZED', 'Valid evidence deployStatus must be preserved');
    if (fs.existsSync(validPath)) fs.unlinkSync(validPath);

    if (fs.existsSync(corruptPath)) fs.unlinkSync(corruptPath);

    console.log('✓ PASS: loadEvidence fails closed on corrupt/unreadable JSON; zero writes; corrupt file preserved; valid file still parses.');
    passedTests++;
  }

  console.log('\n================================================================');
  console.log(`ALL TOOLING TESTS PASSED (${passedTests}/${totalTests})`);
  console.log('================================================================');
}

runTests().catch(err => {
  console.error('\nTEST SUITE ERROR:', err);
  process.exit(1);
});

