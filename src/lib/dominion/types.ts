export type CategoryId = "BIG_TECH" | "AI_GROWTH" | "CRYPTO_FINTECH";

export type MarketStatus = "UPCOMING" | "OPEN" | "PENDING_SETTLEMENT" | "SETTLED" | "INCONCLUSIVE";

export type SourceId = "BINANCE" | "BITGET" | "GATE";

export type SourceStatus = "OK" | "STALE" | "UNAVAILABLE";

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
  createdBy: string;
  status: MarketStatus;
  pools: Record<string, number>;
  totalPool: number;
  winner: string | null;
  consensusCount: number;
  evidence: SourceEvidence[];
  claimedPool: number;
}

export interface Position {
  marketId: string;
  wallet: string;
  asset: string;
  stake: number;
  claimed: boolean;
}

export type ActivityKind = "BET_PLACED" | "BET_TOPPED_UP" | "PAYOUT_CLAIMED" | "REFUND_CLAIMED" | "MARKET_CREATED" | "MARKET_SETTLED";

export interface ActivityRecord {
  id: string;
  kind: ActivityKind;
  marketId: string;
  category: CategoryId;
  asset: string | null;
  amount: number;
  timestamp: number;
  read: boolean;
}

export interface Wallet {
  address: string;
  balance: number;
  network: string;
}

export interface ProtocolConfig {
  feeBps: number;
  minBet: number;
  windowMinutes: number;
  sources: SourceId[];
  consensusThreshold: number;
  network: string;
}

/** Frontend-ready denormalized view of a market for the connected wallet. */
export interface MarketView extends Market {
  poolShares: Record<string, number>;
  bettingOpen: boolean;
  settlementAvailable: boolean;
  winningPool: number;
  remainingPool: number;
  userSelectedAsset: string | null;
  userStake: number;
  canTopUp: boolean;
  positionWon: boolean;
  positionLost: boolean;
  claimAvailable: boolean;
  refundAvailable: boolean;
  claimableAmount: number;
  claimType: "PAYOUT" | "REFUND" | null;
}
