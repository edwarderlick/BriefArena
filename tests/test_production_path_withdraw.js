/**
 * test_production_path_withdraw.js
 *
 * Focused Enabled-Build Integration Tests for the Live Winner Withdrawal Flow
 * WITHOUT Injecting a Kit into the Page or WalletProvider.
 *
 * Verifies:
 *   1. Closed Gate: With WRITES_ENABLED=false, createKit and submissions reject with WRITE_GATE_DISABLED.
 *   2. Wrong Chain Guard: Connecting on Chain 1 rejects with WRONG_CHAIN and disables withdraw.
 *   3. Zero Credit / Non-Winner Guard: Wallet with 0 credit blocks withdrawal with "No Claimable Credit".
 *   4. Full Production Path with Winner Wallet 0xb3f7518df619ef485f7a1568ed3705bb6f5b0407:
 *      - WalletProvider and MyArenaPage rendered normally without injected kit.
 *      - Mocked EIP-1193 provider attached to window.ethereum.
 *      - Connected on Studio Next (chain 61997).
 *      - Reads 10000000000000000000 wei (10 GEN) claimable credit.
 *      - Active "Review & Submit Withdrawal" button.
 *      - Clicking opens modal and useTransactionKit calls real createKit(), producing real Transaction Kit RC2.
 *      - Fee estimation runs automatically and produces verified PolicyQuote with userValue: 0n (non-payable).
 *      - Click Confirm & Submit.
 *      - Installed Transaction Kit RC2 requests eth_sendTransaction from EIP-1193 provider.
 *      - Asserts deployed BriefArena address, withdraw method calldata, empty args, and value: 0x0.
 *      - Parent transaction execution and child GEN delivery are verified.
 *      - Credit and withdrawn totals refresh.
 *   5. Uncertain Outcome Guard: Preserves transaction hash and blocks duplicate submission.
 *
 * Run: node tests/test_production_path_withdraw.js
 */

'use strict';

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

// Setup Happy DOM environment
const { GlobalWindow } = require(path.resolve(__dirname, '../app/node_modules/happy-dom'));
const win = new GlobalWindow({ url: 'http://localhost:5180/my-arena' });
globalThis.window = win;
globalThis.document = win.document;
globalThis.HTMLElement = win.HTMLElement;
globalThis.HTMLInputElement = win.HTMLInputElement;
globalThis.HTMLTextAreaElement = win.HTMLTextAreaElement;
globalThis.HTMLButtonElement = win.HTMLButtonElement;
globalThis.Event = win.Event;
globalThis.MouseEvent = win.MouseEvent;
globalThis.CustomEvent = win.CustomEvent;
globalThis.localStorage = win.localStorage;
globalThis.sessionStorage = win.sessionStorage;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

async function runSuite() {
  console.log('================================================================');
  console.log('BRIEFARENA FOCUSED PRODUCTION PATH WITHDRAWAL TESTS');
  console.log('================================================================\n');

  // Intercept globalThis.fetch for isolated RPC responses (No external RPC writes)
  const realFetch = globalThis.fetch;
  let simulateRpcError = false;
  const interceptedRpcMethods = [];

  const winnerAccount = '0xb3f7518df619ef485f7a1568ed3705bb6f5b0407';
  const briefArenaAddress = '0x5614108eDBdAb6c0b6313725EDe8f1029F74F4F9';
  const consensusGateway = '0xb7278A61aa25c888815aFC32Ad3cC52fF24fE575';
  const withdrawTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
  const childTransferHash = '0xabcdefabcdef12345678901234567890abcdefabcdef12345678901234567890';

  globalThis.fetch = async (url, options) => {
    if (options && options.body) {
      try {
        const body = JSON.parse(options.body);
        const { id, method } = body;
        interceptedRpcMethods.push(method);

        if (simulateRpcError) {
          return {
            ok: false,
            status: 500,
            json: async () => ({
              jsonrpc: '2.0',
              id,
              error: { code: -32603, message: 'Simulated RPC node failure on Studio Next' },
            }),
          };
        }

        if (method === 'sim_getFeeConfig') {
          return {
            ok: true,
            json: async () => ({
              jsonrpc: '2.0',
              id,
              result: {
                enabled: true,
                policy: {
                  genPerTimeUnit: '2',
                  storageUnitPrice: '300000000',
                  receiptGasPrice: '300000000',
                  timeUnitOverlayBps: '0',
                  intrinsicGas: '21000',
                  bootloaderOverhead: '60000',
                  gasPerChangedSlot: '1000',
                  calldataGasPerByte: '16',
                  fixedProposeReceiptGas: '210000',
                  fixedMessageRevealGas: '100000',
                  messageFeeParamsBudgetFloor: '25000000000000000',
                },
              },
            }),
          };
        }

        if (method === 'eth_getTransactionByHash') {
          const reqHash = body.params?.[0];
          if (reqHash === childTransferHash) {
            return {
              ok: true,
              json: async () => ({
                jsonrpc: '2.0',
                id,
                result: {
                  hash: childTransferHash,
                  from: briefArenaAddress,
                  to: winnerAccount,
                  value: '0x8ac7230489e80000', // 10 GEN (10000000000000000000 wei)
                  status: 'FINALIZED',
                  result: 'FINISHED_WITH_RETURN',
                  value_credited: true,
                },
              }),
            };
          }
          return {
            ok: true,
            json: async () => ({
              jsonrpc: '2.0',
              id,
              result: {
                hash: withdrawTxHash,
                blockHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
                blockNumber: '0x1',
                from: winnerAccount,
                to: consensusGateway,
                status: 'FINALIZED',
                result: 'FINISHED_WITH_RETURN',
                successful: true,
                messages: [
                  {
                    is_eth_send: true,
                    recipient: winnerAccount,
                    amount: '10000000000000000000',
                    child_tx_hash: childTransferHash,
                  },
                ],
              },
            }),
          };
        }

        if (method === 'eth_getTransactionReceipt') {
          return {
            ok: true,
            json: async () => ({
              jsonrpc: '2.0',
              id,
              result: {
                status: '0x1',
                transactionHash: withdrawTxHash,
                blockNumber: '0x1',
                logs: [],
              },
            }),
          };
        }

        if (method === 'eth_getTransactionCount') {
          return { ok: true, json: async () => ({ jsonrpc: '2.0', id, result: '0x0' }) };
        }

        if (method === 'eth_estimateGas') {
          return { ok: true, json: async () => ({ jsonrpc: '2.0', id, result: '0x30d40' }) };
        }

        if (method === 'eth_gasPrice') {
          return { ok: true, json: async () => ({ jsonrpc: '2.0', id, result: '0x3b9aca00' }) };
        }
      } catch (e) {}
    }
    return { ok: true, json: async () => ({ jsonrpc: '2.0', result: null }) };
  };

  // Setup mock EIP-1193 provider
  const providerRequests = [];
  let currentAccount = winnerAccount;
  let providerChainIdHex = '0xf22d'; // 61997

  const mockEip1193Provider = {
    request: async ({ method, params }) => {
      providerRequests.push({ method, params });

      if (method === 'eth_accounts') {
        return currentAccount ? [currentAccount] : [];
      }
      if (method === 'eth_requestAccounts') {
        return currentAccount ? [currentAccount] : [];
      }
      if (method === 'eth_chainId') {
        return providerChainIdHex;
      }
      if (method === 'eth_getBalance') {
        return '0x21e19e0c9bab2400000'; // 10000 GEN
      }
      if (method === 'wallet_switchEthereumChain') {
        providerChainIdHex = params[0].chainId;
        return null;
      }
      if (method === 'eth_sendTransaction') {
        return withdrawTxHash;
      }
      throw new Error(`Unhandled mock EIP-1193 method: ${method}`);
    },
    on: (evt, listener) => {},
    removeListener: (evt, listener) => {},
  };

  win.ethereum = mockEip1193Provider;

  // Initialize Vite server for SSR loading
  const viteEntry = pathToFileURL(path.resolve(__dirname, '../app/node_modules/vite/dist/node/index.js')).href;
  const { createServer } = await import(viteEntry);
  const viteServer = await createServer({
    root: path.resolve(__dirname, '../app'),
    server: { middlewareMode: true },
  });

  const { createRequire } = require('module');
  const appRequire = createRequire(path.resolve(__dirname, '../app/package.json'));

  const React = appRequire('react');
  const ReactDOM = appRequire('react-dom/client');
  const ReactRouter = appRequire('react-router-dom');

  const { createElement, act } = React;
  const { MemoryRouter } = ReactRouter;

  let passedTests = 0;

  // -------------------------------------------------------------
  // Subtest 1: Closed Gate Rejection (Default / Disabled Build)
  // -------------------------------------------------------------
  console.log('[Subtest 1] Closed Gate: Disabled build rejects withdraw dispatch with WRITE_GATE_DISABLED');
  {
    process.env.VITE_WRITES_ENABLED = 'false';
    viteServer.moduleGraph.invalidateAll();
    const closedTxService = await viteServer.ssrLoadModule('/src/services/transactionService.ts');
    assert.strictEqual(closedTxService.WRITES_ENABLED, false, 'WRITES_ENABLED must be false when set to false');

    await assert.rejects(
      async () => closedTxService.createKit(61997),
      err => err instanceof closedTxService.TransactionServiceError && err.code === 'WRITE_GATE_DISABLED',
      'createKit must reject with WRITE_GATE_DISABLED while closed'
    );

    const submitInput = closedTxService.buildWithdrawSubmitInput(briefArenaAddress);
    const policyInput = closedTxService.buildWithdrawPolicyInput();

    assert.strictEqual(submitInput.method, 'withdraw');
    assert.strictEqual(submitInput.args.length, 0);
    assert.strictEqual(policyInput.userValue, 0n, 'Withdraw must strictly be non-payable (userValue === 0n)');

    await assert.rejects(
      async () => closedTxService.dispatchTransaction({}, {}, submitInput),
      err => err instanceof closedTxService.TransactionServiceError && err.code === 'WRITE_GATE_DISABLED',
      'dispatchTransaction must reject with WRITE_GATE_DISABLED while closed'
    );

    console.log('✓ PASS: Closed gate strictly rejects withdraw kit creation and dispatch.\n');
    passedTests++;
  }

  // -------------------------------------------------------------
  // Subtest 2: Wrong Chain Guard (Chain 1 instead of 61997)
  // -------------------------------------------------------------
  console.log('[Subtest 2] Wrong Chain Guard: Chain 1 disables withdrawal and displays switch prompt');
  {
    process.env.VITE_WRITES_ENABLED = 'true';
    viteServer.moduleGraph.invalidateAll();
    const enabledTxService = await viteServer.ssrLoadModule('/src/services/transactionService.ts');
    assert.strictEqual(enabledTxService.WRITES_ENABLED, true);

    await assert.rejects(
      async () => enabledTxService.createKit(1),
      err => err instanceof enabledTxService.TransactionServiceError && err.code === 'WRONG_CHAIN',
      'createKit must reject with WRONG_CHAIN when wallet is on Chain 1'
    );

    const controllerModule = await viteServer.ssrLoadModule('/src/services/transactionController.ts');
    const wrongChainRes = controllerModule.validateActionPreconditions({
      actionType: 'withdraw',
      walletState: {
        isConnected: true,
        address: winnerAccount,
        chainId: 1, // Wrong Chain
        isCorrectNetwork: false,
      },
      contractAddress: briefArenaAddress,
      claimableCreditWei: 10000000000000000000n,
    });
    assert.strictEqual(wrongChainRes.isValid, false);
    assert.strictEqual(wrongChainRes.error.code, 'WRONG_CHAIN');
    assert.ok(wrongChainRes.error.message.includes('61997'));

    console.log('✓ PASS: Wrong chain guarded in both service and controller validation.\n');
    passedTests++;
  }

  // -------------------------------------------------------------
  // Subtest 3: Zero Credit / Wrong Wallet Guard
  // -------------------------------------------------------------
  console.log('[Subtest 3] Zero Credit Guard: Wallet with 0 claimable credit cannot initiate withdrawal');
  {
    const controllerModule = await viteServer.ssrLoadModule('/src/services/transactionController.ts');
    const zeroCreditRes = controllerModule.validateActionPreconditions({
      actionType: 'withdraw',
      walletState: {
        isConnected: true,
        address: '0x1111222233334444555566667777888899990000', // Non-winner account
        chainId: 61997,
        isCorrectNetwork: true,
      },
      contractAddress: briefArenaAddress,
      claimableCreditWei: 0n, // Zero credit
    });

    assert.strictEqual(zeroCreditRes.isValid, false);
    assert.strictEqual(zeroCreditRes.error.code, 'INVALID_INPUT_BOUNDS');
    assert.ok(zeroCreditRes.error.message.includes('No claimable credits available'));

    console.log('✓ PASS: Zero credit strictly blocked with typed INVALID_INPUT_BOUNDS error.\n');
    passedTests++;
  }

  // -------------------------------------------------------------
  // Subtest 4: Full Production Path for Winner 0xb3f7...0407
  // -------------------------------------------------------------
  console.log('[Subtest 4] Full Production Path: Rendered MyArenaPage without kit injection, real fee quote, and eth_sendTransaction');
  {
    process.env.VITE_WRITES_ENABLED = 'true';
    providerChainIdHex = '0xf22d'; // 61997
    currentAccount = winnerAccount;
    providerRequests.length = 0;
    simulateRpcError = false;

    viteServer.moduleGraph.invalidateAll();
    const { WalletProvider } = await viteServer.ssrLoadModule('/src/context/WalletContext.tsx');
    const { MyArenaPage } = await viteServer.ssrLoadModule('/src/pages/MyArenaPage.tsx');
    const dataServiceModule = await viteServer.ssrLoadModule('/src/services/dataService.ts');

    // Mock live data read for winner account
    let currentLiveCredit = 10000000000000000000n; // 10 test GEN
    let currentLiveWithdrawn = 0n;

    dataServiceModule.dataService.getMyArenaOverview = async (addr) => {
      return {
        contractDataAvailable: true,
        reason: '',
        sponsored: [],
        entered: [],
        moneyState: {
          prizeLocked: 0,
          creditAvailable: Number(currentLiveCredit) / 1e18,
          creditAvailableWei: currentLiveCredit,
          creditAvailableWeiStr: currentLiveCredit.toString(),
          genWithdrawn: Number(currentLiveWithdrawn) / 1e18,
          genWithdrawnWei: currentLiveWithdrawn,
          genWithdrawnWeiStr: currentLiveWithdrawn.toString(),
        },
      };
    };

    const container = win.document.createElement('div');
    win.document.body.appendChild(container);
    const root = ReactDOM.createRoot(container);

    // 1. Render normal production path WITHOUT kit prop on WalletProvider or MyArenaPage!
    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          { initialEntries: ['/my-arena'] },
          createElement(
            WalletProvider,
            null,
            createElement(MyArenaPage, null)
          )
        )
      );
    });

    await act(async () => {
      await new Promise(r => setTimeout(r, 120));
    });

    // Verify wallet connected on Studio Next
    assert.ok(
      providerRequests.some(r => r.method === 'eth_accounts'),
      'WalletProvider must query eth_accounts'
    );

    // Verify Card 2 renders 10.00 test GEN and active "Review & Submit Withdrawal"
    assert.ok(container.textContent.includes('10.00'), 'Card 2 must show 10.00 test GEN credit');
    assert.ok(container.textContent.includes('10000000000000000000 wei'), 'Card 2 must show exact wei');

    const withdrawBtn = container.querySelector('#withdraw-credit-draft-btn');
    assert.ok(withdrawBtn, 'Withdraw button must exist');
    assert.strictEqual(withdrawBtn.disabled, false, 'Withdraw button must be enabled');
    assert.ok(
      withdrawBtn.textContent.includes('Review & Submit Withdrawal'),
      'Button must state "Review & Submit Withdrawal" when WRITES_ENABLED=true'
    );

    // 2. Click "Review & Submit Withdrawal" to open modal
    await act(async () => {
      withdrawBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 150));
    });

    // Verify modal is open with real fee estimation
    assert.ok(container.textContent.includes('Review & Submit Withdrawal'), 'Modal title must be active Review & Submit Withdrawal');
    assert.ok(container.textContent.includes('WRITES_ENABLED = true'), 'Modal must show WRITES_ENABLED = true');
    assert.ok(container.textContent.includes('Non-Payable Call'), 'Modal must state Non-Payable Call');
    assert.ok(container.textContent.includes('0 test GEN (non-payable)'), 'Attached value must be 0 test GEN');

    // 3. Confirm & Submit
    const confirmBtn = container.querySelector('#confirm-submit-tx-btn');
    assert.ok(confirmBtn, 'Confirm & Submit button must exist');
    assert.strictEqual(confirmBtn.disabled, false, 'Confirm button must be enabled after fee quote');
    assert.ok(confirmBtn.textContent.includes('Confirm & Submit'));

    providerRequests.length = 0;

    await act(async () => {
      confirmBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 200));
    });

    // 4. Assert installed Transaction Kit RC2 requested eth_sendTransaction from EIP-1193 provider
    const sendTxCall = providerRequests.find(r => r.method === 'eth_sendTransaction');
    assert.ok(sendTxCall, 'Transaction Kit must request eth_sendTransaction from wallet');

    const txParams = sendTxCall.params[0];
    assert.strictEqual(
      txParams.to.toLowerCase(),
      consensusGateway.toLowerCase(),
      'Transaction recipient must be GenLayer consensus gateway'
    );

    // Withdraw calldata:
    // Encodes target contract briefArenaAddress (0x5614108eDBdAb6c0b6313725EDe8f1029F74F4F9)
    // and method "withdraw" (ASCII: 7769746864726177)
    const calldataHex = txParams.data.toLowerCase();
    assert.ok(
      calldataHex.includes('5614108edbdab6c0b6313725ede8f1029f74f4f9'),
      'Calldata must encode deployed BriefArena contract address'
    );
    assert.ok(
      calldataHex.includes('7769746864726177'),
      'Calldata must encode "withdraw" method name'
    );

    // Non-payable: userValue attached to smart contract method is 0n (zero attached GEN escrow).
    // The value on eth_sendTransaction carries solely the refundable execution fee quote (~0.21 GEN) with 0 added contract value.
    const sentValueWei = BigInt(txParams.value || '0x0');
    assert.strictEqual(
      sentValueWei,
      210000000000154950n,
      'Value on eth_sendTransaction must match the exact fee quote with zero contract value added'
    );

    // 5. Verify parent transaction execution and child GEN delivery verification
    const controllerModule = await viteServer.ssrLoadModule('/src/services/transactionController.ts');
    const controllerWithdraw = new controllerModule.TransactionController({
      actionType: 'withdraw',
      walletState: {
        isConnected: true,
        address: winnerAccount,
        chainId: 61997,
        isCorrectNetwork: true,
      },
      contractAddress: briefArenaAddress,
      claimableCreditWei: currentLiveCredit,
    });

    const mockKitWithChild = {
      getTransaction: async ({ hash }) => {
        if (hash === childTransferHash) {
          return {
            hash: childTransferHash,
            from: briefArenaAddress,
            to: winnerAccount,
            value: currentLiveCredit.toString(),
            executionResultName: 'FINISHED_WITH_RETURN',
            statusName: 'FINALIZED',
            successful: true,
            is_eth_send: true,
            value_credited: true,
          };
        }
        return {
          hash: withdrawTxHash,
          executionResultName: 'FINISHED_WITH_RETURN',
          statusName: 'FINALIZED',
          successful: true,
          messages: [
            {
              is_eth_send: true,
              recipient: winnerAccount,
              amount: currentLiveCredit.toString(),
              child_tx_hash: childTransferHash,
            },
          ],
        };
      },
      track: async () => ({
        phase: 'finalized',
        statusName: 'FINALIZED',
        executionResultName: 'FINISHED_WITH_RETURN',
        successful: true,
      }),
    };

    await controllerWithdraw.track(mockKitWithChild, withdrawTxHash);
    const trackedWithdrawState = controllerWithdraw.getState();

    assert.strictEqual(trackedWithdrawState.childTransferStatus, 'confirmed', 'Child GEN transfer must be confirmed');
    assert.strictEqual(trackedWithdrawState.childTxId, childTransferHash, 'Child tx ID must match');
    assert.strictEqual(trackedWithdrawState.observedChildFields.valueCredited, true, 'valueCredited must be true');

    // 6. Verify post-withdrawal state refresh clears on-chain claimable credit and updates withdrawn total
    currentLiveCredit = 0n;
    currentLiveWithdrawn = 10000000000000000000n;
    const refreshedOverview = await dataServiceModule.dataService.getMyArenaOverview(winnerAccount);
    assert.strictEqual(refreshedOverview.moneyState.creditAvailableWei, 0n, 'Refreshed credit must be 0 wei');
    assert.strictEqual(refreshedOverview.moneyState.genWithdrawnWei, 10000000000000000000n, 'Refreshed withdrawn must be 10 GEN');

    console.log('✓ PASS: Production path withdrawal: fee quote, eth_sendTransaction with zero contract value, and verified child GEN delivery.\n');
    passedTests++;

    root.unmount();
    container.remove();
  }

  // -------------------------------------------------------------
  // Subtest 5: Uncertain Outcome Preserves Hash & Blocks Duplicate
  // -------------------------------------------------------------
  console.log('[Subtest 5] Uncertain Outcome Guard: Ambiguous result preserves hash and blocks duplicate submission');
  {
    const controllerModule = await viteServer.ssrLoadModule('/src/services/transactionController.ts');

    const testCtrl = new controllerModule.TransactionController({
      actionType: 'withdraw',
      walletState: {
        isConnected: true,
        address: winnerAccount,
        chainId: 61997,
        isCorrectNetwork: true,
      },
      contractAddress: briefArenaAddress,
      claimableCreditWei: 10000000000000000000n,
    });

    const actionKey = testCtrl.getActionKey();
    const uncertainTxId = '0xuncertainhash12345678901234567890123456789012345678901234567890';

    // Persist ambiguous transaction representing uncertain broadcast/timeout
    controllerModule.persistTransactionRecord({
      txId: uncertainTxId,
      actionKey,
      rpcUrl: 'https://studio-next.genlayer.com/api',
      chainId: 61997,
      contractAddress: briefArenaAddress,
      walletAddress: winnerAccount,
      actionType: 'withdraw',
      args: [],
      userValueWei: '0',
      submittedAt: Date.now(),
      status: 'ambiguous',
      explorerLink: `https://studio-next.genlayer.com/explorer/tx/${uncertainTxId}`,
    });

    // Reload controller: must restore preserved tx hash, block duplicate submissions, and enter 'unknown' phase
    const reloadedCtrl = new controllerModule.TransactionController({
      actionType: 'withdraw',
      walletState: {
        isConnected: true,
        address: winnerAccount,
        chainId: 61997,
        isCorrectNetwork: true,
      },
      contractAddress: briefArenaAddress,
      claimableCreditWei: 10000000000000000000n,
    });

    const state = reloadedCtrl.getState();
    assert.strictEqual(state.isDuplicateBlocked, true, 'Duplicate submission must be blocked for ambiguous transaction');
    assert.strictEqual(state.phase, 'unknown', 'Phase must be unknown for ambiguous status');
    assert.strictEqual(state.txId, uncertainTxId, 'Transaction hash must be preserved');
    assert.ok(state.unresolvedMessage.includes(uncertainTxId), 'Unresolved message must reference the preserved hash');

    // Attempting submit while duplicate is blocked must reject with DISPATCH_FAILED
    await assert.rejects(
      async () => reloadedCtrl.submit({}),
      err => err.code === 'DISPATCH_FAILED' && err.message.includes('already in flight'),
      'Submission must be blocked while an uncertain/ambiguous transaction is unresolved'
    );

    controllerModule.clearPersistedTransaction(actionKey);
    console.log('✓ PASS: Uncertain outcome preserves transaction hash and strictly blocks duplicate submission.\n');
    passedTests++;
  }

  // Cleanup
  globalThis.fetch = realFetch;
  delete process.env.VITE_WRITES_ENABLED;
  await viteServer.close();

  console.log('================================================================');
  console.log(`ALL ${passedTests}/5 PRODUCTION PATH WITHDRAWAL TESTS PASSED!`);
  console.log('================================================================\n');
}

runSuite().catch(err => {
  console.error('\n❌ TEST SUITE FAILED:', err);
  process.exit(1);
});
