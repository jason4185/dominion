import json

import pytest

from conftest import (
    AI_GROWTH,
    ASSETS,
    BIG_TECH,
    BINANCE,
    BITGET,
    CATEGORIES,
    CONTRACT,
    CRYPTO_FINTECH,
    CREATION,
    END,
    END_SECONDS,
    GATE,
    install_live_market_fixture,
    LIVE_END,
    LIVE_END_SECONDS,
    LIVE_START_MS,
    LIVE_START_SECONDS,
    START,
    START_MS,
    START_SECONDS,
    SOURCES,
    deploy_market,
    install_candles,
    prices_for_votes,
    settle,
    set_value,
)


def test_valid_market_creation_and_derived_state(direct_vm, direct_deploy):
    contract, market_id = deploy_market(direct_vm, direct_deploy)
    assert market_id == 1
    market = contract.get_market(market_id)
    assert market["id"] == 1
    assert market["category"] == BIG_TECH
    assert market["assets"] == ["AAPL", "META", "GOOGL"]
    assert market["market_start"] == START_SECONDS
    assert market["market_end"] == END_SECONDS
    assert market["betting_close"] == START_SECONDS
    assert market["settlement_deadline"] == END_SECONDS + 6 * 3600
    assert market["duration_seconds"] == 3600
    assert market["state"] == "OPEN"
    assert market["winner"] == ""
    assert market["total_pool"] == 0
    assert market["betting_open"] is True


@pytest.mark.parametrize("category, assets", [
    (BIG_TECH, ["AAPL", "META", "GOOGL"]),
    (AI_GROWTH, ["NVDA", "PLTR", "TSLA"]),
    (CRYPTO_FINTECH, ["MSTR", "COIN", "HOOD"]),
])
def test_all_locked_categories_and_fixed_mappings(direct_vm, direct_deploy, category, assets):
    contract = direct_deploy(CONTRACT)
    assert contract.categories() == list(CATEGORIES)
    assert contract.category_assets(category) == assets
    direct_vm.warp(CREATION)
    market_id = contract.create_market(category, START_SECONDS)
    assert contract.get_market(market_id)["assets"] == assets


def test_invalid_category_reverts(direct_vm, direct_deploy):
    contract = direct_deploy(CONTRACT)
    direct_vm.warp(CREATION)
    with direct_vm.expect_revert("invalid category"):
        contract.create_market("MEME STOCKS", START_SECONDS)


def test_duplicate_market_key_reverts(direct_vm, direct_deploy):
    contract, market_id = deploy_market(direct_vm, direct_deploy)
    assert market_id == 1
    with direct_vm.expect_revert("market already exists"):
        contract.create_market(BIG_TECH, START_SECONDS)


@pytest.mark.parametrize("market_start", [START_SECONDS + 60, START_SECONDS + 1])
def test_non_hour_or_noncanonical_market_start_reverts(direct_vm, direct_deploy, market_start):
    contract = direct_deploy(CONTRACT)
    direct_vm.warp(START)
    with direct_vm.expect_revert("exact UTC hour"):
        contract.create_market(BIG_TECH, market_start)


def test_iso_string_timestamp_is_not_accepted_by_creation_abi(direct_vm, direct_deploy):
    contract = direct_deploy(CONTRACT)
    direct_vm.warp(CREATION)
    with direct_vm.expect_revert("market start must be u256"):
        contract.create_market(BIG_TECH, START)


def test_same_timestamp_different_category_is_allowed(direct_vm, direct_deploy):
    contract = direct_deploy(CONTRACT)
    direct_vm.warp(CREATION)
    first_id = contract.create_market(BIG_TECH, START_SECONDS)
    second_id = contract.create_market(AI_GROWTH, START_SECONDS)
    assert (first_id, second_id) == (1, 2)


def test_creation_rejects_end_deadline_and_source_timestamp_overflow(direct_vm, direct_deploy):
    max_u256 = 2**256 - 1
    cases = [
        (max_u256 - max_u256 % 3600, "u256 addition overflow"),
        (((max_u256 - 21600) // 3600 + 1) * 3600, "u256 addition overflow"),
        (((max_u256 // 1000) // 3600 + 1) * 3600, "u256 multiplication overflow"),
    ]
    contract = direct_deploy(CONTRACT)
    for market_start, message in cases:
        direct_vm.warp(CREATION)
        with direct_vm.expect_revert(message):
            contract.create_market(BIG_TECH, market_start)
        assert contract.get_config()["duration_seconds"] == 3600


def test_fixed_one_hour_duration_across_date_boundary(direct_vm, direct_deploy):
    contract = direct_deploy(CONTRACT)
    start_seconds = START_SECONDS + 13 * 3600
    direct_vm.warp("2025-01-01T22:59:59Z")
    market_id = contract.create_market(BIG_TECH, start_seconds)
    market = contract.get_market(market_id)
    assert market["market_end"] == start_seconds + 3600
    assert market["duration_seconds"] == 3600


def test_settle_only_after_expiry(direct_vm, direct_deploy):
    contract, market_id = deploy_market(direct_vm, direct_deploy)
    install_candles(direct_vm)
    direct_vm.warp("2025-01-01T10:59:59Z")
    with direct_vm.expect_revert("has not expired"):
        contract.settle_market(market_id)
    direct_vm.warp(END)
    assert contract.settle_market(market_id) == "SETTLED"


@pytest.mark.parametrize("category, expected", [
    (BIG_TECH, ("AAPL", "GOOGL", "GOOGL", "GOOGL")),
    (AI_GROWTH, ("NVDA", "NVDA", "NVDA", "NVDA")),
    (CRYPTO_FINTECH, ("COIN", "MSTR", "COIN", "COIN")),
])
def test_locked_live_fixture_source_winners_and_final(category, expected, direct_vm, direct_deploy):
    contract, market_id = deploy_market(direct_vm, direct_deploy, category)
    values = {
        BIG_TECH: {
            BINANCE: {"AAPL": (100, "99.8676"), "META": (100, "99.8296"), "GOOGL": (100, "99.8181")},
            BITGET: {"AAPL": (100, "99.8247"), "META": (100, "99.7880"), "GOOGL": (100, "99.9057")},
            GATE: {"AAPL": (100, "99.8553"), "META": (100, "99.7597"), "GOOGL": (100, "99.8682")},
        },
        AI_GROWTH: {
            BINANCE: {"NVDA": (100, "100.0769"), "PLTR": (100, "99.7211"), "TSLA": (100, "99.9872")},
            BITGET: {"NVDA": (100, "100.0934"), "PLTR": (100, "99.7189"), "TSLA": (100, "100.0361")},
            GATE: {"NVDA": (100, "100.0779"), "PLTR": (100, "99.7522"), "TSLA": (100, "100.0222")},
        },
        CRYPTO_FINTECH: {
            BINANCE: {"MSTR": (100, "99.8201"), "COIN": (100, "100.0057"), "HOOD": (100, "99.8779")},
            BITGET: {"MSTR": (100, "100.1849"), "COIN": (100, "100.0847"), "HOOD": (100, "100.1184")},
            GATE: {"MSTR": (100, "100.0556"), "COIN": (100, "100.0989"), "HOOD": (100, "100.0237")},
        },
    }[category]
    install_candles(direct_vm, category, values)
    direct_vm.warp(END)
    assert contract.settle_market(market_id) == "SETTLED"
    assert contract.get_market(market_id)["winner"] == expected[3]
    assert [contract.get_source_evidence(market_id, source)["source_winner"] for source in SOURCES] == list(expected[:3])


@pytest.mark.parametrize("closes, expected_winner", [
    ((101, 102, 103), "GOOGL"),
    ((99, 100, 101), "GOOGL"),
    ((99, 98, 101), "GOOGL"),
])
def test_positive_negative_and_mixed_returns_rank_numerically(direct_vm, direct_deploy, closes, expected_winner):
    contract, market_id = deploy_market(direct_vm, direct_deploy)
    values = {source: {asset: (100, closes[index]) for index, asset in enumerate(ASSETS[BIG_TECH])} for source in SOURCES}
    install_candles(direct_vm, BIG_TECH, values)
    direct_vm.warp(END)
    assert contract.settle_market(market_id) == "SETTLED"
    evidence = contract.get_source_evidence(market_id, BINANCE)
    assert evidence["source_winner"] == expected_winner
    assert max(evidence["assets"], key=lambda row: row["return_units"])["asset"] == expected_winner


def test_all_negative_returns_keep_highest_numerical_return(direct_vm, direct_deploy):
    contract, market_id = deploy_market(direct_vm, direct_deploy)
    values = {source: {"AAPL": (100, "99.50"), "META": (100, "99.80"), "GOOGL": (100, "99.20")} for source in SOURCES}
    install_candles(direct_vm, BIG_TECH, values)
    direct_vm.warp(END)
    contract.settle_market(market_id)
    assert contract.get_source_evidence(market_id, BINANCE)["source_winner"] == "META"


def test_exact_tie_produces_no_source_vote(direct_vm, direct_deploy):
    contract, market_id = deploy_market(direct_vm, direct_deploy)
    values = {source: {"AAPL": (100, "101"), "META": (100, "101"), "GOOGL": (100, "99")} for source in SOURCES}
    install_candles(direct_vm, BIG_TECH, values)
    direct_vm.warp(END)
    contract.settle_market(market_id)
    evidence = contract.get_source_evidence(market_id, BINANCE)
    assert evidence["source_status"] == "TIE"
    assert evidence["source_winner"] == ""


@pytest.mark.parametrize("closes, expected_status, expected_winner", [
    (("101", "101", "101"), "TIE", ""),
    (("101", "99", "99"), "VALID", "AAPL"),
    (("99", "99", "98"), "TIE", ""),
])
def test_two_way_three_way_and_negative_ties_are_numerical(
    direct_vm, direct_deploy, closes, expected_status, expected_winner
):
    contract, market_id = deploy_market(direct_vm, direct_deploy)
    values = {
        source: {
            asset: (100, closes[index])
            for index, asset in enumerate(ASSETS[BIG_TECH])
        }
        for source in SOURCES
    }
    install_candles(direct_vm, BIG_TECH, values)
    direct_vm.warp(END)
    contract.settle_market(market_id)
    evidence = contract.get_source_evidence(market_id, BINANCE)
    assert evidence["source_status"] == expected_status
    assert evidence["source_winner"] == expected_winner


def test_tie_precision_is_deterministic_at_one_millionth_percent(direct_vm, direct_deploy):
    contract, market_id = deploy_market(direct_vm, direct_deploy)
    values = {source: {"AAPL": (100, "100.0000001"), "META": (100, "100.0000002"), "GOOGL": (100, "99")} for source in SOURCES}
    install_candles(direct_vm, BIG_TECH, values)
    direct_vm.warp(END)
    contract.settle_market(market_id)
    evidence = contract.get_source_evidence(market_id, BINANCE)
    assert [row["return_units"] for row in evidence["assets"]] == [0, 0, -1000000]
    assert evidence["source_status"] == "TIE"


@pytest.mark.parametrize("winners, expected_state, expected_winner", [
    (("AAPL", "AAPL", "AAPL"), "SETTLED", "AAPL"),
    (("AAPL", "AAPL", "META"), "SETTLED", "AAPL"),
    (("AAPL", "META", "GOOGL"), "INCONCLUSIVE", ""),
    (("AAPL", "AAPL", "UNAVAILABLE"), "SETTLED", "AAPL"),
    (("AAPL", "META", "UNAVAILABLE"), "INCONCLUSIVE", ""),
    (("AAPL", "UNAVAILABLE", "UNAVAILABLE"), "INCONCLUSIVE", ""),
    (("TIE", "AAPL", "AAPL"), "SETTLED", "AAPL"),
    (("TIE", "AAPL", "META"), "INCONCLUSIVE", ""),
    (("TIE", "TIE", "AAPL"), "INCONCLUSIVE", ""),
    (("TIE", "TIE", "TIE"), "INCONCLUSIVE", ""),
])
def test_exact_settlement_matrix(direct_vm, direct_deploy, winners, expected_state, expected_winner):
    contract, market_id = deploy_market(direct_vm, direct_deploy)
    unavailable = []
    for source, winner in zip(SOURCES, winners):
        if winner == "UNAVAILABLE":
            unavailable.append({"source": source, "asset": "AAPL", "body": "{"})
    mock_winners = [winner if winner != "UNAVAILABLE" else "AAPL" for winner in winners]
    install_candles(direct_vm, BIG_TECH, prices_for_votes(BIG_TECH, mock_winners), bad=unavailable)
    direct_vm.warp(END)
    assert contract.settle_market(market_id) == expected_state
    market = contract.get_market(market_id)
    assert market["state"] == expected_state
    assert market["winner"] == expected_winner


def test_no_bettors_does_not_change_settlement(direct_vm, direct_deploy):
    contract, market_id = deploy_market(direct_vm, direct_deploy)
    assert contract.get_market(market_id)["state"] == "OPEN"
    assert settle(direct_vm, contract, market_id) == "SETTLED"


def test_repeat_settlement_and_invalid_state_transition_revert(direct_vm, direct_deploy):
    contract, market_id = deploy_market(direct_vm, direct_deploy)
    settle(direct_vm, contract, market_id)
    with direct_vm.expect_revert("market is not open"):
        contract.settle_market(market_id)
    with direct_vm.expect_revert("market not found"):
        contract.get_market(999)


@pytest.mark.parametrize("source", SOURCES)
def test_malformed_source_response_is_unavailable(direct_vm, direct_deploy, source):
    contract, market_id = deploy_market(direct_vm, direct_deploy)
    install_candles(direct_vm, bad={"source": source, "asset": "AAPL", "body": "not-json"})
    direct_vm.warp(END)
    assert contract.settle_market(market_id) == "SETTLED"
    assert contract.get_source_evidence(market_id, source)["source_status"] == "UNAVAILABLE"


@pytest.mark.parametrize("source", SOURCES)
def test_wrong_symbol_is_unavailable(direct_vm, direct_deploy, source):
    contract, market_id = deploy_market(direct_vm, direct_deploy)
    if source == BITGET:
        bad = {"source": source, "asset": "AAPL", "metadata": {"symbol": "BADUSDT"}}
    elif source == GATE:
        bad = {"source": source, "asset": "AAPL", "metadata": {"contract": "index_BAD_USDT"}}
    else:
        bad = {"source": source, "asset": "AAPL", "body": json.dumps({"symbol": "BADUSDT"})}
    install_candles(direct_vm, bad=bad)
    direct_vm.warp(END)
    contract.settle_market(market_id)
    assert contract.get_source_evidence(market_id, source)["source_status"] == "UNAVAILABLE"


@pytest.mark.parametrize("source", SOURCES)
@pytest.mark.parametrize("kind", [
    "wrong_timestamp", "stale_candle", "future_candle", "wrong_interval",
    "zero_price", "negative_price", "non_numeric_price", "missing_open", "missing_close",
])
def test_source_validation_rejects_bad_candles(direct_vm, direct_deploy, source, kind):
    contract, market_id = deploy_market(direct_vm, direct_deploy)
    bad = {"source": source, "asset": "AAPL"}
    if kind in ("wrong_timestamp", "stale_candle", "future_candle"):
        delta = -3600000 if kind == "stale_candle" else 3600000
        bad["timestamp"] = (START_SECONDS if source == GATE else START_MS) + delta
    elif kind == "wrong_interval":
        if source == BINANCE:
            bad["body"] = json.dumps({"interval": "15m", "data": []})
        else:
            bad["metadata"] = {"interval": "15m"}
    elif kind == "zero_price":
        bad["opening"] = 0
    elif kind == "negative_price":
        bad["opening"] = -1
    elif kind == "non_numeric_price":
        bad["opening"] = "NaN"
    elif kind == "missing_open":
        bad["missing"] = "open"
    elif kind == "missing_close":
        bad["missing"] = "close"
    install_candles(direct_vm, bad=bad)
    direct_vm.warp(END)
    contract.settle_market(market_id)
    assert contract.get_source_evidence(market_id, source)["source_status"] == "UNAVAILABLE"


def test_http_error_response_is_unavailable(direct_vm, direct_deploy):
    contract, market_id = deploy_market(direct_vm, direct_deploy)
    install_candles(direct_vm, bad={"source": BINANCE, "asset": "AAPL", "status": 503})
    direct_vm.warp(END)
    contract.settle_market(market_id)
    assert contract.get_source_evidence(market_id, BINANCE)["source_status"] == "UNAVAILABLE"


def test_oversized_response_is_unavailable(direct_vm, direct_deploy):
    contract, market_id = deploy_market(direct_vm, direct_deploy)
    install_candles(direct_vm, bad={"source": BINANCE, "asset": "AAPL", "body": "x" * 65_537})
    direct_vm.warp(END)
    contract.settle_market(market_id)
    assert contract.get_source_evidence(market_id, BINANCE)["source_status"] == "UNAVAILABLE"


@pytest.mark.parametrize("source", SOURCES)
def test_duplicate_matching_candles_are_unavailable(direct_vm, direct_deploy, source):
    contract, market_id = deploy_market(direct_vm, direct_deploy)
    if source == BINANCE:
        row = [START_MS, "100", "101", "100", "101", "0", START_MS + 3_599_999, "0", "0", "0", "0", "0"]
        body = json.dumps([row, row])
    elif source == BITGET:
        row = [START_MS, "100", "101", "100", "101", "0", "0"]
        body = json.dumps({"code": "00000", "msg": "success", "data": [row, row]})
    else:
        row = {"t": START_SECONDS, "o": "100", "c": "101", "h": "101", "l": "100"}
        body = json.dumps([row, row])
    install_candles(direct_vm, bad={"source": source, "asset": "AAPL", "body": body})
    direct_vm.warp(END)
    contract.settle_market(market_id)
    assert contract.get_source_evidence(market_id, source)["source_status"] == "UNAVAILABLE"


def test_binance_candle_with_wrong_close_time_is_unavailable(direct_vm, direct_deploy):
    contract, market_id = deploy_market(direct_vm, direct_deploy)
    row = [START_MS, "100", "101", "100", "101", "0", START_MS + 3_599_998, "0", "0", "0", "0", "0"]
    install_candles(direct_vm, bad={"source": BINANCE, "asset": "AAPL", "body": json.dumps([row])})
    direct_vm.warp(END)
    contract.settle_market(market_id)
    assert contract.get_source_evidence(market_id, BINANCE)["source_status"] == "UNAVAILABLE"


def test_contract_source_size_and_forbidden_storage_check():
    from pathlib import Path

    contract_text = Path(CONTRACT).read_text()
    assert len(contract_text.encode("utf-8")) < 52_224
    assert "dynray" not in contract_text.lower()


def test_exact_index_endpoint_queries_and_no_trade_candle_fallback(direct_vm, direct_deploy):
    contract, market_id = deploy_market(direct_vm, direct_deploy)
    install_candles(direct_vm, exact=True)
    direct_vm._strict_mock_mode = True
    direct_vm.warp(END)
    assert contract.settle_market(market_id) == "SETTLED"


def test_live_market_fixture_selects_exact_start_candle(direct_vm, direct_deploy):
    contract, market_id = deploy_market(direct_vm, direct_deploy, start=LIVE_START_SECONDS)
    install_live_market_fixture(direct_vm)
    direct_vm._strict_mock_mode = True
    direct_vm.warp(LIVE_END)
    assert contract.settle_market(market_id) == "SETTLED"

    expected_timestamps = {
        BINANCE: LIVE_START_MS,
        BITGET: LIVE_START_MS,
        GATE: LIVE_START_SECONDS,
    }
    for source in SOURCES:
        evidence = contract.get_source_evidence(market_id, source)
        assert evidence["source_status"] == "VALID"
        assert evidence["source_winner"] == "GOOGL"
        assert all(row["candle_timestamp"] == str(expected_timestamps[source]) for row in evidence["assets"])


def test_validator_equivalence_compares_source_evidence_fields(direct_vm, direct_deploy):
    contract, market_id = deploy_market(direct_vm, direct_deploy)
    install_candles(direct_vm)
    direct_vm.warp(END)
    contract.settle_market(market_id)
    assert direct_vm.run_validator(index=0) is True
    direct_vm.clear_mocks()
    install_candles(direct_vm, source_values=prices_for_votes(BIG_TECH, ("META", "AAPL", "AAPL")))
    assert direct_vm.run_validator(index=0) is False


def test_validator_rejects_different_source_witness_even_when_final_winner_matches(direct_vm, direct_deploy):
    contract, market_id = deploy_market(direct_vm, direct_deploy)
    install_candles(direct_vm, BIG_TECH, prices_for_votes(BIG_TECH, ("AAPL", "AAPL", "AAPL")))
    direct_vm.warp(END)
    contract.settle_market(market_id)
    direct_vm.clear_mocks()
    install_candles(
        direct_vm,
        BIG_TECH,
        prices_for_votes(BIG_TECH, ("AAPL", "AAPL", "AAPL")),
        bad={"source": BINANCE, "asset": "AAPL", "body": "{"},
    )
    # The alternate validator could still see Bitget and Gate vote AAPL, but
    # it lacks the same Binance evidence as the leader.
    assert direct_vm.run_validator(index=0) is False


def test_pickling_and_state_snapshot_serialization(direct_vm, direct_deploy):
    direct_vm.check_pickling = True
    contract, market_id = deploy_market(direct_vm, direct_deploy)
    snapshot = direct_vm.snapshot()
    settle(direct_vm, contract, market_id)
    assert contract.get_market(market_id)["state"] == "SETTLED"
    direct_vm.revert(snapshot)
    assert contract.get_market(market_id)["state"] == "OPEN"
