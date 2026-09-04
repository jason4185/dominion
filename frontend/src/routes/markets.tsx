import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useAccount } from "wagmi";
import { MarketCard } from "@/components/dominion/MarketCard";
import { EmptyState, FilterChip, Panel } from "@/components/dominion/primitives";
import { Button } from "@/components/ui/button";
import { categoryById } from "@/lib/dominion/categories";
import { gen } from "@/lib/dominion/format";
import { useCategories, useMarkets, useNow } from "@/lib/dominion/useDominion";
import type { CategoryId, MarketStatus } from "@/lib/dominion/types";

type StatusFilter = "ALL" | "OPEN" | "UPCOMING" | "SETTLED" | "INCONCLUSIVE";

interface MarketsSearch {
  q?: string | undefined;
  cat?: CategoryId | "ALL" | undefined;
  status?: StatusFilter | undefined;
}

export const Route = createFileRoute("/markets")({
  validateSearch: (search: Record<string, unknown>): MarketsSearch => ({
    q: typeof search["q"] === "string" && search["q"] ? search["q"] : undefined,
    cat: (search["cat"] as MarketsSearch["cat"]) ?? undefined,
    status: (search["status"] as StatusFilter) ?? undefined,
  }),
  head: () => ({
    meta: [
      { title: "Markets — DOMINION hourly stock dominance" },
      {
        name: "description",
        content:
          "Browse open, upcoming and settled 1-hour stock dominance markets across Big Tech, AI & Growth and Crypto & Fintech.",
      },
      { property: "og:title", content: "Markets — DOMINION" },
      {
        property: "og:description",
        content: "Permissionless hourly stock dominance pools on GenLayer.",
      },
    ],
  }),
  component: MarketsPage,
});

function MarketsPage() {
  const now = useNow();
  const { address, isConnecting, isReconnecting } = useAccount();
  const { q, cat = "ALL", status = "ALL" } = Route.useSearch();
  const navigate = Route.useNavigate();

  const marketsQuery = useMarkets(now);
  const categoriesQuery = useCategories();
  const categories = categoriesQuery.data ?? [];
  const all = useMemo(() => marketsQuery.data ?? [], [marketsQuery.data]);

  const filtered = useMemo(() => {
    const query = (q ?? "").trim().toLowerCase();
    return all.filter((m) => {
      if (cat !== "ALL" && m.category !== cat) return false;
      if (status !== "ALL") {
        const effective: MarketStatus[] =
          status === "SETTLED"
            ? ["SETTLED"]
            : status === "OPEN"
              ? ["OPEN", "PENDING_SETTLEMENT"]
              : [status];
        if (!effective.includes(m.status)) return false;
      }
      if (!query) return true;
      const haystack = [
        m.id,
        m.category.replace("_", " "),
        ...m.assets.map((a) => `${a.symbol} ${a.company}`),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [all, cat, status, q]);

  const totalLiquidity = all.reduce((sum, m) => sum + m.totalPool, 0n);
  const openCount = all.filter((m) => m.status === "OPEN").length;
  const hasMarketData =
    marketsQuery.data !== undefined && !marketsQuery.isError && !categoriesQuery.isError;

  const setSearch = (patch: Partial<MarketsSearch>) =>
    navigate({ to: "/markets", search: (prev) => ({ ...prev, ...patch }) });

  return (
    <main className="mx-auto max-w-[1400px] px-4 py-8 lg:px-6">
      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Stock dominance, one hour at a time.
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Pick the stock that leads its category over an exact 1-hour UTC window. Pari-mutuel
            pools, 0% protocol fee, settled by 2-of-3 exchange source consensus.
          </p>
        </div>
        <div className="flex gap-3">
          <div className="rounded-xl border border-border bg-card px-4 py-3">
            <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              Total liquidity
            </p>
            <p className="num mt-1 text-lg font-semibold text-foreground">
              {hasMarketData ? `${gen(totalLiquidity, 0)} GEN` : "—"}
            </p>
          </div>
          <div className="rounded-xl border border-border bg-card px-4 py-3">
            <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              Open now
            </p>
            <p className="num mt-1 text-lg font-semibold text-positive">
              {hasMarketData ? openCount : "—"}
            </p>
          </div>
        </div>
      </section>

      <section className="mt-6 flex flex-col gap-3 rounded-xl border border-border bg-card p-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-1.5">
          <FilterChip active={cat === "ALL"} onClick={() => setSearch({ cat: "ALL" })}>
            All
          </FilterChip>
          {categories.map((id) => (
            <FilterChip key={id} active={cat === id} onClick={() => setSearch({ cat: id })}>
              {categoryById(id).label}
            </FilterChip>
          ))}
          <span className="mx-1 hidden h-5 w-px bg-border sm:block" />
          {(["ALL", "OPEN", "UPCOMING", "SETTLED", "INCONCLUSIVE"] as StatusFilter[]).map((s) => (
            <FilterChip key={s} active={status === s} onClick={() => setSearch({ status: s })}>
              {s === "ALL" ? "All status" : s.charAt(0) + s.slice(1).toLowerCase()}
            </FilterChip>
          ))}
        </div>
        <div className="relative lg:w-72">
          <input
            value={q ?? ""}
            onChange={(e) => setSearch({ q: e.target.value || undefined })}
            placeholder="Search symbol, category or market ID"
            aria-label="Filter markets"
            className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/50"
          />
        </div>
      </section>

      <section className="mt-5">
        {marketsQuery.isPending || categoriesQuery.isPending ? (
          <Panel className="px-6 py-14 text-center text-xs text-muted-foreground">
            Loading markets from Dominion…
          </Panel>
        ) : marketsQuery.isError || categoriesQuery.isError ? (
          <Panel className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <p className="text-sm font-semibold text-foreground">Could not load markets</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              Could not reach Bradbury. Please try again.
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                void Promise.allSettled([marketsQuery.refetch(), categoriesQuery.refetch()]);
              }}
            >
              Retry
            </Button>
          </Panel>
        ) : filtered.length === 0 ? (
          <EmptyState
            title={all.length === 0 ? "No markets yet" : "No markets match your filters"}
            description={
              all.length === 0
                ? "The Dominion contract has no markets yet. Create the first exact UTC-hour window."
                : "Try a different category, status or search term — or create the market yourself."
            }
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((m) => (
              <MarketCard
                key={m.id}
                market={m}
                now={now}
                address={address}
                walletHydrating={isConnecting || isReconnecting}
              />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
