import pytest
import sys
import datetime as dt

# Set up WASI mock for native GenLayer SDK testing
from genvm_linter.validate.sdk_loader import setup_wasi_mocks
setup_wasi_mocks()

sys.path.insert(0, r"C:\Users\samir\.cache\genvm-linter\extracted\genlayerlabs-genvm-manager-v0.6.0-rc9\py-lib-genlayer-std\z7fv8bqpetj3wnjd8sn5s5xfqve3rz8nmtq4npwf2qdvns57zjgg")
sys.path.insert(0, r"d:\BriefArena")

import genlayer as gl
from genlayer.storage import inmem_allocate
from genlayer.types import Address, u256
from contracts.brief_arena import BriefArena, ChallengeStatus, EntryStatus
from gltest.direct.loader import _make_contract_proxy

# Test Addresses
SPONSOR = Address("0x1111111111111111111111111111111111111111")
AUTHOR_1 = Address("0x2222222222222222222222222222222222222222")
AUTHOR_2 = Address("0x3333333333333333333333333333333333333333")
CONTRACT_ADDR = Address("0x9999999999999999999999999999999999999999")

T0_STR = "2026-10-13T00:00:00Z"

class SimulatedRecipient:
    emitted_transfers: list[tuple[Address, int]] = []

    def __init__(self, target: Address):
        self.target = target

    def emit_transfer(self, *, value: u256) -> None:
        amt = value.as_int if hasattr(value, "as_int") else int(value)
        SimulatedRecipient.emitted_transfers.append((self.target, amt))

class InMemorySimulationHarness:
    """
    In-memory simulation with calldata proxying and simulated balance accounting.

    IMPORTANT NOTICE:
    This is an in-memory Python simulation harness, NOT a GenLayer network transfer,
    RPC integration, or GenVM execution proof. Its custom balance dictionary models
    local accounting assumptions to test contract logic prior to full live deployment.
    """
    def __init__(self):
        self.contract_instance = inmem_allocate(BriefArena)
        self.contract_instance.__init__()
        self.proxy = _make_contract_proxy(self.contract_instance)
        
        self.balances: dict[Address, int] = {
            SPONSOR: 1000 * 10**18,
            AUTHOR_1: 100 * 10**18,
            AUTHOR_2: 100 * 10**18,
            CONTRACT_ADDR: 0,
        }
        self.current_time = T0_STR

    def warp(self, iso_time: str) -> None:
        self.current_time = iso_time

    def send_transaction(self, sender: Address, method_name: str, *args, value: int = 0):
        # 1. Enforce local simulated sender balance
        assert self.balances[sender] >= value, f"Sender {sender} insufficient simulated balance for {value}"
        
        # 2. Local simulated state transition: transfer simulated GEN
        self.balances[sender] -= value
        self.balances[CONTRACT_ADDR] += value
        
        # 3. Supply context using real runner API gl.message.raw['datetime']
        gl.message.sender_address = sender
        gl.message.value = u256(value)
        gl.message.raw = {"datetime": self.current_time}
        gl.message.datetime = self.current_time
        if hasattr(gl, "message_raw"):
            delattr(gl, "message_raw")
        
        # 4. Dispatch through calldata proxy (enforces calldata serialization)
        method = getattr(self.proxy, method_name)
        result = method(*args)

        # 5. Handle simulated withdrawal transfer
        if method_name == "withdraw":
            assert len(SimulatedRecipient.emitted_transfers) > 0, "No transfer emitted during withdraw"
            recip, amt = SimulatedRecipient.emitted_transfers[-1]
            assert recip == sender, f"Emitted recipient {recip} != sender {sender}"
            assert self.balances[CONTRACT_ADDR] >= amt, "Insufficient contract balance for withdrawal"
            self.balances[CONTRACT_ADDR] -= amt
            self.balances[sender] += amt

        return result

    def get_balance(self, addr: Address) -> int:
        return self.balances.get(addr, 0)


@pytest.fixture
def sim(monkeypatch):
    import contracts.brief_arena
    SimulatedRecipient.emitted_transfers.clear()
    monkeypatch.setattr(contracts.brief_arena, "_Recipient", SimulatedRecipient)
    harness = InMemorySimulationHarness()
    yield harness
    SimulatedRecipient.emitted_transfers.clear()


# ==============================================================================
# In-Memory Simulation Tests (Calldata Proxy & Accounting Checks)
# ==============================================================================

def test_simulated_payable_creation_balance_tracking(sim):
    """
    In-memory simulation test:
    Simulates sender balance deduction, contract balance increment,
    and verifies create_challenge reads gl.message.value and locks escrow.
    """
    prize_amount = 50 * 10**18
    sponsor_pre_balance = sim.get_balance(SPONSOR)
    contract_pre_balance = sim.get_balance(CONTRACT_ADDR)
    assert contract_pre_balance == 0
    
    cid = sim.send_transaction(
        SPONSOR,
        "create_challenge",
        "Editorial Copywriting Challenge",
        "Brand Strategy",
        "A rigorous brief demanding razor-sharp tagline and concise launch paragraph.",
        ["Maximum clarity", "Punchy delivery"],
        ["synergy", "game-changer"],
        u256(86400),
        value=prize_amount,
    )
    assert cid == u256(1)
    
    # Verify simulated balances
    assert sim.get_balance(SPONSOR) == sponsor_pre_balance - prize_amount
    assert sim.get_balance(CONTRACT_ADDR) == contract_pre_balance + prize_amount
    
    # Verify contract state
    ch = sim.proxy.get_challenge(cid)
    assert ch.prizeAmount == u256(prize_amount)
    assert ch.sponsorAddress == SPONSOR
    assert ch.status == ChallengeStatus.OPEN
    assert ch.filledSlots == u256(0)
    
    # Verify simulated solvency invariant
    assert sim.proxy.get_total_locked_escrow() == u256(prize_amount)
    assert sim.proxy.get_credit(SPONSOR) == u256(0)
    assert sim.get_balance(CONTRACT_ADDR) >= int(sim.proxy.get_total_locked_escrow()) + int(sim.proxy.get_credit(SPONSOR))


def test_simulated_submission_and_deadline_closure(sim):
    """
    In-memory simulation test:
    Tests submission through calldata proxy, deadline boundary enforcement,
    and permissionless closure after deadline.
    """
    prize_amount = 25 * 10**18
    cid = sim.send_transaction(
        SPONSOR,
        "create_challenge",
        "Launch Headline Sprint",
        "Product Marketing",
        "Creating an unforgettable tagline and descriptive launch paragraph for DevTools.",
        ["Developer first", "Zero setup"],
        ["revolutionize"],
        u256(86400),
        value=prize_amount,
    )
    
    # Author submits 1 entry at T0 + 1000s
    sim.warp("2026-10-13T00:16:40Z")
    sim.send_transaction(
        AUTHOR_1,
        "submit_entry",
        cid,
        "Code with clarity, ship with pride.",
        "A developer platform built from the ground up for resilient and deterministic testing.",
        value=0,
    )
    
    ch = sim.proxy.get_challenge(cid)
    assert ch.filledSlots == u256(1)
    assert ch.status == ChallengeStatus.OPEN
    
    # Warp past deadline
    sim.warp("2026-10-14T01:00:00Z")
    
    # Submissions past deadline must fail
    with pytest.raises(Exception, match="DEADLINE_PASSED"):
        sim.send_transaction(
            AUTHOR_2,
            "submit_entry",
            cid,
            "Late submission attempt.",
            "This paragraph arrives after the brief deadline has expired.",
            value=0,
        )
        
    # Permissionless close_deadline succeeds
    sim.send_transaction(AUTHOR_2, "close_deadline", cid, value=0)
    ch_after = sim.proxy.get_challenge(cid)
    assert ch_after.status == ChallengeStatus.CLOSED


def test_simulated_zero_entry_expiry_credit_allocation(sim):
    """
    In-memory simulation test:
    Tests zero-entry expiry refunding to sponsor credit and verifies
    simulated solvency invariant.
    """
    prize_1 = 30 * 10**18
    prize_2 = 40 * 10**18
    
    # Challenge 1: Active brief with 1 entry
    cid_1 = sim.send_transaction(
        SPONSOR,
        "create_challenge",
        "Active Challenge Brief",
        "Infrastructure",
        "Active brief description with more than forty characters of technical specifications.",
        ["Requirement 1", "Requirement 2"],
        ["buzzword"],
        u256(86400),
        value=prize_1,
    )
    sim.send_transaction(
        AUTHOR_1,
        "submit_entry",
        cid_1,
        "First qualifying entry",
        "This is thirty characters long or more for the launch paragraph requirement.",
        value=0,
    )
    
    # Challenge 2: Expiring brief with zero entries
    cid_2 = sim.send_transaction(
        SPONSOR,
        "create_challenge",
        "Zero Entry Expiring Brief",
        "Design Systems",
        "Another editorial brief with zero submissions that reaches its deadline.",
        ["Requirement Alpha"],
        ["forbidden"],
        u256(86400),
        value=prize_2,
    )
    
    total_deposited = prize_1 + prize_2
    assert sim.get_balance(CONTRACT_ADDR) == total_deposited
    
    # Warp past deadline
    sim.warp("2026-10-14T02:00:00Z")
    
    # Expire zero entries for Challenge 2
    sim.send_transaction(AUTHOR_2, "expire_zero_entries", cid_2, value=0)
    
    ch_2 = sim.proxy.get_challenge(cid_2)
    assert ch_2.status == ChallengeStatus.NO_WINNER
    assert sim.proxy.get_total_locked_escrow() == u256(prize_1)
    assert sim.proxy.get_credit(SPONSOR) == u256(prize_2)
    dec_2 = sim.proxy.get_decision(cid_2)
    assert dec_2.outcome == "no-winner"
    assert dec_2.resolutionKind == "ZERO_ENTRIES"
    
    # Solvency invariant check
    total_liabilities = int(sim.proxy.get_total_locked_escrow()) + int(sim.proxy.get_credit(SPONSOR))
    assert sim.get_balance(CONTRACT_ADDR) == total_liabilities


def test_simulated_commit_judging_and_timeout_lifecycle(sim):
    """
    In-memory simulation test for Phase 2A:
    Tests commit_judging transition, 48h timeout rejection,
    successful timeout resolution, and brief/entry immutability.
    """
    prize = 50 * 10**18
    cid = sim.send_transaction(
        SPONSOR,
        "create_challenge",
        "Deliberation Timeout Lifecycle Brief",
        "Infrastructure",
        "A rigorous brief testing commit_judging and timeout_judgement lifecycle.",
        ["Tenet 1", "Tenet 2"],
        ["taboo"],
        u256(86400),
        value=prize,
    )
    sim.send_transaction(
        AUTHOR_1,
        "submit_entry",
        cid,
        "Top tier tagline",
        "A paragraph that satisfies the minimum thirty character requirement.",
        value=0,
    )
    
    # Warp past deadline and close
    sim.warp("2026-10-14T01:00:00Z")
    sim.send_transaction(AUTHOR_2, "close_deadline", cid, value=0)
    assert sim.proxy.get_challenge(cid).status == ChallengeStatus.CLOSED
    
    # Snapshot before commit_judging
    ch_pre = sim.proxy.get_challenge(cid)
    entries_pre = sim.proxy.get_entries(cid)
    
    # Commit judging at T_commit = 2026-10-14T02:00:00Z
    sim.warp("2026-10-14T02:00:00Z")
    sim.send_transaction(AUTHOR_2, "commit_judging", cid, value=0)
    
    ch_judging = sim.proxy.get_challenge(cid)
    assert ch_judging.status == ChallengeStatus.JUDGING
    assert ch_judging.judgingStartedAt > u256(0)
    
    # Reject timeout at 47 hours (T_commit + 169200s)
    sim.warp("2026-10-16T01:00:00Z")
    with pytest.raises(Exception, match="TIMEOUT_NOT_EXPIRED"):
        sim.send_transaction(AUTHOR_2, "timeout_judgement", cid, value=0)
        
    # Timeout succeeds at 48 hours (T_commit + 172800s)
    sim.warp("2026-10-16T02:00:00Z")
    sim.send_transaction(AUTHOR_2, "timeout_judgement", cid, value=0)
    
    ch_timeout = sim.proxy.get_challenge(cid)
    assert ch_timeout.status == ChallengeStatus.NO_WINNER
    assert sim.proxy.get_total_locked_escrow() == u256(0)
    assert sim.proxy.get_credit(SPONSOR) == u256(prize)
    dec_timeout = sim.proxy.get_decision(cid)
    assert dec_timeout.outcome == "no-winner"
    assert dec_timeout.resolutionKind == "JUDGING_TIMEOUT"
    
    # Verify brief metadata and entry text immutability
    assert ch_timeout.title == ch_pre.title
    assert ch_timeout.synopsis == ch_pre.synopsis
    assert ch_timeout.prizeAmount == ch_pre.prizeAmount
    assert ch_timeout.sponsorAddress == ch_pre.sponsorAddress
    entries_post = sim.proxy.get_entries(cid)
    assert len(entries_post) == len(entries_pre)
    assert entries_post[0].tagline == entries_pre[0].tagline
    assert entries_post[0].paragraph == entries_pre[0].paragraph


def test_simulated_attempt_judgement_and_decision_record(sim, monkeypatch):
    """
    In-memory simulation test:
    Executes complete Phase 2B comparative judging flow through simulated dispatch:
    create -> submit entries -> close -> commit judging -> attempt_judgement -> decision record.
    """
    prize = 60 * 10**18
    cid = sim.send_transaction(
        SPONSOR,
        "create_challenge",
        "Editorial Copywriting Contest",
        "Brand Strategy",
        "Brief testing comparative deliberation and on-chain decision records in simulation.",
        ["Mandatory Tenet 1", "Mandatory Tenet 2"],
        ["tabooword"],
        u256(86400),
        value=prize,
    )

    sim.send_transaction(
        AUTHOR_1,
        "submit_entry",
        cid,
        "Elegance and Clarity",
        "A compelling launch paragraph satisfying all brand guidelines with excellence.",
        value=0,
    )
    sim.send_transaction(
        AUTHOR_2,
        "submit_entry",
        cid,
        "Speed and Precision",
        "Another strong paragraph fulfilling the minimum thirty character requirement.",
        value=0,
    )

    sim.warp("2026-10-14T01:00:00Z")
    sim.send_transaction(AUTHOR_1, "close_deadline", cid, value=0)
    sim.send_transaction(AUTHOR_1, "commit_judging", cid, value=0)

    # Mock nondet consensus execution
    def mock_run_nondet(leader_fn, validator_fn):
        res = leader_fn()
        valid = validator_fn(gl.vm.Return(res))
        assert valid, "Validator rejected verdict"
        return res

    monkeypatch.setattr(gl.vm, "run_nondet", mock_run_nondet)

    def mock_exec_prompt(prompt, response_format="json"):
        if "independent consensus validator" in prompt:
            return {
                "independent_outcome": "winner",
                "independent_winner_entry_number": 1,
                "is_agreed": True,
                "validator_reason": "Verified against frozen rubric."
            }
        else:
            return {
                "outcome": "winner",
                "winner_entry_number": 1,
                "entry_reviews": [
                    {"entry_number": 1, "status": "QUALIFYING", "defect_reason": ""},
                    {"entry_number": 2, "status": "QUALIFYING", "defect_reason": ""}
                ],
                "overall_reason": "Entry 1 exhibited superior punchiness and voice under fixed rubric."
            }

    monkeypatch.setattr(gl.nondet, "exec_prompt", mock_exec_prompt)

    sim.warp("2026-10-14T02:00:00Z")
    sim.send_transaction(AUTHOR_2, "attempt_judgement", cid, value=0)

    ch = sim.proxy.get_challenge(cid)
    assert ch.status == ChallengeStatus.AWARDED
    assert sim.proxy.get_total_locked_escrow() == u256(0)
    assert sim.proxy.get_credit(AUTHOR_1) == u256(prize)
    assert sim.proxy.get_credit(SPONSOR) == u256(0)

    dec = sim.proxy.get_decision(cid)
    assert dec.outcome == "winner"
    assert dec.resolutionKind == "CONSENSUS"
    assert dec.winnerAddress == AUTHOR_1
    assert dec.winningEntryNumber == u256(1)
    assert dec.winningTagline == "Elegance and Clarity"
    assert len(dec.transparencyLog) == 2
    assert dec.transparencyLog[0].status == EntryStatus.WINNER
    assert dec.transparencyLog[1].status == EntryStatus.QUALIFYING


def test_simulated_withdrawal_lifecycle(sim, monkeypatch):
    """
    In-memory simulation test:
    Validates complete simulated withdrawal flow:
    1. Sponsor funds challenge (50 GEN).
    2. Entrant submits, challenge closes, judging commits, attempt_judgement awards prize.
    3. Verifies post-settlement state: locked escrow = 0, claimable credits = 50, contract balance = 50.
    4. Winner calls withdraw():
       - Credit cleared to 0.
       - totalClaimableCredits decremented to 0.
       - get_withdrawn(winner) updated to 50 GEN.
       - Simulated balance transferred: Contract balance drops to 0, Winner balance increases by 50 GEN.
    5. Second withdrawal attempt reverts with NO_CREDIT_AVAILABLE.
    6. Verifies solvency invariant holds: contract balance >= locked escrow + claimable credits.
    """
    prize = 50 * 10**18
    winner_initial_balance = sim.get_balance(AUTHOR_1)

    cid = sim.send_transaction(
        SPONSOR,
        "create_challenge",
        "Creative Payout Challenge",
        "Brand Strategy",
        "Brief designed to test end-to-end simulated pull-payment withdrawal and balance tracking.",
        ["Mandatory Tenet"],
        ["taboo"],
        u256(86400),
        value=prize,
    )

    sim.send_transaction(
        AUTHOR_1,
        "submit_entry",
        cid,
        "Simulated Excellence",
        "A compelling launch paragraph satisfying all brand guidelines with excellence.",
        value=0,
    )

    sim.warp("2026-10-14T01:00:00Z")
    sim.send_transaction(AUTHOR_1, "close_deadline", cid, value=0)
    sim.send_transaction(AUTHOR_1, "commit_judging", cid, value=0)

    # Mock consensus execution
    monkeypatch.setattr(gl.vm, "run_nondet", lambda leader_fn, validator_fn: leader_fn())
    monkeypatch.setattr(
        gl.nondet,
        "exec_prompt",
        lambda prompt, response_format="json": {
            "outcome": "winner",
            "winner_entry_number": 1,
            "entry_reviews": [{"entry_number": 1, "status": "QUALIFYING", "defect_reason": ""}],
            "overall_reason": "Clear winner.",
        },
    )

    sim.warp("2026-10-14T02:00:00Z")
    sim.send_transaction(AUTHOR_1, "attempt_judgement", cid, value=0)

    # Pre-withdrawal checks
    assert sim.proxy.get_total_locked_escrow() == u256(0)
    assert sim.proxy.get_total_claimable_credits() == u256(prize)
    assert sim.proxy.get_credit(AUTHOR_1) == u256(prize)
    assert sim.get_balance(CONTRACT_ADDR) == prize
    assert sim.get_balance(AUTHOR_1) == winner_initial_balance

    # Solvency invariant check before withdrawal
    assert sim.get_balance(CONTRACT_ADDR) >= int(sim.proxy.get_total_locked_escrow()) + int(sim.proxy.get_total_claimable_credits())

    # Execute withdrawal
    sim.send_transaction(AUTHOR_1, "withdraw", value=0)

    # Post-withdrawal state checks
    assert sim.proxy.get_credit(AUTHOR_1) == u256(0)
    assert sim.proxy.get_total_claimable_credits() == u256(0)
    assert sim.proxy.get_withdrawn(AUTHOR_1) == u256(prize)
    assert sim.get_balance(CONTRACT_ADDR) == 0
    assert sim.get_balance(AUTHOR_1) == winner_initial_balance + prize

    # Solvency invariant check after withdrawal
    assert sim.get_balance(CONTRACT_ADDR) >= int(sim.proxy.get_total_locked_escrow()) + int(sim.proxy.get_total_claimable_credits())

    # Repeated withdrawal rejected
    with pytest.raises(Exception, match="NO_CREDIT_AVAILABLE"):
        sim.send_transaction(AUTHOR_1, "withdraw", value=0)

