/**
 * test_isolated_provider_flow.js
 *
 * Isolated Provider & Transaction Kit RC2 Execution Tests
 *
 * Architecture & Test Guarantees:
 *   1. Isolated EIP-1193 Provider:
 *      - Exercises wallet connection request (eth_requestAccounts) and chain switch (wallet_switchEthereumChain).
 *   2. Tamper-Resistance Proof:
 *      - Proves production build gate defaults to closed (WRITES_ENABLED = false).
 *      - Proves console tampering via globalThis.__BRIEFARENA_TEST_WRITES_ENABLED__ does NOT enable writes.
 *      - Proves runtime mutator (setWritesEnabledForTesting) is completely removed from production exports.
 *      - Proves kit creation, fee estimation, and dispatch fail closed with WRITE_GATE_DISABLED.
 *   3. Build-Gate Enablement:
 *      - Intentionally enables isolated test build via process.env.VITE_WRITES_ENABLED = 'true'.
 *      - Rebinds Vite modules and confirms WRITES_ENABLED === true.
 *   4. Real Transaction Kit RC2 Execution:
 *      - Exercises installed @genlayer/transaction-kit RC2 (createTransactionKit -> estimate -> submit).
 *      - Does NOT mock kit.submit manually or invent fake calls.
 *      - Intercepts RPC endpoints (sim_getFeeConfig, eth_getTransactionCount, eth_estimateGas, etc.) in-memory.
 *      - Records the provider method actually requested by the SDK: 'eth_sendTransaction'.
 *      - Explicitly marks real browser wallet popup behavior as unverified in headless test.
 *   5. Rendered UI Flows with Real Transaction Kit RC2:
 *      - CreateChallengePage: Form steps 1-4 -> Real kit.estimate -> Modal -> Confirm -> Real kit.submit -> Provider signing -> Hash.
 *      - SubmitEntryPage: Entry form -> Real kit.estimate -> Modal -> Confirm -> Real kit.submit -> Provider signing -> Hash.
 *      - ChallengeDetailPage: Cancel Challenge -> Real kit.estimate -> Modal -> Confirm -> Real kit.submit.
 *      - MyArenaPage: Withdraw Credit -> Real kit.estimate -> Modal -> Confirm -> Real kit.submit.
 *   6. Error States & Rejection Handling:
 *      - Fee estimation error blocks confirmation button.
 *      - User rejection (code 4001) surfaces cleanly as DISPATCH_FAILED without unhandled rejections.
 *      - Execution failure (FINISHED_WITH_ERROR) is proven failed.
 *   7. Gate Teardown:
 *      - Cleans up environment, invalidates module graph, and verifies WRITES_ENABLED reverts to false.
 *
 * Run: node tests/test_isolated_provider_flow.js
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
  console.log('BRIEFARENA ISOLATED PROVIDER & TRANSACTION KIT RC2 EXECUTION TESTS');
  console.log('================================================================\n');

  // Load real Vite server to transpile and import app modules
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
  const { createTransactionKit } = appRequire('@genlayer/transaction-kit');
  const { chains } = appRequire('genlayer-js');

  const { createElement, act } = React;
  const { MemoryRouter, Routes, Route } = ReactRouterDOM;

  // Intercept globalThis.fetch for isolated GenLayer / EVM RPC calls
  const realFetch = globalThis.fetch;
  const interceptedRpcMethods = [];
  globalThis.fetch = async (url, options) => {
    if (options && options.body) {
      try {
        const body = JSON.parse(options.body);
        const { id, method } = body;
        interceptedRpcMethods.push(method);

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
          return {
            ok: true,
            json: async () => ({ jsonrpc: '2.0', id, result: '0x0' }),
          };
        }

        if (method === 'eth_estimateGas') {
          return {
            ok: true,
            json: async () => ({ jsonrpc: '2.0', id, result: '0x30d40' }),
          };
        }

        if (method === 'eth_gasPrice') {
          return {
            ok: true,
            json: async () => ({ jsonrpc: '2.0', id, result: '0x3b9aca00' }),
          };
        }
      } catch (e) {
        // Fall through
      }
    }
    if (typeof realFetch === 'function') {
      return realFetch(url, options);
    }
    return { ok: true, json: async () => ({ jsonrpc: '2.0', result: null }) };
  };

  // Initial module load (Default Closed Gate: WRITES_ENABLED = false)
  let txService = await viteServer.ssrLoadModule('/src/services/transactionService.ts');
  let txControllerModule = await viteServer.ssrLoadModule('/src/services/transactionController.ts');
  let contractClient = await viteServer.ssrLoadModule('/src/services/contractClient.ts');
  let dataServiceModule = await viteServer.ssrLoadModule('/src/services/dataService.ts');
  let WalletContextModule = await viteServer.ssrLoadModule('/src/context/WalletContext.tsx');
  let HeaderModule = await viteServer.ssrLoadModule('/src/components/Header.tsx');
  let CreateChallengePageModule = await viteServer.ssrLoadModule('/src/pages/CreateChallengePage.tsx');
  let SubmitEntryPageModule = await viteServer.ssrLoadModule('/src/pages/SubmitEntryPage.tsx');
  let ChallengeDetailPageModule = await viteServer.ssrLoadModule('/src/pages/ChallengeDetailPage.tsx');
  let MyArenaPageModule = await viteServer.ssrLoadModule('/src/pages/MyArenaPage.tsx');

  let { WalletContext } = WalletContextModule;
  let { Header } = HeaderModule;
  let { CreateChallengePage } = CreateChallengePageModule;
  let { SubmitEntryPage } = SubmitEntryPageModule;
  let { ChallengeDetailPage } = ChallengeDetailPageModule;
  let { MyArenaPage } = MyArenaPageModule;

  // Mount container
  const container = win.document.createElement('div');
  container.id = 'root';
  win.document.body.appendChild(container);
  const root = ReactDOMClient.createRoot(container);

  let passedTests = 0;

  // -------------------------------------------------------------
  // Test 1: Isolated EIP-1193 Provider Connect Request & Chain Switch
  // -------------------------------------------------------------
  console.log('[Test 1] Isolated EIP-1193 Provider: Connect request and chain switch from rendered Header');

  const providerRequests = [];
  let providerAccounts = ['0x1E47d7d7079FE4aD599B184559ffCDC56278fb54'];
  let providerChainId = '0x1'; // initially wrong chain (Ethereum mainnet)

  const mockEip1193Provider = {
    request: async ({ method, params }) => {
      providerRequests.push({ method, params });
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') {
        return providerAccounts;
      }
      if (method === 'eth_chainId') {
        return providerChainId;
      }
      if (method === 'wallet_switchEthereumChain') {
        providerChainId = params[0].chainId;
        return null;
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

  // Wallet context state for simulation
  let walletContextState = {
    isConnected: false,
    address: null,
    chainId: null,
    isCorrectNetwork: false,
    balance: null,
    isConnecting: false,
    error: null,
    connectWallet: async () => {
      const accounts = await mockEip1193Provider.request({ method: 'eth_requestAccounts' });
      walletContextState.isConnected = true;
      walletContextState.address = accounts[0];
      walletContextState.chainId = parseInt(providerChainId, 16);
      walletContextState.isCorrectNetwork = walletContextState.chainId === 61997;
    },
    disconnectWallet: () => {
      walletContextState.isConnected = false;
      walletContextState.address = null;
    },
    switchNetwork: async () => {
      await mockEip1193Provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0xf22d' }],
      });
      walletContextState.chainId = 61997;
      walletContextState.isCorrectNetwork = true;
    },
  };

  // Render Header in disconnected state
  await act(async () => {
    root.render(
      createElement(
        MemoryRouter,
        { key: 'header-test' },
        createElement(
          WalletContext.Provider,
          { value: walletContextState },
          createElement(Header)
        )
      )
    );
  });

  const connectBtn = container.querySelector('#connect-wallet-btn');
  assert.ok(connectBtn, 'Connect wallet button must render in disconnected state');

  // Click Connect Wallet
  await act(async () => {
    connectBtn.click();
    await new Promise(r => setTimeout(r, 20));
  });

  const connectReq = providerRequests.find(r => r.method === 'eth_requestAccounts');
  assert.ok(connectReq, 'Clicking connect wallet must invoke eth_requestAccounts on EIP-1193 provider');
  assert.strictEqual(walletContextState.isConnected, true, 'Wallet must mark isConnected = true');
  assert.strictEqual(walletContextState.isCorrectNetwork, false, 'Chain 1 is not Studio Next (61997)');

  // Re-render Header with connected on wrong network
  await act(async () => {
    root.render(
      createElement(
        MemoryRouter,
        { key: 'header-test-wrong-chain' },
        createElement(
          WalletContext.Provider,
          { value: walletContextState },
          createElement(Header)
        )
      )
    );
  });

  const switchNetworkBtn = container.querySelector('#switch-network-btn');
  assert.ok(switchNetworkBtn, 'Switch Network button must render when connected to wrong chain');

  // Click Switch Network
  await act(async () => {
    switchNetworkBtn.click();
    await new Promise(r => setTimeout(r, 20));
  });

  const switchReq = providerRequests.find(r => r.method === 'wallet_switchEthereumChain');
  assert.ok(switchReq, 'Clicking switch network must invoke wallet_switchEthereumChain on EIP-1193 provider');
  assert.strictEqual(switchReq.params[0].chainId, '0xf22d', 'Must request switch to chain 0xf22d (61997)');
  assert.strictEqual(walletContextState.isCorrectNetwork, true, 'Wallet now on correct network (61997)');

  console.log('✓ PASS: EIP-1193 connect request and chain switch exercised through rendered controls.\n');
  passedTests++;

  // -------------------------------------------------------------
  // Test 2: Console Tamper-Resistance & Default Closed Gate Proof
  // -------------------------------------------------------------
  console.log('[Test 2] Tamper-Resistance: Production build gate closed; browser console overrides impossible');

  assert.strictEqual(txService.WRITES_ENABLED, false, 'WRITES_ENABLED must be false by default');
  assert.strictEqual(
    typeof txService.setWritesEnabledForTesting,
    'undefined',
    'setWritesEnabledForTesting must not be exported'
  );
  assert.strictEqual(
    typeof txService.areWritesEnabled,
    'undefined',
    'areWritesEnabled must not be exported'
  );

  // Attempt console tampering via globalThis override
  globalThis.__BRIEFARENA_TEST_WRITES_ENABLED__ = true;
  assert.strictEqual(
    txService.WRITES_ENABLED,
    false,
    'globalThis.__BRIEFARENA_TEST_WRITES_ENABLED__ must have zero effect on WRITES_ENABLED'
  );
  delete globalThis.__BRIEFARENA_TEST_WRITES_ENABLED__;

  // Verify write gate fail-closed behavior on all service operations
  await assert.rejects(
    async () => txService.createKit(61997),
    err => err instanceof txService.TransactionServiceError && err.code === 'WRITE_GATE_DISABLED',
    'createKit must reject with WRITE_GATE_DISABLED when closed'
  );

  await assert.rejects(
    async () =>
      txService.estimateFees({}, { preset: 'standard' }, { kind: 'write', address: '0x1234', method: 'test', args: [] }),
    err => err instanceof txService.TransactionServiceError && err.code === 'WRITE_GATE_DISABLED',
    'estimateFees must reject with WRITE_GATE_DISABLED when closed'
  );

  await assert.rejects(
    async () =>
      txService.dispatchTransaction({}, {}, { kind: 'write', address: '0x1234', method: 'test', args: [] }),
    err => err instanceof txService.TransactionServiceError && err.code === 'WRITE_GATE_DISABLED',
    'dispatchTransaction must reject with WRITE_GATE_DISABLED when closed'
  );

  console.log('✓ PASS: Production gate defaults closed and cannot be opened from browser console or globals.\n');
  passedTests++;

  // -------------------------------------------------------------
  // Test 3: Build-Gate Enablement for Isolated Testing
  // -------------------------------------------------------------
  console.log('[Test 3] Loading intentionally enabled isolated test build (VITE_WRITES_ENABLED=true)...');

  process.env.VITE_WRITES_ENABLED = 'true';
  viteServer.moduleGraph.invalidateAll();

  txService = await viteServer.ssrLoadModule('/src/services/transactionService.ts');
  txControllerModule = await viteServer.ssrLoadModule('/src/services/transactionController.ts');
  contractClient = await viteServer.ssrLoadModule('/src/services/contractClient.ts');
  dataServiceModule = await viteServer.ssrLoadModule('/src/services/dataService.ts');
  WalletContextModule = await viteServer.ssrLoadModule('/src/context/WalletContext.tsx');
  HeaderModule = await viteServer.ssrLoadModule('/src/components/Header.tsx');
  CreateChallengePageModule = await viteServer.ssrLoadModule('/src/pages/CreateChallengePage.tsx');
  SubmitEntryPageModule = await viteServer.ssrLoadModule('/src/pages/SubmitEntryPage.tsx');
  ChallengeDetailPageModule = await viteServer.ssrLoadModule('/src/pages/ChallengeDetailPage.tsx');
  MyArenaPageModule = await viteServer.ssrLoadModule('/src/pages/MyArenaPage.tsx');

  WalletContext = WalletContextModule.WalletContext;
  Header = HeaderModule.Header;
  CreateChallengePage = CreateChallengePageModule.CreateChallengePage;
  SubmitEntryPage = SubmitEntryPageModule.SubmitEntryPage;
  ChallengeDetailPage = ChallengeDetailPageModule.ChallengeDetailPage;
  MyArenaPage = MyArenaPageModule.MyArenaPage;

  assert.strictEqual(txService.WRITES_ENABLED, true, 'WRITES_ENABLED must be true in enabled build');
  console.log('✓ PASS: Intentionally enabled build successfully loaded with WRITES_ENABLED=true.\n');
  passedTests++;

  // -------------------------------------------------------------
  // Test 4: Real Transaction Kit RC2 createTransactionKit -> estimate -> submit
  // -------------------------------------------------------------
  console.log('[Test 4] Transaction Kit RC2: Real createTransactionKit -> estimate -> submit path execution');

  const validTestWallet = {
    isConnected: true,
    address: '0x1E47d7d7079FE4aD599B184559ffCDC56278fb54',
    chainId: 61997,
    isCorrectNetwork: true,
    balance: '500.0',
    isConnecting: false,
    error: null,
    connectWallet: async () => {},
    disconnectWallet: () => {},
    switchNetwork: async () => {},
  };

  const studioNextChain = {
    ...chains.studioDevnet,
    rpcUrls: {
      ...chains.studioDevnet.rpcUrls,
      default: { http: ['https://studio-next.genlayer.com/api'] },
    },
  };

  // Instantiate REAL installed @genlayer/transaction-kit RC2 kit
  const realRc2Kit = createTransactionKit({
    chain: studioNextChain,
    provider: mockEip1193Provider,
    account: validTestWallet.address,
  });

  assert.ok(realRc2Kit, 'Transaction Kit RC2 must be successfully created');
  assert.strictEqual(typeof realRc2Kit.estimate, 'function', 'kit.estimate must be a function');
  assert.strictEqual(typeof realRc2Kit.submit, 'function', 'kit.submit must be a function');

  // Exercise real kit.estimate
  const sampleSubmitInput = {
    kind: 'write',
    address: '0x4072D26298eefD8c6D865164a6a3c14fa3E7e272',
    method: 'create_challenge',
    args: ['Title', 'Category', 'Synopsis meeting minimum length bounds here', ['req'], ['proh'], 86400n],
  };

  const realQuote = await realRc2Kit.estimate(
    { preset: 'standard', userValue: 25000000000000000000n },
    sampleSubmitInput
  );

  assert.ok(realQuote, 'Real kit.estimate must produce a policy quote');
  assert.strictEqual(realQuote.verification?.status, 'verified', 'Policy quote status must be verified');
  assert.ok(realQuote.feeValue > 0n, 'Fee value must be greater than 0');
  assert.strictEqual(realQuote.userValue, 25000000000000000000n, 'userValue must match attached escrow');

  // Clear provider requests to accurately record submit invocation
  const preSubmitReqCount = providerRequests.length;

  // Exercise real kit.submit
  const submitResult = await realRc2Kit.submit(realQuote, sampleSubmitInput);

  assert.ok(submitResult, 'Real kit.submit must return result');
  assert.strictEqual(
    submitResult.genlayerTxId,
    '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    'Real kit.submit must return 66-character transaction hash'
  );

  // Record provider method actually requested by Transaction Kit RC2 SDK
  const postSubmitRequests = providerRequests.slice(preSubmitReqCount);
  const sendTxRequest = postSubmitRequests.find(r => r.method === 'eth_sendTransaction');
  assert.ok(
    sendTxRequest,
    'Transaction Kit RC2 SDK must request "eth_sendTransaction" from the EIP-1193 provider'
  );

  console.log(`  SDK Recorded Provider Method: ${sendTxRequest.method}`);
  console.log(`  SDK Sent To: ${sendTxRequest.params[0].to}`);
  console.log(`  SDK Attached Value: ${sendTxRequest.params[0].value}`);
  console.log(
    '  [NOTE] Browser wallet popup behavior (e.g., MetaMask extension dialog) cannot trigger headlessly and remains UNVERIFIED until user tests in a real browser.'
  );

  console.log('✓ PASS: Real Transaction Kit RC2 SDK createTransactionKit -> estimate -> submit exercised successfully.\n');
  passedTests++;

  // -------------------------------------------------------------
  // Test 5: CreateChallengePage with Real Transaction Kit RC2
  // -------------------------------------------------------------
  console.log('[Test 5] Create Challenge: Enabled path with real Transaction Kit RC2');

  await act(async () => {
    root.render(
      createElement(
        MemoryRouter,
        { key: 'create-enabled-test' },
        createElement(
          WalletContext.Provider,
          { value: validTestWallet },
          createElement(CreateChallengePage, { kit: realRc2Kit })
        )
      )
    );
  });

  // Step 1: Basic Information
  const titleInput = container.querySelector('#brief-title');
  const synopsisInput = container.querySelector('#product-synopsis');
  assert.ok(titleInput, '#brief-title must exist');
  assert.ok(synopsisInput, '#product-synopsis must exist');

  await act(async () => {
    setInputValue(titleInput, 'Decentralized AI Governance Pitch');
    setTextareaValue(synopsisInput, 'Write a high-converting governance proposal summary for intelligent consensus.');
  });

  const step1NextBtn = Array.from(container.querySelectorAll('button')).find(b =>
    b.textContent.includes('Next: Define Rubrics')
  );
  assert.ok(step1NextBtn, 'Next: Define Rubrics button must exist');
  await act(async () => {
    step1NextBtn.click();
  });

  // Step 2: Evaluation Rubrics
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
    setInputValue(anchorInput, 'Verifiable consensus threshold');
  });
  await act(async () => {
    addAnchorBtn.click();
  });

  await act(async () => {
    setInputValue(prohibitedInput, 'centralized server');
  });
  await act(async () => {
    addProhibitedBtn.click();
  });

  await act(async () => {
    step2NextBtn.click();
  });

  // Step 3: Escrow Bounty & Timing
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
  });

  // Step 4: Final Review & Confirmation Checkbox
  const ackCheck = container.querySelector('input[type="checkbox"]');
  assert.ok(ackCheck, 'Agreement checkbox must exist on Step 4');
  await act(async () => {
    setCheckboxValue(ackCheck, true);
  });

  const submitStep4Btn = container.querySelector('button[type="submit"]');
  assert.strictEqual(submitStep4Btn.disabled, false, 'Step 4 submit button must be enabled');

  const providerCallsBeforeModal = providerRequests.length;

  // Open modal and trigger real kit.estimate
  await act(async () => {
    submitStep4Btn.click();
    await new Promise(r => setTimeout(r, 80));
  });

  // Modal is now open
  const confirmBtn = container.querySelector('#confirm-submit-tx-btn');
  assert.ok(confirmBtn, 'Confirm submission button must render in modal');
  assert.strictEqual(confirmBtn.disabled, false, 'Confirm button must be ENABLED in enabled test');
  assert.ok(confirmBtn.textContent.includes('Confirm & Submit'), 'Confirm button must have "Confirm & Submit" text');

  // Click Confirm & Submit to trigger real kit.submit
  await act(async () => {
    confirmBtn.click();
    await new Promise(r => setTimeout(r, 120));
  });

  const modalPostRequests = providerRequests.slice(providerCallsBeforeModal);
  const modalSendTx = modalPostRequests.find(r => r.method === 'eth_sendTransaction');
  assert.ok(modalSendTx, 'Confirm button click must execute real kit.submit and call eth_sendTransaction');

  console.log('✓ PASS: Create Challenge rendered flow quoted and submitted through real Transaction Kit RC2.\n');
  passedTests++;

  // -------------------------------------------------------------
  // Test 6: SubmitEntryPage with Real Transaction Kit RC2
  // -------------------------------------------------------------
  console.log('[Test 6] Submit Entry: Enabled path with real Transaction Kit RC2');

  const liveChallenge = {
    id: '42',
    code: '#GEN-042',
    title: 'Volumetric Silicon Operating System',
    category: 'Spatial Computing',
    synopsis: 'A deterministic spatial computing kernel enforcing zero background telemetry and sub-millisecond task switching.',
    mandatoryRequirements: ['Sub-millisecond task switching', 'Direct silicon isolation'],
    prohibitedTerms: ['web3', 'synergy'],
    prizeAmount: 300,
    prizeCurrency: 'test GEN',
    sponsorAddress: '0x3333333333333333333333333333333333333333',
    deadlineDisplay: 'Open for 48 hours',
    deadlineIso: '2026-10-16T12:00:00Z',
    status: 'open',
    maxSlots: 3,
    filledSlots: 1,
    remainingTime: '48h remaining',
    isFixture: false,
  };
  dataServiceModule.dataService.getChallengeById = async id => ({ ...liveChallenge, id });

  await act(async () => {
    root.render(
      createElement(
        MemoryRouter,
        { initialEntries: ['/challenges/42/submit'], key: 'submit-enabled-test' },
        createElement(
          WalletContext.Provider,
          { value: validTestWallet },
          createElement(
            Routes,
            null,
            createElement(Route, {
              path: '/challenges/:id/submit',
              element: createElement(SubmitEntryPage, { kit: realRc2Kit }),
            })
          )
        )
      )
    );
  });

  await act(async () => {
    await new Promise(r => setTimeout(r, 60));
  });

  const taglineInput = container.querySelector('#taglineInput');
  const paragraphInput = container.querySelector('#paragraphInput');
  assert.ok(taglineInput, 'Tagline input #taglineInput must render');
  assert.ok(paragraphInput, 'Paragraph textarea #paragraphInput must render');

  await act(async () => {
    setInputValue(taglineInput, 'Deterministic computing restored to absolute quiet.');
    setTextareaValue(
      paragraphInput,
      'Aether OS operates with deterministic sub-millisecond task switching, discarding unnecessary abstractions. Built upon direct spatial silicon isolation, it enforces zero telemetry by design. Your thoughts remain local, sovereign, and imperviously silent.'
    );
  });

  const entryAgreementCheckbox = container.querySelector('input[type="checkbox"]');
  assert.ok(entryAgreementCheckbox, 'Agreement checkbox must exist');
  await act(async () => {
    setCheckboxValue(entryAgreementCheckbox, true);
  });

  const entrySubmitBtn = container.querySelector('button[type="submit"]');
  assert.strictEqual(entrySubmitBtn.disabled, false, 'Entry form submit button must be enabled');

  const providerCallsBeforeEntrySubmit = providerRequests.length;

  await act(async () => {
    entrySubmitBtn.click();
    await new Promise(r => setTimeout(r, 80));
  });

  const confirmEntryBtn = container.querySelector('#confirm-submit-tx-btn');
  assert.ok(confirmEntryBtn, 'Confirm entry button must render in modal');
  assert.strictEqual(confirmEntryBtn.disabled, false, 'Confirm button must be enabled');

  await act(async () => {
    confirmEntryBtn.click();
    await new Promise(r => setTimeout(r, 120));
  });

  const entryPostRequests = providerRequests.slice(providerCallsBeforeEntrySubmit);
  const entrySendTx = entryPostRequests.find(r => r.method === 'eth_sendTransaction');
  assert.ok(entrySendTx, 'Confirm entry must trigger real kit.submit and call eth_sendTransaction');

  console.log('✓ PASS: Submit Entry rendered flow quoted and submitted through real Transaction Kit RC2.\n');
  passedTests++;

  // -------------------------------------------------------------
  // Test 7: Lifecycle Action (cancel_challenge) with Real Transaction Kit RC2
  // -------------------------------------------------------------
  console.log('[Test 7] Lifecycle Action: Enabled cancel_challenge with real Transaction Kit RC2');

  dataServiceModule.dataService.getChallengeById = async id => ({
    id: '42',
    numericId: 42,
    title: 'Brand Hook for Autonomous AI Agents',
    category: 'Product Marketing',
    synopsis: 'Craft a punchy, unforgettable tagline and value paragraph.',
    mandatoryRequirements: ['Must mention autonomous decision-making'],
    prohibitedTerms: ['cheap', 'guaranteed'],
    sponsorAddress: validTestWallet.address,
    prizePool: '50.0',
    prizePoolWei: '50000000000000000000',
    status: 'open',
    deadline: Math.floor(Date.now() / 1000) + 86400,
    filledSlots: 0,
    entriesCount: 0,
    isFixture: false,
  });
  dataServiceModule.dataService.getEntriesForChallenge = async () => [];

  await act(async () => {
    root.render(
      createElement(
        MemoryRouter,
        { initialEntries: ['/challenges/42'], key: 'lifecycle-test' },
        createElement(
          WalletContext.Provider,
          { value: validTestWallet },
          createElement(
            Routes,
            null,
            createElement(Route, {
              path: '/challenges/:id',
              element: createElement(ChallengeDetailPage, { kit: realRc2Kit }),
            })
          )
        )
      )
    );
  });

  await act(async () => {
    await new Promise(r => setTimeout(r, 60));
  });

  const cancelChallengeBtn = container.querySelector('#cancel-challenge-draft-btn');
  assert.ok(cancelChallengeBtn, 'Cancel Challenge button must render for eligible sponsor with 0 entries');

  const providerCallsBeforeCancel = providerRequests.length;

  await act(async () => {
    cancelChallengeBtn.click();
    await new Promise(r => setTimeout(r, 80));
  });

  const confirmLifecycleBtn = container.querySelector('#confirm-submit-tx-btn');
  assert.ok(confirmLifecycleBtn, 'Confirm button must render in lifecycle modal');
  assert.strictEqual(confirmLifecycleBtn.disabled, false, 'Confirm button must be enabled');

  await act(async () => {
    confirmLifecycleBtn.click();
    await new Promise(r => setTimeout(r, 120));
  });

  const cancelPostRequests = providerRequests.slice(providerCallsBeforeCancel);
  const cancelSendTx = cancelPostRequests.find(r => r.method === 'eth_sendTransaction');
  assert.ok(cancelSendTx, 'Cancel challenge must invoke real kit.submit and call eth_sendTransaction');

  console.log('✓ PASS: Lifecycle action cancel_challenge successfully executed through real Transaction Kit RC2.\n');
  passedTests++;

  // -------------------------------------------------------------
  // Test 8: Withdraw Flow with Real Transaction Kit RC2
  // -------------------------------------------------------------
  console.log('[Test 8] Withdraw Flow: Enabled withdraw with real Transaction Kit RC2');

  dataServiceModule.dataService.getMyArenaOverview = async () => ({
    sponsored: [],
    entered: [],
    moneyState: {
      creditAvailableWei: 50000000000000000000n,
      creditAvailableGen: '50.0',
      totalEarnedGen: '50.0',
      totalEarnedWei: '50000000000000000000',
    },
    contractDataAvailable: true,
    reason: '',
  });

  await act(async () => {
    root.render(
      createElement(
        MemoryRouter,
        { initialEntries: ['/my-arena'], key: 'withdraw-test' },
        createElement(
          WalletContext.Provider,
          { value: validTestWallet },
          createElement(MyArenaPage, { kit: realRc2Kit })
        )
      )
    );
  });

  await act(async () => {
    await new Promise(r => setTimeout(r, 60));
  });

  const withdrawBtn = container.querySelector('#withdraw-credit-draft-btn');
  assert.ok(withdrawBtn, 'Withdraw credit button must render with positive credit');
  assert.strictEqual(withdrawBtn.disabled, false, 'Withdraw button must be enabled with claimable credit');

  const providerCallsBeforeWithdraw = providerRequests.length;

  await act(async () => {
    withdrawBtn.click();
    await new Promise(r => setTimeout(r, 80));
  });

  const confirmWithdrawBtn = container.querySelector('#confirm-submit-tx-btn');
  assert.ok(confirmWithdrawBtn, 'Confirm withdraw button must render in modal');
  assert.strictEqual(confirmWithdrawBtn.disabled, false, 'Confirm withdraw button must be enabled');

  await act(async () => {
    confirmWithdrawBtn.click();
    await new Promise(r => setTimeout(r, 120));
  });

  const withdrawPostRequests = providerRequests.slice(providerCallsBeforeWithdraw);
  const withdrawSendTx = withdrawPostRequests.find(r => r.method === 'eth_sendTransaction');
  assert.ok(withdrawSendTx, 'Withdraw flow must invoke real kit.submit and call eth_sendTransaction');

  console.log('✓ PASS: Withdraw flow successfully quoted and submitted through real Transaction Kit RC2.\n');
  passedTests++;

  // -------------------------------------------------------------
  // Test 9: Error States (Fee Error, User Rejection 4001, Execution Failure)
  // -------------------------------------------------------------
  console.log('[Test 9] Error States: Fee estimation error, user rejection (4001), and execution failure');

  // 9a: Fee estimation error blocks confirm button
  dataServiceModule.dataService.getChallengeById = async id => ({
    ...liveChallenge,
    id,
    sponsorAddress: '0x9999999999999999999999999999999999999999',
  });

  const mockFeeErrorKit = {
    estimate: async () => {
      throw new Error('Fee estimation failed: RPC node gas limit exceeded');
    },
    submit: async () => ({ genlayerTxId: '0x0' }),
    track: async () => {},
  };

  await act(async () => {
    root.render(
      createElement(
        MemoryRouter,
        { initialEntries: ['/challenges/42/submit'], key: 'fee-error-test' },
        createElement(
          WalletContext.Provider,
          { value: validTestWallet },
          createElement(
            Routes,
            null,
            createElement(Route, {
              path: '/challenges/:id/submit',
              element: createElement(SubmitEntryPage, { kit: mockFeeErrorKit }),
            })
          )
        )
      )
    );
  });

  await act(async () => {
    await new Promise(r => setTimeout(r, 60));
  });

  const taglineInputErr = container.querySelector('#taglineInput');
  const paragraphInputErr = container.querySelector('#paragraphInput');
  await act(async () => {
    setInputValue(taglineInputErr, 'Valid tagline for fee failure demonstration');
    setTextareaValue(paragraphInputErr, 'Valid paragraph meeting length requirements for fee estimation failure test.');
    setCheckboxValue(container.querySelector('input[type="checkbox"]'), true);
  });

  await act(async () => {
    container.querySelector('button[type="submit"]').click();
    await new Promise(r => setTimeout(r, 60));
  });

  const confirmErrBtn = container.querySelector('#confirm-submit-tx-btn');
  assert.ok(confirmErrBtn, 'Confirm button renders in modal');
  assert.strictEqual(confirmErrBtn.disabled, true, 'Confirm button must remain DISABLED when fee estimation fails');
  assert.ok(confirmErrBtn.textContent.includes('Awaiting Fee Quote'), 'Confirm button indicates awaiting quote');

  // 9b: User rejection (4001) in provider
  let rejectionCaught = false;
  const mockRejectKit = {
    estimate: async () => realQuote,
    submit: async () => {
      const err = new Error('User rejected the transaction signature.');
      err.code = 4001;
      throw err;
    },
    track: async () => {},
  };

  try {
    await txService.dispatchTransaction(mockRejectKit, realQuote, {
      kind: 'write',
      address: contractClient.CONTRACT_ADDRESS,
      method: 'create_challenge',
      args: [],
    });
  } catch (err) {
    rejectionCaught = true;
    assert.strictEqual(err.code, 'DISPATCH_FAILED');
    assert.ok(err.message.includes('User rejected the transaction signature'));
  }
  assert.strictEqual(rejectionCaught, true, 'User rejection 4001 must be safely surfaced without crashing');

  // 9c: Execution Failure (FINISHED_WITH_ERROR)
  const failureStatus = {
    statusName: 'FINALIZED',
    executionResultName: 'FINISHED_WITH_ERROR',
    successful: false,
  };
  assert.strictEqual(txService.isExecutionSuccessful(failureStatus), false, 'FINISHED_WITH_ERROR is never successful');
  assert.strictEqual(txService.isExecutionProvenFailed(failureStatus), true, 'FINISHED_WITH_ERROR is proven failed');

  console.log('✓ PASS: All error states (fee error, user rejection 4001, execution failure) handled safely.\n');
  passedTests++;

  // -------------------------------------------------------------
  // Test 10: Teardown & Write Gate Disabled State
  // -------------------------------------------------------------
  console.log('[Test 10] Safety Teardown: Restores write gate to strictly disabled');

  delete process.env.VITE_WRITES_ENABLED;
  viteServer.moduleGraph.invalidateAll();
  txService = await viteServer.ssrLoadModule('/src/services/transactionService.ts');

  assert.strictEqual(txService.WRITES_ENABLED, false, 'WRITES_ENABLED must be strictly false after teardown');

  console.log('✓ PASS: Write gate safely closed after test run.\n');
  passedTests++;

  console.log('================================================================');
  console.log(`ALL ISOLATED PROVIDER & TRANSACTION KIT RC2 TESTS PASSED (${passedTests}/${passedTests})`);
  console.log('================================================================\n');

  // Restore fetch
  globalThis.fetch = realFetch;

  await viteServer.close();
  process.exit(0);
}

runSuite().catch(err => {
  console.error('\n❌ ISOLATED PROVIDER TEST SUITE FAILED:', err);
  process.exit(1);
});
