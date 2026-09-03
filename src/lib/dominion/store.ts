import { CATEGORIES, categoryById } from "./categories";
import { HOUR_MS, floorHour } from "./format";
import type {
  ActivityRecord,
  CategoryId,
  Market,
  MarketStatus,
  MarketView,
  Position,
  ProtocolConfig,
  SourceEvidence,
  Wallet,
} from "./types";

export const CONFIG: ProtocolConfig = {
  feeBps: 0,
  minBet: 1,
  windowMinutes: 60,
  sources: ["BINANCE", "BITGET", "GATE"],
  consensusThreshold: 2,
  network: "GenLayer Bradbury Testnet",
};

export const WALLET: Wallet = {
  address: "0x7ad3f19c4b2e5a80d16c9f42be7c8104ea59d3b7",
  balance: 1284.5,
  network: CONFIG.network,
};

const OTHER = "0x91cb0e7d5a4f2830b6ce1147d9a02f3c58ba7e11";

// Deterministic pseudo-random so SSR and client agree.
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

function makeEvidence(
  seed: number,
  symbols: string[],
  winner: string | null,
  degraded: boolean,
): SourceEvidence[] {
  const r = rng(seed);
  const base: Record<string, number> = {};
  symbols.forEach((s) => {
    base[s] = 80 + r() * 400;
  });
  const returnsBase: Record<string, number> = {};
  symbols.forEach((s) => {
    returnsBase[s] = (r() - 0.5) * 2.4;
  });
  if (winner) {
    const max = Math.max(...symbols.map((s) => returnsBase[s]));
    returnsBase[winner] = max + 0.35;
  }
  return CONFIG.sources.map((source, i) => {
    const unavailable = degraded && i === 2;
    const openPrices: Record<string, number | null> = {};
    const closePrices: Record<string, number | null> = {};
    const returns: Record<string, number | null> = {};
    symbols.forEach((s) => {
      if (unavailable) {
        openPrices[s] = null;
        closePrices[s] = null;
        returns[s] = null;
        return;
      }
      const drift = (i - 1) * 0.012;
      const o = Number((base[s] * (1 + drift / 100)).toFixed(2));
      const ret = Number((returnsBase[s] + drift).toFixed(3));
      openPrices[s] = o;
      closePrices[s] = Number((o * (1 + ret / 100)).toFixed(2));
      returns[s] = ret;
    });
    let srcWinner: string | null = null;
    if (!unavailable) {
      srcWinner = symbols.reduce((a, b) => ((returns[a] ?? -99) >= (returns[b] ?? -99) ? a : b));
    }
    return {
      source,
      status: unavailable ? "UNAVAILABLE" : "OK",
      openPrices,
      closePrices,
      returns,
      winner: srcWinner,
    };
  });
}

interface Seed {
  cat: CategoryId;
  offsetHours: number;
  status: MarketStatus;
  pools: [number, number, number];
  winnerIdx: number | null;
  degraded?: boolean;
  claimed?: boolean;
  user?: { assetIdx: number; stake: number; claimed?: boolean };
}

const SEEDS: Seed[] = [
  { cat: "BIG_TECH", offsetHours: 0, status: "OPEN", pools: [420, 268.5, 190], winnerIdx: null, user: { assetIdx: 0, stake: 45 } },
  { cat: "AI_GROWTH", offsetHours: 0, status: "OPEN", pools: [980.25, 310, 545.75], winnerIdx: null, user: { assetIdx: 2, stake: 120 } },
  { cat: "CRYPTO_FINTECH", offsetHours: 0, status: "OPEN", pools: [155, 92.5, 61], winnerIdx: null },
  { cat: "BIG_TECH", offsetHours: 1, status: "UPCOMING", pools: [64, 30, 18], winnerIdx: null },
  { cat: "AI_GROWTH", offsetHours: 1, status: "UPCOMING", pools: [210, 88, 141], winnerIdx: null, user: { assetIdx: 1, stake: 25 } },
  { cat: "CRYPTO_FINTECH", offsetHours: 2, status: "UPCOMING", pools: [12, 5, 9], winnerIdx: null },
  { cat: "BIG_TECH", offsetHours: -1, status: "PENDING_SETTLEMENT", pools: [340, 402, 288], winnerIdx: null },
  { cat: "AI_GROWTH", offsetHours: -2, status: "SETTLED", pools: [1240, 460, 780], winnerIdx: 0, user: { assetIdx: 0, stake: 90 } },
  { cat: "CRYPTO_FINTECH", offsetHours: -3, status: "SETTLED", pools: [510, 620, 355], winnerIdx: 1, user: { assetIdx: 2, stake: 60 } },
  { cat: "BIG_TECH", offsetHours: -4, status: "SETTLED", pools: [880, 640, 990], winnerIdx: 2, user: { assetIdx: 2, stake: 150, claimed: true }, claimed: true },
  { cat: "AI_GROWTH", offsetHours: -5, status: "INCONCLUSIVE", pools: [300, 220, 180], winnerIdx: null, degraded: true, user: { assetIdx: 1, stake: 70 } },
  { cat: "CRYPTO_FINTECH", offsetHours: -6, status: "INCONCLUSIVE", pools: [140, 95, 165], winnerIdx: null, degraded: true },
  { cat: "BIG_TECH", offsetHours: -7, status: "SETTLED", pools: [720, 810, 430], winnerIdx: 1, user: { assetIdx: 1, stake: 110, claimed: true }, claimed: true },
  { cat: "AI_GROWTH", offsetHours: -8, status: "SETTLED", pools: [260, 340, 400], winnerIdx: 2 },
];

interface State {
  markets: Market[];
  positions: Position[];
  activity: ActivityRecord[];
  wallet: Wallet;
}

function buildInitialState(): State {
  const anchor = floorHour(Date.now());
  const markets: Market[] = [];
  const positions: Position[] = [];
  const activity: ActivityRecord[] = [];

  SEEDS.forEach((seed, i) => {
    const def = categoryById(seed.cat);
    const startMs = anchor + seed.offsetHours * HOUR_MS;
    const endMs = startMs + HOUR_MS;
    const symbols = def.assets.map((a) => a.symbol);
    const pools: Record<string, number> = {};
    symbols.forEach((s, idx) => (pools[s] = seed.pools[idx]));
    const totalPool = seed.pools.reduce((a, b) => a + b, 0);
    const winner = seed.winnerIdx === null ? null : symbols[seed.winnerIdx];
    const settledLike = seed.status === "SETTLED" || seed.status === "INCONCLUSIVE";
    const id = `DMN-${def.id === "BIG_TECH" ? "BT" : def.id === "AI_GROWTH" ? "AG" : "CF"}-${String(1000 + i * 7)}`;

    markets.push({
      id,
      category: seed.cat,
      assets: def.assets,
      startMs,
      endMs,
      createdBy: i % 3 === 0 ? WALLET.address : OTHER,
      status: seed.status,
      pools,
      totalPool,
      winner,
      consensusCount: settledLike ? (seed.degraded ? 1 : 3) : 0,
      evidence: settledLike || seed.status === "PENDING_SETTLEMENT"
        ? makeEvidence(i * 977 + 13, symbols, winner, !!seed.degraded)
        : [],
      claimedPool: seed.claimed && winner ? pools[winner] * 0.62 : 0,
    });

    if (seed.user) {
      const asset = symbols[seed.user.assetIdx];
      positions.push({
        marketId: id,
        wallet: WALLET.address,
        asset,
        stake: seed.user.stake,
        claimed: !!seed.user.claimed,
      });
      activity.push({
        id: `act-${id}-bet`,
        kind: "BET_PLACED",
        marketId: id,
        category: seed.cat,
        asset,
        amount: seed.user.stake,
        timestamp: startMs - 20 * 60_000,
        read: seed.offsetHours < 0,
      });
      if (seed.user.claimed) {
        activity.push({
          id: `act-${id}-claim`,
          kind: "PAYOUT_CLAIMED",
          marketId: id,
          category: seed.cat,
          asset,
          amount: Number((seed.user.stake * 1.85).toFixed(2)),
          timestamp: endMs + 12 * 60_000,
          read: true,
        });
      }
    }
  });

  // a top-up example
  activity.push({
    id: "act-topup-seed",
    kind: "BET_TOPPED_UP",
    marketId: markets[1].id,
    category: markets[1].category,
    asset: markets[1].assets[2].symbol,
    amount: 40,
    timestamp: Date.now() - 26 * 60_000,
    read: false,
  });

  activity.sort((a, b) => b.timestamp - a.timestamp);

  return { markets, positions, activity, wallet: { ...WALLET } };
}

let state: State = buildInitialState();
const listeners = new Set<() => void>();
let snapshotVersion = 0;
let cachedSnapshot: State = state;

export function getState(): State {
  return cachedSnapshot;
}

export function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setState(mutator: (s: State) => State) {
  state = mutator(state);
  snapshotVersion += 1;
  cachedSnapshot = { ...state };
  listeners.forEach((l) => l());
}

export function getVersion() {
  return snapshotVersion;
}

/* ---------- derivation ---------- */

export function deriveStatus(m: Market, now: number): MarketStatus {
  if (m.status === "SETTLED" || m.status === "INCONCLUSIVE") return m.status;
  if (now < m.startMs) return "UPCOMING";
  if (now < m.endMs) return "OPEN";
  return "PENDING_SETTLEMENT";
}

export function toView(m: Market, now: number, wallet = state.wallet.address): MarketView {
  const status = deriveStatus(m, now);
  const totalPool = Object.values(m.pools).reduce((a, b) => a + b, 0);
  const poolShares: Record<string, number> = {};
  m.assets.forEach((a) => {
    poolShares[a.symbol] = totalPool > 0 ? (m.pools[a.symbol] / totalPool) * 100 : 0;
  });
  const pos = state.positions.find((p) => p.marketId === m.id && p.wallet === wallet);
  const winningPool = m.winner ? m.pools[m.winner] : 0;
  const bettingOpen = status === "OPEN" || status === "UPCOMING";
  const positionWon = !!(pos && m.winner && pos.asset === m.winner && status === "SETTLED");
  const positionLost = !!(pos && m.winner && pos.asset !== m.winner && status === "SETTLED");
  const refundAvailable = !!(pos && status === "INCONCLUSIVE" && !pos.claimed);
  const claimAvailable = !!(positionWon && pos && !pos.claimed);
  let claimableAmount = 0;
  if (claimAvailable && pos) claimableAmount = (pos.stake / winningPool) * totalPool;
  if (refundAvailable && pos) claimableAmount = pos.stake;

  return {
    ...m,
    status,
    totalPool,
    poolShares,
    bettingOpen,
    settlementAvailable: status === "PENDING_SETTLEMENT",
    winningPool,
    remainingPool: Math.max(0, totalPool - m.claimedPool),
    userSelectedAsset: pos?.asset ?? null,
    userStake: pos?.stake ?? 0,
    canTopUp: bettingOpen && !!pos,
    positionWon,
    positionLost,
    claimAvailable,
    refundAvailable,
    claimableAmount: Number(claimableAmount.toFixed(2)),
    claimType: claimAvailable ? "PAYOUT" : refundAvailable ? "REFUND" : null,
  };
}

export function pushActivity(rec: Omit<ActivityRecord, "id" | "read" | "timestamp">) {
  setState((s) => ({
    ...s,
    activity: [
      { ...rec, id: `act-${Math.random().toString(36).slice(2, 10)}`, read: false, timestamp: Date.now() },
      ...s.activity,
    ],
  }));
}

export function markNotificationsRead() {
  setState((s) => ({ ...s, activity: s.activity.map((a) => ({ ...a, read: true })) }));
}

export { CATEGORIES };
