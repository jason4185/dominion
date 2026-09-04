import json
from datetime import datetime, timedelta, timezone

import pytest


CONTRACT = "contracts/Dominion.py"
START = "2025-01-01T10:00:00Z"
END = "2025-01-01T11:00:00Z"
START_SECONDS = int(datetime.fromisoformat(START.replace("Z", "+00:00")).timestamp())
END_SECONDS = START_SECONDS + 3600
START_MS = START_SECONDS * 1000
CREATION = "2025-01-01T09:00:00Z"
LIVE_START = "2026-09-04T01:00:00Z"
LIVE_END = "2026-09-04T02:00:00Z"
LIVE_START_SECONDS = 1788483600
LIVE_END_SECONDS = 1788487200
LIVE_START_MS = LIVE_START_SECONDS * 1000
LIVE_END_MS = LIVE_END_SECONDS * 1000

BIG_TECH = "BIG TECH"
AI_GROWTH = "AI & GROWTH"
CRYPTO_FINTECH = "CRYPTO & FINTECH"

BINANCE = "BINANCE"
BITGET = "BITGET"
GATE = "GATE"

SOURCES = (BINANCE, BITGET, GATE)
CATEGORIES = (BIG_TECH, AI_GROWTH, CRYPTO_FINTECH)
ASSETS = {
    BIG_TECH: ("AAPL", "META", "GOOGL"),
    AI_GROWTH: ("NVDA", "PLTR", "TSLA"),
    CRYPTO_FINTECH: ("MSTR", "COIN", "HOOD"),
}

LIVE_BITGET_RESPONSES = {
    "AAPL": """{"code":"00000","msg":"success","requestTime":1788517679220,"data":[["1788483600000","328.31","328.64","328.17","328.31","62.71","20596.3688"]]}""",
    "META": """{"code":"00000","msg":"success","requestTime":1788517679208,"data":[["1788483600000","613.98","614.09","613.29","613.68","6.75","4141.431"]]}""",
    "GOOGL": """{"code":"00000","msg":"success","requestTime":1788517679223,"data":[["1788483600000","342.69","343.14","342.6","343.14","101.66","34855.1487"]]}""",
}

LIVE_GATE_RESPONSES = {
    "AAPL": """[{"o":"328.034","v":0,"t":1788483600,"c":"328.148","l":"328.014","h":"328.275","sum":"0"}]""",
    "META": """[{"o":"613.555","v":0,"t":1788483600,"c":"613.388","l":"613.095","h":"613.555","sum":"0"}]""",
    "GOOGL": """[{"o":"342.741","v":0,"t":1788483600,"c":"343.093","l":"342.689","h":"343.093","sum":"0"}]""",
}

LIVE_BINANCE_RESPONSES = {
    "AAPL": """[[1788483600000,"328.15655824","328.36419820","328.10732612","328.16271330","0",1788487199999,"0",3600,"0","0","0"]]""",
    "META": """[[1788483600000,"613.72282198","613.79347058","613.00342454","613.51231605","0",1788487199999,"0",3600,"0","0","0"]]""",
    "GOOGL": """[[1788483600000,"342.68830647","343.15742308","342.59023212","343.13353792","0",1788487199999,"0",3600,"0","0","0"]]""",
}


@pytest.fixture(autouse=True)
def synchronize_message_datetime(direct_vm, monkeypatch):
    original_warp = direct_vm.warp

    def warp(timestamp):
        original_warp(timestamp)
        import sys
        gl_module = sys.modules.get("genlayer.gl")
        if gl_module is not None:
            gl_module.message_raw["datetime"] = timestamp

    monkeypatch.setattr(direct_vm, "warp", warp)


def deploy_market(direct_vm, direct_deploy, category=BIG_TECH, start=START_SECONDS):
    contract = direct_deploy(CONTRACT)
    start_dt = datetime.fromtimestamp(start, tz=timezone.utc)
    direct_vm.warp((start_dt - timedelta(seconds=1)).isoformat().replace("+00:00", "Z"))
    market_id = contract.create_market(category, start)
    return contract, market_id


def set_value(direct_vm, amount):
    direct_vm.value = amount


def _source_pattern(source, asset, exact=False, start_seconds=START_SECONDS, end_seconds=END_SECONDS):
    start_ms = start_seconds * 1000
    end_ms = end_seconds * 1000
    if source == BINANCE:
        suffix = rf"\?pair={asset}USDT&interval=1h&startTime={start_ms}&endTime={end_ms}&limit=1$" if exact else rf"\?pair={asset}USDT.*"
        return rf"^https://fapi\.binance\.com/fapi/v1/indexPriceKlines{suffix}"
    if source == BITGET:
        suffix = rf"\?category=USDT-FUTURES&symbol={asset}USDT&interval=1H&type=INDEX&startTime={start_ms}&endTime={end_ms - 1}&limit=1$" if exact else rf"\?.*symbol={asset}USDT.*"
        return rf"^https://api\.bitget\.com/api/v3/market/candles{suffix}"
    suffix = rf"\?contract=index_{asset}_USDT&interval=1h&from={start_seconds}&to={end_seconds - 1}$" if exact else rf"\?.*contract=index_{asset}_USDT.*"
    return rf"^https://api\.gateio\.ws/api/v4/futures/usdt/candlesticks{suffix}"


def _body(source, asset, opening, closing, *, timestamp=None, metadata=None, missing=None):
    if timestamp is None:
        timestamp = START_SECONDS if source == GATE else START_MS
    if source == GATE:
        row = {"t": timestamp, "o": str(opening), "c": str(closing), "h": str(closing), "l": str(opening)}
        if metadata:
            row.update(metadata)
        if missing:
            row.pop("o" if missing == "open" else "c" if missing == "close" else missing, None)
        return json.dumps([row], separators=(",", ":"))
    if source == BINANCE:
        row = [
            timestamp, str(opening), str(closing), str(opening), str(closing), "0",
            timestamp + 3_599_999, "0", "0", "0", "0", "0",
        ]
    else:
        row = [timestamp, str(opening), str(closing), str(opening), str(closing), "0", "0"]
    if missing == "open":
        row = [timestamp]
    elif missing == "close":
        row = [timestamp, str(opening)]
    payload = [row]
    if source == BITGET:
        payload = {"code": "00000", "msg": "success", "data": payload}
        if metadata:
            payload.update(metadata)
    return json.dumps(payload, separators=(",", ":"))


def install_candles(direct_vm, category=BIG_TECH, source_values=None, bad=None, exact=False):
    assets = ASSETS[category]
    source_values = source_values or {source: {asset: (100, 101 - index) for index, asset in enumerate(assets)} for source in SOURCES}
    bad_entries = bad if isinstance(bad, list) else [bad] if bad else []
    for source in SOURCES:
        for index, asset in enumerate(assets):
            opening, closing = source_values[source][asset]
            kwargs = {}
            for bad_entry in bad_entries:
                if bad_entry.get("source") == source and bad_entry.get("asset") == asset:
                    kwargs = {key: value for key, value in bad_entry.items() if key not in ("source", "asset")}
                    break
            status = kwargs.pop("status", 200)
            body = kwargs.pop("body", None)
            opening = kwargs.pop("opening", opening)
            closing = kwargs.pop("closing", closing)
            if body is None:
                body = _body(source, asset, opening, closing, **kwargs)
            direct_vm.mock_web(_source_pattern(source, asset, exact=exact), {"status": status, "body": body})


def install_live_market_fixture(direct_vm):
    for asset in ASSETS[BIG_TECH]:
        direct_vm.mock_web(_source_pattern(BINANCE, asset, exact=True, start_seconds=LIVE_START_SECONDS, end_seconds=LIVE_END_SECONDS), {"status": 200, "body": LIVE_BINANCE_RESPONSES[asset]})
        direct_vm.mock_web(_source_pattern(BITGET, asset, exact=True, start_seconds=LIVE_START_SECONDS, end_seconds=LIVE_END_SECONDS), {"status": 200, "body": LIVE_BITGET_RESPONSES[asset]})
        direct_vm.mock_web(_source_pattern(GATE, asset, exact=True, start_seconds=LIVE_START_SECONDS, end_seconds=LIVE_END_SECONDS), {"status": 200, "body": LIVE_GATE_RESPONSES[asset]})


def prices_for_votes(category, winners):
    assets = ASSETS[category]
    values = {}
    for source, winner in zip(SOURCES, winners):
        if winner == "TIE":
            closes = (101, 101, 99)
        else:
            closes = tuple(101 if asset == winner else 100 if index == 1 else 99 for index, asset in enumerate(assets))
        values[source] = {asset: (100, closes[index]) for index, asset in enumerate(assets)}
    return values


def settle(direct_vm, contract, market_id, category=BIG_TECH, winners=("AAPL", "AAPL", "AAPL"), bad=None):
    install_candles(direct_vm, category, prices_for_votes(category, winners), bad=bad)
    direct_vm.warp(END)
    return contract.settle_market(market_id)
