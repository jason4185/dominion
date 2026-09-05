import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CalendarDays, Check, Clock3, LockKeyhole, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useAccount, useConnect } from "wagmi";
import { Button } from "@/components/ui/button";
import { CategoryBadge, Panel } from "@/components/dominion/primitives";
import { TransactionDialog, useTransactionDialog } from "@/components/dominion/TransactionDialog";
import { assetBySymbol, categoryById } from "@/lib/dominion/categories";
import { BRADBURY_CHAIN_ID, contractAdapter, contractError } from "@/lib/dominion/contractAdapter";
import { HOUR_MS, utcDate, utcWindow } from "@/lib/dominion/format";
import {
  useCategories,
  useCategoryAssets,
  useNow,
  useRefreshDominion,
} from "@/lib/dominion/useDominion";
import { reconcileAcceptedWrite } from "@/lib/dominion/retry";
import type { Asset, CategoryId } from "@/lib/dominion/types";
import { cn } from "@/lib/utils";
import { dominionInjectedConnector } from "@/lib/walletConfig";

export const Route = createFileRoute("/create")({
  head: () => ({
    meta: [
      { title: "Create market — DOMINION" },
      { name: "description", content: "Create a permissionless Dominion 1-hour market." },
    ],
  }),
  component: CreateMarketPage,
});

const initialHour = () => Math.ceil((Date.now() + 1) / HOUR_MS) * HOUR_MS;
const toDateInput = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const atUtcHour = (date: string, hour: number) => {
  const day = new Date(`${date}T00:00:00.000Z`);
  return Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour);
};

function CreateMarketPage() {
  const now = useNow();
  const navigate = useNavigate();
  const { address, chainId } = useAccount();
  const { connect } = useConnect();
  const transaction = useTransactionDialog();
  const refresh = useRefreshDominion();
  const firstStart = initialHour();
  const [category, setCategory] = useState<CategoryId>();
  const [date, setDate] = useState(toDateInput(firstStart));
  const [hour, setHour] = useState(new Date(firstStart).getUTCHours());
  const categoriesQuery = useCategories();
  const liveCategories = categoriesQuery.data ?? [];
  const categoryAssetQueries = useCategoryAssets(liveCategories);
  const activeCategory =
    category && liveCategories.includes(category) ? category : liveCategories[0];
  const assetsFor = (id: CategoryId): Asset[] => {
    const index = liveCategories.indexOf(id);
    const symbols = index >= 0 ? (categoryAssetQueries[index]?.data ?? []) : [];
    return symbols.map((symbol) => assetBySymbol(id, symbol));
  };
  const definition = activeCategory ? categoryById(activeCategory) : undefined;
  const selectedAssets = activeCategory ? assetsFor(activeCategory) : [];
  const categoryDataPending = categoryAssetQueries.some((query) => query.isPending);
  const categoryDataError = categoryAssetQueries.some((query) => query.isError);
  const startMs = atUtcHour(date, hour);
  const endMs = startMs + HOUR_MS;
  const isValid =
    activeCategory !== undefined &&
    selectedAssets.length === 3 &&
    Number.isSafeInteger(startMs) &&
    startMs > now &&
    startMs % HOUR_MS === 0;
  const slots = useMemo(() => Array.from({ length: 24 }, (_, value) => value), []);

  if (categoriesQuery.isPending || categoryDataPending) {
    return (
      <main className="mx-auto max-w-[1120px] px-4 py-10 lg:px-6">
        <Panel className="px-6 py-14 text-center text-xs text-muted-foreground">
          Loading Dominion categories…
        </Panel>
      </main>
    );
  }

  if (categoriesQuery.isError || categoryDataError) {
    return (
      <main className="mx-auto max-w-[1120px] px-4 py-10 lg:px-6">
        <Panel className="flex flex-col items-center gap-3 px-6 py-14 text-center">
          <p className="text-sm font-semibold text-foreground">Could not load market categories</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            Could not reach Bradbury. Please try again.
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              void categoriesQuery.refetch();
              categoryAssetQueries.forEach((query) => void query.refetch());
            }}
          >
            Retry
          </Button>
        </Panel>
      </main>
    );
  }

  if (!activeCategory || !definition || selectedAssets.length !== 3) {
    return (
      <main className="mx-auto max-w-[1120px] px-4 py-10 lg:px-6">
        <Panel className="px-6 py-14 text-center text-xs text-muted-foreground">
          No supported Dominion categories are available.
        </Panel>
      </main>
    );
  }

  const create = async () => {
    if (!isValid) {
      toast.error("Choose an upcoming exact UTC-hour window.");
      return;
    }
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
    if (chainId !== BRADBURY_CHAIN_ID) {
      toast.error("Switch your wallet to Bradbury Testnet first.");
      return;
    }
    if (!transaction.begin("create")) return;
    const result = await contractAdapter.createMarket(
      activeCategory,
      startMs,
      address,
      transaction.update,
    );
    if (!result.ok) {
      transaction.fail(result.error ?? "Unable to create market.");
      return;
    }
    if (result.confirmed !== true || !result.hash) {
      transaction.uncertain(result.hash);
      return;
    }
    transaction.success(result.hash);
    await refresh("create");
    const createdMarket = await reconcileAcceptedWrite(
      result,
      () => contractAdapter.getMarketByCategoryStart(activeCategory, startMs),
      (market) => market !== null,
      { onWaiting: () => transaction.reconcile("Loading market...") },
    );
    if (!createdMarket) {
      transaction.reconcile("Market created. Loading market...");
      return;
    }
    await refresh("create");
    transaction.done(result.hash, "Market created successfully.");
    void navigate({ to: "/market/$id", params: { id: createdMarket.id } });
  };

  return (
    <main className="mx-auto max-w-[1120px] px-4 py-8 lg:px-6">
      <div className="max-w-2xl">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary-glow">
          Permissionless protocol action
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          Create a Dominion market
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Choose a category and an upcoming exact 1-hour UTC window. No admin approval required.
        </p>
      </div>
      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
        <div className="space-y-6">
          <section>
            <div className="mb-3 flex items-end justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">1. Choose a category</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  The three assets are fixed by protocol.
                </p>
              </div>
              <LockKeyhole className="size-4 text-muted-foreground" />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {liveCategories.map((id) => {
                const item = categoryById(id);
                const itemAssets = assetsFor(id);
                const selected = item.id === activeCategory;
                return (
                  <button
                    type="button"
                    key={item.id}
                    onClick={() => setCategory(item.id)}
                    className={cn(
                      "rounded-xl border p-4 text-left transition-colors",
                      selected
                        ? "border-primary/55 bg-primary-soft"
                        : "border-border bg-card hover:border-border-strong",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <CategoryBadge category={item.id} />
                      {selected && <Check className="size-4 text-primary-glow" />}
                    </div>
                    <p className="mt-4 text-sm font-semibold text-foreground">{item.label}</p>
                    <div className="mt-3 space-y-1">
                      {itemAssets.map((asset) => (
                        <p key={asset.symbol} className="num text-xs text-muted-foreground">
                          {asset.symbol}
                          <span className="ml-2 font-sans text-[10px]">{asset.company}</span>
                        </p>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
          <section>
            <div className="mb-3">
              <h2 className="text-sm font-semibold text-foreground">2. Select a UTC date</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Past and already-started windows are disabled.
              </p>
            </div>
            <div className="relative max-w-xs">
              <CalendarDays className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="date"
                value={date}
                min={toDateInput(now)}
                onChange={(event) => setDate(event.target.value)}
                className="h-11 w-full rounded-lg border border-input bg-surface pl-10 pr-3 text-sm text-foreground outline-none focus:border-primary/60"
              />
            </div>
          </section>
          <section>
            <div className="mb-3 flex items-end justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">3. Choose a 1-hour window</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Only exact hourly UTC boundaries are available.
                </p>
              </div>
              <Clock3 className="size-4 text-muted-foreground" />
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {slots.map((slot) => {
                const slotStart = atUtcHour(date, slot);
                const disabled = slotStart <= now;
                const selected = slot === hour;
                return (
                  <button
                    type="button"
                    key={slot}
                    disabled={disabled}
                    onClick={() => setHour(slot)}
                    className={cn(
                      "rounded-lg border px-3 py-2.5 text-left transition-colors",
                      selected && !disabled
                        ? "border-primary/55 bg-primary-soft"
                        : "border-border bg-card hover:border-border-strong",
                      disabled && "cursor-not-allowed opacity-35",
                    )}
                  >
                    <p className="num text-xs font-semibold text-foreground">
                      {String(slot).padStart(2, "0")}:00
                    </p>
                    <p className="num mt-0.5 text-[10px] text-muted-foreground">
                      → {slot === 23 ? "00" : String(slot + 1).padStart(2, "0")}:00 UTC
                    </p>
                  </button>
                );
              })}
            </div>
          </section>
        </div>
        <aside className="lg:sticky lg:top-20">
          <Panel className="p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-foreground">Market preview</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Review the immutable market inputs.
                </p>
              </div>
              <ShieldCheck className="size-4 text-primary-glow" />
            </div>
            <div className="mt-5 rounded-lg bg-elevated p-3">
              <CategoryBadge category={activeCategory} />
              <p className="mt-3 text-lg font-semibold text-foreground">{definition.short}</p>
              <p className="num mt-1 text-sm text-muted-foreground">{utcDate(startMs)}</p>
              <p className="num mt-0.5 text-sm font-semibold text-foreground">
                {utcWindow(startMs, endMs)}
              </p>
            </div>
            <div className="mt-4 space-y-2 border-b border-border pb-4">
              {selectedAssets.map((asset) => (
                <div key={asset.symbol} className="flex items-center justify-between gap-3 text-xs">
                  <span className="num font-semibold text-foreground">{asset.symbol}</span>
                  <span className="text-muted-foreground">{asset.company}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 space-y-2 text-xs">
              <div className="flex justify-between gap-3 text-muted-foreground">
                <span>Duration</span>
                <span className="num text-foreground">1 hour</span>
              </div>
              <div className="flex justify-between gap-3 text-muted-foreground">
                <span>Creation</span>
                <span className="text-foreground">Permissionless</span>
              </div>
              <div className="flex justify-between gap-3 text-muted-foreground">
                <span>Settlement</span>
                <span className="text-right text-foreground">
                  Binance · Bitget · Gate
                  <br />
                  <span className="text-[10px] text-muted-foreground">2-of-3 consensus</span>
                </span>
              </div>
              <div className="flex justify-between gap-3 text-muted-foreground">
                <span>Window status</span>
                <span className={cn("font-semibold", !isValid ? "text-gold" : "text-positive")}>
                  {isValid ? "Upcoming" : "Choose a future slot"}
                </span>
              </div>
            </div>
            <Button
              type="button"
              className="mt-5 h-11 w-full"
              disabled={!isValid || !address || chainId !== BRADBURY_CHAIN_ID || transaction.locked}
              onClick={create}
            >
              {transaction.busy
                ? "Creating market…"
                : transaction.isReconciling
                  ? "Loading market..."
                  : transaction.locked
                    ? "Market created"
                    : "Create market"}
            </Button>
            <p className="mt-3 text-center text-[10px] leading-relaxed text-muted-foreground">
              Markets must start strictly in the future on an exact UTC hour. Duplicate category +
              start windows are rejected.
            </p>
          </Panel>
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
