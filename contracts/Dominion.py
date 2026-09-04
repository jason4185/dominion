# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

import json

from genlayer import *


CATEGORY_BIG_TECH = "BIG TECH"
CATEGORY_AI_GROWTH = "AI & GROWTH"
CATEGORY_CRYPTO_FINTECH = "CRYPTO & FINTECH"

SOURCE_BINANCE = "BINANCE"
SOURCE_BITGET = "BITGET"
SOURCE_GATE = "GATE"

STATE_OPEN = "OPEN"
STATE_SETTLED = "SETTLED"
STATE_INCONCLUSIVE = "INCONCLUSIVE"

SOURCE_VALID = "VALID"
SOURCE_TIE = "TIE"
SOURCE_UNAVAILABLE = "UNAVAILABLE"

DURATION_SECONDS = 3600
PRICE_SCALE = 1_000_000_000_000_000_000
RETURN_SCALE = 1_000_000
MAX_RESPONSE_BYTES = 65_536
GEN_SCALE = 1_000_000_000_000_000_000
MIN_BET = GEN_SCALE
U256_MAX = 2**256 - 1
SETTLEMENT_RETRY_WINDOW_SECONDS = 6 * DURATION_SECONDS
MAX_PAGE_SIZE = 50


def _is_u256(value) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= U256_MAX


@gl.evm.contract_interface
class _NativeRecipient:
    class View:
        pass

    class Write:
        pass


def _assets(category: str) -> list[str]:
    if category == CATEGORY_BIG_TECH:
        return ["AAPL", "META", "GOOGL"]
    if category == CATEGORY_AI_GROWTH:
        return ["NVDA", "PLTR", "TSLA"]
    if category == CATEGORY_CRYPTO_FINTECH:
        return ["MSTR", "COIN", "HOOD"]
    raise gl.vm.UserError("invalid category")


def _is_digits(value: str) -> bool:
    if not value:
        return False
    for char in value:
        if char < "0" or char > "9":
            return False
    return True


def _is_leap(year: int) -> bool:
    return year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)


def _days_in_month(year: int, month: int) -> int:
    if month == 2:
        return 29 if _is_leap(year) else 28
    if month == 4 or month == 6 or month == 9 or month == 11:
        return 30
    return 31


def _epoch_seconds(year: int, month: int, day: int, hour: int, minute: int, second: int) -> int:
    adjusted_year = year - (1 if month <= 2 else 0)
    era = adjusted_year // 400
    year_of_era = adjusted_year - era * 400
    month_prime = month + (-3 if month > 2 else 9)
    day_of_year = (153 * month_prime + 2) // 5 + day - 1
    day_of_era = year_of_era * 365 + year_of_era // 4 - year_of_era // 100 + day_of_year
    days = era * 146097 + day_of_era - 719468
    return days * 86400 + hour * 3600 + minute * 60 + second


def _parse_iso(value: str) -> int | None:
    if not isinstance(value, str) or len(value) < 20:
        return None
    if value[4] != "-" or value[7] != "-" or value[10] != "T":
        return None
    if value[13] != ":" or value[16] != ":":
        return None
    if not _is_digits(value[0:4]) or not _is_digits(value[5:7]) or not _is_digits(value[8:10]):
        return None
    if not _is_digits(value[11:13]) or not _is_digits(value[14:16]) or not _is_digits(value[17:19]):
        return None
    year = int(value[0:4])
    month = int(value[5:7])
    day = int(value[8:10])
    hour = int(value[11:13])
    minute = int(value[14:16])
    second = int(value[17:19])
    if year < 1970 or year > 9999 or month < 1 or month > 12:
        return None
    if day < 1 or day > _days_in_month(year, month):
        return None
    if hour > 23 or minute > 59 or second > 59:
        return None
    suffix = value[19:]
    if suffix == "Z":
        pass
    elif suffix.startswith(".") and suffix.endswith("Z") and _is_digits(suffix[1:-1]) and len(suffix[1:-1]) <= 9:
        pass
    else:
        return None
    return _epoch_seconds(year, month, day, hour, minute, second)


def _now() -> int | None:
    """Return deterministic transaction time from the GenLayer message."""
    return _parse_iso(gl.message_raw["datetime"])


def _parse_integer(value) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if value >= 0 else None
    if not isinstance(value, str) or len(value) > 40 or not _is_digits(value):
        return None
    return int(value)


def _parse_price(value):
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        text = str(value)
    elif isinstance(value, str):
        text = value
    else:
        return None
    if len(text) == 0 or len(text) > 60 or text.startswith("+") or text.startswith("-"):
        return None
    pieces = text.split(".")
    if len(pieces) > 2 or not _is_digits(pieces[0]) or len(pieces[0]) > 38:
        return None
    fraction = pieces[1] if len(pieces) == 2 else ""
    if fraction and (not _is_digits(fraction) or len(fraction) > 18):
        return None
    scaled = int(pieces[0]) * PRICE_SCALE + int((fraction + "0" * 18)[:18])
    if scaled <= 0:
        return None
    canonical_fraction = fraction.rstrip("0")
    canonical = str(int(pieces[0]))
    if canonical_fraction:
        canonical += "." + canonical_fraction
    return scaled, canonical


def _return_units(open_scaled: int, close_scaled: int) -> int:
    numerator = (close_scaled - open_scaled) * 100 * RETURN_SCALE
    if numerator >= 0:
        return (numerator + open_scaled // 2) // open_scaled
    return -((-numerator + open_scaled // 2) // open_scaled)


def _add_u256(left: int, right: int) -> int:
    if left < 0 or right < 0 or left > U256_MAX or right > U256_MAX or left > U256_MAX - right:
        raise gl.vm.UserError("u256 addition overflow")
    return left + right


def _mul_u256(left: int, right: int) -> int:
    if left < 0 or right < 0 or left > U256_MAX or right > U256_MAX or (right > 0 and left > U256_MAX // right):
        raise gl.vm.UserError("u256 multiplication overflow")
    return left * right


def _mul_div_u256(numerator: int, multiplier: int, denominator: int) -> int:
    """Compute floor(numerator * multiplier / denominator) without a wide product."""
    if numerator < 0 or multiplier < 0 or denominator <= 0 or numerator > denominator:
        raise gl.vm.UserError("invalid payout arithmetic")
    quotient = 0
    remainder = 0
    for bit_index in range(256):
        bit = (numerator >> (255 - bit_index)) & 1
        carry = remainder * 2 + (multiplier if bit else 0)
        added, remainder = divmod(carry, denominator)
        quotient = quotient * 2 + added
    if quotient > U256_MAX:
        raise gl.vm.UserError("u256 payout overflow")
    return quotient


def _request_json(url: str):
    try:
        response = gl.nondet.web.get(url, headers={"Accept": "application/json"})
        if response.status != 200 or response.body is None or len(response.body) > MAX_RESPONSE_BYTES:
            return None
        return json.loads(response.body.decode("utf-8"))
    except (gl.vm.UserError, ValueError, TypeError, UnicodeError, AttributeError):
        return None


def _array_candle(payload, timestamp: int, source: str):
    if not isinstance(payload, list) or len(payload) == 0 or len(payload) > 3:
        return None
    found = None
    for row in payload:
        expected_length = 12 if source == SOURCE_BINANCE else 7
        if not isinstance(row, list) or len(row) != expected_length:
            return None
        row_timestamp = _parse_integer(row[0])
        if row_timestamp != timestamp:
            return None
        if source == SOURCE_BINANCE and _parse_integer(row[6]) != _add_u256(timestamp, 3_599_999):
            return None
        if found is not None:
            return None
        found = row
    if found is None:
        return None
    opening = _parse_price(found[1])
    closing = _parse_price(found[4])
    if opening is None or closing is None:
        return None
    return timestamp, opening, closing


def _gate_candle(payload, timestamp: int, asset: str):
    if not isinstance(payload, list) or len(payload) == 0 or len(payload) > 3:
        return None
    found = None
    for row in payload:
        if not isinstance(row, dict) or len(row) > 10:
            return None
        if "t" not in row or "o" not in row or "c" not in row:
            return None
        if row.get("source", SOURCE_GATE) != SOURCE_GATE or row.get("asset", asset) != asset or row.get("contract", "index_" + asset + "_USDT") != "index_" + asset + "_USDT" or row.get("interval", "1h") != "1h":
            return None
        row_timestamp = _parse_integer(row["t"])
        if row_timestamp != timestamp:
            return None
        if found is not None:
            return None
        found = row
    if found is None:
        return None
    opening = _parse_price(found["o"])
    closing = _parse_price(found["c"])
    if opening is None or closing is None:
        return None
    return timestamp, opening, closing


def _fetch_candle(source: str, asset: str, start_seconds: int, end_seconds: int):
    start_ms = _mul_u256(start_seconds, 1000)
    end_ms = _mul_u256(end_seconds, 1000)
    if source == SOURCE_BINANCE:
        url = "https://fapi.binance.com/fapi/v1/indexPriceKlines?pair=" + asset + "USDT&interval=1h&startTime=" + str(start_ms) + "&endTime=" + str(end_ms) + "&limit=1"
        return _array_candle(_request_json(url), start_ms, SOURCE_BINANCE)
    if source == SOURCE_BITGET:
        url = "https://api.bitget.com/api/v3/market/candles?category=USDT-FUTURES&symbol=" + asset + "USDT&interval=1H&type=INDEX&startTime=" + str(start_ms) + "&endTime=" + str(end_ms - 1) + "&limit=1"
        payload = _request_json(url)
        if not isinstance(payload, dict) or payload.get("code") != "00000" or "data" not in payload:
            return None
        if payload.get("source", SOURCE_BITGET) != SOURCE_BITGET or payload.get("category", "USDT-FUTURES") != "USDT-FUTURES" or payload.get("asset", asset) != asset or payload.get("symbol", asset + "USDT") != asset + "USDT":
            return None
        if payload.get("interval", "1H") != "1H" or payload.get("type", "INDEX") != "INDEX":
            return None
        return _array_candle(payload["data"], start_ms, SOURCE_BITGET)
    if source == SOURCE_GATE:
        url = "https://api.gateio.ws/api/v4/futures/usdt/candlesticks?contract=index_" + asset + "_USDT&interval=1h&from=" + str(start_seconds) + "&to=" + str(end_seconds - 1)
        return _gate_candle(_request_json(url), start_seconds, asset)
    return None


def _empty_asset(asset: str, market_start: u256, market_end: u256) -> dict:
    return {
        "asset": asset,
        "symbol": asset + "USDT",
        "market_start": market_start,
        "market_end": market_end,
        "candle_timestamp": "",
        "timestamp_unit": "",
        "interval": "1h",
        "open": "",
        "close": "",
        "return_units": 0,
        "valid": False,
    }


def _unavailable_result(source: str, category: str, market_start: u256, market_end: u256) -> dict:
    return {
        "source": source,
        "category": category,
        "market_start": market_start,
        "market_end": market_end,
        "interval": "1h",
        "source_status": SOURCE_UNAVAILABLE,
        "source_winner": "",
        "assets": [_empty_asset(asset, market_start, market_end) for asset in _assets(category)],
    }


def _source_result(source: str, category: str, market_start: u256, market_end: u256, start_seconds: u256) -> dict:
    assets = _assets(category)
    end_seconds = _add_u256(start_seconds, DURATION_SECONDS)
    rows = []
    for asset in assets:
        candle = _fetch_candle(source, asset, start_seconds, end_seconds)
        if candle is None:
            return _unavailable_result(source, category, market_start, market_end)
        timestamp, opening, closing = candle
        opening_scaled, opening_text = opening
        closing_scaled, closing_text = closing
        rows.append({
            "asset": asset,
            "symbol": asset + "USDT",
            "market_start": market_start,
            "market_end": market_end,
            "candle_timestamp": str(timestamp),
            "timestamp_unit": "s" if source == SOURCE_GATE else "ms",
            "interval": "1h",
            "open": opening_text,
            "close": closing_text,
            "return_units": _return_units(opening_scaled, closing_scaled),
            "valid": True,
        })
    highest = rows[0]["return_units"]
    winner = rows[0]["asset"]
    tied = False
    for row in rows[1:]:
        value = row["return_units"]
        if value > highest:
            highest = value
            winner = row["asset"]
            tied = False
        elif value == highest:
            tied = True
    if tied:
        winner = ""
        status = SOURCE_TIE
    else:
        status = SOURCE_VALID
    return {
        "source": source,
        "category": category,
        "market_start": market_start,
        "market_end": market_end,
        "interval": "1h",
        "source_status": status,
        "source_winner": winner,
        "assets": rows,
    }


def _evidence_key(evidence: dict, source: str, category: str, market_start: u256, market_end: u256, start_seconds: u256):
    if not isinstance(evidence, dict):
        return None
    reported_source = evidence.get("source")
    status = evidence.get("source_status")
    winner = evidence.get("source_winner")
    if reported_source not in (SOURCE_BINANCE, SOURCE_BITGET, SOURCE_GATE) or reported_source != source:
        return None
    if not isinstance(status, str) or not isinstance(winner, str):
        return None
    if evidence.get("category") != category or evidence.get("market_start") != market_start or evidence.get("market_end") != market_end or evidence.get("interval") != "1h":
        return None
    rows = evidence.get("assets")
    expected_assets = _assets(category)
    if not isinstance(rows, list) or len(rows) != 3:
        return None
    if status not in (SOURCE_VALID, SOURCE_TIE, SOURCE_UNAVAILABLE):
        return None
    if status == SOURCE_VALID and winner not in expected_assets:
        return None
    if status != SOURCE_VALID and winner != "":
        return None
    parts = [reported_source, category, str(market_start), str(market_end), "1h", status, winner]
    for index in range(3):
        row = rows[index]
        if not isinstance(row, dict) or row.get("asset") != expected_assets[index] or row.get("symbol") != expected_assets[index] + "USDT":
            return None
        if row.get("market_start") != market_start or row.get("market_end") != market_end or row.get("interval") != "1h":
            return None
        if not isinstance(row.get("candle_timestamp"), str) or not isinstance(row.get("timestamp_unit"), str):
            return None
        if not isinstance(row.get("open"), str) or not isinstance(row.get("close"), str):
            return None
        if not isinstance(row.get("return_units"), int) or not isinstance(row.get("valid"), bool):
            return None
        expected_timestamp = str(start_seconds if source == SOURCE_GATE else _mul_u256(start_seconds, 1000))
        expected_unit = "s" if source == SOURCE_GATE else "ms"
        if row["valid"] != (status != SOURCE_UNAVAILABLE):
            return None
        if row["valid"]:
            if row["candle_timestamp"] != expected_timestamp or row["timestamp_unit"] != expected_unit:
                return None
            opening = _parse_price(row["open"])
            closing = _parse_price(row["close"])
            if opening is None or closing is None or row["return_units"] != _return_units(opening[0], closing[0]):
                return None
        elif row["candle_timestamp"] != "" or row["timestamp_unit"] != "" or row["open"] != "" or row["close"] != "":
            return None
        parts.extend([
            row["asset"], row["symbol"], row["candle_timestamp"], row["timestamp_unit"],
            row["interval"], row["open"], row["close"], str(row["return_units"]), str(row["valid"]),
        ])
    return "\x1f".join(parts)


def _source_consensus(source: str, category: str, market_start: u256, market_end: u256, start_seconds: u256) -> dict:
    def leader_fn():
        return _source_result(source, category, market_start, market_end, start_seconds)

    def validator_fn(leaders_result) -> bool:
        if not isinstance(leaders_result, gl.vm.Return):
            return False
        leader_key = _evidence_key(leaders_result.calldata, source, category, market_start, market_end, start_seconds)
        if leader_key is None:
            return False
        validator_result = _source_result(source, category, market_start, market_end, start_seconds)
        return leader_key == _evidence_key(validator_result, source, category, market_start, market_end, start_seconds)

    return gl.vm.run_nondet(leader_fn, validator_fn)


def _consensus_winner(results: list[dict]) -> str:
    votes = []
    for result in results:
        if result.get("source_status") == SOURCE_VALID:
            votes.append(result.get("source_winner", ""))
        else:
            votes.append("")
    if votes[0] and votes[0] == votes[1]:
        return votes[0]
    if votes[0] and votes[0] == votes[2]:
        return votes[0]
    if votes[1] and votes[1] == votes[2]:
        return votes[1]
    return ""


class Dominion(gl.Contract):
    market_count: u256
    market_category: TreeMap[u256, str]
    market_start_seconds: TreeMap[u256, u256]
    market_end_seconds: TreeMap[u256, u256]
    market_state: TreeMap[u256, str]
    market_winner: TreeMap[u256, str]
    market_creation_keys: TreeMap[str, u256]
    market_source_evidence: TreeMap[str, str]
    market_pool: TreeMap[u256, u256]
    market_winning_pool: TreeMap[u256, u256]
    market_claimed_pool: TreeMap[u256, u256]
    market_claimed_winning_stake: TreeMap[u256, u256]
    market_refunded_pool: TreeMap[u256, u256]
    market_settlement_deadline: TreeMap[u256, u256]
    outcome_pool: TreeMap[str, u256]
    bettor_outcome: TreeMap[str, str]
    bettor_stake: TreeMap[str, u256]
    bettor_claimed: TreeMap[str, bool]
    bettor_refunded: TreeMap[str, bool]
    user_market_count: TreeMap[str, u256]
    user_market_index: TreeMap[str, u256]
    user_activity_count: TreeMap[str, u256]
    user_activity: TreeMap[str, str]

    def __init__(self):
        self.market_count = 0

    def _require_market(self, market_id: u256) -> None:
        if not isinstance(market_id, int) or market_id <= 0 or market_id > self.market_count or market_id not in self.market_category:
            raise gl.vm.UserError("market not found")

    def _source_key(self, market_id: u256, source: str) -> str:
        return str(market_id) + ":" + source

    def _outcome_key(self, market_id: u256, asset: str) -> str:
        return str(market_id) + ":" + asset

    def _bettor_key(self, market_id: u256) -> str:
        return str(market_id) + ":" + gl.message.sender_address.as_hex

    def _position_key(self, market_id: u256, user: Address) -> str:
        return str(market_id) + ":" + user.as_hex

    def _user_key(self, user: Address) -> str:
        return user.as_hex

    def _activity_key(self, user: Address, index: u256) -> str:
        return user.as_hex + ":" + str(index)

    def _next_activity(self, user: Address) -> tuple[int, int]:
        index = self.user_activity_count.get(self._user_key(user), 0)
        return index, _add_u256(index, 1)

    def _activity_record(self, user: Address, activity_type: str, market_id: u256, asset: str, amount: u256, index: u256) -> str:
        return json.dumps({
            "id": index,
            "wallet": user.as_hex,
            "market_id": market_id,
            "type": activity_type,
            "asset": asset,
            "amount": amount,
            "timestamp": gl.message_raw["datetime"],
        }, separators=(",", ":"), sort_keys=True)

    def _market_preview(self, market_id: u256) -> dict:
        category = self.market_category[market_id]
        assets = _assets(category)
        state = self.market_state[market_id]
        total_pool = self.market_pool.get(market_id, 0)
        claimed_pool = self.market_claimed_pool.get(market_id, 0)
        refunded_pool = self.market_refunded_pool.get(market_id, 0)
        consumed_pool = claimed_pool if state == STATE_SETTLED else refunded_pool if state == STATE_INCONCLUSIVE else 0
        if claimed_pool > total_pool or refunded_pool > total_pool:
            raise gl.vm.UserError("market liability overflow")
        now_seconds = _now()
        market_start = self.market_start_seconds[market_id]
        end_seconds = self.market_end_seconds[market_id]
        return {
            "id": market_id,
            "category": category,
            "assets": assets,
            "market_start": market_start,
            "market_end": end_seconds,
            "betting_close": market_start,
            "duration_seconds": DURATION_SECONDS,
            "state": state,
            "winner": self.market_winner[market_id],
            "total_pool": total_pool,
            "outcome_pools": {
                asset: self.outcome_pool.get(self._outcome_key(market_id, asset), 0)
                for asset in assets
            },
            "betting_open": state == STATE_OPEN and now_seconds is not None and now_seconds < self.market_start_seconds[market_id],
            "settlement_available": state == STATE_OPEN and now_seconds is not None and now_seconds >= end_seconds,
            "settlement_deadline": self.market_settlement_deadline[market_id],
            "winning_pool": self.market_winning_pool.get(market_id, 0),
            "claimed_pool": claimed_pool,
            "refunded_pool": refunded_pool,
            "remaining_pool": total_pool - consumed_pool,
        }

    def _send_value(self, amount: u256) -> None:
        _NativeRecipient(gl.message.sender_address).emit_transfer(value=amount)

    def _record_activity(self, market_id: u256, record: str, index: u256, next_index: u256) -> None:
        user = gl.message.sender_address
        user_key = self._user_key(user)
        self.user_activity[self._activity_key(user, index)] = record
        self.user_activity_count[user_key] = next_index

    def _position_view(self, market_id: u256, user: Address) -> dict:
        self._require_market(market_id)
        category = self.market_category[market_id]
        key = self._position_key(market_id, user)
        asset = self.bettor_outcome.get(key, "")
        stake = self.bettor_stake.get(key, 0)
        state = self.market_state[market_id]
        claimed = self.bettor_claimed.get(key, False)
        refunded = self.bettor_refunded.get(key, False)
        winner = self.market_winner[market_id]
        now_seconds = _now()
        position_won = state == STATE_SETTLED and stake > 0 and asset == winner
        position_lost = state == STATE_SETTLED and stake > 0 and asset != winner
        claim_available = False
        refund_available = state == STATE_INCONCLUSIVE and stake > 0 and not refunded
        claimable_amount = 0
        claim_type = "NONE"
        if position_won and not claimed:
            winning_pool = self.market_winning_pool.get(market_id, 0)
            claimed_stake = self.market_claimed_winning_stake.get(market_id, 0)
            claimed_pool = self.market_claimed_pool.get(market_id, 0)
            total_pool = self.market_pool.get(market_id, 0)
            if winning_pool > 0 and claimed_stake <= winning_pool and claimed_pool <= total_pool:
                new_stake = _add_u256(claimed_stake, stake)
                if new_stake <= winning_pool:
                    if new_stake == winning_pool:
                        claimable_amount = total_pool - claimed_pool
                    else:
                        claimable_amount = _mul_div_u256(stake, total_pool, winning_pool)
                    claim_available = claimable_amount > 0
                    if claim_available:
                        claim_type = "WINNINGS"
        if refund_available:
            claimable_amount = stake
            claim_type = "REFUND"
        return {
            "market_id": market_id,
            "has_position": stake > 0,
            "selected_asset": asset,
            "total_stake": stake,
            "can_top_up": state == STATE_OPEN and now_seconds is not None and now_seconds < self.market_start_seconds[market_id] and stake > 0,
            "position_won": position_won,
            "position_lost": position_lost,
            "claim_available": claim_available,
            "refund_available": refund_available,
            "already_claimed": claimed,
            "refunded": refunded,
            "claimable_amount": claimable_amount,
            "claim_type": claim_type,
        }

    @gl.public.view
    def categories(self) -> list[str]:
        return [CATEGORY_BIG_TECH, CATEGORY_AI_GROWTH, CATEGORY_CRYPTO_FINTECH]

    @gl.public.view
    def category_assets(self, category: str) -> list[str]:
        return _assets(category)

    @gl.public.view
    def get_config(self) -> dict:
        return {
            "protocol": "Dominion V1",
            "categories": self.categories(),
            "category_assets": {
                CATEGORY_BIG_TECH: _assets(CATEGORY_BIG_TECH),
                CATEGORY_AI_GROWTH: _assets(CATEGORY_AI_GROWTH),
                CATEGORY_CRYPTO_FINTECH: _assets(CATEGORY_CRYPTO_FINTECH),
            },
            "duration_seconds": DURATION_SECONDS,
            "minimum_bet": MIN_BET,
            "fee_bps": 0,
            "sources": [SOURCE_BINANCE, SOURCE_BITGET, SOURCE_GATE],
            "consensus_threshold": 2,
            "timezone": "UTC",
            "return_precision_units": RETURN_SCALE,
            "price_precision": PRICE_SCALE,
            "payout_rounding": "floor; final winning claimant receives remaining pool",
            "zero_bettor_behavior": "valid consensus settles with no claims",
            "zero_backed_winner_behavior": "inconclusive with original-stake refunds",
            "settlement_retry_window_seconds": SETTLEMENT_RETRY_WINDOW_SECONDS,
            "max_page_size": MAX_PAGE_SIZE,
        }

    @gl.public.view
    def get_market(self, market_id: u256) -> dict:
        self._require_market(market_id)
        return self._market_preview(market_id)

    def _page_bounds(self, offset: u256, limit: u256, count: u256) -> tuple[int, int]:
        if limit > MAX_PAGE_SIZE:
            raise gl.vm.UserError("page limit exceeded")
        if offset >= count or limit == 0:
            return 0, 0
        end = min(count, _add_u256(offset, limit))
        return offset, end

    @gl.public.view
    def get_markets(self, offset: u256, limit: u256) -> list[dict]:
        start, end = self._page_bounds(offset, limit, self.market_count)
        return [self._market_preview(index + 1) for index in range(start, end)]

    @gl.public.view
    def get_open_markets(self, offset: u256, limit: u256) -> list[dict]:
        start, end = self._page_bounds(offset, limit, self.market_count)
        results = []
        for index in range(start, end):
            market_id = index + 1
            market = self._market_preview(market_id)
            if market["betting_open"]:
                results.append(market)
        return results

    @gl.public.view
    def get_user_position(self, market_id: u256, user: Address) -> dict:
        return self._position_view(market_id, user)

    def _user_market_page(self, user: Address, offset: u256, limit: u256, claimable_only: bool) -> list[dict]:
        user_key = self._user_key(user)
        count = self.user_market_count.get(user_key, 0)
        start, end = self._page_bounds(offset, limit, count)
        results = []
        for index in range(start, end):
            market_id = self.user_market_index[user_key + ":" + str(index)]
            position = self._position_view(market_id, user)
            if not claimable_only or position["claim_available"] or position["refund_available"]:
                results.append(position)
        return results

    @gl.public.view
    def get_user_positions(self, user: Address, offset: u256, limit: u256) -> list[dict]:
        return self._user_market_page(user, offset, limit, False)

    @gl.public.view
    def get_claimable_markets(self, user: Address, offset: u256, limit: u256) -> list[dict]:
        return self._user_market_page(user, offset, limit, True)

    @gl.public.view
    def get_market_by_category_start(self, category: str, market_start: u256) -> dict:
        _assets(category)
        if not _is_u256(market_start):
            raise gl.vm.UserError("market start must be u256")
        if market_start % DURATION_SECONDS != 0:
            raise gl.vm.UserError("market start must be exact UTC hour")
        key = category + "\x1f" + str(market_start)
        if key not in self.market_creation_keys:
            raise gl.vm.UserError("market not found")
        return self._market_preview(self.market_creation_keys[key])

    @gl.public.view
    def get_user_activity_count(self, user: Address) -> u256:
        return self.user_activity_count.get(self._user_key(user), 0)

    @gl.public.view
    def get_user_activity(self, user: Address, offset: u256, limit: u256) -> list[dict]:
        user_key = self._user_key(user)
        count = self.user_activity_count.get(user_key, 0)
        start, end = self._page_bounds(offset, limit, count)
        return [json.loads(self.user_activity[self._activity_key(user, index)]) for index in range(start, end)]

    @gl.public.view
    def get_source_evidence(self, market_id: u256, source: str) -> dict:
        self._require_market(market_id)
        if source != SOURCE_BINANCE and source != SOURCE_BITGET and source != SOURCE_GATE:
            raise gl.vm.UserError("invalid source")
        key = self._source_key(market_id, source)
        if key not in self.market_source_evidence:
            raise gl.vm.UserError("source evidence unavailable")
        return json.loads(self.market_source_evidence[key])

    @gl.public.view
    def get_betting_state(self, market_id: u256) -> dict:
        self._require_market(market_id)
        category = self.market_category[market_id]
        bettor_key = self._bettor_key(market_id)
        return {
            "total_market_pool": self.market_pool.get(market_id, 0),
            "outcome_stakes": {
                asset: self.outcome_pool.get(self._outcome_key(market_id, asset), 0)
                for asset in _assets(category)
            },
            "bettor_asset": self.bettor_outcome.get(bettor_key, ""),
            "bettor_stake": self.bettor_stake.get(bettor_key, 0),
            "claimed": self.bettor_claimed.get(bettor_key, False),
            "refunded": self.bettor_refunded.get(bettor_key, False),
            "winning_pool": self.market_winning_pool.get(market_id, 0),
            "claimed_pool": self.market_claimed_pool.get(market_id, 0),
            "claimed_winning_stake": self.market_claimed_winning_stake.get(market_id, 0),
            "refunded_pool": self.market_refunded_pool.get(market_id, 0),
        }

    @gl.public.write
    def create_market(self, category: str, market_start: u256) -> u256:
        if not _is_u256(market_start):
            raise gl.vm.UserError("market start must be u256")
        if market_start % DURATION_SECONDS != 0:
            raise gl.vm.UserError("market start must be exact UTC hour")
        now_seconds = _now()
        if now_seconds is None or market_start <= now_seconds:
            raise gl.vm.UserError("market start must be in future")
        _assets(category)
        market_key = category + "\x1f" + str(market_start)
        if market_key in self.market_creation_keys:
            raise gl.vm.UserError("market already exists")
        market_id = _add_u256(self.market_count, 1)
        start_seconds = market_start
        end_seconds = _add_u256(start_seconds, DURATION_SECONDS)
        settlement_deadline = _add_u256(end_seconds, SETTLEMENT_RETRY_WINDOW_SECONDS)
        _mul_u256(end_seconds, 1000)
        self.market_count = market_id
        self.market_category[market_id] = category
        self.market_start_seconds[market_id] = start_seconds
        self.market_end_seconds[market_id] = end_seconds
        self.market_state[market_id] = STATE_OPEN
        self.market_winner[market_id] = ""
        self.market_pool[market_id] = 0
        self.market_winning_pool[market_id] = 0
        self.market_claimed_pool[market_id] = 0
        self.market_claimed_winning_stake[market_id] = 0
        self.market_refunded_pool[market_id] = 0
        self.market_settlement_deadline[market_id] = settlement_deadline
        self.market_creation_keys[market_key] = market_id
        return market_id

    @gl.public.write.payable
    def place_bet(self, market_id: u256, asset: str) -> None:
        self._require_market(market_id)
        if self.market_state[market_id] != STATE_OPEN:
            raise gl.vm.UserError("market is not open")
        now_seconds = _now()
        if now_seconds is None or now_seconds >= self.market_start_seconds[market_id]:
            raise gl.vm.UserError("betting is closed")
        if asset not in _assets(self.market_category[market_id]):
            raise gl.vm.UserError("invalid market asset")
        amount = gl.message.value
        if amount < MIN_BET:
            raise gl.vm.UserError("minimum bet is 1 GEN")
        bettor_key = self._bettor_key(market_id)
        chosen = self.bettor_outcome.get(bettor_key, "")
        if chosen and chosen != asset:
            raise gl.vm.UserError("wallet outcome already selected")
        outcome_key = self._outcome_key(market_id, asset)
        old_stake = self.bettor_stake.get(bettor_key, 0)
        old_outcome_pool = self.outcome_pool.get(outcome_key, 0)
        old_market_pool = self.market_pool.get(market_id, 0)
        new_stake = _add_u256(old_stake, amount)
        new_outcome_pool = _add_u256(old_outcome_pool, amount)
        new_market_pool = _add_u256(old_market_pool, amount)
        user = gl.message.sender_address
        user_key = self._user_key(user)
        activity_index, next_activity_index = self._next_activity(user)
        activity_record = self._activity_record(user, "BET_PLACED" if not chosen else "BET_TOPPED_UP", market_id, asset, amount, activity_index)
        market_index = self.user_market_count.get(user_key, 0)
        if not chosen:
            next_market_index = _add_u256(market_index, 1)
            self.user_market_index[user_key + ":" + str(market_index)] = market_id
            self.user_market_count[user_key] = next_market_index
            self.bettor_outcome[bettor_key] = asset
        self.bettor_stake[bettor_key] = new_stake
        self.outcome_pool[outcome_key] = new_outcome_pool
        self.market_pool[market_id] = new_market_pool
        self._record_activity(market_id, activity_record, activity_index, next_activity_index)

    @gl.public.write
    def claim(self, market_id: u256) -> None:
        self._require_market(market_id)
        if self.market_state[market_id] != STATE_SETTLED:
            raise gl.vm.UserError("market is not settled")
        bettor_key = self._bettor_key(market_id)
        if self.bettor_claimed.get(bettor_key, False):
            raise gl.vm.UserError("payout already claimed")
        if self.bettor_refunded.get(bettor_key, False):
            raise gl.vm.UserError("position already refunded")
        asset = self.bettor_outcome.get(bettor_key, "")
        if asset != self.market_winner[market_id]:
            raise gl.vm.UserError("not a winning bettor")
        stake = self.bettor_stake.get(bettor_key, 0)
        if stake <= 0:
            raise gl.vm.UserError("no bettor stake")
        winning_pool = self.market_winning_pool.get(market_id, 0)
        if winning_pool <= 0:
            raise gl.vm.UserError("winning pool is empty")
        total_pool = self.market_pool.get(market_id, 0)
        claimed_pool = self.market_claimed_pool.get(market_id, 0)
        claimed_stake = self.market_claimed_winning_stake.get(market_id, 0)
        if claimed_pool > total_pool or claimed_stake > winning_pool:
            raise gl.vm.UserError("claimed accounting exceeds pool")
        new_claimed_stake = _add_u256(claimed_stake, stake)
        if new_claimed_stake > winning_pool:
            raise gl.vm.UserError("winning stake accounting exceeds pool")
        if new_claimed_stake == winning_pool:
            payout = total_pool - claimed_pool
        else:
            payout = _mul_div_u256(stake, total_pool, winning_pool)
        if payout <= 0:
            raise gl.vm.UserError("payout is empty")
        remaining_pool = total_pool - claimed_pool
        if payout > remaining_pool:
            raise gl.vm.UserError("payout exceeds remaining pool")
        new_claimed_pool = _add_u256(claimed_pool, payout)
        if new_claimed_pool > total_pool:
            raise gl.vm.UserError("claimed pool exceeds total pool")
        activity_index, next_activity_index = self._next_activity(gl.message.sender_address)
        activity_record = self._activity_record(gl.message.sender_address, "PAYOUT_CLAIMED", market_id, asset, payout, activity_index)
        self.bettor_claimed[bettor_key] = True
        self.market_claimed_pool[market_id] = new_claimed_pool
        self.market_claimed_winning_stake[market_id] = new_claimed_stake
        self._record_activity(market_id, activity_record, activity_index, next_activity_index)
        self._send_value(payout)

    @gl.public.write
    def claim_refund(self, market_id: u256) -> None:
        self._require_market(market_id)
        if self.market_state[market_id] != STATE_INCONCLUSIVE:
            raise gl.vm.UserError("market is not inconclusive")
        bettor_key = self._bettor_key(market_id)
        if self.bettor_refunded.get(bettor_key, False):
            raise gl.vm.UserError("refund already claimed")
        if self.bettor_claimed.get(bettor_key, False):
            raise gl.vm.UserError("position already claimed")
        stake = self.bettor_stake.get(bettor_key, 0)
        if stake <= 0:
            raise gl.vm.UserError("no bettor stake")
        total_pool = self.market_pool.get(market_id, 0)
        refunded_pool = self.market_refunded_pool.get(market_id, 0)
        if refunded_pool > total_pool:
            raise gl.vm.UserError("refunded accounting exceeds pool")
        if stake > total_pool - refunded_pool:
            raise gl.vm.UserError("refund exceeds remaining pool")
        new_refunded_pool = _add_u256(refunded_pool, stake)
        if new_refunded_pool > total_pool:
            raise gl.vm.UserError("refunded pool exceeds total pool")
        activity_index, next_activity_index = self._next_activity(gl.message.sender_address)
        refund_asset = self.bettor_outcome.get(bettor_key, "")
        activity_record = self._activity_record(gl.message.sender_address, "REFUND_CLAIMED", market_id, refund_asset, stake, activity_index)
        self.bettor_refunded[bettor_key] = True
        self.market_refunded_pool[market_id] = new_refunded_pool
        self._record_activity(market_id, activity_record, activity_index, next_activity_index)
        self._send_value(stake)

    @gl.public.write
    def settle_market(self, market_id: u256) -> str:
        self._require_market(market_id)
        if self.market_state[market_id] != STATE_OPEN:
            raise gl.vm.UserError("market is not open")
        now_seconds = _now()
        if now_seconds is None or now_seconds < self.market_end_seconds[market_id]:
            raise gl.vm.UserError("market has not expired")
        if now_seconds >= self.market_settlement_deadline[market_id]:
            self.market_state[market_id] = STATE_INCONCLUSIVE
            self.market_winner[market_id] = ""
            return STATE_INCONCLUSIVE
        category = self.market_category[market_id]
        market_start = self.market_start_seconds[market_id]
        market_end = self.market_end_seconds[market_id]
        start_seconds = self.market_start_seconds[market_id]
        results = []
        for source in [SOURCE_BINANCE, SOURCE_BITGET, SOURCE_GATE]:
            key = self._source_key(market_id, source)
            if key in self.market_source_evidence:
                raise gl.vm.UserError("duplicate source evidence")
            result = _source_consensus(source, category, market_start, market_end, start_seconds)
            results.append(result)
        winner = _consensus_winner(results)
        for index, source in enumerate([SOURCE_BINANCE, SOURCE_BITGET, SOURCE_GATE]):
            self.market_source_evidence[self._source_key(market_id, source)] = json.dumps(results[index], separators=(",", ":"), sort_keys=True)
        if winner:
            self.market_winner[market_id] = winner
            total_pool = self.market_pool.get(market_id, 0)
            winning_pool = self.outcome_pool.get(self._outcome_key(market_id, winner), 0)
            if total_pool > 0 and winning_pool == 0:
                self.market_state[market_id] = STATE_INCONCLUSIVE
            else:
                self.market_state[market_id] = STATE_SETTLED
                self.market_winning_pool[market_id] = winning_pool
        else:
            self.market_state[market_id] = STATE_INCONCLUSIVE
            self.market_winner[market_id] = ""
        return self.market_state[market_id]
