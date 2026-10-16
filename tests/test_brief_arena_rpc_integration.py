import pytest
import httpx
from pathlib import Path

LOCAL_RPC_URL = "http://127.0.0.1:4000/api"

def is_local_studio_available() -> bool:
    """Checks if a local GenLayer Studio / glsim RPC node is currently running."""
    try:
        resp = httpx.post(
            LOCAL_RPC_URL,
            json={"jsonrpc": "2.0", "method": "eth_chainId", "params": [], "id": 1},
            timeout=1.0,
        )
        return resp.status_code == 200 and "result" in resp.json()
    except Exception:
        return False

@pytest.mark.integration
def test_rpc_deployment_and_payable_creation():
    """
    Live RPC Integration Test.
    Connects to local GenLayer Studio / simulator, deploys BriefArena,
    sends value to create_challenge, and verifies on-chain contract balance
    and stored challenge prize directly through the node's RPC interface.

    If local Studio is not running, this test is marked NOT RUN (skipped).
    """
    if not is_local_studio_available():
        pytest.skip(
            f"Local GenLayer Studio RPC is unavailable at {LOCAL_RPC_URL}. "
            "Integration test marked as NOT RUN."
        )

    import genlayer_py as gp

    # 1. Setup client and test account
    sponsor_account = gp.create_account(gp.generate_private_key())
    client = gp.create_client(
        chain=gp.localnet,
        account=sponsor_account,
        endpoint=LOCAL_RPC_URL,
    )

    # 2. Fund sponsor via simulator debug RPC
    fund_amount = 500 * 10**18
    fund_res = httpx.post(
        LOCAL_RPC_URL,
        json={
            "jsonrpc": "2.0",
            "method": "sim_fundAccount",
            "params": [sponsor_account.address, fund_amount],
            "id": 1,
        },
        timeout=5.0,
    )
    assert fund_res.status_code == 200

    # 3. Deploy BriefArena contract
    contract_code = Path("contracts/brief_arena.py").read_text(encoding="utf-8")
    deploy_tx = client.deploy_contract(code=contract_code)
    deploy_receipt = client.wait_for_transaction_receipt(deploy_tx)
    contract_address = deploy_receipt.contract_address

    # 4. Verify initial contract balance is 0
    initial_contract_balance = client.get_balance(contract_address)
    assert initial_contract_balance == 0

    # 5. Call payable create_challenge with attached GEN
    prize_amount = 50 * 10**18
    create_tx = client.write_contract(
        address=contract_address,
        function_name="create_challenge",
        args=[
            "RPC Integration Brief",
            "Infrastructure",
            "A comprehensive brief deployed to local GenLayer Studio for on-chain testing.",
            ["Mandatory requirement 1", "Mandatory requirement 2"],
            ["prohibited1", "prohibited2"],
            86400,
        ],
        value=prize_amount,
    )
    create_receipt = client.wait_for_transaction_receipt(create_tx)
    assert create_receipt.status == 1

    # 6. Read back on-chain contract balance via RPC (proves attached GEN arrived)
    post_contract_balance = client.get_balance(contract_address)
    assert post_contract_balance == prize_amount

    # 7. Read back stored challenge prize via RPC read_contract
    cid = 1
    challenge_data = client.read_contract(
        address=contract_address,
        function_name="get_challenge",
        args=[cid],
    )
    assert challenge_data["prizeAmount"] == prize_amount
