import { createClient } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
import {
  CalldataAddress,
  ExecutionResult,
  TransactionStatus,
  executionResultNumberToName,
  transactionsStatusNumberToName,
  type CalldataEncodable,
  type TransactionHash,
} from "genlayer-js/types";
import { hexToBytes, isAddress, type Address, type EIP1193Provider } from "viem";
import { CATEGORIES, assetBySymbol, categoryById } from "./categories";
import { HOUR_MS } from "./format";
import type {
  ActivityRecord,
  CategoryId,
  MarketView,
  Position,
  ProtocolConfig,
  SourceEvidence,
  SourceId,
  SourceStatus,
} from "./types";

export const DOMINION_CONTRACT_ADDRESS = "0xec08425932105bC12c2B9A7F91D50Be60DDAEBa4" as Address;
export const BRADBURY_CHAIN_ID = testnetBradbury.id;
export const GEN_SCALE = 1_000_000_000_000_000_000n;
export const MIN_BET_WEI = GEN_SCALE;
const MAX_PAGE = 50;

export type TransactionStage =
  "AWAITING_SIGNATURE" | "SUBMITTED" | "PROCESSING" | "SUCCESS" | "UNCERTAIN";
export type TransactionStageHandler = (stage: TransactionStage) => void;
export const TRANSACTION_POLL_INTERVAL_MS = 2_000;
export const TRANSACTION_MAX_ATTEMPTS = 75;

export interface ContractWriteResult {
  ok: boolean;
  hash?: string;
  confirmed?: boolean;
  error?: string;
}

export function parseGenAmount(value: string): bigint | null {
  const normalized = value.trim();
  if (!/^\d+(\.\d{0,18})?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  return BigInt(whole ?? "0") * GEN_SCALE + BigInt(fraction.padEnd(18, "0") || "0");
}

type RawMap = Record<string, unknown>;
const readClient = createClient({ chain: testnetBradbury as never });

type TransactionPollClient = {
  getTransaction(args: { hash: TransactionHash }): Promise<unknown>;
};

const TERMINAL_TRANSACTION_STATUSES = new Set([
  "CANCELED",
  "CANCELLED",
  "REJECTED",
  "FAILED",
  "UNDETERMINED",
  "VALIDATORS_TIMEOUT",
  "LEADER_TIMEOUT",
]);

function isMap(value: unknown): value is RawMap {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asMap(value: unknown): RawMap {
  if (!isMap(value)) throw new Error("Invalid contract response shape.");
  return value;
}

function asArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("Invalid contract response shape.");
  return value;
}

function asString(value: unknown): string {
  if (typeof value === "string") return value;
  throw new Error("Invalid string in contract response.");
}

function asDisplayString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  throw new Error("Invalid display value in contract response.");
}

function asBool(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("Invalid boolean in contract response.");
  return value;
}

function asBigInt(value: unknown): bigint {
  try {
    if (typeof value === "bigint" && value >= 0n) return value;
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
      return BigInt(value);
    if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  } catch {
    // Fall through to the normalized response error below.
  }
  throw new Error("Invalid unsigned integer in contract response.");
}

function asNumber(value: unknown): number {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  if (Number.isFinite(n)) return n;
  throw new Error("Invalid number in contract response.");
}

function asCategory(value: unknown): CategoryId {
  const category = asString(value);
  const mapped = CATEGORIES.find(
    (item) => item.id === category || item.short === category || item.label === category,
  );
  if (!mapped) throw new Error("Contract response has an invalid category.");
  return mapped.id;
}

function contractCategory(value: unknown): CategoryId {
  const category = asString(value);
  const mapped = CATEGORIES.find(
    (item) => item.id === category || item.short === category || item.label === category,
  );
  if (!mapped) throw new Error("Contract market response has an invalid category.");
  return mapped.id;
}

function contractAssets(value: unknown, category: CategoryId) {
  const symbols = categoryAssetSymbols(value, category);
  return symbols.map((symbol) => assetBySymbol(category, symbol));
}

function categoryAssetSymbols(value: unknown, category: CategoryId): string[] {
  if (!Array.isArray(value)) throw new Error("Contract response is missing category assets.");
  const symbols = value.map((item) => asString(item));
  if (
    symbols.length !== 3 ||
    new Set(symbols).size !== symbols.length ||
    symbols.some((symbol) => !/^[A-Z0-9]{1,16}$/.test(symbol))
  ) {
    throw new Error("Contract response has invalid category assets.");
  }
  return symbols;
}

function toContractCategory(category: CategoryId): string {
  return categoryById(category).short;
}

function toContractAddress(address: string): CalldataAddress {
  if (!isAddress(address)) throw new Error("Invalid wallet address.");
  return new CalldataAddress(hexToBytes(address as Address));
}

function toMarketId(value: string): bigint {
  if (!/^\d+$/.test(value)) throw new Error("Market not found.");
  return BigInt(value);
}

function toUnixSeconds(milliseconds: number): bigint {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0 || milliseconds % 1000 !== 0)
    throw new Error("Invalid market timestamp.");
  return BigInt(Math.floor(milliseconds / 1000));
}

function asSource(value: unknown): SourceId {
  const source = asString(value);
  if (source === "BINANCE" || source === "BITGET" || source === "GATE") return source;
  throw new Error("Contract response has an invalid source.");
}

function asSourceStatus(value: unknown): SourceStatus {
  const status = asString(value);
  if (status === "TIE") return "TIE";
  if (status === "UNAVAILABLE") return "UNAVAILABLE";
  if (status === "VALID" || status === "OK") return "OK";
  throw new Error("Contract response has an invalid source status.");
}

function toGenAmount(value: unknown): bigint {
  return asBigInt(value);
}

function poolShare(pool: bigint, total: bigint): number {
  if (total === 0n) return 0;
  return Number((pool * 10_000n) / total) / 100;
}

function toTimestampMs(value: unknown): number {
  const seconds = asBigInt(value);
  if (seconds > BigInt(Math.floor(Number.MAX_SAFE_INTEGER / 1000)))
    throw new Error("Timestamp is outside the supported display range.");
  const milliseconds = seconds * 1000n;
  const number = Number(milliseconds);
  if (!Number.isSafeInteger(number)) throw new Error("Invalid timestamp in contract response.");
  return number;
}

function effectiveStatus(rawState: string, startMs: number, endMs: number, now: number) {
  if (rawState === "SETTLED") return "SETTLED" as const;
  if (rawState === "INCONCLUSIVE") return "INCONCLUSIVE" as const;
  if (now < startMs) return "UPCOMING" as const;
  if (now >= endMs) return "PENDING_SETTLEMENT" as const;
  return "OPEN" as const;
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error:\s*/i, "").trim() || "Contract request failed.";
}

function errorText(error: unknown): string {
  let details = "";
  if (error && typeof error === "object") {
    try {
      details = JSON.stringify(error, Object.getOwnPropertyNames(error));
    } catch {
      details = "";
    }
  }
  const text = `${errorMessage(error)} ${details}`;
  const decoded = text.replace(/0x([0-9a-f]{1,2})(?:,\s*)?/gi, (_, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
  return `${text} ${decoded}`;
}

function isNotFound(error: unknown): boolean {
  return /\bmarket(?:\s+id)?\b.*(?:not found|does not exist)/i.test(errorText(error));
}

function isUnavailableEvidence(error: unknown): boolean {
  return /source evidence unavailable/i.test(errorText(error));
}

function pageArgs(offset: number, limit: number): [bigint, bigint] {
  if (!Number.isInteger(offset) || offset < 0) throw new Error("Invalid page offset.");
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE)
    throw new Error(`Page size must be between 1 and ${MAX_PAGE}.`);
  return [BigInt(offset), BigInt(limit)];
}

function normalizeMarket(raw: unknown, now: number): MarketView {
  const data = asMap(raw);
  const category = contractCategory(data["category"]);
  const assets = contractAssets(data["assets"], category);
  const startMs = toTimestampMs(data["market_start"]);
  const endMs = toTimestampMs(data["market_end"]);
  if (endMs <= startMs || endMs - startMs !== HOUR_MS || startMs % HOUR_MS !== 0) {
    throw new Error("Contract market has an invalid time window.");
  }
  const rawPools = asMap(data["outcome_pools"]);
  const pools: Record<string, bigint> = {};
  let outcomePoolWei = 0n;
  assets.forEach((asset) => {
    const poolWei = asBigInt(rawPools[asset.symbol]);
    outcomePoolWei += poolWei;
    pools[asset.symbol] = poolWei;
  });
  const totalPoolWei = asBigInt(data["total_pool"]);
  if (outcomePoolWei !== totalPoolWei)
    throw new Error("Contract market pool totals are inconsistent.");
  const totalPool = totalPoolWei;
  const poolShares: Record<string, number> = {};
  assets.forEach((asset) => {
    poolShares[asset.symbol] = poolShare(pools[asset.symbol] ?? 0n, totalPool);
  });
  const rawState = asString(data["state"]);
  if (rawState !== "OPEN" && rawState !== "SETTLED" && rawState !== "INCONCLUSIVE")
    throw new Error("Contract market has an invalid state.");
  const status = effectiveStatus(rawState, startMs, endMs, now);
  const winnerValue = asString(data["winner"]);
  if (winnerValue && !assets.some((asset) => asset.symbol === winnerValue))
    throw new Error("Contract market has an invalid winner.");
  const winner = winnerValue || null;
  const claimedPool = toGenAmount(data["claimed_pool"]);
  const winningPool = toGenAmount(data["winning_pool"]);
  const remainingPool = toGenAmount(data["remaining_pool"]);
  if (claimedPool > totalPool || remainingPool > totalPool || winningPool > totalPool)
    throw new Error("Contract market accounting is inconsistent.");
  return {
    id: asBigInt(data["id"]).toString(),
    category,
    assets,
    startMs,
    endMs,
    status,
    pools,
    totalPool,
    winner,
    claimedPool,
    bettingOpen: asBool(data["betting_open"]),
    settlementAvailable: asBool(data["settlement_available"]),
    poolShares,
    winningPool,
    remainingPool,
    userSelectedAsset: null,
    userStake: 0n,
    canTopUp: false,
    positionWon: false,
    positionLost: false,
    claimAvailable: false,
    refundAvailable: false,
    claimableAmount: 0n,
    claimType: null,
  };
}

function normalizePosition(raw: unknown, wallet: string, expectedMarketId?: string): Position {
  const data = asMap(raw);
  if (typeof data["has_position"] !== "boolean") {
    throw new Error("Invalid user position response.");
  }
  const stake = toGenAmount(data["total_stake"]);
  const claimableAmount = toGenAmount(data["claimable_amount"]);
  const marketId = asBigInt(data["market_id"]).toString();
  if (expectedMarketId !== undefined && marketId !== expectedMarketId)
    throw new Error("User position market mismatch.");
  const rawClaimType = asString(data["claim_type"]);
  if (rawClaimType && !["NONE", "PAYOUT", "WINNINGS", "REFUND"].includes(rawClaimType))
    throw new Error("Invalid claim type in user position response.");
  const asset = asString(data["selected_asset"]);
  if (data["has_position"] && !asset) throw new Error("User position asset is missing.");
  const claimType =
    rawClaimType === "PAYOUT" || rawClaimType === "WINNINGS"
      ? "PAYOUT"
      : rawClaimType === "REFUND"
        ? "REFUND"
        : null;
  return {
    marketId,
    wallet,
    hasPosition: data["has_position"],
    asset,
    stake,
    claimed: asBool(data["already_claimed"]),
    refunded: asBool(data["refunded"]),
    canTopUp: asBool(data["can_top_up"]),
    positionWon: asBool(data["position_won"]),
    positionLost: asBool(data["position_lost"]),
    claimAvailable: asBool(data["claim_available"]),
    refundAvailable: asBool(data["refund_available"]),
    claimableAmount,
    claimType,
  };
}

export function applyPositionToMarket(market: MarketView, position: Position | null): MarketView {
  if (!position) return market;
  return {
    ...market,
    userSelectedAsset: position.asset || null,
    userStake: position.stake,
    canTopUp: position.canTopUp ?? false,
    positionWon: position.positionWon ?? false,
    positionLost: position.positionLost ?? false,
    claimAvailable: position.claimAvailable ?? false,
    refundAvailable: position.refundAvailable ?? false,
    claimableAmount: position.claimableAmount ?? 0n,
    claimType:
      position.claimType ??
      (position.claimAvailable ? "PAYOUT" : position.refundAvailable ? "REFUND" : null),
  };
}

type NormalizedActivity = Omit<ActivityRecord, "category">;

function normalizeActivity(raw: unknown, expectedWallet: string): NormalizedActivity {
  const data = asMap(raw);
  const rawTimestamp = data["timestamp"];
  const timestamp =
    typeof rawTimestamp === "number"
      ? toTimestampMs(rawTimestamp)
      : /^\d+$/.test(asString(rawTimestamp))
        ? toTimestampMs(asString(rawTimestamp))
        : Date.parse(asString(rawTimestamp));
  if (!Number.isSafeInteger(timestamp) || timestamp < 0)
    throw new Error("Invalid activity timestamp.");
  const amount = toGenAmount(data["amount"]);
  const wallet = asString(data["wallet"]);
  if (wallet.toLowerCase() !== expectedWallet.toLowerCase())
    throw new Error("Activity wallet mismatch.");
  const kind = asString(data["type"]);
  const assetValue = data["asset"];
  if (assetValue !== null && typeof assetValue !== "string")
    throw new Error("Invalid activity asset.");
  return {
    id: asBigInt(data["id"]).toString(),
    wallet,
    kind,
    marketId: asBigInt(data["market_id"]).toString(),
    asset: assetValue ? assetValue : null,
    amount,
    timestamp,
    read: false,
  };
}

function parsePositivePrice(value: unknown, field: string): number {
  const price = asNumber(value);
  if (price <= 0) throw new Error(`Invalid ${field} in source evidence.`);
  return price;
}

function normalizeEvidence(
  raw: unknown,
  expectedMarket: MarketView,
  expectedSource: SourceId,
): SourceEvidence {
  const data = asMap(raw);
  const category = asCategory(data["category"]);
  if (category !== expectedMarket.category) throw new Error("Source evidence category mismatch.");
  const source = asSource(data["source"]);
  if (source !== expectedSource) throw new Error("Source evidence source mismatch.");
  const status = asSourceStatus(data["source_status"]);
  const interval = asString(data["interval"]);
  if (interval !== "1h") throw new Error("Source evidence interval mismatch.");
  const marketStart = asBigInt(data["market_start"]);
  const marketEnd = asBigInt(data["market_end"]);
  if (
    marketStart !== BigInt(Math.floor(expectedMarket.startMs / 1000)) ||
    marketEnd !== BigInt(Math.floor(expectedMarket.endMs / 1000))
  ) {
    throw new Error("Source evidence market window mismatch.");
  }
  if (status === "UNAVAILABLE") return emptyEvidence(expectedSource, expectedMarket);

  const rawAssets = asArray(data["assets"]);
  if (rawAssets.length !== expectedMarket.assets.length)
    throw new Error("Source evidence has an invalid asset count.");
  const openPrices: Record<string, number | null> = {};
  const closePrices: Record<string, number | null> = {};
  const returns: Record<string, number | null> = {};
  const seenAssets = new Set<string>();
  rawAssets.forEach((value) => {
    const row = asMap(value);
    const asset = asString(row["asset"]);
    const definitionAsset = expectedMarket.assets.find((item) => item.symbol === asset);
    if (!definitionAsset || seenAssets.has(asset))
      throw new Error("Source evidence has an invalid or duplicate asset.");
    seenAssets.add(asset);
    if (asString(row["symbol"]) !== `${asset}USDT`)
      throw new Error("Source evidence symbol mismatch.");
    const timestamp = asBigInt(row["candle_timestamp"]);
    const timestampUnit = asString(row["timestamp_unit"]);
    const expectedTimestamp = timestampUnit === "ms" ? marketStart * 1000n : marketStart;
    if ((timestampUnit !== "ms" && timestampUnit !== "s") || timestamp !== expectedTimestamp)
      throw new Error("Source evidence timestamp mismatch.");
    if (asBool(row["valid"]) !== true) throw new Error("Source evidence row is invalid.");
    const open = parsePositivePrice(row["open"], "open price");
    const close = parsePositivePrice(row["close"], "close price");
    openPrices[asset] = open;
    closePrices[asset] = close;
    const units = row["return_units"];
    if (units === undefined || units === null)
      throw new Error("Source evidence return is missing.");
    returns[asset] = asNumber(units) / 1_000_000;
  });
  const winner = asString(data["source_winner"]);
  if (status === "OK" && !expectedMarket.assets.some((asset) => asset.symbol === winner))
    throw new Error("Source evidence winner mismatch.");
  return {
    source,
    status,
    openPrices,
    closePrices,
    returns,
    winner: winner || null,
  };
}

function emptyEvidence(source: SourceId, market: MarketView): SourceEvidence {
  const openPrices: Record<string, number | null> = {};
  const closePrices: Record<string, number | null> = {};
  const returns: Record<string, number | null> = {};
  market.assets.forEach((asset) => {
    openPrices[asset.symbol] = null;
    closePrices[asset.symbol] = null;
    returns[asset.symbol] = null;
  });
  return { source, status: "UNAVAILABLE", openPrices, closePrices, returns, winner: null };
}

async function readContract(functionName: string, args: unknown[] = []): Promise<unknown> {
  return readClient.readContract({
    address: DOMINION_CONTRACT_ADDRESS,
    functionName,
    args: args as CalldataEncodable[],
    jsonSafeReturn: true,
  });
}

export function transactionStatusName(receipt: RawMap): string | undefined {
  const named = receipt["statusName"];
  if (typeof named === "string") return named;
  const status = receipt["status"];
  if (typeof status === "number") {
    return transactionsStatusNumberToName[
      String(status) as keyof typeof transactionsStatusNumberToName
    ];
  }
  if (typeof status === "string") {
    return (
      transactionsStatusNumberToName[status as keyof typeof transactionsStatusNumberToName] ??
      status
    );
  }
  return undefined;
}

export function executionResultName(receipt: RawMap): string | undefined {
  const named = receipt["txExecutionResultName"];
  if (typeof named === "string") return named;
  const result = receipt["txExecutionResult"];
  if (typeof result === "number") {
    return executionResultNumberToName[String(result) as keyof typeof executionResultNumberToName];
  }
  if (typeof result === "string") {
    return (
      executionResultNumberToName[result as keyof typeof executionResultNumberToName] ?? result
    );
  }
  return undefined;
}

export async function waitForAcceptedExecution({
  client,
  hash,
  onStage,
  maxAttempts = TRANSACTION_MAX_ATTEMPTS,
  pollIntervalMs = TRANSACTION_POLL_INTERVAL_MS,
  wait = (milliseconds: number) =>
    new Promise<void>((resolve) => globalThis.setTimeout(resolve, milliseconds)),
}: {
  client: TransactionPollClient;
  hash: string;
  onStage?: TransactionStageHandler | undefined;
  maxAttempts?: number | undefined;
  pollIntervalMs?: number | undefined;
  wait?: ((milliseconds: number) => Promise<unknown>) | undefined;
}): Promise<{ confirmed: boolean; status?: string | undefined; receipt?: RawMap | undefined }> {
  const attempts = Math.max(1, Math.floor(maxAttempts));
  const delay = Math.max(0, Math.floor(pollIntervalMs));
  let lastStatus: string | undefined;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let receipt: RawMap | null = null;
    try {
      const value = await client.getTransaction({ hash: hash as TransactionHash });
      if (isMap(value)) receipt = value;
    } catch {
      // A submitted transaction can be temporarily absent from the read path.
    }

    if (receipt) {
      const status = transactionStatusName(receipt);
      const execution = executionResultName(receipt);
      lastStatus = status ?? lastStatus;

      if (execution === ExecutionResult.FINISHED_WITH_ERROR) {
        throw new Error("FINISHED_WITH_ERROR");
      }
      if (status && TERMINAL_TRANSACTION_STATUSES.has(status)) {
        throw new Error(`TRANSACTION_${status}`);
      }
      if (
        (status === TransactionStatus.ACCEPTED || status === TransactionStatus.FINALIZED) &&
        execution === ExecutionResult.FINISHED_WITH_RETURN
      ) {
        onStage?.("SUCCESS");
        return { confirmed: true, status, receipt };
      }
      if (status === TransactionStatus.ACCEPTED || status === TransactionStatus.FINALIZED) {
        return { confirmed: false, status, receipt };
      }
    }

    if (attempt + 1 < attempts) {
      onStage?.("PROCESSING");
      await wait(delay);
    }
  }

  return { confirmed: false, status: lastStatus };
}

async function writeContract(
  address: string,
  functionName: string,
  args: unknown[],
  value: bigint,
  onStage?: TransactionStageHandler,
): Promise<{ hash: string; confirmed: boolean }> {
  if (!isAddress(address)) throw new Error("Invalid wallet address.");
  if (value < 0n) throw new Error("Invalid transaction value.");
  if (typeof window === "undefined" || !window.ethereum)
    throw new Error("Connect an injected wallet before sending a transaction.");
  const chainId = await window.ethereum.request({ method: "eth_chainId" });
  if (Number(chainId) !== BRADBURY_CHAIN_ID)
    throw new Error("Switch your wallet to Bradbury Testnet before sending a transaction.");
  const client = createClient({
    chain: testnetBradbury as never,
    account: address as Address,
    provider: window.ethereum as EIP1193Provider,
  });
  onStage?.("AWAITING_SIGNATURE");
  const hash = await client.writeContract({
    address: DOMINION_CONTRACT_ADDRESS,
    functionName,
    args: args as CalldataEncodable[],
    value,
  });
  onStage?.("SUBMITTED");
  const outcome = await waitForAcceptedExecution({
    client: readClient as unknown as TransactionPollClient,
    hash: String(hash),
    onStage,
  });
  if (!outcome.confirmed) {
    onStage?.("UNCERTAIN");
  }
  return { hash: String(hash), confirmed: outcome.confirmed };
}

export function contractError(error: unknown): string {
  const message = errorText(error).toLowerCase();
  if (/user rejected|rejected the request|denied|user cancelled|user canceled/.test(message))
    return "You cancelled the transaction.";
  if (
    /finished_with_error|transaction_(rejected|failed|canceled|cancelled|undetermined|validators_timeout|leader_timeout)/.test(
      message,
    )
  )
    return "GenLayer rejected the transaction execution.";
  if (/transaction_still_pending|confirmation is taking longer/.test(message))
    return "Transaction submitted, but confirmation is taking longer than expected.";
  if (/switch.*bradbury|wrong network|chain id|unsupported chain/.test(message))
    return "Switch your wallet to Bradbury Testnet.";
  if (/insufficient funds|insufficient balance|not enough gen|balance too low/.test(message))
    return "You do not have enough GEN for this transaction.";
  if (/minimum bet|minimum stake/.test(message)) return "Minimum bet is 1 GEN.";
  if (/betting is closed|betting closed/.test(message)) return "Betting is closed for this market.";
  if (/market start.*future|already started|market has started/.test(message))
    return "This market has already started.";
  if (/market already exists|duplicate market/.test(message))
    return "A market already exists for this category and time.";
  if (/invalid category/.test(message)) return "That market category is not supported.";
  if (/invalid market asset|invalid asset/.test(message))
    return "That stock is not valid for this market.";
  if (/wallet outcome already selected|different outcome|side switch/.test(message))
    return "You already picked a different stock in this market.";
  if (/market not found|does not exist/.test(message)) return "Market not found.";
  if (/market has not expired|not expired|cannot be settled yet/.test(message))
    return "This market cannot be settled yet.";
  if (/market is not open|market not open/.test(message)) return "This market is no longer open.";
  if (/not a winning bettor|not winning/.test(message)) return "This position did not win.";
  if (/refund already claimed|already refunded/.test(message))
    return "You already claimed this refund.";
  if (/payout already claimed/.test(message)) return "You already claimed these winnings.";
  if (/market is not inconclusive|not refundable/.test(message))
    return "This market is not refundable.";
  if (/source evidence unavailable/.test(message))
    return "Settlement evidence is not available yet.";
  if (
    /failed to fetch|unable to connect|connection refused|network request|rpc error|-32603/.test(
      message,
    )
  )
    return "Could not reach Bradbury. Please try again.";
  return "Something went wrong. Please try again.";
}

export const contractAdapter = {
  async getConfig(): Promise<ProtocolConfig> {
    const data = asMap(await readContract("get_config"));
    const sources = asArray(data["sources"]).map((value) => asSource(value));
    if (sources.length !== 3 || new Set(sources).size !== 3)
      throw new Error("Contract configuration has invalid sources.");
    return {
      protocolName: asString(data["protocol"]),
      feeBps: asNumber(data["fee_bps"]),
      minBet: toGenAmount(data["minimum_bet"]),
      windowMinutes: asNumber(data["duration_seconds"]) / 60,
      sources,
      consensusThreshold: asNumber(data["consensus_threshold"]),
      network: "Bradbury Testnet",
      timezone: "UTC",
      returnPrecision: asDisplayString(data["return_precision_units"]),
      pricePrecision: asDisplayString(data["price_precision"]),
      payoutRounding: asString(data["payout_rounding"]),
      zeroBettorRule: asString(data["zero_bettor_behavior"]),
      zeroBackedWinnerRule: asString(data["zero_backed_winner_behavior"]),
      settlementFallback: asDisplayString(data["settlement_retry_window_seconds"]),
    };
  },

  async categories(): Promise<CategoryId[]> {
    const categories = asArray(await readContract("categories")).map(asCategory);
    if (categories.length !== CATEGORIES.length || new Set(categories).size !== categories.length)
      throw new Error("Contract response has invalid categories.");
    return categories;
  },

  async categoryAssets(category: CategoryId): Promise<string[]> {
    return categoryAssetSymbols(
      await readContract("category_assets", [toContractCategory(category)]),
      category,
    );
  },

  async getMarkets(now: number, offset = 0, limit = MAX_PAGE): Promise<MarketView[]> {
    const data = asArray(await readContract("get_markets", pageArgs(offset, limit)));
    return data.map((item) => normalizeMarket(item, now)).sort((a, b) => a.startMs - b.startMs);
  },

  async getMarket(id: string, now: number, user?: string): Promise<MarketView | null> {
    try {
      const market = normalizeMarket(await readContract("get_market", [toMarketId(id)]), now);
      if (market.id !== id) throw new Error("Contract market ID mismatch.");
      if (!user) return market;
      const position = await this.getUserPosition(id, user);
      return applyPositionToMarket(market, position);
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  },

  async getBettingState(marketId: string, now: number, user?: string): Promise<MarketView | null> {
    await readContract("get_betting_state", [toMarketId(marketId)]);
    return this.getMarket(marketId, now, user);
  },

  async getOpenMarkets(now: number, offset = 0, limit = MAX_PAGE): Promise<MarketView[]> {
    const data = asArray(await readContract("get_open_markets", pageArgs(offset, limit)));
    return data.map((item) => normalizeMarket(item, now)).sort((a, b) => a.startMs - b.startMs);
  },

  async getMarketByCategoryStart(
    category: CategoryId,
    startMs: number,
  ): Promise<MarketView | null> {
    try {
      const market = normalizeMarket(
        await readContract("get_market_by_category_start", [
          toContractCategory(category),
          toUnixSeconds(startMs),
        ]),
        Date.now(),
      );
      if (market.category !== category || market.startMs !== startMs)
        throw new Error("Contract market lookup does not match the requested window.");
      return market;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  },

  async getUserPosition(marketId: string, user: string): Promise<Position | null> {
    const raw = await readContract("get_user_position", [
      toMarketId(marketId),
      toContractAddress(user),
    ]);
    const position = normalizePosition(raw, user, marketId);
    return position.hasPosition ? position : null;
  },

  async getUserPositions(
    now: number,
    user: string,
    offset = 0,
    limit = MAX_PAGE,
  ): Promise<{ position: Position; market: MarketView }[]> {
    const rawPositions = asArray(
      await readContract("get_user_positions", [
        toContractAddress(user),
        ...pageArgs(offset, limit),
      ]),
    );
    return Promise.all(
      rawPositions.map(async (raw) => {
        const position = normalizePosition(raw, user);
        const market = await this.getMarket(position.marketId, now, user);
        if (!market) throw new Error("Position references a market that no longer exists.");
        return { position, market };
      }),
    );
  },

  async getClaimableMarkets(
    now: number,
    user: string,
    offset = 0,
    limit = MAX_PAGE,
  ): Promise<MarketView[]> {
    const rawPositions = asArray(
      await readContract("get_claimable_markets", [
        toContractAddress(user),
        ...pageArgs(offset, limit),
      ]),
    );
    return Promise.all(
      rawPositions.map(async (raw) => {
        const position = normalizePosition(raw, user);
        const market = await this.getMarket(position.marketId, now, user);
        if (!market) throw new Error("Claimable position references a missing market.");
        return market;
      }),
    );
  },

  async getSourceEvidence(marketId: string, source?: SourceId): Promise<SourceEvidence[]> {
    const market = await this.getMarket(marketId, Date.now());
    if (!market) return [];
    const sources: SourceId[] = source ? [source] : ["BINANCE", "BITGET", "GATE"];
    const results = await Promise.all(
      sources.map(async (item) => {
        try {
          return normalizeEvidence(
            await readContract("get_source_evidence", [toMarketId(marketId), item]),
            market,
            item,
          );
        } catch (error) {
          if (isUnavailableEvidence(error)) return emptyEvidence(item, market);
          throw error;
        }
      }),
    );
    return results;
  },

  async getUserActivity(user: string, offset = 0, limit = MAX_PAGE): Promise<ActivityRecord[]> {
    const rows = asArray(
      await readContract("get_user_activity", [
        toContractAddress(user),
        ...pageArgs(offset, limit),
      ]),
    );
    const records = rows.map((row) => normalizeActivity(row, user)).reverse();
    return Promise.all(
      records.map(async (record) => {
        const market = await this.getMarket(record.marketId, Date.now());
        if (!market) throw new Error("Activity references a missing market.");
        if (record.asset && !market.assets.some((asset) => asset.symbol === record.asset))
          throw new Error("Activity asset does not belong to its market.");
        return { ...record, category: market.category };
      }),
    );
  },

  async getUserActivityCount(user: string): Promise<number> {
    const count = asBigInt(
      await readContract("get_user_activity_count", [toContractAddress(user)]),
    );
    if (count > BigInt(Number.MAX_SAFE_INTEGER))
      throw new Error("Activity count is outside the supported display range.");
    return Number(count);
  },

  async createMarket(
    category: CategoryId,
    startMs: number,
    user: string,
    onStage?: TransactionStageHandler,
  ): Promise<ContractWriteResult> {
    try {
      const receipt = await writeContract(
        user,
        "create_market",
        [toContractCategory(category), toUnixSeconds(startMs)],
        0n,
        onStage,
      );
      return { ok: true, hash: receipt.hash, confirmed: receipt.confirmed };
    } catch (error) {
      return { ok: false, error: contractError(error) };
    }
  },

  async placeBet(
    marketId: string,
    asset: string,
    amountWei: bigint,
    user: string,
    onStage?: TransactionStageHandler,
  ): Promise<ContractWriteResult> {
    try {
      const receipt = await writeContract(
        user,
        "place_bet",
        [toMarketId(marketId), asset],
        amountWei,
        onStage,
      );
      return { ok: true, hash: receipt.hash, confirmed: receipt.confirmed };
    } catch (error) {
      return { ok: false, error: contractError(error) };
    }
  },

  async settleMarket(
    marketId: string,
    user: string,
    onStage?: TransactionStageHandler,
  ): Promise<ContractWriteResult> {
    try {
      const receipt = await writeContract(
        user,
        "settle_market",
        [toMarketId(marketId)],
        0n,
        onStage,
      );
      return { ok: true, hash: receipt.hash, confirmed: receipt.confirmed };
    } catch (error) {
      return { ok: false, error: contractError(error) };
    }
  },

  async claim(
    marketId: string,
    user: string,
    onStage?: TransactionStageHandler,
  ): Promise<ContractWriteResult> {
    try {
      const receipt = await writeContract(user, "claim", [toMarketId(marketId)], 0n, onStage);
      return { ok: true, hash: receipt.hash, confirmed: receipt.confirmed };
    } catch (error) {
      return { ok: false, error: contractError(error) };
    }
  },

  async claimRefund(
    marketId: string,
    user: string,
    onStage?: TransactionStageHandler,
  ): Promise<ContractWriteResult> {
    try {
      const receipt = await writeContract(
        user,
        "claim_refund",
        [toMarketId(marketId)],
        0n,
        onStage,
      );
      return { ok: true, hash: receipt.hash, confirmed: receipt.confirmed };
    } catch (error) {
      return { ok: false, error: contractError(error) };
    }
  },
};
