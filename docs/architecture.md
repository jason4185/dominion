# Dominion V1 architecture

## Scope and ownership

Dominion is a one-hour native-GEN pari-mutuel prediction market. A market is
created with one locked category and one exact UTC hour. Its three assets are
derived from the category. After expiry, three independent index-price sources
are fetched and each source ranks the three assets deterministically. The
contract settles only when two valid, non-tied source winners agree.

The contract owns category and time validation, source URL selection, candle
validation, fixed-point returns, source ranking, validator equivalence,
consensus, betting custody, pool accounting, claims, refunds, and terminal
state transitions. A frontend may display previews and cached data but cannot
provide settlement inputs or payout decisions.

## Locked inputs and timing

| Category | Assets |
| --- | --- |
| `BIG TECH` | AAPL, META, GOOGL |
| `AI & GROWTH` | NVDA, PLTR, TSLA |
| `CRYPTO & FINTECH` | MSTR, COIN, HOOD |

The public market-start input is `market_start: u256`, representing Unix
seconds. It must be divisible by 3,600 for an exact UTC hour and strictly
greater than the deterministic transaction timestamp from
`gl.message_raw["datetime"]`; past, already-started, and exactly-current starts
are rejected. The end is derived as `market_start + 3,600`, and the settlement
deadline is the end plus six hours. Betting closes exactly at `market_start`.
All market times are stored and returned numerically. No wall-clock API is used.
The frontend converts its human-friendly UTC date/hour selection into Unix
seconds before calling the contract.

## Price sources

Only these tightly scoped hosts are used, with index/reference-price candles:

- Binance: `fapi.binance.com/fapi/v1/indexPriceKlines`, pair
  `<ASSET>USDT`, interval `1h`, exact millisecond start/end, limit 1.
- Bitget: `api.bitget.com/api/v3/market/candles`, category `USDT-FUTURES`,
  symbol `<ASSET>USDT`, interval `1H`, type `INDEX`, exact millisecond
  start/end, limit 1.
- Gate: `api.gateio.ws/api/v4/futures/usdt/candlesticks`, contract
  `index_<ASSET>_USDT`, interval `1h`, exact second `from`/`to`.

For every source, all three category assets must have one exact completed
candle. The implementation rejects malformed JSON or shape, wrong source or
symbol metadata, wrong category/asset, wrong interval, missing or duplicate
candles, stale/future timestamps, non-positive or non-numeric open/close
prices, oversized bodies, HTTP errors, and unexpected source identifiers.
Fetched data is treated as untrusted text; no LLM interprets it.

## Deterministic settlement

Prices are decimal strings scaled to integers at `10^18`. A return is a signed
integer number of `10^-6` percentage points:

`return_units = round_half_away_from_zero((close - open) * 100 * 10^6 / open)`

The highest numerical return wins, including when every return is negative.
Equal return units produce `TIE` and no source vote. Raw prices and returns
are never averaged.

The leader and validator independently fetch and normalize each source. Their
equivalence key compares only source, category, market times, interval, source
status/winner, and the three deterministic candle evidence rows. Validators do
not choose prices, returns, category membership, timing, ties, or final
consensus.

Source votes are Binance, Bitget, and Gate in that order. `TIE` and
`UNAVAILABLE` are empty votes. Any pair of equal non-empty votes settles; every
other combination is inconclusive.

| Source votes | State | Winner |
| --- | --- | --- |
| 3 equal valid | `SETTLED` | agreeing asset |
| 2 equal valid; third differs, tied, or unavailable | `SETTLED` | agreeing asset |
| 1 valid; two tied/unavailable | `INCONCLUSIVE` | empty |
| 2 valid disagree; third tied/unavailable | `INCONCLUSIVE` | empty |
| 3 valid disagree | `INCONCLUSIVE` | empty |
| 2 tied; one valid, or all tied/unavailable | `INCONCLUSIVE` | empty |

## States and betting

The state machine has only `OPEN`, `SETTLED`, and `INCONCLUSIVE`. Markets are
open for bets only before start. There is no cancellation, side switching,
cash-out, leverage, dynamic odds, AMM, or order book.

Settlement is retryable from the stored market end through a six-hour retry
window. If a nondeterministic settlement execution cannot reach consensus by
the stored deadline, the next permissionless `settle_market` call deterministically
sets `INCONCLUSIVE` without another web call. That bounded fallback makes all
expired bettor funds refundable even when providers or validators remain
unavailable forever.

Bets are native GEN. The contract uses `GEN_SCALE = 10^18` base units per GEN
and requires `gl.message.value >= MIN_BET`, where `MIN_BET = GEN_SCALE`.
Amounts are `u256` and all pool and payout arithmetic is integer arithmetic.
There is no Dominion per-user, per-market, or application maximum; amounts are
limited only by protocol/u256/balance constraints.

Each wallet has one selected asset per market. Its first successful bet stores
that asset. Later bets must use the same asset, and their values are added to
the same bettor stake and outcome pool. A different asset is rejected.

## Pari-mutuel accounting

The contract tracks `total_market_pool` and a total for each category asset.
V1 has a 0% fee: no protocol, creator, settlement, or house deduction is made.

For a normally settled market and winning bettor:

`payout = bettor_winning_stake * total_market_pool // total_winning_outcome_stake`

The original winning stake is included in this proportional amount. Ordinary
claims floor. The final claimant, identified when
`claimed_winning_stake + claimant_stake == winning_pool`, receives
`total_market_pool - claimed_pool`. Thus the full pool is distributed and
integer dust is assigned deterministically to the final claimant. The contract
tracks `market_winning_pool`, `market_claimed_pool`, and
`market_claimed_winning_stake` and checks every liability bound before writing.

Losing bettors receive no payout. Claims are pull-based: settlement never loops
over bettors or sends funds to them. Each claim/refund status and aggregate
liability update is written before the finalized transfer message is emitted.
Claim/refund recipients use the supported finalized
`@gl.evm.contract_interface` native transfer to the immediate caller. This
supports both EOAs and EVM contract wallets; no recipient argument is accepted.

Integer division floors ordinary claims. The final winning claimant receives
the remaining market pool, so no rounding dust remains after all winning
claims. The final claimant may receive slightly more than its proportional
floor; this is not a fee.

If valid source consensus exists and the pool is zero, the market is still
`SETTLED` and records the actual winner; there are simply no claims. If bets
exist but the actual winner has zero stake, the actual winner is retained for
audit and the market becomes `INCONCLUSIVE`; every bettor can reclaim exactly
their accumulated original stake. A source-consensus failure is also
`INCONCLUSIVE` with an empty winner and refunds for bettors.

## Persistent storage

Only supported typed `TreeMap` storage is used; dynray is not used. Market IDs
start at 1. Existing market maps store count, category, times, state, winner,
unique creation keys, settlement deadline, and canonical source-evidence JSON.
Betting maps store the market pool, fixed winning pool, claimed/refunded
aggregates, market/outcome totals, bettor outcome, bettor stake, claimed status,
and refunded status. Per-wallet maps store a bounded-pageable market index and
compact activity records. Composite string keys contain market ID, asset, and
the checksummed caller address; wallet index keys contain the checksummed
address and sequence. Assets are derived from category mappings, not duplicated
in storage.

## Public ABI

- `categories() -> string[]`
- `category_assets(category: string) -> string[]`
- `get_market(market_id: u256) -> dict`
- `get_config() -> dict`
- `get_markets(offset: u256, limit: u256) -> dict[]`
- `get_open_markets(offset: u256, limit: u256) -> dict[]`
- `get_user_position(market_id: u256, user: address) -> dict`
- `get_user_positions(user: address, offset: u256, limit: u256) -> dict[]`
- `get_claimable_markets(user: address, offset: u256, limit: u256) -> dict[]`
- `get_market_by_category_start(category: string, market_start: u256) -> dict`
- `get_source_evidence(market_id: u256, source: string) -> dict`
- `get_user_activity_count(user: address) -> u256`
- `get_user_activity(user: address, offset: u256, limit: u256) -> dict[]`
- `get_betting_state(market_id: u256) -> dict` (pool, outcome totals, and the
  caller's outcome/stake/claim/refund status; retained as a compatibility view)

Market previews include state-derived betting/settlement availability,
settlement deadline, outcome pools, winning pool, claimed/refunded totals, and
remaining pool.
- `create_market(category: string, market_start: u256) -> u256`
- `place_bet(market_id: u256, asset: string) payable -> void`
- `settle_market(market_id: u256) -> string`
- `claim(market_id: u256) -> void`
- `claim_refund(market_id: u256) -> void`

Read pages are capped at 50 records. Market pages use zero-based creation
sequence offsets; user pages use zero-based per-wallet index offsets. Open and
claimable pages scan only one bounded page of the relevant creation/user index,
so callers advance the offset without an unbounded loop. Activity records store
wallet, type, market, asset, amount, and deterministic transaction timestamp
only.
Read/unread status is intentionally off-chain.

## Funds safety boundary

There is no admin, creator, treasury, emergency, cancellation, winner override,
or arbitrary recovery method. For a settled market, unpaid liability is
`total_pool - claimed_pool`; for an inconclusive market it is
`total_pool - refunded_pool`. Claims and refunds are caller-bound and cannot
consume another market's counters. External finalized value transfer is
platform asynchronous; direct EOA transfers and payable recipient contracts
are supported by the EVM interface, while recipient-contract rejection after
emission is an unavoidable current platform integration risk that requires live
network validation. V1 has no claim expiry.

The single-file contract has a pinned `py-genlayer` runner dependency. Direct
and integration test commands do not deploy this contract.
