import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Check } from "lucide-react";
import { CategoryBadge, PoolBar, StatusPill, ASSET_DOT } from "./primitives";
import { countdown, gen, pct, utcDate, utcWindow } from "@/lib/dominion/format";
import { resolvePositionUiState } from "@/lib/dominion/marketState";
import { useUserPosition } from "@/lib/dominion/useDominion";
import type { MarketView } from "@/lib/dominion/types";
import { cn } from "@/lib/utils";

export function MarketCard({
  market,
  now,
  address,
  walletHydrating = false,
}: {
  market: MarketView;
  now: number;
  address: string | undefined;
  walletHydrating?: boolean;
}) {
  const positionQuery = useUserPosition(market.id, address);
  const positionState = resolvePositionUiState({
    address,
    walletHydrating,
    query: positionQuery,
  });
  const position = positionState === "HAS_POSITION" ? positionQuery.data : undefined;
  const symbols = market.assets.map((a) => a.symbol);
  const timing =
    market.status === "OPEN"
      ? `Closes in ${countdown(market.endMs, now)}`
      : market.status === "UPCOMING"
        ? `Opens in ${countdown(market.startMs, now)}`
        : market.status === "PENDING_SETTLEMENT"
          ? "Settlement available"
          : market.winner
            ? `Winner ${market.winner}`
            : "Refunds available";

  return (
    <Link
      to="/market/$id"
      params={{ id: market.id }}
      className="group flex flex-col rounded-xl border border-border bg-card p-4 transition-colors hover:border-border-strong"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <CategoryBadge category={market.category} />
          <StatusPill status={market.status} />
        </div>
        <span className="num shrink-0 text-[10px] text-muted-foreground">{market.id}</span>
      </div>

      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="num text-sm font-semibold text-foreground">
            {utcWindow(market.startMs, market.endMs)}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {utcDate(market.startMs)} · {timing}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Pool</p>
          <p className="num text-sm font-semibold text-foreground">{gen(market.totalPool)} GEN</p>
        </div>
      </div>

      <PoolBar className="mt-3" shares={market.poolShares} symbols={symbols} />

      <div className="mt-3 space-y-1.5">
        {market.assets.map((a, i) => {
          const selected = position?.asset === a.symbol;
          const isWinner = market.winner === a.symbol;
          return (
            <div
              key={a.symbol}
              className={cn(
                "flex items-center gap-2 rounded-lg border px-2.5 py-1.5",
                selected
                  ? "border-primary/40 bg-primary-soft"
                  : isWinner
                    ? "border-positive/30 bg-positive-soft"
                    : "border-transparent bg-elevated",
              )}
            >
              <span className={cn("size-1.5 shrink-0 rounded-full", ASSET_DOT[i])} />
              <span className="num w-14 shrink-0 text-xs font-semibold text-foreground">
                {a.symbol}
              </span>
              <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                {a.company}
              </span>
              {selected && <Check className="size-3 shrink-0 text-primary-glow" />}
              <span className="num shrink-0 text-[11px] text-muted-foreground">
                {gen(market.pools[a.symbol] ?? 0n, 0)}
              </span>
              <span className="num w-11 shrink-0 text-right text-[11px] font-semibold text-foreground">
                {pct(market.poolShares[a.symbol] ?? 0, 0)}
              </span>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
        <span className="text-[11px] text-muted-foreground">
          {positionState === "DISCONNECTED"
            ? "Connect wallet to see your position"
            : positionState === "LOADING"
              ? "Loading your position…"
              : positionState === "ERROR"
                ? "Could not load your position. Try again."
                : positionState === "HAS_POSITION" && position
                  ? `Your pick ${position.asset} · ${gen(position.stake)} GEN`
                  : "No position"}
        </span>
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-primary-glow">
          {market.bettingOpen ? "Bet now" : "View market"}
          <ArrowUpRight className="size-3.5" />
        </span>
      </div>
    </Link>
  );
}
