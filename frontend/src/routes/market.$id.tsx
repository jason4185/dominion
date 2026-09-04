import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  Check,
  Clock3,
  ExternalLink,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Trophy,
  WalletCards,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useAccount, useBalance, useConnect } from "wagmi";
import { formatEther } from "viem";
import { Button } from "@/components/ui/button";
import {
  CategoryBadge,
  EmptyState,
  Panel,
  PoolBar,
  StatusPill,
  ASSET_DOT,
} from "@/components/dominion/primitives";
import { LivePerformanceChart } from "@/components/dominion/LivePerformanceChart";
import {
  TransactionDialog,
  TRANSACTION_DELAYED_MESSAGE,
  TRANSACTION_UPDATE_MESSAGE,
  type TransactionDialogController,
  useTransactionDialog,
} from "@/components/dominion/TransactionDialog";
import { categoryById } from "@/lib/dominion/categories";
import {
  applyPositionToMarket,
  contractAdapter,
  BRADBURY_CHAIN_ID,
  MIN_BET_WEI,
  parseGenAmount,
  contractError,
} from "@/lib/dominion/contractAdapter";
import { countdown, gen, pct, utcDate, utcWindow } from "@/lib/dominion/format";
import { resolveMarketStatus, resolvePositionUiState } from "@/lib/dominion/marketState";
import {
  useBettingState,
  useMarket,
  useNow,
  useRefreshDominion,
  useSourceEvidence,
  useUserPosition,
} from "@/lib/dominion/useDominion";
import type { MarketView, SourceEvidence } from "@/lib/dominion/types";
import { retryRead } from "@/lib/dominion/retry";
import { cn } from "@/lib/utils";
import { dominionInjectedConnector } from "@/lib/walletConfig";

export const Route = createFileRoute("/market/$id")({
  head: () => ({
    meta: [
      { title: "Market detail — DOMINION" },
      {
        name: "description",
        content:
          "Inspect a Dominion 1-hour stock dominance market, pool, position and settlement evidence.",
      },
    ],
  }),
  component: MarketDetailPage,
});

function timing(market: MarketView, now: number) {
  if (market.status === "UPCOMING")
    return now < market.startMs
      ? `Opens in ${countdown(market.startMs, now)}`
      : "Updating market state…";
  if (market.status === "OPEN")
    return now < market.endMs
      ? `Closes in ${countdown(market.endMs, now)}`
      : "Updating market state…";
  if (market.status === "PENDING_SETTLEMENT") return "Settlement is available";
  if (market.status === "INCONCLUSIVE") return "Refunds remain available indefinitely";
  return market.winner ? `${market.winner} won this market` : "Market resolved";
}

function sourceTone(evidence: SourceEvidence) {
  if (evidence.status === "OK") return "border-positive/20 bg-positive-soft";
  if (evidence.status === "TIE" || evidence.status === "STALE")
    return "border-gold/20 bg-gold-soft";
  return "border-border bg-elevated";
}

function SourceEvidenceCard({
  evidence,
  market,
}: {
  evidence: SourceEvidence;
  market: MarketView;
}) {
  const statusLabel =
    evidence.status === "OK"
      ? "Validated"
      : evidence.status === "TIE"
        ? "Tie · no vote"
        : evidence.status === "STALE"
          ? "Stale"
          : "Unavailable";
  return (
    <div className={cn("rounded-lg border p-3", sourceTone(evidence))}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-md border border-border bg-surface text-muted-foreground">
            <ExternalLink className="size-3.5" />
          </span>
          <div>
            <p className="text-xs font-semibold text-foreground">{evidence.source}</p>
            <p className="text-[10px] text-muted-foreground">1-hour index candle</p>
          </div>
        </div>
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {statusLabel}
        </span>
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-border/70 pt-2.5">
        <span className="text-[11px] text-muted-foreground">Source vote</span>
        <span
          className={cn(
            "num text-xs font-semibold",
            evidence.winner ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {evidence.winner ? evidence.winner : "No vote"}
        </span>
      </div>
      {evidence.status === "OK" && (
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {market.assets.map((asset) => (
            <div key={asset.symbol} className="rounded-md bg-surface/60 px-2 py-1.5 text-center">
              <p className="num text-[10px] font-semibold text-foreground">{asset.symbol}</p>
              <p className="num mt-0.5 text-[10px] text-muted-foreground">
                {evidence.returns[asset.symbol] === null ||
                evidence.returns[asset.symbol] === undefined
                  ? "—"
                  : pct(evidence.returns[asset.symbol] ?? 0, 3)}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function OutcomeRow({
  market,
  symbol,
  index,
  selectedAsset,
  onSelect,
}: {
  market: MarketView;
  symbol: string;
  index: number;
  selectedAsset: string;
  onSelect: () => void;
}) {
  const asset = market.assets.find((item) => item.symbol === symbol)!;
  const selected =
    market.userSelectedAsset === symbol ||
    (market.bettingOpen && !market.userSelectedAsset && selectedAsset === symbol);
  const isWinner = market.winner === symbol;
  const canSelect = market.bettingOpen && (!market.userSelectedAsset || selected);
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={!canSelect}
      className={cn(
        "w-full rounded-xl border p-4 text-left transition-colors",
        selected
          ? "border-primary/50 bg-primary-soft"
          : isWinner
            ? "border-positive/40 bg-positive-soft"
            : "border-border bg-card hover:border-border-strong",
        !canSelect && "cursor-not-allowed opacity-45",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className={cn("mt-0.5 size-2 shrink-0 rounded-full", ASSET_DOT[index])} />
          <div className="min-w-0">
            <p className="num text-lg font-semibold text-foreground">{asset.symbol}</p>
            <p className="truncate text-xs text-muted-foreground">{asset.company}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isWinner && <Trophy className="size-4 text-positive" />}
          {selected && <Check className="size-4 text-primary-glow" />}
        </div>
      </div>
      <div className="mt-4 flex items-end justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex items-center justify-between text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            <span>Pool share</span>
            <span className="num text-xs font-semibold text-foreground">
              {pct(market.poolShares[symbol] ?? 0, 1)}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full rounded-full",
                index === 0 ? "bg-primary" : index === 1 ? "bg-gold" : "bg-positive",
              )}
              style={{ width: `${market.poolShares[symbol] ?? 0}%` }}
            />
          </div>
        </div>
        <p className="num shrink-0 text-sm font-semibold text-foreground">
          {gen(market.pools[symbol] ?? 0n, 2)} GEN
        </p>
      </div>
      {selected && (
        <p className="mt-3 text-[11px] font-medium text-primary-glow">
          Your wallet is backing this stock
        </p>
      )}
    </button>
  );
}

function BetPanel({
  market,
  now,
  selectedAsset,
  onSelect,
  onRefresh,
  transaction,
}: {
  market: MarketView;
  now: number;
  selectedAsset: string;
  onSelect: (asset: string) => void;
  onRefresh: () => void | Promise<void>;
  transaction: TransactionDialogController;
}) {
  const { address, chainId } = useAccount();
  const { connect } = useConnect();
  const balanceQuery = useBalance({ address, chainId: BRADBURY_CHAIN_ID });
  const balanceWei = balanceQuery.data?.value;
  const walletBalance = balanceWei === undefined ? null : balanceWei;
  const [amount, setAmount] = useState("");
  const chosenAsset = market.userSelectedAsset ?? selectedAsset;
  const amountWei = parseGenAmount(amount);
  const canBet =
    market.bettingOpen &&
    !!address &&
    chainId === BRADBURY_CHAIN_ID &&
    !!chosenAsset &&
    amountWei !== null &&
    amountWei >= MIN_BET_WEI &&
    balanceWei !== undefined &&
    amountWei <= balanceWei;

  const submitBet = async () => {
    if (!address || !amountWei || !chosenAsset) return;
    transaction.begin(market.userSelectedAsset ? "top_up" : "bet");
    const result = await contractAdapter.placeBet(
      market.id,
      chosenAsset,
      amountWei,
      address,
      transaction.update,
    );
    if (!result.ok) {
      transaction.fail(result.error ?? "Something went wrong. Please try again.");
      return;
    }
    transaction.success(TRANSACTION_UPDATE_MESSAGE);
    setAmount("");
    await onRefresh();
    const updatedPosition = await retryRead(
      () => contractAdapter.getUserPosition(market.id, address),
      (position) => Boolean(position && position.stake > market.userStake),
    );
    if (updatedPosition) await onRefresh();
    transaction.success(updatedPosition ? undefined : TRANSACTION_DELAYED_MESSAGE);
  };

  const handleBetClick = () => {
    if (!address) {
      if (typeof window === "undefined" || !window.ethereum) {
        toast.error("No injected wallet detected.");
        return;
      }
      connect(
        { connector: dominionInjectedConnector },
        { onError: (error) => toast.error(contractError(error)) },
      );
      return;
    }
    void submitBet();
  };

  if (!market.bettingOpen) return null;

  return (
    <>
      <Panel className="p-4 shadow-lift lg:sticky lg:top-20">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-foreground">Back a stock</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Choose one outcome. Top-ups stay on that side.
            </p>
          </div>
          <WalletCards className="size-4 text-primary-glow" />
        </div>

        {market.userSelectedAsset && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-primary/30 bg-primary-soft p-2.5 text-[11px] text-primary-glow">
            <LockKeyhole className="mt-0.5 size-3.5 shrink-0" />
            <span>
              You already selected {market.userSelectedAsset} for this market. The other outcomes
              are locked.
            </span>
          </div>
        )}

        <div className="mt-4 grid grid-cols-3 gap-1.5">
          {market.assets.map((item, index) => {
            const selected = selectedAsset === item.symbol;
            const locked = !!market.userSelectedAsset && market.userSelectedAsset !== item.symbol;
            return (
              <button
                type="button"
                key={item.symbol}
                onClick={() => onSelect(item.symbol)}
                disabled={locked}
                className={cn(
                  "rounded-lg border px-2 py-2.5 text-center transition-colors",
                  selected
                    ? "border-primary/50 bg-primary-soft text-primary-glow"
                    : "border-border bg-surface text-muted-foreground hover:border-border-strong hover:text-foreground",
                  locked && "cursor-not-allowed opacity-35",
                )}
              >
                <span
                  className={cn("mx-auto mb-1 block size-1.5 rounded-full", ASSET_DOT[index])}
                />
                <span className="num text-xs font-semibold">{item.symbol}</span>
              </button>
            );
          })}
        </div>

        <label
          className="mt-4 block text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground"
          htmlFor="bet-amount"
        >
          Amount in GEN
        </label>
        <div className="relative mt-1.5">
          <input
            id="bet-amount"
            inputMode="decimal"
            type="number"
            min="1"
            step="0.01"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="1.00"
            className="num h-11 w-full rounded-lg border border-input bg-surface px-3 pr-14 text-base text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/60"
          />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted-foreground">
            GEN
          </span>
        </div>
        <div className="mt-2 grid grid-cols-4 gap-1.5">
          {[1, 5, 10].map((quick) => (
            <button
              type="button"
              key={quick}
              onClick={() => setAmount(String(quick))}
              className="rounded-md border border-border bg-surface py-1.5 text-xs text-muted-foreground hover:border-border-strong hover:text-foreground"
            >
              +{quick}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              if (balanceWei !== undefined) setAmount(formatEther(balanceWei));
            }}
            disabled={balanceWei === undefined}
            className="rounded-md border border-border bg-surface py-1.5 text-xs font-semibold text-primary-glow hover:border-primary/40"
          >
            MAX
          </button>
        </div>
        <div className="mt-4 space-y-2 rounded-lg bg-elevated p-3 text-xs">
          <div className="flex justify-between gap-3 text-muted-foreground">
            <span>Selected pool share</span>
            <span className="num text-foreground">
              {pct(market.poolShares[chosenAsset] ?? 0, 1)}
            </span>
          </div>
          <div className="flex justify-between gap-3 text-muted-foreground">
            <span>Protocol fee</span>
            <span className="num text-positive">0%</span>
          </div>
          <div className="flex justify-between gap-3 text-muted-foreground">
            <span>Wallet balance</span>
            <span className="num text-foreground">
              {balanceQuery.isPending
                ? "Loading…"
                : balanceQuery.isError || walletBalance === null
                  ? "Unavailable"
                  : `${gen(walletBalance)} GEN`}
            </span>
          </div>
        </div>
        <Button
          type="button"
          className="mt-4 h-11 w-full"
          onClick={handleBetClick}
          disabled={address ? !canBet || transaction.locked : false}
        >
          {!address
            ? "Connect wallet to bet"
            : transaction.busy
              ? "Waiting for transaction…"
              : transaction.locked
                ? "Updating position…"
                : market.userSelectedAsset
                  ? `Top up ${market.userSelectedAsset}`
                  : `Place ${chosenAsset} bet`}
        </Button>
        <p className="mt-2 text-center text-[10px] text-muted-foreground">
          Minimum 1 GEN · no app-level maximum
        </p>
        <p className="mt-2 text-center text-[10px] text-muted-foreground">
          Betting closes at {utcWindow(market.startMs, market.endMs).split("–")[0]} UTC.
        </p>
        <p className="mt-1 text-center text-[10px] text-muted-foreground">
          Current time: {utcDate(now)} · {new Date(now).toISOString().slice(11, 16)} UTC
        </p>
      </Panel>
    </>
  );
}

function TerminalPanel({
  market,
  address,
  onRefresh,
  transaction,
}: {
  market: MarketView;
  address: string | undefined;
  onRefresh: () => void | Promise<void>;
  transaction: TransactionDialogController;
}) {
  const { connect } = useConnect();

  if (market.status === "PENDING_SETTLEMENT") {
    const settle = async () => {
      if (!address) {
        if (typeof window === "undefined" || !window.ethereum) {
          toast.error("No injected wallet detected.");
          return;
        }
        connect(
          { connector: dominionInjectedConnector },
          { onError: (error) => toast.error(contractError(error)) },
        );
        return;
      }
      transaction.begin("settle");
      const result = await contractAdapter.settleMarket(market.id, address, transaction.update);
      if (!result.ok) {
        transaction.fail(result.error ?? "Something went wrong. Please try again.");
        return;
      }
      transaction.success(TRANSACTION_UPDATE_MESSAGE);
      await onRefresh();
      const resolvedMarket = await retryRead(
        () => contractAdapter.getMarket(market.id, Date.now()),
        (nextMarket) =>
          Boolean(
            nextMarket && (nextMarket.status === "SETTLED" || nextMarket.status === "INCONCLUSIVE"),
          ),
      );
      if (resolvedMarket) await onRefresh();
      transaction.success(resolvedMarket ? undefined : TRANSACTION_DELAYED_MESSAGE);
    };
    return (
      <Panel className="p-4 lg:sticky lg:top-20">
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-gold-soft text-gold">
            <Clock3 className="size-4" />
          </span>
          <div>
            <p className="text-sm font-semibold text-foreground">Ready for settlement</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              The window has ended. Anyone can trigger the deterministic 2-of-3 evidence check.
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          className="mt-4 w-full border-gold/30 text-gold hover:bg-gold-soft"
          disabled={transaction.locked}
          onClick={() => void settle()}
        >
          <RefreshCw className="size-4" />
          {transaction.busy
            ? "Settling…"
            : transaction.locked
              ? "Updating market…"
              : "Settle market"}
        </Button>
      </Panel>
    );
  }

  if (!address) {
    return (
      <Panel className="p-4 lg:sticky lg:top-20">
        <p className="text-sm font-semibold text-foreground">Market result</p>
        <p className="mt-1 text-xs text-muted-foreground">Connect wallet to see your position.</p>
      </Panel>
    );
  }

  if (market.status === "SETTLED" && market.positionWon && market.claimAvailable) {
    const claim = async () => {
      if (!address) {
        toast.error("Connect the wallet that owns this position.");
        return;
      }
      transaction.begin("claim");
      const result = await contractAdapter.claim(market.id, address, transaction.update);
      if (!result.ok) {
        transaction.fail(result.error ?? "Something went wrong. Please try again.");
        return;
      }
      transaction.success(TRANSACTION_UPDATE_MESSAGE);
      await onRefresh();
      const updatedPosition = await retryRead(
        () => contractAdapter.getUserPosition(market.id, address),
        (position) => Boolean(position?.claimed),
      );
      if (updatedPosition) await onRefresh();
      transaction.success(updatedPosition ? undefined : TRANSACTION_DELAYED_MESSAGE);
    };
    return (
      <Panel className="border-positive/30 bg-positive-soft p-4 lg:sticky lg:top-20">
        <div className="flex items-start gap-3">
          <span className="grid size-9 place-items-center rounded-lg bg-positive/15 text-positive">
            <Trophy className="size-4" />
          </span>
          <div>
            <p className="text-sm font-semibold text-foreground">You backed the winner</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Your proportional share is ready to claim.
            </p>
          </div>
        </div>
        <Button
          type="button"
          className="mt-4 w-full bg-positive text-background hover:bg-positive/90"
          disabled={transaction.locked}
          onClick={claim}
        >
          {transaction.busy
            ? "Claiming…"
            : transaction.locked
              ? "Updating claim…"
              : `Claim ${gen(market.claimableAmount)} GEN`}
        </Button>
      </Panel>
    );
  }
  if (market.status === "SETTLED" && market.positionWon)
    return (
      <Panel className="border-positive/30 bg-positive-soft p-4 lg:sticky lg:top-20">
        <p className="text-sm font-semibold text-foreground">Winnings claimed</p>
        <p className="mt-1 text-xs text-muted-foreground">
          This wallet has already claimed its payout.
        </p>
      </Panel>
    );
  if (market.status === "SETTLED" && market.positionLost)
    return (
      <Panel className="p-4 lg:sticky lg:top-20">
        <p className="text-sm font-semibold text-foreground">Position settled</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {market.userSelectedAsset} did not lead this window. Losing positions receive 0 GEN.
        </p>
      </Panel>
    );
  if (market.status === "INCONCLUSIVE" && market.refundAvailable) {
    const refund = async () => {
      if (!address) {
        toast.error("Connect the wallet that owns this position.");
        return;
      }
      transaction.begin("refund");
      const result = await contractAdapter.claimRefund(market.id, address, transaction.update);
      if (!result.ok) {
        transaction.fail(result.error ?? "Something went wrong. Please try again.");
        return;
      }
      transaction.success(TRANSACTION_UPDATE_MESSAGE);
      await onRefresh();
      const updatedPosition = await retryRead(
        () => contractAdapter.getUserPosition(market.id, address),
        (position) => Boolean(position?.refunded),
      );
      if (updatedPosition) await onRefresh();
      transaction.success(updatedPosition ? undefined : TRANSACTION_DELAYED_MESSAGE);
    };
    return (
      <Panel className="border-gold/30 bg-gold-soft p-4 lg:sticky lg:top-20">
        <div className="flex items-start gap-3">
          <span className="grid size-9 place-items-center rounded-lg bg-gold/15 text-gold">
            <RefreshCw className="size-4" />
          </span>
          <div>
            <p className="text-sm font-semibold text-foreground">Refund available</p>
            <p className="mt-1 text-xs text-muted-foreground">
              No payout is calculated. Your original stake is refundable.
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          className="mt-4 w-full border-gold/40 text-gold hover:bg-gold/10"
          disabled={transaction.locked}
          onClick={refund}
        >
          {transaction.busy
            ? "Claiming refund…"
            : transaction.locked
              ? "Updating refund…"
              : `Claim ${gen(market.claimableAmount)} GEN refund`}
        </Button>
      </Panel>
    );
  }
  if (market.status === "INCONCLUSIVE" && market.userStake > 0n)
    return (
      <Panel className="p-4 lg:sticky lg:top-20">
        <p className="text-sm font-semibold text-foreground">Refund claimed</p>
        <p className="mt-1 text-xs text-muted-foreground">
          This wallet has already recovered its original stake.
        </p>
      </Panel>
    );
  return (
    <Panel className="p-4 lg:sticky lg:top-20">
      <p className="text-sm font-semibold text-foreground">Market result</p>
      <p className="mt-1 text-xs text-muted-foreground">No position is connected to this wallet.</p>
    </Panel>
  );
}

function MarketDetailPage() {
  const now = useNow();
  const { id } = Route.useParams();
  const { address, isConnecting, isReconnecting } = useAccount();
  const marketQuery = useMarket(id, now);
  const bettingStateQuery = useBettingState(id, now);
  const positionQuery = useUserPosition(id, address);
  const publicMarket = marketQuery.data;
  const resolvedStatus = resolveMarketStatus(marketQuery, bettingStateQuery, now);
  const positionState = resolvePositionUiState({
    address,
    walletHydrating: isConnecting || isReconnecting,
    query: positionQuery,
  });
  const market =
    publicMarket && resolvedStatus
      ? applyPositionToMarket(
          { ...publicMarket, status: resolvedStatus },
          positionState === "HAS_POSITION" ? (positionQuery.data ?? null) : null,
        )
      : null;
  const evidenceQuery = useSourceEvidence(
    id,
    undefined,
    Boolean(market && (market.status === "SETTLED" || market.status === "INCONCLUSIVE")),
  );
  const refresh = useRefreshDominion();
  const transaction = useTransactionDialog();
  const [selectedAsset, setSelectedAsset] = useState("");

  if (marketQuery.isError || bettingStateQuery.isError) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10 lg:px-6">
        <EmptyState
          title="Could not load market"
          description="Could not reach Bradbury. Please try again."
          action={
            <Button
              type="button"
              variant="outline"
              onClick={() => void Promise.all([marketQuery.refetch(), bettingStateQuery.refetch()])}
            >
              Retry
            </Button>
          }
        />
      </main>
    );
  }

  if (marketQuery.isPending || bettingStateQuery.isPending || now === 0) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10 lg:px-6">
        <Panel className="px-6 py-14 text-center text-xs text-muted-foreground">
          Loading market state from Dominion…
        </Panel>
      </main>
    );
  }

  if (!publicMarket) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10 lg:px-6">
        <EmptyState
          title="Market not found"
          description="This market ID does not exist in the Dominion contract."
          action={
            <Button asChild>
              <Link to="/markets">Back to markets</Link>
            </Button>
          }
        />
      </main>
    );
  }

  if (marketQuery.isFetching || bettingStateQuery.isFetching || !market) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10 lg:px-6">
        <Panel className="px-6 py-14 text-center text-xs text-muted-foreground">
          Updating market state…
        </Panel>
      </main>
    );
  }

  const definition = categoryById(market.category);
  const evidence = evidenceQuery.data ?? [];
  const consensusCount = evidence.filter(
    (item) => item.status === "OK" && item.winner === market.winner,
  ).length;
  const evidenceLoading =
    evidenceQuery.isPending ||
    evidenceQuery.isError ||
    evidence.length < 3 ||
    evidence.some((item) => item.status === "UNAVAILABLE");
  const hasResult = market.status === "SETTLED" || market.status === "INCONCLUSIVE";
  const positionLoading = positionState === "LOADING";
  const positionError = positionState === "ERROR";

  return (
    <main className="mx-auto max-w-[1400px] px-4 py-6 lg:px-6 lg:py-8">
      <Link
        to="/markets"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" /> All markets
      </Link>
      <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        <div className="min-w-0">
          <header>
            <div className="flex flex-wrap items-center gap-2">
              <CategoryBadge category={market.category} />
              <StatusPill status={market.status} />
              <span className="num text-[10px] text-muted-foreground">{market.id}</span>
            </div>
            <h1 className="mt-4 max-w-3xl text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Which stock leads {definition.short} from {utcWindow(market.startMs, market.endMs)}?
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
              <span className="num">
                {utcDate(market.startMs)} · {utcWindow(market.startMs, market.endMs)}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Clock3 className="size-3.5" />
                {timing(market, now)}
              </span>
              <span className="num font-semibold text-foreground">
                {gen(market.totalPool)} GEN pool
              </span>
            </div>
          </header>

          <section className="mt-7">
            <div className="mb-3 flex items-end justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-foreground">Choose one outcome</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Pool share is informational; the winner is determined by return, not pool size.
                </p>
              </div>
              <span className="num text-xs text-muted-foreground">
                {market.assets.length} assets
              </span>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {market.assets.map((asset, index) => (
                <OutcomeRow
                  key={asset.symbol}
                  market={market}
                  symbol={asset.symbol}
                  index={index}
                  selectedAsset={selectedAsset || market.assets[0]?.symbol || ""}
                  onSelect={() => setSelectedAsset(asset.symbol)}
                />
              ))}
            </div>
            <PoolBar
              className="mt-4 h-2"
              shares={market.poolShares}
              symbols={market.assets.map((asset) => asset.symbol)}
            />
          </section>

          <LivePerformanceChart market={market} now={now} />

          {market.userStake > 0n && (
            <Panel className="mt-5 p-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-foreground">Your position</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    One wallet, one outcome. Same-side top-ups remain allowed while betting is open.
                  </p>
                </div>
                <span className="rounded-md bg-primary-soft px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-primary-glow">
                  {market.userSelectedAsset}
                </span>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                    Stake
                  </p>
                  <p className="num mt-1 text-lg font-semibold text-foreground">
                    {gen(market.userStake)} GEN
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                    Status
                  </p>
                  <p className="mt-1 text-sm font-semibold text-foreground">
                    {market.positionWon
                      ? "Won"
                      : market.positionLost
                        ? "Lost"
                        : market.refundAvailable
                          ? "Refund available"
                          : market.status === "INCONCLUSIVE"
                            ? "Refunded"
                            : market.status === "SETTLED"
                              ? "Claimed"
                              : "Pending"}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                    Claimable
                  </p>
                  <p className="num mt-1 text-lg font-semibold text-primary-glow">
                    {market.claimAvailable || market.refundAvailable
                      ? `${gen(market.claimableAmount)} GEN`
                      : "—"}
                  </p>
                </div>
              </div>
            </Panel>
          )}

          {hasResult && (
            <section className="mt-7">
              <div className="mb-3 flex items-end justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">Settlement evidence</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Each source votes independently from its validated index-price candle.
                  </p>
                </div>
                <ShieldCheck className="size-4 text-primary-glow" />
              </div>
              <Panel className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      Final result
                    </p>
                    <p className="mt-1 text-xl font-semibold text-foreground">
                      {market.winner ? market.winner : "No consensus"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      Source consensus
                    </p>
                    <p className="num mt-1 text-sm font-semibold text-primary-glow">
                      {evidenceLoading
                        ? "Settlement completed. Evidence is still loading."
                        : !market.winner
                          ? "Inconclusive"
                          : `${consensusCount}/3 votes`}
                    </p>
                  </div>
                </div>
                <p className="mt-4 max-w-2xl text-xs leading-relaxed text-muted-foreground">
                  A market settles only when at least two independent sources agree on the same
                  highest percentage return. A tied or unavailable source contributes no vote.{" "}
                  {market.status === "INCONCLUSIVE"
                    ? "This market is in refund mode; no winning payout is calculated."
                    : "The winning pool shares the full pool with integer-safe rounding."}
                </p>
              </Panel>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                {evidence.map((item) => (
                  <SourceEvidenceCard key={item.source} evidence={item} market={market} />
                ))}
              </div>
            </section>
          )}

          <section className="mt-7">
            <div className="mb-3 flex items-center gap-2">
              <span className="grid size-7 place-items-center rounded-md bg-primary-soft text-primary-glow">
                <ShieldCheck className="size-3.5" />
              </span>
              <div>
                <p className="text-sm font-semibold text-foreground">Market rules</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  The settlement rule is deterministic once source evidence is validated.
                </p>
              </div>
            </div>
            <Panel className="p-4">
              <ul className="grid gap-3 text-xs leading-relaxed text-muted-foreground sm:grid-cols-2">
                <li>
                  <span className="font-semibold text-foreground">Exact 1-hour UTC window.</span>{" "}
                  Starts only on an exact hourly boundary.
                </li>
                <li>
                  <span className="font-semibold text-foreground">Highest return wins.</span> If all
                  returns are negative, the least-negative return wins.
                </li>
                <li>
                  <span className="font-semibold text-foreground">2-of-3 consensus.</span> Binance,
                  Bitget and Gate vote independently.
                </li>
                <li>
                  <span className="font-semibold text-foreground">Index/reference candles.</span>{" "}
                  Ordinary trade candles and synthetic averages are not used.
                </li>
                <li>
                  <span className="font-semibold text-foreground">0% fee.</span> Winners split the
                  pari-mutuel pool; no fixed odds.
                </li>
                <li>
                  <span className="font-semibold text-foreground">One wallet / one outcome.</span>{" "}
                  Same-outcome top-ups only. Inconclusive markets refund original stake.
                </li>
              </ul>
            </Panel>
          </section>
        </div>
        <aside>
          {positionLoading ? (
            <Panel className="p-4 lg:sticky lg:top-20">
              <p className="text-sm font-semibold text-foreground">Your position</p>
              <p className="mt-1 text-xs text-muted-foreground">Loading your position…</p>
            </Panel>
          ) : positionError ? (
            <Panel className="p-4 lg:sticky lg:top-20">
              <p className="text-sm font-semibold text-foreground">Your position</p>
              <p className="mt-1 text-xs text-destructive">
                Could not load your position. Try again.
              </p>
            </Panel>
          ) : market.bettingOpen ? (
            <BetPanel
              market={market}
              now={now}
              selectedAsset={selectedAsset || market.assets[0]?.symbol || ""}
              onSelect={setSelectedAsset}
              onRefresh={refresh}
              transaction={transaction}
            />
          ) : (
            <TerminalPanel
              market={market}
              address={address}
              onRefresh={refresh}
              transaction={transaction}
            />
          )}
        </aside>
      </div>
      <TransactionDialog
        state={transaction.state}
        busy={transaction.busy}
        onClose={transaction.close}
      />
    </main>
  );
}
