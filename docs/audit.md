# Dominion V1 audit

Audit scope: the complete single-file contract, its typed persistent state, the
direct test harness, and the opt-in integration collection. The audit covers
permission, lifecycle, source evidence, validator equivalence, accounting,
funds liveness, value transfer, read models, and activity indexing. No
deployment was performed.

## Severity summary

| Severity | Finding | Status |
| --- | --- | --- |
| HIGH | EOA claims used the IC-to-IC transfer primitive | Remediated with the finalized EVM value-transfer interface for EOA/EVM wallet recipients |
| HIGH | Floor-only claims could trap integer remainder | Remediated with Crown-style final-claimant remainder accounting |
| HIGH | No bounded exit from repeated settlement consensus failure | Remediated with a deterministic six-hour post-expiry fallback to refundable `INCONCLUSIVE` |
| HIGH | Wide payout multiplication was not explicitly overflow-safe | Remediated with bounded `u256` addition and a 256-step mul/div routine without a wide product |
| MEDIUM | Bet writes preceded all aggregate accounting checks | Remediated by precomputing every new total before persistent writes |
| MEDIUM | The contract lacked paginated user/market read models and activity indexing | Remediated with bounded views and compact per-wallet indexes |
| MEDIUM | Strict evidence equivalence can retry when the same final winner has different source witnesses | Retained intentionally; documented as safety-first, with deadline fallback |
| MEDIUM | Public ISO creation input and redundant ISO market storage increased the parsing/storage surface | Remediated with numeric `u256` timestamps, numeric read fields, and removal of creation-only parsing/formatting |
| MEDIUM | Array-source adapters accepted underspecified kline rows without a Binance close-time check | Remediated with fixed Binance/Bitget row shapes and Binance completed-candle close-time validation |
| LOW | A market may be created with only a very short future betting window | Accepted by locked rules; strict-future creation is deterministic and does not trap funds |
| INFORMATIONAL | Studio does not model live ghost/EVM contract execution fully | Documented platform limitation; finalized transfer behavior requires live-network validation |
| INFORMATIONAL | Web API does not expose redirect/final-URL metadata to the contract | Mitigated by hard-coded HTTPS hosts and exact paths; runtime network policy remains part of deployment assurance |

## Final timestamp ABI refactor

The former public `create_market(category: str, market_start: str)` ISO
datetime input is removed. The final ABI is
`create_market(category: str, market_start: u256) -> u256`, and
`get_market_by_category_start` accepts the same numeric timestamp type. Unix
seconds must be strictly in the future and divisible by 3,600. Dominion derives
the one-hour end, closes betting at the start, and derives the six-hour
settlement deadline with checked `u256` arithmetic. Market and source-evidence
read models expose numeric `market_start`, `market_end`, `betting_close`, and
`settlement_deadline`; no human-readable timestamp is stored. The frontend must
convert its selected UTC date/hour to Unix seconds before calling the contract.

The ISO parser remains only for deterministic `gl.message_raw["datetime"]`
conversion and activity timestamps. Creation-only ISO parsing and formatting
code, plus redundant ISO storage maps, were removed.

## Findings

### HIGH — EOA claims used the IC-to-IC transfer primitive

- Lifecycle: claim and refund exit paths.
- Affected method/storage: `claim`, `claim_refund`, `_send_value`.
- Scenario: the old implementation called `gl.get_contract_at(sender).emit_transfer` for every recipient. That primitive is intended for another Intelligent Contract, not an EOA or chain-layer EVM address.
- User-funds impact: an EOA payout could be emitted to the wrong execution layer or fail to deliver.
- Stuck funds: yes, if the recipient path failed after claim state was consumed.
- Fix: derive the recipient only from `gl.message.sender_address` and always use the finalized `@gl.evm.contract_interface` value transfer. Sender/origin comparison is deliberately not used because an EVM contract wallet called by an EOA also has different sender/origin addresses.
- Final remediation: implemented.
- Regression test: transfer-hook tests assert the recipient is the caller and the request uses `EthSend` for direct callers; claim/refund authorization tests reject cross-wallet access.

### HIGH — Floor-only claims could trap integer remainder

- Lifecycle: settled market claims.
- Affected method/storage: `claim`, `market_pool`, outcome pools, claim totals.
- Scenario: each claimant used floor division independently and no final claimant received the remaining pool.
- User-funds impact: the sum of successful payouts could be less than the deposited pool.
- Stuck funds: yes; the remainder had no V1 withdrawal path.
- Fix: ordinary claims use `stake * total_pool // winning_pool`; the claimant whose accumulated claimed winning stake reaches `winning_pool` receives `total_pool - claimed_pool`. Track `market_winning_pool`, `market_claimed_pool`, and `market_claimed_winning_stake` with bounds checks.
- Final remediation: implemented.
- Regression test: Crown dust tests prove the final claim clears the exact remainder and `claimed_pool == total_pool`.

### HIGH — No bounded exit from repeated settlement consensus failure

- Lifecycle: expired `OPEN` markets.
- Affected method/storage: `settle_market`, `market_state`, settlement deadline.
- Scenario: a validator disagreement or repeated nondeterministic execution error could revert every settlement attempt indefinitely.
- User-funds impact: bettors could remain unable to claim or refund.
- Stuck funds: yes without a timeout.
- Fix: store `market_settlement_deadline = market_end + 6 hours`. Before that deadline, settlement retries the locked source/equivalence process. At or after it, any permissionless `settle_market` call deterministically enters `INCONCLUSIVE` without external calls; all positions can refund. This is a safety fallback, so a valid consensus not submitted before the deadline is forfeited in favor of refunds.
- Final remediation: implemented.
- Regression test: deadline fallback runs in strict no-web mode and produces refundable `INCONCLUSIVE`.

### HIGH — Wide payout multiplication was not explicitly overflow-safe

- Lifecycle: claim and large-bet accounting.
- Affected method/storage: all `u256` pool fields and payout arithmetic.
- Scenario: `stake * total_pool` can exceed 256 bits even when the quotient fits.
- User-funds impact: arithmetic failure could make a valid claim unavailable; unchecked arithmetic could corrupt liabilities.
- Stuck funds: potentially yes.
- Fix: `_add_u256` checks every aggregate addition against `2**256 - 1`. `_mul_div_u256` computes floor multiplication/division by fixed 256-bit long division without constructing a wide product; it requires `stake <= winning_pool`, which bounds the result by `total_pool`.
- Final remediation: implemented.
- Regression test: maximum-value single deposits, aggregate-overflow rejection, and large payout tests.

### MEDIUM — Bet writes preceded all aggregate accounting checks

- Lifecycle: payable bet entry.
- Affected method/storage: `place_bet`, bettor/outcome/market pools and user indexes.
- Scenario: the old method could store the chosen side before a later aggregate addition failed.
- User-funds impact: a reverted or malformed edge-case call could leave inconsistent position state in a non-atomic harness or future runtime.
- Stuck funds: potentially yes.
- Fix: validate market, time, asset, value, side lock, all three aggregate additions, user-index increment, and activity-index increment before the first write.
- Final remediation: implemented.
- Regression test: rejected deposits leave all pool, position, index, and activity counts unchanged.

### MEDIUM — Missing frontend read models and wallet activity index

- Lifecycle: all read paths; direct bet and claim/refund events.
- Affected method/storage: market and bettor maps; new bounded indexes and activity records.
- Scenario: a frontend would need unbounded market scans or caller-dependent legacy reads and could not efficiently show a wallet’s bets or direct activity.
- User-funds impact: no direct custody loss, but poor observability can delay claims/refunds.
- Stuck funds: not by contract state; reads are now bounded and indexed.
- Fix: add configuration, paginated market/open-market, explicit-user position, user-market, claimable, category/start lookup, source evidence, activity-count, and activity-page views. Records contain only the wallet, sequence ID, market, type, asset, amount, and deterministic timestamp; read/unread state is off-chain.
- Final remediation: implemented.
- Regression test: pagination limits, empty pages, per-wallet isolation, activity order/count, and no phantom activity on reverted calls.

### MEDIUM — Strict evidence equivalence can retry on different source witnesses

- Lifecycle: source consensus and settlement retry.
- Affected method/storage: `_source_consensus`, `_evidence_key`, source evidence maps.
- Scenario: leader may observe `Binance + Bitget` agreeing while validator observes `Bitget + Gate` agreeing on the same final winner. Complete evidence keys differ, so the result is rejected.
- User-funds impact: safe result is delayed; after the deadline it becomes refundable rather than settled.
- Stuck funds: no after the deterministic fallback; claims/refunds remain available once terminal.
- Fix: retain strict comparison of all deterministic source evidence and document the common-witness consequence. This prevents a validator from silently substituting an independent witness. Deadline fallback supplies liveness.
- Final remediation: retained intentionally and covered by an equivalence regression test.

### LOW — Very short future betting windows are permitted

- Lifecycle: creation to betting close.
- Affected method/storage: `create_market` and stored start time.
- Scenario: a caller can create a valid exact-hour market one second before its start.
- User-funds impact: no funds are accepted after start; the short window is inconvenient but deterministic.
- Stuck funds: no.
- Fix: none; the locked V1 rule requires strictly-future start and does not specify a minimum lead time.
- Final remediation: accepted by scope; covered by future/current/past creation tests.

### INFORMATIONAL — Studio/live value-transfer parity

- Lifecycle: payout/refund external execution.
- Affected method/storage: `_send_value`; direct transfer hooks and integration smoke tests.
- Scenario: Studio simulates balances and does not fully model chain-layer ghost/EVM contract execution.
- User-funds impact: direct tests prove emitted recipient/value/state ordering, not live EVM delivery.
- Stuck funds: a recipient contract that rejects native GEN can fail an external operation; the current platform exposes no synchronous success result or parent callback for an external `EthSend` that lets the IC safely reopen a consumed claim.
- Fix/mitigation: use only caller-derived recipients, finalized external messages, and effects-before-emission. EOA/native-receive contract behavior must be validated on the target network. A contract wallet should call only when it can accept GEN.
- Final remediation: protocol-side mitigation implemented; platform/recipient failure remains an unavoidable integration risk and is not claimed away.
- Regression test: direct hooks cover EOA-shaped and contract-address-shaped recipient values, state-before-transfer ordering, and single-use status. Live recipient-revert behavior is an integration skip because Studio cannot model it.

### INFORMATIONAL — Web redirect/final-domain visibility

- Lifecycle: nondeterministic candle retrieval.
- Affected method/storage: `_request_json`, `_fetch_candle`, source evidence.
- Scenario: the contract can hard-code the three approved HTTPS hosts and paths,
  but the current web API does not expose a final redirect URL for an
  application-level allowlist check.
- User-funds impact: a hostile redirect could theoretically supply unexpected
  data if the runtime followed one; source equivalence still requires both
  executions to agree on the deterministic evidence.
- Stuck funds: a bad response leads to unavailable evidence and either a
  consensus-based refund state or deadline fallback, not an accepted deposit
  without an exit path.
- Fix/mitigation: use only the locked literal hosts, exact endpoint families,
  bounded response bodies, strict response parsing, and the runtime’s web
  sandbox. Validate redirect policy on the target network.
- Final remediation: application-level controls implemented; final-URL policy
  is an unavoidable current API/runtime limitation.
- Regression test: exact endpoint query tests and malformed/oversized response
  tests; live redirect behavior is not modeled by Studio.

## Funds-liveness proof

The only payable entry is `place_bet`. It accepts value only after market, state,
strict pre-start time, category asset, minimum, side-lock, and overflow checks.
The same amount is then written to exactly one bettor stake, one outcome pool,
the market pool, and one direct activity record. Failed validation occurs before
those writes.

The public payable ABI contains only `place_bet`; `claim`, `claim_refund`,
`create_market`, and `settle_market` are nonpayable. The base-contract
`__on_errored_message__` hook is a protocol callback for failed internal
messages, not a user betting entry, and Dominion emits no internal value
messages. Plain no-method transfers are not implemented as a deposit path.

The only exits are `claim` and `claim_refund`. Both derive the position key and
recipient from the immediate caller, reject repeat status, check aggregate
liabilities, persist effects before emitting a finalized transfer, and cannot
accept a recipient argument. `claim` is possible only for the recorded winner
of a normally settled market; `claim_refund` is possible only for
`INCONCLUSIVE`. There is no admin, creator, treasury, cancellation, or sweep
method.

For every expired market, either source consensus completes in the retry window
or the deadline fallback stores `INCONCLUSIVE`. Thus source outage and validator
disagreement cannot leave an expired market permanently `OPEN`. Zero-bettor
valid consensus is `SETTLED`; a nonzero pool with zero stake on the actual
winner is `INCONCLUSIVE` and refunds original stakes. Losing positions have no
positive claim path.

For a settled market, unpaid liability is `total_pool - claimed_pool`; each
claim adds exactly one disjoint winning stake and no claim can exceed either
the winning pool or remaining market pool. The final claimant receives the
remaining pool, so successful claims distribute the entire pool. For an
inconclusive market, unpaid refund liability is `total_pool - refunded_pool`;
each position refunds exactly its accumulated stake once. Pools are keyed by
market ID, so one market’s counters cannot select another market’s liabilities.

The residual platform risk is external transfer failure after the IC has emitted
an external finalized value message: current GenLayer APIs do not provide a
synchronous parent-visible success/failure callback for reopening a consumed
claim. EOA transfers and payable contract-wallet recipients are expected to
complete at the chain layer; a rejecting recipient contract must not call the
method. This limitation is explicitly not represented as a guarantee of
production-safe recovery from arbitrary recipient reverts.

## Permission conclusion

Creation, betting, and settlement are permissionless. The creator is not stored
as an authority and has no financial privilege. Settlement callers cannot supply
prices, source results, winners, or recipients. Claims/refunds accept only a
market ID; the stored position is keyed by the caller address and the transfer
target is derived from that same address. Public user views accept explicit
addresses but perform no writes.

## Final audit disposition

Confirmed at protocol level: creation, betting, settlement, claims, and refunds
are permissionless/caller-bound as specified; category mappings and source
identities are fixed; all stateful pool and liability additions are checked;
source winners are numerical fixed-precision winners; ties cast no vote;
settlement requires two matching valid source winners or reaches the bounded
fallback; zero-bettor consensus settles; zero-backed actual winners refund;
and the Crown-style final claimant receives the exact remaining pool. No
owner/operator/creator withdrawal, override, cancellation, arbitrary recipient,
or sweep path exists.

The direct suite exercises these invariants, including numeric timestamp
creation, alignment/current/past/future checks, duplicate identity, numeric
read models, malformed and incomplete source data, ties, unavailable sources,
validator evidence equivalence, fallback, pool isolation, refunds, final-claim
dust, overflow, activity, pagination, snapshots, and pickling. Lint, schema,
and typecheck are run separately as part of the final verification pass.

Accepted residuals: strict complete-evidence equivalence may sacrifice a
settlement attempt when validators observe different but winner-equivalent
witness sets; the six-hour fallback prioritizes fund liveness. External
finalized GEN delivery to an EOA or EVM contract wallet remains a GenLayer/
recipient-runtime concern after effects are persisted. Live Bradbury behavior
for source availability, redirects, consensus, and recipient-contract
acceptance still requires a separately authorized deployment/integration run;
no deployment was performed for this audit.

The final contract source is 41,103 bytes, leaving 11,121 bytes below the
52,224-byte project limit.
