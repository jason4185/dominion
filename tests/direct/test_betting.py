import pytest

from conftest import (
    BIG_TECH,
    CONTRACT,
    CREATION,
    END,
    START,
    START_SECONDS,
    deploy_market,
    prices_for_votes,
    set_value,
    install_candles,
)


ONE_GEN = 10**18
TWO_GEN = 2 * ONE_GEN


def bet(direct_vm, contract, market_id, asset, amount, sender=None):
    if sender is not None:
        direct_vm.sender = sender
    set_value(direct_vm, amount)
    contract.place_bet(market_id, asset)
    set_value(direct_vm, 0)


def settle_with_winners(direct_vm, contract, market_id, winners):
    install_candles(direct_vm, BIG_TECH, prices_for_votes(BIG_TECH, winners))
    direct_vm.warp(END)
    return contract.settle_market(market_id)


def capture_transfers(direct_vm, contract, market_id):
    transfers = []
    observed_claimed = []

    def hook(_vm, request):
        transfers.append(request.get("EthSend") or request.get("PostMessage"))
        observed_claimed.append(contract.get_betting_state(market_id)["claimed"])
        return {"ok": None}

    direct_vm._gl_call_hook = hook
    return transfers, observed_claimed


def test_future_exact_hour_creation_is_accepted(direct_vm, direct_deploy):
    contract = direct_deploy(CONTRACT)
    direct_vm.warp(CREATION)
    assert contract.create_market(BIG_TECH, START_SECONDS) == 1


@pytest.mark.parametrize("now", [START, "2025-01-01T10:30:00Z", END, "2025-01-01T12:00:00Z"])
def test_past_or_already_started_market_creation_reverts(direct_vm, direct_deploy, now):
    contract = direct_deploy(CONTRACT)
    direct_vm.warp(now)
    with direct_vm.expect_revert("in future"):
        contract.create_market(BIG_TECH, START_SECONDS)


def test_non_hour_start_still_reverts_after_future_check(direct_vm, direct_deploy):
    contract = direct_deploy(CONTRACT)
    direct_vm.warp(CREATION)
    with direct_vm.expect_revert("exact UTC hour"):
        contract.create_market(BIG_TECH, START_SECONDS + 17 * 60)


def test_one_gen_is_minimum_and_stored_in_base_units(direct_vm, direct_deploy, direct_alice):
    contract, market_id = deploy_market(direct_vm, direct_deploy)
    direct_vm.sender = direct_alice
    bet(direct_vm, contract, market_id, "AAPL", ONE_GEN)
    state = contract.get_betting_state(market_id)
    assert state["total_market_pool"] == ONE_GEN
    assert state["outcome_stakes"]["AAPL"] == ONE_GEN
    assert state["bettor_stake"] == ONE_GEN


def test_below_one_gen_reverts_and_does_not_change_pool(direct_vm, direct_deploy, direct_alice):
    contract, market_id = deploy_market(direct_vm, direct_deploy)
    direct_vm.sender = direct_alice
    set_value(direct_vm, ONE_GEN - 1)
    with direct_vm.expect_revert("minimum bet"):
        contract.place_bet(market_id, "AAPL")
    set_value(direct_vm, 0)
    assert contract.get_betting_state(market_id)["total_market_pool"] == 0


def test_large_bet_is_accepted_without_dominion_maximum(direct_vm, direct_deploy, direct_alice):
    contract, market_id = deploy_market(direct_vm, direct_deploy)
    large_bet = 10**40
    bet(direct_vm, contract, market_id, "AAPL", large_bet, direct_alice)
    assert contract.get_betting_state(market_id)["total_market_pool"] == large_bet


def test_first_side_locks_wallet_and_same_side_topups_accumulate(
    direct_vm, direct_deploy, direct_alice
):
    contract, market_id = deploy_market(direct_vm, direct_deploy)
    bet(direct_vm, contract, market_id, "AAPL", ONE_GEN, direct_alice)
    bet(direct_vm, contract, market_id, "AAPL", TWO_GEN, direct_alice)
    state = contract.get_betting_state(market_id)
    assert state["bettor_asset"] == "AAPL"
    assert state["bettor_stake"] == 3 * ONE_GEN


def test_wallet_cannot_switch_to_second_or_third_outcome(
    direct_vm, direct_deploy, direct_alice
):
    contract, market_id = deploy_market(direct_vm, direct_deploy)
    bet(direct_vm, contract, market_id, "AAPL", ONE_GEN, direct_alice)
    set_value(direct_vm, ONE_GEN)
    with direct_vm.expect_revert("outcome already selected"):
        contract.place_bet(market_id, "META")
    with direct_vm.expect_revert("outcome already selected"):
        contract.place_bet(market_id, "GOOGL")
    set_value(direct_vm, 0)
    assert contract.get_betting_state(market_id)["outcome_stakes"] == {
        "AAPL": ONE_GEN,
        "META": 0,
        "GOOGL": 0,
    }


def test_betting_before_start_is_accepted_at_start_rejected_and_after_rejected(
    direct_vm, direct_deploy, direct_alice
):
    contract, market_id = deploy_market(direct_vm, direct_deploy)
    bet(direct_vm, contract, market_id, "AAPL", ONE_GEN, direct_alice)
    direct_vm.warp(START)
    set_value(direct_vm, ONE_GEN)
    with direct_vm.expect_revert("betting is closed"):
        contract.place_bet(market_id, "AAPL")
    direct_vm.warp("2025-01-01T10:00:01Z")
    with direct_vm.expect_revert("betting is closed"):
        contract.place_bet(market_id, "AAPL")
    set_value(direct_vm, 0)


def test_invalid_asset_market_id_and_non_open_market_revert(
    direct_vm, direct_deploy, direct_alice
):
    contract, market_id = deploy_market(direct_vm, direct_deploy)
    direct_vm.sender = direct_alice
    set_value(direct_vm, ONE_GEN)
    with direct_vm.expect_revert("invalid market asset"):
        contract.place_bet(market_id, "NVDA")
    with direct_vm.expect_revert("market not found"):
        contract.place_bet(999, "AAPL")
    set_value(direct_vm, 0)
    assert settle_with_winners(direct_vm, contract, market_id, ("AAPL", "AAPL", "AAPL")) == "SETTLED"
    set_value(direct_vm, ONE_GEN)
    with direct_vm.expect_revert("market is not open"):
        contract.place_bet(market_id, "AAPL")
    set_value(direct_vm, 0)


def test_pool_and_bettor_totals_are_independent(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract, market_id = deploy_market(direct_vm, direct_deploy)
    bet(direct_vm, contract, market_id, "AAPL", TWO_GEN, direct_alice)
    bet(direct_vm, contract, market_id, "META", 3 * ONE_GEN, direct_bob)
    with direct_vm.prank(direct_alice):
        alice = contract.get_betting_state(market_id)
    with direct_vm.prank(direct_bob):
        bob = contract.get_betting_state(market_id)
    assert alice["total_market_pool"] == 5 * ONE_GEN
    assert alice["outcome_stakes"] == {"AAPL": TWO_GEN, "META": 3 * ONE_GEN, "GOOGL": 0}
    assert alice["bettor_asset"] == "AAPL" and alice["bettor_stake"] == TWO_GEN
    assert bob["bettor_asset"] == "META" and bob["bettor_stake"] == 3 * ONE_GEN


def test_normal_settlement_with_bettors_records_winner_and_allows_claims(
    direct_vm, direct_deploy, direct_alice
):
    contract, market_id = deploy_market(direct_vm, direct_deploy)
    bet(direct_vm, contract, market_id, "AAPL", ONE_GEN, direct_alice)
    assert settle_with_winners(direct_vm, contract, market_id, ("AAPL", "AAPL", "META")) == "SETTLED"
    assert contract.get_market(market_id)["winner"] == "AAPL"


def test_parimutuel_payout_is_proportional_floor_and_zero_fee(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract, market_id = deploy_market(direct_vm, direct_deploy)
    bet(direct_vm, contract, market_id, "AAPL", 2 * ONE_GEN, direct_alice)
    bet(direct_vm, contract, market_id, "AAPL", ONE_GEN, direct_bob)
    bet(direct_vm, contract, market_id, "META", 3 * ONE_GEN, direct_charlie)
    settle_with_winners(direct_vm, contract, market_id, ("AAPL", "AAPL", "META"))
    transfers, observed_claimed = capture_transfers(direct_vm, contract, market_id)
    with direct_vm.prank(direct_alice):
        contract.claim(market_id)
    with direct_vm.prank(direct_bob):
        contract.claim(market_id)
    assert [item["value"] for item in transfers] == [4 * ONE_GEN, 2 * ONE_GEN]
    assert transfers[0]["address"].as_bytes == direct_alice
    assert transfers[1]["address"].as_bytes == direct_bob
    assert observed_claimed == [True, True]
    assert contract.get_betting_state(market_id)["total_market_pool"] == 6 * ONE_GEN


def test_uneven_winner_stakes_match_big_int_reference_and_clear_dust(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract, market_id = deploy_market(direct_vm, direct_deploy)
    bet(direct_vm, contract, market_id, "AAPL", 7 * ONE_GEN, direct_alice)
    bet(direct_vm, contract, market_id, "AAPL", 11 * ONE_GEN, direct_bob)
    bet(direct_vm, contract, market_id, "META", 13 * ONE_GEN, direct_charlie)
    assert settle_with_winners(direct_vm, contract, market_id, ("AAPL", "AAPL", "AAPL")) == "SETTLED"
    transfers, _ = capture_transfers(direct_vm, contract, market_id)
    with direct_vm.prank(direct_alice):
        contract.claim(market_id)
    with direct_vm.prank(direct_bob):
        contract.claim(market_id)
    total_pool = 31 * ONE_GEN
    winning_pool = 18 * ONE_GEN
    first_expected = (7 * ONE_GEN) * total_pool // winning_pool
    assert transfers[0]["value"] == first_expected
    assert transfers[1]["value"] == total_pool - first_expected
    state = contract.get_betting_state(market_id)
    assert state["claimed_winning_stake"] == winning_pool
    assert state["claimed_pool"] == total_pool


def test_final_winning_claimant_receives_remainder_and_claim_is_once_only(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract, market_id = deploy_market(direct_vm, direct_deploy)
    bet(direct_vm, contract, market_id, "AAPL", ONE_GEN, direct_alice)
    bet(direct_vm, contract, market_id, "AAPL", ONE_GEN, direct_bob)
    bet(direct_vm, contract, market_id, "META", ONE_GEN, direct_charlie)
    settle_with_winners(direct_vm, contract, market_id, ("AAPL", "AAPL", "META"))
    transfers, _ = capture_transfers(direct_vm, contract, market_id)
    with direct_vm.prank(direct_alice):
        contract.claim(market_id)
        with direct_vm.expect_revert("payout already claimed"):
            contract.claim(market_id)
    assert transfers[0]["value"] == 3 * ONE_GEN // 2
    with direct_vm.prank(direct_bob):
        contract.claim(market_id)
    assert transfers[1]["value"] == 3 * ONE_GEN - transfers[0]["value"]
    assert contract.get_market(market_id)["claimed_pool"] == 3 * ONE_GEN


def test_losing_bettor_gets_no_positive_payout_and_cannot_claim(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract, market_id = deploy_market(direct_vm, direct_deploy)
    bet(direct_vm, contract, market_id, "AAPL", ONE_GEN, direct_alice)
    bet(direct_vm, contract, market_id, "META", ONE_GEN, direct_bob)
    settle_with_winners(direct_vm, contract, market_id, ("AAPL", "AAPL", "AAPL"))
    with direct_vm.prank(direct_bob):
        with direct_vm.expect_revert("not a winning bettor"):
            contract.claim(market_id)
    with direct_vm.prank(direct_alice):
        assert contract.get_betting_state(market_id)["claimed"] is False


def test_claim_before_settlement_reverts(direct_vm, direct_deploy, direct_alice):
    contract, market_id = deploy_market(direct_vm, direct_deploy)
    bet(direct_vm, contract, market_id, "AAPL", ONE_GEN, direct_alice)
    with direct_vm.expect_revert("market is not settled"):
        contract.claim(market_id)


def test_zero_bettor_market_settles_normally_with_recorded_winner(
    direct_vm, direct_deploy
):
    contract, market_id = deploy_market(direct_vm, direct_deploy)
    assert settle_with_winners(direct_vm, contract, market_id, ("GOOGL", "GOOGL", "AAPL")) == "SETTLED"
    market = contract.get_market(market_id)
    assert market["winner"] == "GOOGL"
    assert contract.get_betting_state(market_id)["total_market_pool"] == 0


def test_zero_stake_actual_winner_enters_refund_mode_without_division_by_zero(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract, market_id = deploy_market(direct_vm, direct_deploy)
    bet(direct_vm, contract, market_id, "AAPL", 2 * ONE_GEN, direct_alice)
    bet(direct_vm, contract, market_id, "META", ONE_GEN, direct_bob)
    assert settle_with_winners(direct_vm, contract, market_id, ("GOOGL", "GOOGL", "GOOGL")) == "INCONCLUSIVE"
    assert contract.get_market(market_id)["winner"] == "GOOGL"
    assert contract.get_betting_state(market_id)["outcome_stakes"]["GOOGL"] == 0
    with direct_vm.prank(direct_alice):
        with direct_vm.expect_revert("market is not settled"):
            contract.claim(market_id)


def test_two_agreeing_sources_settle_with_one_unavailable_and_claim(
    direct_vm, direct_deploy, direct_alice
):
    contract, market_id = deploy_market(direct_vm, direct_deploy)
    bet(direct_vm, contract, market_id, "AAPL", ONE_GEN, direct_alice)
    install_candles(direct_vm, BIG_TECH, prices_for_votes(BIG_TECH, ("AAPL", "AAPL", "AAPL")), bad={"source": "GATE", "asset": "AAPL", "body": "{"})
    direct_vm.warp(END)
    assert contract.settle_market(market_id) == "SETTLED"
    with direct_vm.prank(direct_alice):
        contract.claim(market_id)


def test_inconclusive_market_refunds_exact_accumulated_stake(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract, market_id = deploy_market(direct_vm, direct_deploy)
    bet(direct_vm, contract, market_id, "AAPL", ONE_GEN, direct_alice)
    bet(direct_vm, contract, market_id, "AAPL", 2 * ONE_GEN, direct_alice)
    bet(direct_vm, contract, market_id, "META", 3 * ONE_GEN, direct_bob)
    assert settle_with_winners(direct_vm, contract, market_id, ("AAPL", "META", "GOOGL")) == "INCONCLUSIVE"
    transfers, _ = capture_transfers(direct_vm, contract, market_id)
    with direct_vm.prank(direct_alice):
        contract.claim_refund(market_id)
    with direct_vm.prank(direct_bob):
        contract.claim_refund(market_id)
    assert [item["value"] for item in transfers] == [3 * ONE_GEN, 3 * ONE_GEN]
    with direct_vm.prank(direct_alice):
        assert contract.get_betting_state(market_id)["refunded"] is True


def test_double_refund_and_wrong_terminal_method_revert(
    direct_vm, direct_deploy, direct_alice
):
    contract, market_id = deploy_market(direct_vm, direct_deploy)
    bet(direct_vm, contract, market_id, "AAPL", ONE_GEN, direct_alice)
    snapshot = direct_vm.snapshot()
    settle_with_winners(direct_vm, contract, market_id, ("AAPL", "META", "GOOGL"))
    with direct_vm.prank(direct_alice):
        contract.claim_refund(market_id)
        with direct_vm.expect_revert("refund already claimed"):
            contract.claim_refund(market_id)
        with direct_vm.expect_revert("market is not settled"):
            contract.claim(market_id)

    direct_vm.revert(snapshot)
    settle_with_winners(direct_vm, contract, market_id, ("AAPL", "AAPL", "AAPL"))
    with direct_vm.prank(direct_alice):
        with direct_vm.expect_revert("market is not inconclusive"):
            contract.claim_refund(market_id)


def test_tied_source_two_agreeing_still_allows_normal_claim(
    direct_vm, direct_deploy, direct_alice
):
    contract, market_id = deploy_market(direct_vm, direct_deploy)
    bet(direct_vm, contract, market_id, "AAPL", ONE_GEN, direct_alice)
    assert settle_with_winners(direct_vm, contract, market_id, ("TIE", "AAPL", "AAPL")) == "SETTLED"
    with direct_vm.prank(direct_alice):
        contract.claim(market_id)


def test_state_and_claim_status_survive_snapshot_and_pickling(
    direct_vm, direct_deploy, direct_alice
):
    direct_vm.check_pickling = True
    contract, market_id = deploy_market(direct_vm, direct_deploy)
    bet(direct_vm, contract, market_id, "AAPL", ONE_GEN, direct_alice)
    snapshot = direct_vm.snapshot()
    settle_with_winners(direct_vm, contract, market_id, ("AAPL", "AAPL", "AAPL"))
    with direct_vm.prank(direct_alice):
        contract.claim(market_id)
        assert contract.get_betting_state(market_id)["claimed"] is True
    direct_vm.revert(snapshot)
    with direct_vm.prank(direct_alice):
        assert contract.get_betting_state(market_id)["bettor_stake"] == ONE_GEN
        assert contract.get_betting_state(market_id)["claimed"] is False


def test_invalid_claim_refund_ids_revert(direct_vm, direct_deploy):
    contract, _ = deploy_market(direct_vm, direct_deploy)
    with direct_vm.expect_revert("market not found"):
        contract.claim(999)
    with direct_vm.expect_revert("market not found"):
        contract.claim_refund(999)


def test_max_u256_single_bet_is_protocol_bounded_not_app_capped(
    direct_vm, direct_deploy, direct_alice
):
    contract, market_id = deploy_market(direct_vm, direct_deploy)
    maximum = 2**256 - 1
    bet(direct_vm, contract, market_id, "AAPL", maximum, direct_alice)
    assert contract.get_betting_state(market_id)["bettor_stake"] == maximum
