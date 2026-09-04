export type CategoryId = "BIG_TECH" | "AI_GROWTH" | "CRYPTO_FINTECH";

export type MarketStatus = "UPCOMING" | "OPEN" | "PENDING_SETTLEMENT" | "SETTLED" | "INCONCLUSIVE";

export type SourceId = "BINANCE" | "BITGET" | "GATE";

export type SourceStatus = "OK" | "TIE" | "STALE" | "UNAVAILABLE";

export interface Asset {
  symbol: string;
  company: string;
}

export interface CategoryDef {
  id: CategoryId;
  label: string;
  short: string;
  assets: Asset[];
}

export interface SourceEvidence {
  source: SourceId;
  status: SourceStatus;
  openPrices: Record<string, number | null>;
  closePrices: Record<string, number | null>;
  returns: Record<string, number | null>;
  winner: string | null;
}

export interface Market {
  id: string;
  category: CategoryId;
  assets: Asset[];
  startMs: number;
  endMs: number;
  createdBy?: string;
  status: MarketStatus;
  pools: Record<string, bigint>;
  totalPool: bigint;
  winner: string | null;
  consensusCount?: number;
  evidence?: SourceEvidence[];
  claimedPool: bigint;
  claimedWinningStake?: bigint;
}

export interface Position {
  marketId: string;
  wallet: string;
  hasPosition: boolean;
  asset: string;
  stake: bigint;
  claimed: boolean;
  refunded?: boolean;
  canTopUp?: boolean;
  positionWon?: boolean;
  positionLost?: boolean;
  claimAvailable?: boolean;
  refundAvailable?: boolean;
  claimableAmount?: bigint;
  claimType?: "PAYOUT" | "REFUND" | null;
}

export type ActivityKind =
  | "BET_PLACED"
  | "BET_TOPPED_UP"
  | "PAYOUT_CLAIMED"
  | "REFUND_CLAIMED"
  | "MARKET_CREATED"
  | "MARKET_SETTLED"
  | string;

export interface ActivityRecord {
  id: string;
  wallet: string;
  kind: ActivityKind;
  marketId: string;
  category: CategoryId;
  asset: string | null;
  amount: bigint;
  timestamp: number;
  read: boolean;
}

export interface Wallet {
  address: string;
  balance: bigint;
  network: string;
}

export interface ProtocolConfig {
  protocolName: string;
  feeBps: number;
  minBet: bigint;
  windowMinutes: number;
  sources: SourceId[];
  consensusThreshold: number;
  network: string;
  timezone: "UTC";
  returnPrecision: string;
  pricePrecision: string;
  payoutRounding: string;
  zeroBettorRule: string;
  zeroBackedWinnerRule: string;
  settlementFallback: string;
}

/** Frontend-ready denormalized view of a market for the connected wallet. */
export interface MarketView extends Market {
  poolShares: Record<string, number>;
  bettingOpen: boolean;
  settlementAvailable: boolean;
  winningPool: bigint;
  remainingPool: bigint;
  userSelectedAsset: string | null;
  userStake: bigint;
  canTopUp: boolean;
  positionWon: boolean;
  positionLost: boolean;
  claimAvailable: boolean;
  refundAvailable: boolean;
  claimableAmount: bigint;
  claimType: "PAYOUT" | "REFUND" | null;
}
