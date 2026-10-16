/**
 * test_studio_health_check.js
 *
 * Focused tests for scratch/check_studio_health.js:
 *   1. Wrong chain ID (SDK or RPC mismatch): rejects before/during reads and halts.
 *   2. RPC failure (e.g. SQLAlchemy connection pool session abort or 503): halts early and identifies specific failure.
 *   3. Healthy nonempty state: healthyReads is true, but isEmptyContract is false.
 *   4. Healthy empty state: healthyReads is true AND isEmptyContract is true (all 4 metrics 0n).
 *   5. Wei values preserved as bigint/string without floating point precision loss.
 */

'use strict';

const assert = require('assert');
const { checkStudioHealth, REQUIRED_CHAIN_ID } = require('../scratch/check_studio_health');

async function runTests() {
  console.log('================================================================');
  console.log('TEST SUITE: STUDIO NEXT READ-ONLY HEALTH CHECK PROBE');
  console.log('================================================================\n');

  let passed = 0;

  // Test 1: Configured SDK chain ID mismatch (e.g. chain ID 1 or 1337)
  console.log('[Test 1] Wrong configured chain ID rejects before reads and halts immediately');
  const wrongChainResult = await checkStudioHealth({
    chainOverride: { id: 1337, name: 'Wrong Chain' },
    quiet: true,
  });
  assert.strictEqual(wrongChainResult.healthyReads, false);
  assert.strictEqual(wrongChainResult.isEmptyContract, false);
  assert.strictEqual(wrongChainResult.haltedEarly, true);
  assert.ok(wrongChainResult.haltReason.includes('Configured chain ID mismatch'));
  assert.strictEqual(wrongChainResult.checks.chainConfig.matches, false);
  console.log('✓ PASS: Wrong configured chain ID rejected before executing any RPC read.\n');
  passed++;

  // Test 2: Remote RPC returns different chain ID (e.g. 1)
  console.log('[Test 2] Remote RPC chain ID mismatch halts early');
  const mockClientWrongRpcChain = {
    request: async ({ method }) => {
      if (method === 'eth_chainId') return '0x1'; // chain 1
      throw new Error(`Unexpected call ${method}`);
    },
  };
  const wrongRpcChainResult = await checkStudioHealth({
    client: mockClientWrongRpcChain,
    delayMs: 0,
    quiet: true,
  });
  assert.strictEqual(wrongRpcChainResult.healthyReads, false);
  assert.strictEqual(wrongRpcChainResult.isEmptyContract, false);
  assert.strictEqual(wrongRpcChainResult.haltedEarly, true);
  assert.ok(wrongRpcChainResult.haltReason.includes('Remote RPC chain ID mismatch'));
  console.log('✓ PASS: Remote RPC chain mismatch halted early.\n');
  passed++;

  // Test 3: RPC failure (SQLAlchemy database connection error on getter)
  console.log('[Test 3] RPC database failure on getter halts early without retry flood');
  const mockClientDbFail = {
    request: async ({ method }) => {
      if (method === 'eth_chainId') return '0xf22d'; // 61997
      if (method === 'eth_getBalance') return '0x0';
      throw new Error(`Unexpected call ${method}`);
    },
    readContract: async ({ functionName }) => {
      if (functionName === 'get_challenge_count') {
        const err = new Error("Can't reconnect until invalid transaction is rolled back. Please rollback() fully before proceeding");
        err.details = "https://sqlalche.me/e/20/8s2b";
        throw err;
      }
      throw new Error(`Should not call ${functionName} after abort`);
    },
  };
  const dbFailResult = await checkStudioHealth({
    client: mockClientDbFail,
    delayMs: 0,
    quiet: true,
  });
  assert.strictEqual(dbFailResult.healthyReads, false);
  assert.strictEqual(dbFailResult.isEmptyContract, false);
  assert.strictEqual(dbFailResult.haltedEarly, true);
  assert.ok(dbFailResult.haltReason.includes('Halted on database/rate-limit error'));
  assert.strictEqual(dbFailResult.checks.get_total_locked_escrow, undefined, 'Must not probe further getters after DB abort');
  console.log('✓ PASS: RPC database failure halted immediately; zero subsequent getter calls.\n');
  passed++;

  // Test 4: Healthy nonempty state (reads succeed, but challenge count or balance is positive)
  console.log('[Test 4] Healthy nonempty state: healthyReads is true, isEmptyContract is false');
  const mockClientNonempty = {
    request: async ({ method }) => {
      if (method === 'eth_chainId') return '0xf22d'; // 61997
      if (method === 'eth_getBalance') return '0x8ac7230489e80000'; // 10 GEN (10 * 10^18 wei)
      throw new Error(`Unexpected call ${method}`);
    },
    readContract: async ({ functionName }) => {
      if (functionName === 'get_challenge_count') return 1n;
      if (functionName === 'get_total_locked_escrow') return 10000000000000000000n; // 10 GEN
      if (functionName === 'get_total_claimable_credits') return 0n;
      throw new Error(`Unexpected call ${functionName}`);
    },
  };
  const nonemptyResult = await checkStudioHealth({
    client: mockClientNonempty,
    delayMs: 0,
    quiet: true,
  });
  assert.strictEqual(nonemptyResult.healthyReads, true, 'healthyReads must be true when all reads succeed');
  assert.strictEqual(nonemptyResult.isEmptyContract, false, 'isEmptyContract must be false when count or balance > 0');
  assert.strictEqual(nonemptyResult.haltedEarly, false);
  assert.strictEqual(typeof nonemptyResult.checks.contractBalance.wei, 'string');
  assert.strictEqual(nonemptyResult.checks.contractBalance.wei, '10000000000000000000');
  assert.strictEqual(nonemptyResult.checks.get_challenge_count.count, '1');
  assert.strictEqual(nonemptyResult.checks.get_total_locked_escrow.wei, '10000000000000000000');
  console.log('✓ PASS: Healthy nonempty state correctly distinguishes healthy reads from empty contract.\n');
  passed++;

  // Test 5: Healthy empty state (all 4 metrics strictly 0n)
  console.log('[Test 5] Healthy empty state: healthyReads is true AND isEmptyContract is true');
  const mockClientEmpty = {
    request: async ({ method }) => {
      if (method === 'eth_chainId') return '0xf22d'; // 61997
      if (method === 'eth_getBalance') return '0x0';
      throw new Error(`Unexpected call ${method}`);
    },
    readContract: async ({ functionName }) => {
      if (functionName === 'get_challenge_count') return 0n;
      if (functionName === 'get_total_locked_escrow') return 0n;
      if (functionName === 'get_total_claimable_credits') return 0n;
      throw new Error(`Unexpected call ${functionName}`);
    },
  };
  const emptyResult = await checkStudioHealth({
    client: mockClientEmpty,
    delayMs: 0,
    quiet: true,
  });
  assert.strictEqual(emptyResult.healthyReads, true);
  assert.strictEqual(emptyResult.isEmptyContract, true, 'isEmptyContract must be true when all 4 values are exactly zero');
  assert.strictEqual(emptyResult.haltedEarly, false);
  assert.strictEqual(emptyResult.checks.get_challenge_count.count, '0');
  assert.strictEqual(emptyResult.checks.get_total_locked_escrow.wei, '0');
  assert.strictEqual(emptyResult.checks.get_total_claimable_credits.wei, '0');
  assert.strictEqual(emptyResult.checks.contractBalance.wei, '0');
  console.log('✓ PASS: Healthy empty state verified across all 4 metrics strictly at zero.\n');
  passed++;

  console.log(`================================================================`);
  console.log(`ALL HEALTH CHECK PROBE TESTS PASSED (${passed}/${passed})`);
  console.log(`================================================================\n`);
}

runTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
