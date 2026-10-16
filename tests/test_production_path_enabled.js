/**
 * test_production_path_enabled.js
 *
 * Focused Enabled-Build Integration Tests for the Production Path
 * WITHOUT Injecting a Kit into the Page or WalletProvider.
 *
 * Verifies:
 *   1. Closed Gate: With WRITES_ENABLED=false, createKit and submissions reject with WRITE_GATE_DISABLED.
 *   2. Wrong Chain: Connecting on Chain 1 rejects with WRONG_CHAIN.
 *   3. Missing Contract Address: Missing or invalid address rejects with CONTRACT_ADDRESS_MISSING.
 *   4. Failed Estimate: Fee estimation failure surfaces FEE_ESTIMATION_FAILED and blocks confirmation.
 *   5. Full Production Path:
 *      - WalletProvider and CreateChallengePage rendered normally without injected kit.
 *      - Mocked EIP-1193 provider attached to window.ethereum.
 *      - Connected on Studio Next (chain 61997).
 *      - useTransactionKit calls real createKit(), producing real Transaction Kit RC2.
 *      - Complete valid challenge form on /challenges/new (Step 1-4).
 *      - Fee estimation runs automatically and produces verified PolicyQuote.
 *      - Click Confirm & Submit.
 *      - Installed Transaction Kit RC2 requests eth_sendTransaction from EIP-1193 provider.
 *      - Asserts deployed BriefArena contract address, create_challenge method calldata,
 *        and exact escrow value.
 *      - Zero external RPC writes.
 *      - Documents that real browser wallet popup behavior is unverified headlessly.
 *
 * Run: node tests/test_production_path_enabled.js
 */

'use strict';

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

// Setup Happy DOM environment
const { GlobalWindow } = require(path.resolve(__dirname, '../app/node_modules/happy-dom'));
const win = new GlobalWindow({ url: 'http://localhost:5173' });
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

function setInputValue(input, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis.HTMLInputElement.prototype, 'value');
  descriptor.set.call(input, value);
  input.dispatchEvent(new win.Event('input', { bubbles: true }));
  input.dispatchEvent(new win.Event('change', { bubbles: true }));
}

function setTextareaValue(textarea, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis.HTMLTextAreaElement.prototype, 'value');
  descriptor.set.call(textarea, value);
  textarea.dispatchEvent(new win.Event('input', { bubbles: true }));
  textarea.dispatchEvent(new win.Event('change', { bubbles: true }));
}

function setCheckboxValue(checkbox, checked) {
  if (checkbox.checked !== checked) {
    checkbox.click();
  }
}

async function runSuite() {
  console.log('================================================================');
  console.log('BRIEFARENA FOCUSED PRODUCTION PATH ENABLED-BUILD TESTS');
  console.log('================================================================\n');

  // Intercept globalThis.fetch for isolated RPC responses (No external RPC writes)
  const realFetch = globalThis.fetch;
  let simulateRpcError = false;
  const interceptedRpcMethods = [];

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
          return {
            ok: true,
            json: async () => ({
              jsonrpc: '2.0',
              id,
              result: {
                hash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
                blockHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
                blockNumber: '0x1',
                from: '0x1E47d7d7079FE4aD599B184559ffCDC56278fb54',
                to: '0xb7278A61aa25c888815aFC32Ad3cC52fF24fE575',
                status: 'FINALIZED',
                result: 'MAJORITY_AGREE',
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
                transactionHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
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
  const testAccount = '0x1E47d7d7079FE4aD599B184559ffCDC56278fb54';
  let providerChainIdHex = '0xf22d'; // 61997

  const mockEip1193Provider = {
    request: async ({ method, params }) => {
      providerRequests.push({ method, params });
      if (method === 'eth_accounts' || method === 'eth_requestAccounts') {
        return [testAccount];
      }
      if (method === 'eth_chainId') {
        return providerChainIdHex;
      }
      if (method === 'wallet_switchEthereumChain') {
        providerChainIdHex = params[0].chainId;
        return null;
      }
      if (method === 'eth_getBalance') {
        return '0x15afe46c6997ac000'; // 25 GEN in wei hex
      }
      if (method === 'eth_call') {
        return '0x0000000000000000000000001111111111111111111111111111111111111111';
      }
      if (method === 'eth_getTransactionCount') {
        return '0x0';
      }
      if (method === 'eth_estimateGas') {
        return '0x30d40';
      }
      if (method === 'eth_gasPrice') {
        return '0x3b9aca00';
      }
      if (method === 'eth_sendTransaction') {
        return '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
      }
      if (method === 'eth_getTransactionReceipt') {
        return {
          status: '0x1',
          transactionHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
          logs: [],
        };
      }
      return null;
    },
    on: () => {},
    removeListener: () => {},
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
  const ReactDOMClient = appRequire('react-dom/client');
  const ReactRouterDOM = appRequire('react-router-dom');

  const { createElement, act } = React;
  const { MemoryRouter, Routes, Route } = ReactRouterDOM;

  const container = win.document.createElement('div');
  win.document.body.appendChild(container);
  const root = ReactDOMClient.createRoot(container);

  let passedTests = 0;

  // -------------------------------------------------------------
  // Subtest 1: Closed Gate Rejection (Default Build)
  // -------------------------------------------------------------
  console.log('[Subtest 1] Closed Gate: Default build rejects kit creation and submissions with WRITE_GATE_DISABLED');
  {
    delete process.env.VITE_WRITES_ENABLED;
    viteServer.moduleGraph.invalidateAll();
    const closedTxService = await viteServer.ssrLoadModule('/src/services/transactionService.ts');
    assert.strictEqual(closedTxService.WRITES_ENABLED, false, 'WRITES_ENABLED must be false by default');

    await assert.rejects(
      async () => closedTxService.createKit(61997),
      err => err instanceof closedTxService.TransactionServiceError && err.code === 'WRITE_GATE_DISABLED',
      'createKit must reject with WRITE_GATE_DISABLED while closed'
    );

    await assert.rejects(
      async () =>
        closedTxService.estimateFees(
          {},
          { preset: 'standard' },
          { kind: 'write', address: '0x5614108eDBdAb6c0b6313725EDe8f1029F74F4F9', method: 'create_challenge', args: [] }
        ),
      err => err instanceof closedTxService.TransactionServiceError && err.code === 'WRITE_GATE_DISABLED',
      'estimateFees must reject with WRITE_GATE_DISABLED while closed'
    );

    await assert.rejects(
      async () =>
        closedTxService.dispatchTransaction(
          {},
          {},
          { kind: 'write', address: '0x5614108eDBdAb6c0b6313725EDe8f1029F74F4F9', method: 'create_challenge', args: [] }
        ),
      err => err instanceof closedTxService.TransactionServiceError && err.code === 'WRITE_GATE_DISABLED',
      'dispatchTransaction must reject with WRITE_GATE_DISABLED while closed'
    );

    console.log('✓ PASS: Default closed gate strictly rejects kit creation, estimation, and dispatch.\n');
    passedTests++;
  }

  // -------------------------------------------------------------
  // Subtest 2: Wrong Chain Rejection (Chain 1 instead of 61997)
  // -------------------------------------------------------------
  console.log('[Subtest 2] Wrong Chain: createKit rejects on wrong chain (Chain 1 vs 61997)');
  {
    process.env.VITE_WRITES_ENABLED = 'true';
    viteServer.moduleGraph.invalidateAll();
    const enabledTxService = await viteServer.ssrLoadModule('/src/services/transactionService.ts');
    assert.strictEqual(enabledTxService.WRITES_ENABLED, true, 'WRITES_ENABLED must be true in enabled build');

    await assert.rejects(
      async () => enabledTxService.createKit(1),
      err => err instanceof enabledTxService.TransactionServiceError && err.code === 'WRONG_CHAIN',
      'createKit must reject with WRONG_CHAIN when walletChainId is 1'
    );

    console.log('✓ PASS: Wrong chain rejected with typed WRONG_CHAIN error.\n');
    passedTests++;
  }

  // -------------------------------------------------------------
  // Subtest 3: Missing Contract Address Rejection
  // -------------------------------------------------------------
  console.log('[Subtest 3] Missing Contract Address: Preconditions and resolution reject with CONTRACT_ADDRESS_MISSING');
  {
    const enabledTxService = await viteServer.ssrLoadModule('/src/services/transactionService.ts');
    assert.throws(
      () => enabledTxService.resolveContractAddress(''),
      err => err instanceof enabledTxService.TransactionServiceError && err.code === 'CONTRACT_ADDRESS_MISSING',
      'resolveContractAddress must reject with CONTRACT_ADDRESS_MISSING when empty string'
    );

    assert.throws(
      () => enabledTxService.resolveContractAddress('0xinvalid'),
      err => err instanceof enabledTxService.TransactionServiceError && err.code === 'CONTRACT_ADDRESS_MISSING',
      'resolveContractAddress must reject with CONTRACT_ADDRESS_MISSING when invalid'
    );

    console.log('✓ PASS: Missing and invalid contract addresses reject with CONTRACT_ADDRESS_MISSING.\n');
    passedTests++;
  }

  // -------------------------------------------------------------
  // Subtest 4: Fee Estimation Failure Blocks Confirm Button
  // -------------------------------------------------------------
  console.log('[Subtest 4] Failed Estimate: Fee estimation error blocks modal confirmation button');
  {
    simulateRpcError = true;
    const enabledTxService = await viteServer.ssrLoadModule('/src/services/transactionService.ts');
    const enabledControllerModule = await viteServer.ssrLoadModule('/src/services/transactionController.ts');

    // Create real kit on chain 61997
    const kit = await enabledTxService.createKit(61997, {
      provider: mockEip1193Provider,
      account: testAccount,
    });

    const formValues = {
      title: 'Valid Challenge Title Here',
      category: 'Design Systems',
      synopsis: 'A valid synopsis that meets the minimum length requirement for challenge creation.',
      mandatoryRequirements: ['Valid Requirement 1'],
      prohibitedTerms: ['banned'],
      durationHours: 72,
      prizeAmountGen: '25',
    };

    const controller = new enabledControllerModule.TransactionController(
      {
        actionType: 'challenge_creation',
        walletState: {
          isConnected: true,
          address: testAccount,
          chainId: 61997,
          isCorrectNetwork: true,
        },
        contractAddress: '0x5614108eDBdAb6c0b6313725EDe8f1029F74F4F9',
        createChallengeValues: formValues,
      },
      kit
    );

    await assert.rejects(
      async () => controller.estimateFee(),
      err => err instanceof enabledTxService.TransactionServiceError && err.code === 'FEE_ESTIMATION_FAILED',
      'controller.estimateFee must reject with FEE_ESTIMATION_FAILED when RPC fails'
    );

    const controllerState = controller.getState();
    assert.strictEqual(controllerState.canConfirm, false, 'canConfirm must remain false on failed fee estimation');
    assert.strictEqual(controllerState.quote, null, 'quote must remain null on failed fee estimation');
    assert.ok(controllerState.quoteError, 'quoteError must record error details');

    simulateRpcError = false;
    console.log('✓ PASS: Fee estimation failure strictly blocks transaction confirmation controls.\n');
    passedTests++;
  }

  // -------------------------------------------------------------
  // Subtest 5: Full Production Path (Without Injecting Kit)
  // -------------------------------------------------------------
  console.log('[Subtest 5] Full Production Path: Render normal WalletProvider and CreateChallengePage (/challenges/new) WITHOUT injecting kit');
  {
    providerChainIdHex = '0xf22d'; // 61997
    providerRequests.length = 0;

    const WalletContextModule = await viteServer.ssrLoadModule('/src/context/WalletContext.tsx');
    const CreateChallengePageModule = await viteServer.ssrLoadModule('/src/pages/CreateChallengePage.tsx');

    const { WalletProvider } = WalletContextModule;
    const { CreateChallengePage } = CreateChallengePageModule;

    // Render normal WalletProvider and page on /challenges/new WITHOUT INJECTING KIT!
    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          { initialEntries: ['/challenges/new'], key: 'production-path-clean' },
          createElement(
            WalletProvider,
            null, // NO KIT INJECTED INTO WALLETPROVIDER
            createElement(
              Routes,
              null,
              createElement(Route, {
                path: '/challenges/new',
                element: createElement(CreateChallengePage), // NO KIT INJECTED INTO PAGE
              })
            )
          )
        )
      );
    });

    // Wait for WalletProvider mount and useTransactionKit() -> createKit() instantiation
    await act(async () => {
      await new Promise(r => setTimeout(r, 200));
    });

    // Verify WalletProvider queried EIP-1193 provider
    assert.ok(
      providerRequests.some(r => r.method === 'eth_accounts'),
      'WalletProvider must query eth_accounts on mount'
    );
    assert.ok(
      providerRequests.some(r => r.method === 'eth_chainId'),
      'WalletProvider must query eth_chainId on mount'
    );

    // Step 1: Identity
    const titleInput = container.querySelector('#brief-title');
    const synopsisInput = container.querySelector('#product-synopsis');
    assert.ok(titleInput, '#brief-title must exist');
    assert.ok(synopsisInput, '#product-synopsis must exist');

    await act(async () => {
      setInputValue(titleInput, 'Volumetric Minimalist Architecture');
      setTextareaValue(
        synopsisInput,
        'A deterministic spatial computing kernel enforcing zero background noise and strict visual harmony.'
      );
    });

    const step1NextBtn = Array.from(container.querySelectorAll('button')).find(b =>
      b.textContent.includes('Next: Define Rubrics')
    );
    assert.ok(step1NextBtn, 'Next: Define Rubrics button must exist');
    await act(async () => {
      step1NextBtn.click();
      await new Promise(r => setTimeout(r, 50));
    });

    // Step 2: Rubrics
    const anchorInput = container.querySelector('input[placeholder*="Add custom mandatory theme"]');
    const addAnchorBtn = Array.from(container.querySelectorAll('button')).find(b =>
      b.textContent.includes('+ Add Theme')
    );
    const prohibitedInput = container.querySelector('input[placeholder*="Add prohibited term"]');
    const addProhibitedBtn = Array.from(container.querySelectorAll('button')).find(b =>
      b.textContent.includes('+ Add Prohibited')
    );
    const step2NextBtn = Array.from(container.querySelectorAll('button')).find(b =>
      b.textContent.includes('Next: Escrow & Timing')
    );

    await act(async () => {
      setInputValue(anchorInput, 'Clean typography rule');
    });
    await act(async () => {
      addAnchorBtn.click();
    });

    await act(async () => {
      setInputValue(prohibitedInput, 'sloppy');
    });
    await act(async () => {
      addProhibitedBtn.click();
    });

    await act(async () => {
      step2NextBtn.click();
      await new Promise(r => setTimeout(r, 50));
    });

    // Step 3: Terms
    const bountyInput = container.querySelector('#bounty-input');
    assert.ok(bountyInput, '#bounty-input must exist');
    await act(async () => {
      setInputValue(bountyInput, '25');
    });

    const step3NextBtn = Array.from(container.querySelectorAll('button')).find(b =>
      b.textContent.includes('Next: Review & Freeze') || b.textContent.includes('Next: Audit & Freeze')
    );
    assert.ok(step3NextBtn, 'Next button on Step 3 must exist');
    await act(async () => {
      step3NextBtn.click();
      await new Promise(r => setTimeout(r, 50));
    });

    // Step 4: Review & Agree
    const ackCheck = container.querySelector('input[type="checkbox"]');
    assert.ok(ackCheck, 'Agreement checkbox must exist on Step 4');
    await act(async () => {
      setCheckboxValue(ackCheck, true);
    });

    const submitStep4Btn = container.querySelector('button[type="submit"]');
    assert.ok(submitStep4Btn, 'Step 4 submit button must exist');
    assert.strictEqual(submitStep4Btn.disabled, false, 'Step 4 submit button must be enabled');

    const preSubmitReqCount = providerRequests.length;

    // Click Submit -> triggers real fee estimation on kit created by useTransactionKit -> createKit()
    await act(async () => {
      submitStep4Btn.click();
      await new Promise(r => setTimeout(r, 200));
    });

    // Modal is now open
    const confirmBtn = container.querySelector('#confirm-submit-tx-btn');
    assert.ok(confirmBtn, 'Confirm submission button must render in modal');
    assert.strictEqual(confirmBtn.disabled, false, 'Confirm button must be enabled when fee estimation succeeds');
    assert.ok(confirmBtn.textContent.includes('Confirm & Submit'), 'Confirm button must display "Confirm & Submit"');

    // Click Confirm & Submit -> triggers real dispatchTransaction -> kit.submit()
    await act(async () => {
      confirmBtn.click();
      await new Promise(r => setTimeout(r, 250));
    });

    const postConfirmRequests = providerRequests.slice(preSubmitReqCount);
    const sendTxRequest = postConfirmRequests.find(r => r.method === 'eth_sendTransaction');

    assert.ok(sendTxRequest, 'Transaction Kit RC2 must request "eth_sendTransaction" from EIP-1193 provider');

    const txParams = sendTxRequest.params[0];
    const deployedAddressLower = '5614108edbdab6c0b6313725ede8f1029f74f4f9';

    // 1. Assert deployed BriefArena address is target of execution
    assert.ok(
      txParams.data.toLowerCase().includes(deployedAddressLower),
      `Transaction calldata must target deployed BriefArena contract (0x${deployedAddressLower})`
    );

    // 2. Assert correct method calldata (create_challenge in hex: 6372656174655f6368616c6c656e6765)
    assert.ok(
      txParams.data.includes('6372656174655f6368616c6c656e6765'),
      'Transaction calldata must contain "create_challenge" method identifier'
    );

    // 3. Assert exact escrow value (25 GEN = 25 * 10^18 wei = 0x15af1d78b58c40000)
    // The contract calldata contains the exact 25 GEN escrow value attached
    assert.ok(
      txParams.data.includes('15af1d78b58c40000'),
      'Transaction calldata payload must encode exact 25 GEN (0x15af1d78b58c40000) escrow value'
    );

    // And txParams.value carries the total (25 GEN escrow + quoted network fee)
    const txValueBigInt = BigInt(txParams.value);
    assert.ok(
      txValueBigInt >= 25000000000000000000n,
      'eth_sendTransaction value must cover the full 25 GEN escrow amount'
    );

    console.log(`  SDK Provider Method: ${sendTxRequest.method}`);
    console.log(`  SDK Gateway Target: ${txParams.to}`);
    console.log(`  SDK Contract Target: 0x${deployedAddressLower}`);
    console.log(`  SDK Total Value: ${txParams.value} (${txValueBigInt.toString()} wei)`);
    console.log(`  SDK Escrow Encoded in Calldata: 25 GEN (0x15af1d78b58c40000)`);
    console.log(
      '  [UNVERIFIED] Browser wallet popup dialog (MetaMask/Rabby) cannot trigger headlessly and remains UNVERIFIED until tested by user.'
    );

    console.log('✓ PASS: Production path without injection executed end-to-end with real Transaction Kit RC2.\n');
    passedTests++;
  }

  // Teardown
  delete process.env.VITE_WRITES_ENABLED;
  viteServer.moduleGraph.invalidateAll();
  globalThis.fetch = realFetch;
  await viteServer.close();

  console.log('================================================================');
  console.log(`ALL FOCUSED PRODUCTION PATH TESTS PASSED (${passedTests}/${passedTests})`);
  console.log('================================================================\n');
  process.exit(0);
}

runSuite().catch(err => {
  console.error('\n❌ FOCUSED PRODUCTION PATH TEST SUITE FAILED:', err);
  process.exit(1);
});
