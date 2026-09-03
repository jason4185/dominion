import { categoryById } from "./categories";
import { HOUR_MS } from "./format";
import {
  CONFIG,
  deriveStatus,
  getState,
  pushActivity,
  setState,
  toView,
} from "./store";
import type { ActivityRecord, CategoryId, MarketView, Position, ProtocolConfig, SourceEvidence } from "./types";

/**
 * Thin adapter that mirrors the future GenLayer contract surface.
 * Today it reads and writes the in-memory mock store.
 */
export const contractAdapter = {
  getConfig(): ProtocolConfig {
    return CONFIG;
  },

  getWallet() {
    return getState().wallet;
  },

  getMarkets(now: number): MarketView[] {
    return getState()
      .markets.map((m) => toView(m, now))
      .sort((a, b) => a.startMs - b.startMs);
  },

  getMarket(id: string, now: number): MarketView | null {
    const m = getState().markets.find((x) => x.id === id);
    return m ? toView(m, now) : null;
  },

  getOpenMarkets(now: number): MarketView[] {
    return contractAdapter.getMarkets(now).filter((m) => m.status === "OPEN");
  },

  getMarketByCategoryStart(category: CategoryId, startMs: number, now: number): MarketView | null {
    const m = getState().markets.find((x) => x.category === category && x.startMs === startMs);
    return m ? toView(m, now) : null;
  },

  getUserPosition(marketId: string): Position | null {
    const s = getState();
    return s.positions.find((p) => p.marketId === marketId && p.wallet === s.wallet.address) ?? null;
  },

  getUserPositions(now: number): { position: Position; market: MarketView }[] {
    const s = getState();
    return s.positions
      .filter((p) => p.wallet === s.wallet.address)
      .map((p) => ({ position: p, market: toView(s.markets.find((m) => m.id === p.marketId)!, now) }))
      .sort((a, b) => b.market.startMs - a.market.startMs);
  },

  getClaimableMarkets(now: number): MarketView[] {
    return contractAdapter.getMarkets(now).filter((m) => m.claimAvailable || m.refundAvailable);
  },

  getSourceEvidence(marketId: string): SourceEvidence[] {
    return getState().markets.find((m) => m.id === marketId)?.evidence ?? [];
  },

  getUserActivity(): ActivityRecord[] {
    return getState().activity;
  },

  getUserActivityCount(): number {
    return getState().activity.filter((a) => !a.read).length;
  },

  createMarket(category: CategoryId, startMs: number): { ok: boolean; id?: string; error?: string } {
    const s = getState();
    if (startMs <= Date.now()) return { ok: false, error: "Window has already started." };
    if (s.markets.some((m) => m.category === category && m.startMs === startMs))
      return { ok: false, error: "A market already exists for this category and window." };
    const def = categoryById(category);
    const id = `DMN-${category === "BIG_TECH" ? "BT" : category === "AI_GROWTH" ? "AG" : "CF"}-${Math.floor(
      2000 + Math.random() * 7000,
    )}`;
    const pools: Record<string, number> = {};
    def.assets.forEach((a) => (pools[a.symbol] = 0));
    setState((prev) => ({
      ...prev,
      markets: [
        ...prev.markets,
        {
          id,
          category,
          assets: def.assets,
          startMs,
          endMs: startMs + HOUR_MS,
          createdBy: prev.wallet.address,
          status: "UPCOMING",
          pools,
          totalPool: 0,
          winner: null,
          consensusCount: 0,
          evidence: [],
          claimedPool: 0,
        },
      ],
    }));
    pushActivity({ kind: "MARKET_CREATED", marketId: id, category, asset: null, amount: 0 });
    return { ok: true, id };
  },

  placeBet(marketId: string, asset: string, amount: number): { ok: boolean; error?: string; toppedUp?: boolean } {
    const s = getState();
    const market = s.markets.find((m) => m.id === marketId);
    if (!market) return { ok: false, error: "Market not found." };
    const status = deriveStatus(market, Date.now());
    if (status !== "OPEN" && status !== "UPCOMING") return { ok: false, error: "Betting is closed for this market." };
    if (amount < CONFIG.minBet) return { ok: false, error: `Minimum bet is ${CONFIG.minBet} GEN.` };
    if (amount > s.wallet.balance) return { ok: false, error: "Insufficient GEN balance." };
    const existing = s.positions.find((p) => p.marketId === marketId && p.wallet === s.wallet.address);
    if (existing && existing.asset !== asset)
      return { ok: false, error: `You already backed ${existing.asset}. Switching assets is not allowed.` };

    setState((prev) => ({
      ...prev,
      wallet: { ...prev.wallet, balance: Number((prev.wallet.balance - amount).toFixed(2)) },
      markets: prev.markets.map((m) =>
        m.id === marketId
          ? { ...m, pools: { ...m.pools, [asset]: Number((m.pools[asset] + amount).toFixed(2)) } }
          : m,
      ),
      positions: existing
        ? prev.positions.map((p) =>
            p.marketId === marketId && p.wallet === prev.wallet.address
              ? { ...p, stake: Number((p.stake + amount).toFixed(2)) }
              : p,
          )
        : [...prev.positions, { marketId, wallet: prev.wallet.address, asset, stake: amount, claimed: false }],
    }));
    pushActivity({
      kind: existing ? "BET_TOPPED_UP" : "BET_PLACED",
      marketId,
      category: market.category,
      asset,
      amount,
    });
    return { ok: true, toppedUp: !!existing };
  },

  settleMarket(marketId: string): { ok: boolean; error?: string; winner?: string | null } {
    const s = getState();
    const market = s.markets.find((m) => m.id === marketId);
    if (!market) return { ok: false, error: "Market not found." };
    if (deriveStatus(market, Date.now()) !== "PENDING_SETTLEMENT")
      return { ok: false, error: "Market is not ready for settlement." };
    const ok = market.evidence.filter((e) => e.status === "OK");
    if (ok.length < CONFIG.consensusThreshold) {
      setState((prev) => ({
        ...prev,
        markets: prev.markets.map((m) =>
          m.id === marketId ? { ...m, status: "INCONCLUSIVE", consensusCount: ok.length } : m,
        ),
      }));
      pushActivity({ kind: "MARKET_SETTLED", marketId, category: market.category, asset: null, amount: 0 });
      return { ok: true, winner: null };
    }
    const tally: Record<string, number> = {};
    ok.forEach((e) => {
      if (e.winner) tally[e.winner] = (tally[e.winner] ?? 0) + 1;
    });
    const winner = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
    const consensus = winner?.[1] ?? 0;
    const conclusive = consensus >= CONFIG.consensusThreshold;
    setState((prev) => ({
      ...prev,
      markets: prev.markets.map((m) =>
        m.id === marketId
          ? {
              ...m,
              status: conclusive ? "SETTLED" : "INCONCLUSIVE",
              winner: conclusive ? winner[0] : null,
              consensusCount: consensus,
            }
          : m,
      ),
    }));
    pushActivity({ kind: "MARKET_SETTLED", marketId, category: market.category, asset: null, amount: 0 });
    return { ok: true, winner: conclusive ? winner[0] : null };
  },

  claim(marketId: string): { ok: boolean; error?: string; amount?: number } {
    const view = contractAdapter.getMarket(marketId, Date.now());
    if (!view) return { ok: false, error: "Market not found." };
    if (!view.claimAvailable) return { ok: false, error: "Nothing to claim." };
    const amount = view.claimableAmount;
    setState((prev) => ({
      ...prev,
      wallet: { ...prev.wallet, balance: Number((prev.wallet.balance + amount).toFixed(2)) },
      markets: prev.markets.map((m) =>
        m.id === marketId ? { ...m, claimedPool: Number((m.claimedPool + amount).toFixed(2)) } : m,
      ),
      positions: prev.positions.map((p) =>
        p.marketId === marketId && p.wallet === prev.wallet.address ? { ...p, claimed: true } : p,
      ),
    }));
    pushActivity({
      kind: "PAYOUT_CLAIMED",
      marketId,
      category: view.category,
      asset: view.userSelectedAsset,
      amount,
    });
    return { ok: true, amount };
  },

  claimRefund(marketId: string): { ok: boolean; error?: string; amount?: number } {
    const view = contractAdapter.getMarket(marketId, Date.now());
    if (!view) return { ok: false, error: "Market not found." };
    if (!view.refundAvailable) return { ok: false, error: "No refund available." };
    const amount = view.claimableAmount;
    setState((prev) => ({
      ...prev,
      wallet: { ...prev.wallet, balance: Number((prev.wallet.balance + amount).toFixed(2)) },
      positions: prev.positions.map((p) =>
        p.marketId === marketId && p.wallet === prev.wallet.address ? { ...p, claimed: true } : p,
      ),
    }));
    pushActivity({
      kind: "REFUND_CLAIMED",
      marketId,
      category: view.category,
      asset: view.userSelectedAsset,
      amount,
    });
    return { ok: true, amount };
  },
};
