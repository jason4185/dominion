import os

import pytest

gltest = pytest.importorskip("gltest")
from gltest import get_contract_factory
from gltest.assertions import tx_execution_succeeded


RUN_INTEGRATION = os.getenv("DOMINION_RUN_INTEGRATION") == "1"
ONE_GEN = 10**18


@pytest.mark.integration
@pytest.mark.skipif(not RUN_INTEGRATION, reason="integration deployment is opt-in")
def test_deploy_and_read_dominion_v1():
    contract = get_contract_factory("Dominion").deploy(args=[])
    assert contract.categories().call() == ["BIG TECH", "AI & GROWTH", "CRYPTO & FINTECH"]
    assert contract.category_assets(args=["AI & GROWTH"]).call() == ["NVDA", "PLTR", "TSLA"]


@pytest.mark.integration
@pytest.mark.skipif(
    not RUN_INTEGRATION or not os.getenv("DOMINION_INTEGRATION_START"),
    reason="set DOMINION_RUN_INTEGRATION=1 and DOMINION_INTEGRATION_START for live consensus",
)
def test_expired_market_reaches_terminal_consensus_state():
    start = int(os.environ["DOMINION_INTEGRATION_START"])
    contract = get_contract_factory("Dominion").deploy(args=[])
    create_receipt = contract.create_market(args=["BIG TECH", start]).transact()
    assert tx_execution_succeeded(create_receipt)
    settle_receipt = contract.settle_market(args=[1]).transact()
    assert tx_execution_succeeded(settle_receipt)
    assert contract.get_market(args=[1]).call()["state"] in ("SETTLED", "INCONCLUSIVE")


@pytest.mark.integration
@pytest.mark.skipif(
    not RUN_INTEGRATION or not os.getenv("DOMINION_BETTING_START"),
    reason="set DOMINION_RUN_INTEGRATION=1 and DOMINION_BETTING_START for live payable smoke test",
)
def test_future_market_accepts_native_gen_bet():
    start = int(os.environ["DOMINION_BETTING_START"])
    contract = get_contract_factory("Dominion").deploy(args=[])
    create_receipt = contract.create_market(args=["BIG TECH", start]).transact()
    assert tx_execution_succeeded(create_receipt)
    bet_receipt = contract.place_bet(args=[1, "AAPL"]).transact(value=ONE_GEN)
    assert tx_execution_succeeded(bet_receipt)
    state = contract.get_betting_state(args=[1]).call()
    assert state["total_market_pool"] == ONE_GEN
    assert state["outcome_stakes"]["AAPL"] == ONE_GEN
