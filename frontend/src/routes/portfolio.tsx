import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight, Clock3, RefreshCw, Trophy, WalletCards } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useAccount } from "wagmi";
import {
  CategoryBadge,
  EmptyState,
  FilterChip,
  Panel,
  StatusPill,
  StatCard,
} from "@/components/dominion/primitives";
import {
  TransactionDialog,
  TRANSACTION_DELAYED_MESSAGE,
  TRANSACTION_UPDATE_MESSAGE,
  type TransactionDialogController,
  useTransactionDialog,
} from "@/components/dominion/TransactionDialog";
import { contractAdapter } from "@/lib/dominion/contractAdapter";
import { countdown, gen, utcDate, utcWindow } from "@/lib/dominion/format";
import {
  useClaimableMarkets,
  useNow,
  useRefreshDominion,
  useUserPositions,
} from "@/lib/dominion/useDominion";
import type { MarketView, Position } from "@/lib/dominion/types";
import { retryRead } from "@/lib/dominion/retry";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/portfolio")({
  head: () => ({
    meta: [
      { title: "Portfolio — DOMINION" },
      { name: "description", content: "Track Dominion positions, payouts and refunds." },
    ],
  }),
  component: PortfolioPage,
});

type Tab = "ACTIVE" | "CLAIMABLE" | "HISTORY";

function PositionLink({ market, children }: { market: MarketView; children: React.ReactNode }) {
  return (
    <Link to="/market/$id" params={{ id: market.id }} className="group block">
      {children}
    </Link>
  );
}

function ActivePosition({
  position,
  market,
  now,
}: {
  position: Position;
  market: MarketView;
  now: number;
}) {
  const timing =
    market.status === "UPCOMING"
      ? `Opens in ${countdown(market.startMs, now)}`
      : market.status === "OPEN"
        ? `Closes in ${countdown(market.endMs, now)}`
        : market.status === "PENDING_SETTLEMENT"
          ? "Settlement available"
          : "Terminal";
  return (
    <PositionLink market={market}>
      <div className="flex flex-col gap-4 border-b border-border px-4 py-4 last:border-0 transition-colors hover:bg-elevated/40 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-1 grid size-8 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary-glow">
            <WalletCards className="size-4" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <CategoryBadge category={market.category} />
              <StatusPill status={market.status} />
            </div>
            <p className="mt-2 truncate text-sm font-semibold text-foreground">
              {market.id} · {utcWindow(market.startMs, market.endMs)}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {utcDate(market.startMs)} · Backing{" "}
              <span className="num font-semibold text-foreground">{position.asset}</span> · {timing}
            </p>
          </div>
        </div>
        <div className="flex items-center justify-between gap-5 sm:shrink-0 sm:justify-end">
          <div className="text-left sm:text-right">
            <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              Your stake
            </p>
            <p className="num mt-1 text-sm font-semibold text-foreground">
              {gen(position.stake)} GEN
            </p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              Pool {gen(market.totalPool, 0)} GEN
            </p>
          </div>
          <ArrowUpRight className="size-4 text-muted-foreground transition-colors group-hover:text-primary-glow" />
        </div>
      </div>
    </PositionLink>
  );
}

function ClaimablePosition({
  market,
  address,
  onRefresh,
  transaction,
}: {
  market: MarketView;
  address: string;
  onRefresh: () => void | Promise<void>;
  transaction: TransactionDialogController;
}) {
  const isRefund = market.refundAvailable;
  const claim = async () => {
    transaction.begin(isRefund ? "refund" : "claim");
    const result = isRefund
      ? await contractAdapter.claimRefund(market.id, address, transaction.update)
      : await contractAdapter.claim(market.id, address, transaction.update);
    if (!result.ok) {
      transaction.fail(result.error ?? "Something went wrong. Please try again.");
      return;
    }
    transaction.success(TRANSACTION_UPDATE_MESSAGE);
    await onRefresh();
    const updatedPosition = await retryRead(
      () => contractAdapter.getUserPosition(market.id, address),
      (position) => Boolean(position && (isRefund ? position.refunded : position.claimed)),
    );
    if (updatedPosition) await onRefresh();
    transaction.success(updatedPosition ? undefined : TRANSACTION_DELAYED_MESSAGE);
  };
  return (
    <div className="flex flex-col gap-4 border-b border-border px-4 py-4 last:border-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <span
          className={cn(
            "mt-1 grid size-8 shrink-0 place-items-center rounded-lg",
            isRefund ? "bg-gold-soft text-gold" : "bg-positive-soft text-positive",
          )}
        >
          {isRefund ? <RefreshCw className="size-4" /> : <Trophy className="size-4" />}
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <CategoryBadge category={market.category} />
            <span
              className={cn(
                "rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]",
                isRefund ? "bg-gold-soft text-gold" : "bg-positive-soft text-positive",
              )}
            >
              {isRefund ? "Refund" : "Winnings"}
            </span>
          </div>
          <Link
            to="/market/$id"
            params={{ id: market.id }}
            className="mt-2 block truncate text-sm font-semibold text-foreground hover:text-primary-glow"
          >
            {market.id} · {market.userSelectedAsset ?? "Position"}
          </Link>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Original stake {gen(market.userStake)} GEN · {utcDate(market.startMs)}
          </p>
        </div>
      </div>
      <div className="flex items-center justify-between gap-4 sm:shrink-0 sm:justify-end">
        <div className="text-left sm:text-right">
          <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Available now
          </p>
          <p className="num mt-1 text-lg font-semibold text-primary-glow">
            {gen(market.claimableAmount)} GEN
          </p>
        </div>
        <button
          type="button"
          disabled={transaction.locked}
          onClick={claim}
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
        >
          {transaction.busy
            ? "Processing…"
            : transaction.locked
              ? "Updating…"
              : isRefund
                ? "Refund"
                : "Claim"}
        </button>
      </div>
    </div>
  );
}

function HistoryPosition({ position, market }: { position: Position; market: MarketView }) {
  const won = market.status === "SETTLED" && market.winner === position.asset;
  const refunded = market.status === "INCONCLUSIVE";
  const refundClaimed = position.refunded ?? false;
  const label = refunded
    ? refundClaimed
      ? "Refunded"
      : "Refund available"
    : won
      ? position.claimed
        ? "Claimed"
        : "Won"
      : "Lost";
  const tone = refunded
    ? "text-gold bg-gold-soft"
    : won
      ? "text-positive bg-positive-soft"
      : "text-muted-foreground bg-muted";
  return (
    <PositionLink market={market}>
      <div className="flex flex-col gap-3 border-b border-border px-4 py-4 last:border-0 transition-colors hover:bg-elevated/40 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={cn(
              "rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em]",
              tone,
            )}
          >
            {label}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">
              {market.id} · {position.asset}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {utcDate(market.startMs)} · Winner {market.winner ?? "No consensus"}
            </p>
          </div>
        </div>
        <div className="flex items-center justify-between gap-5 sm:shrink-0 sm:justify-end">
          <div className="text-left sm:text-right">
            <p className="num text-sm font-semibold text-foreground">{gen(position.stake)} GEN</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              {position.claimed && won
                ? "Payout claimed"
                : refundClaimed
                  ? "Original stake refunded"
                  : won
                    ? "Awaiting claim"
                    : refunded
                      ? "Original stake"
                      : "No payout"}
            </p>
          </div>
          <ArrowUpRight className="size-4 text-muted-foreground" />
        </div>
      </div>
    </PositionLink>
  );
}

function PortfolioPage() {
  const now = useNow();
  const { address } = useAccount();
  const entriesQuery = useUserPositions(now, address);
  const claimableQuery = useClaimableMarkets(now, address);
  const refresh = useRefreshDominion();
  const transaction = useTransactionDialog();
  const [tab, setTab] = useState<Tab>("ACTIVE");
  const entries = useMemo(() => entriesQuery.data ?? [], [entriesQuery.data]);
  const claimable = claimableQuery.data ?? [];
  const active = useMemo(
    () =>
      entries.filter(({ market }) =>
        ["UPCOMING", "OPEN", "PENDING_SETTLEMENT"].includes(market.status),
      ),
    [entries],
  );
  const history = useMemo(
    () => entries.filter(({ market }) => ["SETTLED", "INCONCLUSIVE"].includes(market.status)),
    [entries],
  );
  const totalStaked = entries.reduce((sum, item) => sum + item.position.stake, 0n);
  const totalClaimable = claimable.reduce((sum, market) => sum + market.claimableAmount, 0n);
  const hasPortfolioData =
    Boolean(address) &&
    !entriesQuery.isPending &&
    !claimableQuery.isPending &&
    !entriesQuery.isError &&
    !claimableQuery.isError;

  return (
    <main className="mx-auto max-w-[1200px] px-4 py-8 lg:px-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary-glow">
            Wallet portfolio
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Your Dominion positions
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Follow every one-outcome position, claim available GEN and review settled market
            history.
          </p>
        </div>
        <Link
          to="/create"
          className="inline-flex h-9 items-center justify-center rounded-md border border-border bg-surface px-3 text-xs font-semibold text-foreground hover:border-border-strong"
        >
          Create a market <ArrowUpRight className="ml-1.5 size-3.5" />
        </Link>
      </div>
      <section className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total staked"
          value={hasPortfolioData ? `${gen(totalStaked)} GEN` : "—"}
          sub="Across indexed positions"
        />
        <StatCard
          label="Claimable"
          value={hasPortfolioData ? `${gen(totalClaimable)} GEN` : "—"}
          sub="Winnings and refunds"
          tone="positive"
        />
        <StatCard
          label="Active positions"
          value={hasPortfolioData ? String(active.length) : "—"}
          sub="Open or awaiting settlement"
          tone="primary"
        />
        <StatCard
          label="Settled positions"
          value={hasPortfolioData ? String(history.length) : "—"}
          sub="Resolved market history"
          tone="gold"
        />
      </section>
      <section className="mt-7">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border pb-3">
          {(["ACTIVE", "CLAIMABLE", "HISTORY"] as Tab[]).map((item) => (
            <FilterChip key={item} active={tab === item} onClick={() => setTab(item)}>
              {item.charAt(0) + item.slice(1).toLowerCase()}
            </FilterChip>
          ))}
        </div>
        {!address ? (
          <div className="mt-3">
            <EmptyState
              title="Connect a wallet to view your portfolio"
              description="Dominion reads positions, claims and history directly from the connected wallet address."
            />
          </div>
        ) : entriesQuery.isPending || claimableQuery.isPending ? (
          <Panel className="mt-3 px-6 py-14 text-center text-xs text-muted-foreground">
            Loading positions from Dominion…
          </Panel>
        ) : entriesQuery.isError || claimableQuery.isError ? (
          <Panel className="mt-3 px-6 py-14 text-center text-xs text-destructive">
            Unable to load portfolio data from the Dominion contract.
          </Panel>
        ) : tab === "ACTIVE" ? (
          <div className="mt-3">
            {active.length ? (
              <Panel>
                {active.map(({ position, market }) => (
                  <ActivePosition key={market.id} position={position} market={market} now={now} />
                ))}
              </Panel>
            ) : (
              <EmptyState
                title="No active positions"
                description="Pick one stock in an open Dominion market to see it here."
                action={
                  <Link to="/markets" className="text-xs font-semibold text-primary-glow">
                    Browse markets <ArrowUpRight className="inline size-3.5" />
                  </Link>
                }
              />
            )}
          </div>
        ) : tab === "CLAIMABLE" ? (
          <div className="mt-3">
            {claimable.length ? (
              <Panel>
                {claimable.map((market) => (
                  <ClaimablePosition
                    key={market.id}
                    market={market}
                    address={address}
                    onRefresh={refresh}
                    transaction={transaction}
                  />
                ))}
              </Panel>
            ) : (
              <EmptyState
                title="Nothing to claim"
                description="Winning payouts and inconclusive refunds will appear here once available."
                action={
                  <Link to="/markets" className="text-xs font-semibold text-primary-glow">
                    Explore markets <ArrowUpRight className="inline size-3.5" />
                  </Link>
                }
              />
            )}
          </div>
        ) : (
          <div className="mt-3">
            {history.length ? (
              <Panel>
                {history.map(({ position, market }) => (
                  <HistoryPosition key={market.id} position={position} market={market} />
                ))}
              </Panel>
            ) : (
              <EmptyState
                title="No settled positions yet"
                description="Your resolved Dominion markets will land here after the settlement window closes."
              />
            )}
          </div>
        )}
      </section>
      <div className="mt-5 flex items-center gap-2 text-[11px] text-muted-foreground">
        <Clock3 className="size-3.5" /> Positions are indexed from the connected wallet. Claims
        never expire in V1.
      </div>
      <TransactionDialog
        state={transaction.state}
        busy={transaction.busy}
        onClose={transaction.close}
      />
    </main>
  );
}
