import pytest

from conftest import (
    AI_GROWTH,
    BIG_TECH,
    CONTRACT,
    END,
    START,
    START_SECONDS,
    deploy_market,
    prices_for_votes,
    set_value,
    install_candles,
)


ONE_GEN = 10**18
MAX_U256 = 2**256 - 1


def addr(raw):
    from genlayer import Address

    return Address(raw)


def bet(direct_vm, contract, market_id, asset, amount, sender):
    direct_vm.sender = sender
    set_value(direct_vm, amount)
    contract.place_bet(market_id, asset)
    set_value(direct_vm, 0)


def settle(direct_vm, contract, market_id, winners=("AAPL", "AAPL", "AAPL")):
    install_candles(direct_vm, BIG_TECH, prices_for_votes(BIG_TECH, winners))
    direct_vm.warp(END)
    return contract.settle_market(market_id)


def recipient_hook(direct_vm, contract, market_id):
    transfers = []

    def hook(_vm, request):
        message = request.get("EthSend") or request.get("PostMessage")
        transfers.append(message)
        return {"ok": None}

    direct_vm._gl_call_hook = hook
    return transfers


def test_permissionless_non_creator_settlement_cannot_choose_winner(
    direct_vm, direct_deploy, direct_bob
):
    contract, market_id = deploy_market(direct_vm, direct_deploy)
    install_candles(direct_vm, BIG_TECH, prices_for_votes(BIG_TECH, ("META", "META", "AAPL")))
    direct_vm.warp(END)
    direct_vm.sender = direct_bob
    assert contract.settle_market(market_id) == "SETTLED"
    assert contract.get_market(market_id)["winner"] == "META"


def test_rejected_bet_has_no_position_index_or_activity_side_effect(
    direct_vm, direct_deploy, direct_alice
):
    contract, market_id = deploy_market(direct_vm, direct_deploy)
    direct_vm.sender = direct_alice
    set_value(direct_vm, ONE_GEN - 1)
    with direct_vm.expect_revert("minimum bet"):
        contract.place_bet(market_id, "AAPL")
    set_value(direct_vm, 0)
    user = addr(direct_alice)
    assert contract.get_user_positions(user, 0, 50) == []
    assert contract.get_user_activity_count(user) == 0
    assert contract.get_betting_state(market_id)["total_market_pool"] == 0


def test_pool_is_exact_sum_of_outcome_pools_and_same_side_topups_do_not_duplicate_index(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract, market_id = deploy_market(direct_vm, direct_deploy)
    bet(direct_vm, contract, market_id, "AAPL", ONE_GEN, direct_alice)
    bet(direct_vm, contract, market_id, "AAPL", 2 * ONE_GEN, direct_alice)
    bet(direct_vm, contract, market_id, "META", 3 * ONE_GEN, direct_bob)
    state = contract.get_betting_state(market_id)
    assert state["total_market_pool"] == sum(state["outcome_stakes"].values()) == 6 * ONE_GEN
    alice_positions = contract.get_user_positions(addr(direct_alice), 0, 50)
    assert len(alice_positions) == 1
    assert alice_positions[0]["total_stake"] == 3 * ONE_GEN
    assert contract.get_user_activity_count(addr(direct_alice)) == 2


def test_wallet_cannot_claim_or_refund_another_wallet_position(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract, market_id = deploy_market(direct_vm, direct_deploy)
    bet(direct_vm, contract, market_id, "AAPL", ONE_GEN, direct_alice)
    settle(direct_vm, contract, market_id)
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("not a winning bettor"):
        contract.claim(market_id)

    second = contract
    second_id = second.create_market(BIG_TECH, START_SECONDS + 2 * 3600)
    bet(direct_vm, second, second_id, "AAPL", ONE_GEN, direct_alice)
    install_candles(direct_vm, BIG_TECH, prices_for_votes(BIG_TECH, ("AAPL", "META", "GOOGL")))
    direct_vm.warp("2025-01-01T13:00:00Z")
    assert second.settle_market(second_id) == "INCONCLUSIVE"
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("no bettor stake"):
        second.claim_refund(second_id)


def test_claim_has_no_arbitrary_recipient_argument(direct_vm, direct_deploy):
    contract, market_id = deploy_market(direct_vm, direct_deploy)
    with pytest.raises(TypeError):
        contract.claim(market_id, addr(b"\x01" * 20))


def test_crown_final_claim_distributes_full_pool_without_dust(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract, market_id = deploy_market(direct_vm, direct_deploy)
    bet(direct_vm, contract, market_id, "AAPL", ONE_GEN, direct_alice)
    bet(direct_vm, contract, market_id, "AAPL", ONE_GEN, direct_bob)
    bet(direct_vm, contract, market_id, "META", ONE_GEN, direct_charlie)
    assert settle(direct_vm, contract, market_id) == "SETTLED"
    transfers = recipient_hook(direct_vm, contract, market_id)
    with direct_vm.prank(direct_alice):
        contract.claim(market_id)
    with direct_vm.prank(direct_bob):
        contract.claim(market_id)
    first = (3 * ONE_GEN) // 2
    assert transfers[0]["value"] == first
    assert transfers[1]["value"] == 3 * ONE_GEN - first
    market = contract.get_market(market_id)
    assert market["claimed_pool"] == market["total_pool"] == 3 * ONE_GEN
    assert market["remaining_pool"] == 0


def test_claim_order_changes_only_final_dust_recipient_not_total(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract, market_id = deploy_market(direct_vm, direct_deploy)
    bet(direct_vm, contract, market_id, "AAPL", ONE_GEN, direct_alice)
    bet(direct_vm, contract, market_id, "AAPL", 2 * ONE_GEN, direct_bob)
    bet(direct_vm, contract, market_id, "META", ONE_GEN, direct_charlie)
    settle(direct_vm, contract, market_id)
    snapshot = direct_vm.snapshot()
    transfers = recipient_hook(direct_vm, contract, market_id)
    with direct_vm.prank(direct_alice):
        contract.claim(market_id)
    with direct_vm.prank(direct_bob):
        contract.claim(market_id)
    first_order = [item["value"] for item in transfers]
    direct_vm.revert(snapshot)
    transfers.clear()
    with direct_vm.prank(direct_bob):
        contract.claim(market_id)
    with direct_vm.prank(direct_alice):
        contract.claim(market_id)
    second_order = [item["value"] for item in transfers]
    assert sum(first_order) == sum(second_order) == 4 * ONE_GEN
    assert first_order[0] == (4 * ONE_GEN) // 3
    assert second_order[0] == (2 * 4 * ONE_GEN) // 3
    assert first_order[1] == 4 * ONE_GEN - first_order[0]
    assert second_order[1] == 4 * ONE_GEN - second_order[0]
    assert first_order != list(reversed(second_order))
    assert contract.get_market(market_id)["claimed_pool"] == 4 * ONE_GEN


def test_large_payout_uses_safe_mul_div_and_final_claim_clears_max_pool(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract, market_id = deploy_market(direct_vm, direct_deploy)
    bet(direct_vm, contract, market_id, "AAPL", ONE_GEN, direct_alice)
    bet(direct_vm, contract, market_id, "AAPL", ONE_GEN, direct_bob)
    bet(direct_vm, contract, market_id, "META", MAX_U256 - 2 * ONE_GEN, direct_charlie)
    assert settle(direct_vm, contract, market_id) == "SETTLED"
    transfers = recipient_hook(direct_vm, contract, market_id)
    with direct_vm.prank(direct_alice):
        contract.claim(market_id)
    with direct_vm.prank(direct_bob):
        contract.claim(market_id)
    assert transfers[0]["value"] == MAX_U256 // 2
    assert transfers[0]["value"] + transfers[1]["value"] == MAX_U256
    assert contract.get_market(market_id)["claimed_pool"] == MAX_U256


def test_pool_addition_overflow_reverts_before_any_write(
    direct_vm, direct_deploy, direct_alice
):
    contract, market_id = deploy_market(direct_vm, direct_deploy)
    bet(direct_vm, contract, market_id, "AAPL", MAX_U256, direct_alice)
    set_value(direct_vm, ONE_GEN)
    with direct_vm.expect_revert("u256 addition overflow"):
        contract.place_bet(market_id, "AAPL")
    set_value(direct_vm, 0)
    position = contract.get_user_position(market_id, addr(direct_alice))
    assert position["total_stake"] == MAX_U256
    assert contract.get_user_activity_count(addr(direct_alice)) == 1
    assert contract.get_market(market_id)["total_pool"] == MAX_U256


def test_zero_stake_winner_refunds_full_pool_and_does_not_redirect_payout(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract, market_id = deploy_market(direct_vm, direct_deploy)
    bet(direct_vm, contract, market_id, "AAPL", ONE_GEN, direct_alice)
    bet(direct_vm, contract, market_id, "META", 2 * ONE_GEN, direct_bob)
    assert settle(direct_vm, contract, market_id, ("GOOGL", "GOOGL", "GOOGL")) == "INCONCLUSIVE"
    transfers = recipient_hook(direct_vm, contract, market_id)
    with direct_vm.prank(direct_alice):
        contract.claim_refund(market_id)
    with direct_vm.prank(direct_bob):
        contract.claim_refund(market_id)
    assert [item["value"] for item in transfers] == [ONE_GEN, 2 * ONE_GEN]
    market = contract.get_market(market_id)
    assert market["winner"] == "GOOGL"
    assert market["refunded_pool"] == market["total_pool"] == 3 * ONE_GEN
    with direct_vm.prank(direct_alice):
        with direct_vm.expect_revert("market is not settled"):
            contract.claim(market_id)


def test_deadline_fallback_is_permissionless_and_does_not_need_external_sources(
    direct_vm, direct_deploy, direct_alice
):
    contract, market_id = deploy_market(direct_vm, direct_deploy)
    bet(direct_vm, contract, market_id, "AAPL", ONE_GEN, direct_alice)
    direct_vm._strict_mock_mode = True
    direct_vm.warp("2025-01-01T17:00:00Z")
    assert contract.settle_market(market_id) == "INCONCLUSIVE"
    assert contract.get_market(market_id)["state"] == "INCONCLUSIVE"
    direct_vm._strict_mock_mode = False


def test_read_model_config_lookup_and_bounded_market_pages(direct_vm, direct_deploy):
    contract, first_id = deploy_market(direct_vm, direct_deploy)
    second_id = contract.create_market(BIG_TECH, START_SECONDS + 3600)
    config = contract.get_config()
    assert config["minimum_bet"] == ONE_GEN
    assert config["fee_bps"] == 0
    assert config["sources"] == ["BINANCE", "BITGET", "GATE"]
    assert config["settlement_retry_window_seconds"] == 21600
    assert contract.get_market_by_category_start(BIG_TECH, START_SECONDS)["id"] == first_id
    assert [market["id"] for market in contract.get_markets(0, 50)] == [first_id, second_id]
    assert contract.get_markets(2, 50) == []
    with pytest.raises(Exception, match="page limit exceeded"):
        contract.get_markets(0, 51)


def test_open_market_page_filters_by_deterministic_current_time(direct_vm, direct_deploy):
    contract, first_id = deploy_market(direct_vm, direct_deploy)
    second_id = contract.create_market(BIG_TECH, START_SECONDS + 3600)
    direct_vm.warp(START)
    open_markets = contract.get_open_markets(0, 50)
    assert [market["id"] for market in open_markets] == [second_id]
    assert contract.get_market(first_id)["betting_open"] is False


def test_user_market_index_spans_markets_and_pages_are_bounded(
    direct_vm, direct_deploy, direct_alice
):
    contract, first_id = deploy_market(direct_vm, direct_deploy)
    second_id = contract.create_market("AI & GROWTH", START_SECONDS)
    bet(direct_vm, contract, first_id, "AAPL", ONE_GEN, direct_alice)
    bet(direct_vm, contract, second_id, "NVDA", ONE_GEN, direct_alice)
    user = addr(direct_alice)
    assert [item["market_id"] for item in contract.get_user_positions(user, 0, 50)] == [first_id, second_id]
    assert [item["market_id"] for item in contract.get_user_positions(user, 1, 1)] == [second_id]
    assert contract.get_user_positions(user, 2, 50) == []
    with pytest.raises(Exception, match="page limit exceeded"):
        contract.get_user_positions(user, 0, 51)


def test_user_position_and_claimable_reads_follow_terminal_state(
    direct_vm, direct_deploy, direct_alice
):
    contract, market_id = deploy_market(direct_vm, direct_deploy)
    user = addr(direct_alice)
    assert contract.get_user_position(market_id, user)["has_position"] is False
    bet(direct_vm, contract, market_id, "AAPL", ONE_GEN, direct_alice)
    position = contract.get_user_position(market_id, user)
    assert position["can_top_up"] is True
    assert position["selected_asset"] == "AAPL"
    assert contract.get_claimable_markets(user, 0, 50) == []
    settle(direct_vm, contract, market_id)
    claimable = contract.get_claimable_markets(user, 0, 50)
    assert claimable[0]["claim_type"] == "WINNINGS"
    assert claimable[0]["claimable_amount"] == ONE_GEN
    transfers = recipient_hook(direct_vm, contract, market_id)
    with direct_vm.prank(direct_alice):
        contract.claim(market_id)
    assert transfers[0]["value"] == ONE_GEN
    assert contract.get_claimable_markets(user, 0, 50) == []


def test_claim_has_no_expiry_after_terminal_settlement(
    direct_vm, direct_deploy, direct_alice
):
    contract, market_id = deploy_market(direct_vm, direct_deploy)
    bet(direct_vm, contract, market_id, "AAPL", ONE_GEN, direct_alice)
    settle(direct_vm, contract, market_id)
    direct_vm.warp("2026-01-01T00:00:00Z")
    transfers = recipient_hook(direct_vm, contract, market_id)
    with direct_vm.prank(direct_alice):
        contract.claim(market_id)
    assert transfers[0]["value"] == ONE_GEN


def test_cross_market_pools_and_claims_are_isolated(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract, first_id = deploy_market(direct_vm, direct_deploy)
    second_id = contract.create_market(AI_GROWTH, START_SECONDS)
    bet(direct_vm, contract, first_id, "AAPL", ONE_GEN, direct_alice)
    bet(direct_vm, contract, first_id, "META", ONE_GEN, direct_charlie)
    bet(direct_vm, contract, second_id, "NVDA", ONE_GEN, direct_bob)
    bet(direct_vm, contract, second_id, "PLTR", ONE_GEN, direct_charlie)
    install_candles(direct_vm, BIG_TECH, prices_for_votes(BIG_TECH, ("AAPL", "AAPL", "AAPL")))
    install_candles(direct_vm, AI_GROWTH, prices_for_votes(AI_GROWTH, ("NVDA", "NVDA", "NVDA")))
    direct_vm.warp(END)
    assert contract.settle_market(first_id) == "SETTLED"
    assert contract.settle_market(second_id) == "SETTLED"
    transfers = recipient_hook(direct_vm, contract, first_id)
    with direct_vm.prank(direct_alice):
        contract.claim(first_id)
    with direct_vm.prank(direct_bob):
        contract.claim(second_id)
    assert [item["value"] for item in transfers] == [2 * ONE_GEN, 2 * ONE_GEN]
    assert contract.get_market(first_id)["claimed_pool"] == 2 * ONE_GEN
    assert contract.get_market(second_id)["claimed_pool"] == 2 * ONE_GEN


def test_activity_records_are_wallet_isolated_and_amounts_are_actual(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract, market_id = deploy_market(direct_vm, direct_deploy)
    bet(direct_vm, contract, market_id, "AAPL", ONE_GEN, direct_alice)
    bet(direct_vm, contract, market_id, "AAPL", 2 * ONE_GEN, direct_alice)
    bet(direct_vm, contract, market_id, "META", ONE_GEN, direct_bob)
    alice = addr(direct_alice)
    bob = addr(direct_bob)
    assert contract.get_user_activity_count(alice) == 2
    assert contract.get_user_activity_count(bob) == 1
    records = contract.get_user_activity(alice, 0, 50)
    assert [record["type"] for record in records] == ["BET_PLACED", "BET_TOPPED_UP"]
    assert [record["amount"] for record in records] == [ONE_GEN, 2 * ONE_GEN]
    assert all(record["wallet"] == alice.as_hex for record in records)
    assert all(record["market_id"] == market_id for record in records)
    set_value(direct_vm, ONE_GEN)
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("outcome already selected"):
        contract.place_bet(market_id, "META")
    set_value(direct_vm, 0)
    assert contract.get_user_activity_count(alice) == 2


def test_all_provider_failure_reaches_refundable_terminal_state(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract, market_id = deploy_market(direct_vm, direct_deploy)
    bet(direct_vm, contract, market_id, "AAPL", ONE_GEN, direct_alice)
    bet(direct_vm, contract, market_id, "META", ONE_GEN, direct_bob)
    install_candles(
        direct_vm,
        bad=[
            {"source": "BINANCE", "asset": "AAPL", "body": "{"},
            {"source": "BITGET", "asset": "AAPL", "body": "{"},
            {"source": "GATE", "asset": "AAPL", "body": "{"},
        ],
    )
    direct_vm.warp(END)
    assert contract.settle_market(market_id) == "INCONCLUSIVE"
    transfers = recipient_hook(direct_vm, contract, market_id)
    with direct_vm.prank(direct_alice):
        contract.claim_refund(market_id)
    with direct_vm.prank(direct_bob):
        contract.claim_refund(market_id)
    assert [item["value"] for item in transfers] == [ONE_GEN, ONE_GEN]
    assert contract.get_market(market_id)["remaining_pool"] == 0
def test_claim_and_refund_activity_use_actual_transfer_amount(
    direct_vm, direct_deploy, direct_alice
):
    contract, market_id = deploy_market(direct_vm, direct_deploy)
    bet(direct_vm, contract, market_id, "AAPL", ONE_GEN, direct_alice)
    settle(direct_vm, contract, market_id)
    recipient_hook(direct_vm, contract, market_id)
    with direct_vm.prank(direct_alice):
        contract.claim(market_id)
    records = contract.get_user_activity(addr(direct_alice), 0, 50)
    assert records[-1]["type"] == "PAYOUT_CLAIMED"
    assert records[-1]["amount"] == ONE_GEN


def test_failed_direct_transfer_exposes_platform_atomicity_boundary(
    direct_vm, direct_deploy, direct_alice
):
    contract, market_id = deploy_market(direct_vm, direct_deploy)
    bet(direct_vm, contract, market_id, "AAPL", ONE_GEN, direct_alice)
    settle(direct_vm, contract, market_id)

    def failing_hook(_vm, _request):
        raise RuntimeError("simulated external transfer failure")

    direct_vm._gl_call_hook = failing_hook
    with direct_vm.prank(direct_alice):
        with pytest.raises(RuntimeError, match="simulated external transfer failure"):
            contract.claim(market_id)
    # Direct mode does not roll back storage around a synthetic hook exception.
    # This regression documents the live-platform boundary described in audit.md.
    position = contract.get_user_position(market_id, addr(direct_alice))
    assert position["already_claimed"] is True
    assert contract.get_market(market_id)["claimed_pool"] == ONE_GEN


def test_contract_wallet_shaped_caller_still_uses_external_finalized_transfer(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract, market_id = deploy_market(direct_vm, direct_deploy)
    bet(direct_vm, contract, market_id, "AAPL", ONE_GEN, direct_alice)
    settle(direct_vm, contract, market_id)
    messages = []

    def hook(_vm, request):
        messages.append(request)
        return {"ok": None}

    direct_vm._gl_call_hook = hook
    direct_vm.origin = direct_bob
    with direct_vm.prank(direct_alice):
        contract.claim(market_id)
    assert "EthSend" in messages[0]
    assert messages[0]["EthSend"]["address"].as_bytes == direct_alice


def test_consensus_failure_before_deadline_can_retry_then_fallback(
    direct_vm, direct_deploy, direct_alice, monkeypatch
):
    contract, market_id = deploy_market(direct_vm, direct_deploy)
    bet(direct_vm, contract, market_id, "AAPL", ONE_GEN, direct_alice)
    import genlayer.gl.vm as gl_vm

    original_run_nondet = gl_vm.run_nondet

    def disagree(*_args, **_kwargs):
        raise RuntimeError("simulated validator disagreement")

    monkeypatch.setattr(gl_vm, "run_nondet", disagree)
    direct_vm.warp(END)
    with pytest.raises(RuntimeError, match="validator disagreement"):
        contract.settle_market(market_id)
    assert contract.get_market(market_id)["state"] == "OPEN"
    monkeypatch.setattr(gl_vm, "run_nondet", original_run_nondet)
    direct_vm._strict_mock_mode = True
    direct_vm.warp("2025-01-01T17:00:00Z")
    assert contract.settle_market(market_id) == "INCONCLUSIVE"
    direct_vm._strict_mock_mode = False


def test_no_admin_money_or_winner_override_abi_exists():
    from pathlib import Path

    source = Path(CONTRACT).read_text().lower()
    for forbidden in ("admin_withdraw", "treasury_sweep", "emergency_sweep", "set_winner", "cancel_market"):
        assert forbidden not in source


def test_source_evidence_is_unavailable_after_deterministic_fallback(
    direct_vm, direct_deploy
):
    contract, market_id = deploy_market(direct_vm, direct_deploy)
    direct_vm._strict_mock_mode = True
    direct_vm.warp("2025-01-01T17:00:00Z")
    contract.settle_market(market_id)
    direct_vm._strict_mock_mode = False
    with direct_vm.expect_revert("source evidence unavailable"):
        contract.get_source_evidence(market_id, "BINANCE")
