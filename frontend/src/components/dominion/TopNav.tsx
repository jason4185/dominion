import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Bell, Check, Copy, Menu, Search, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useAccount, useBalance, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { gen } from "@/lib/dominion/format";
import { Logo } from "./Logo";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { BRADBURY_CHAIN_ID, contractError } from "@/lib/dominion/contractAdapter";
import { relativeTime, truncateAddress } from "@/lib/dominion/format";
import {
  useNow,
  useUserActivity,
  useUserActivityCount,
  useWalletAddress,
} from "@/lib/dominion/useDominion";
import { dominionInjectedConnector } from "@/lib/walletConfig";
import { cn } from "@/lib/utils";

const LINKS = [
  { to: "/markets", label: "Markets" },
  { to: "/portfolio", label: "Portfolio" },
  { to: "/create", label: "Create Market" },
  { to: "/how-it-works", label: "How it works" },
] as const;

const ACTIVITY_LABEL: Record<string, string> = {
  BET_PLACED: "Bet placed",
  BET_TOPPED_UP: "Position topped up",
  PAYOUT_CLAIMED: "Payout claimed",
  REFUND_CLAIMED: "Refund claimed",
};

function SearchBox({ className }: { className?: string }) {
  const navigate = useNavigate();
  const [value, setValue] = useState("");
  return (
    <form
      className={cn("relative", className)}
      onSubmit={(e) => {
        e.preventDefault();
        navigate({ to: "/markets", search: { q: value || undefined } });
      }}
    >
      <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search category, symbol or market ID"
        aria-label="Search markets"
        className="h-9 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/50"
      />
    </form>
  );
}

function NotificationBell() {
  const address = useWalletAddress();
  const now = useNow(30_000);
  const activityQuery = useUserActivity(address, 6);
  const countQuery = useUserActivityCount(address);
  const activity = activityQuery.data ?? [];
  const count = countQuery.data;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Notifications"
          className="relative grid size-9 cursor-pointer place-items-center rounded-lg border border-border bg-surface text-muted-foreground transition-colors hover:text-foreground"
        >
          <Bell className="size-4" />
          {count !== undefined && count > 0 && (
            <span className="num absolute -right-1 -top-1 grid min-w-4 place-items-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
              {count > 99 ? "99+" : count}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 border-border bg-popover p-0">
        <div className="border-b border-border px-3 py-2 text-xs font-semibold text-foreground">
          Recent wallet activity
        </div>
        <div className="max-h-80 overflow-y-auto">
          {!address && (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              Connect a wallet to view on-chain activity.
            </p>
          )}
          {address && activityQuery.isPending && (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              Loading activity from Dominion…
            </p>
          )}
          {address && activityQuery.isError && (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              Could not reach Bradbury. Please try again.
            </p>
          )}
          {address &&
            !activityQuery.isPending &&
            !activityQuery.isError &&
            activity.length === 0 && (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                No activity yet.
              </p>
            )}
          {!activityQuery.isPending &&
            !activityQuery.isError &&
            activity.map((a) => (
              <Link
                key={`${a.id}-${a.marketId}`}
                to="/market/$id"
                params={{ id: a.marketId }}
                className="flex items-start gap-2 border-b border-border px-3 py-2.5 last:border-0 hover:bg-elevated"
              >
                <span className="mt-1 size-1.5 shrink-0 rounded-full bg-primary" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-foreground">
                    {ACTIVITY_LABEL[a.kind] ?? a.kind} {a.asset ? `· ${a.asset}` : ""}
                  </p>
                  <p className="num truncate text-[11px] text-muted-foreground">
                    {a.marketId} · {a.amount > 0n ? `${gen(a.amount)} GEN · ` : ""}
                    {relativeTime(a.timestamp, now)}
                  </p>
                </div>
              </Link>
            ))}
        </div>
        <Link
          to="/portfolio"
          className="block border-t border-border px-3 py-2 text-center text-xs font-semibold text-primary-glow"
        >
          View portfolio
        </Link>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function WalletPill() {
  const { address, chainId, isConnected } = useAccount();
  const { connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const [hasInjectedWallet, setHasInjectedWallet] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setHasInjectedWallet(typeof window !== "undefined" && Boolean(window.ethereum));
  }, []);

  const requestConnection = () => {
    if (!hasInjectedWallet) {
      toast.error("No injected wallet detected.");
      return;
    }
    connect(
      { connector: dominionInjectedConnector },
      {
        onError: (error) => toast.error(contractError(error)),
      },
    );
  };

  if (!isConnected || !address) {
    return (
      <button
        type="button"
        onClick={requestConnection}
        disabled={!hasInjectedWallet || isPending}
        className="flex h-9 items-center gap-2 rounded-lg border border-primary/40 bg-primary-soft px-2.5 text-xs font-semibold text-primary-glow disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Wallet className="size-3.5" />
        {isPending ? "Connecting…" : hasInjectedWallet ? "Connect Wallet" : "No injected wallet"}
      </button>
    );
  }

  const copyAddress = async () => {
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(address);
      setCopied(true);
      toast.success("Wallet address copied");
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Unable to copy wallet address.");
    }
  };

  return (
    <Popover
      open={accountOpen}
      onOpenChange={(open) => {
        setAccountOpen(open);
        if (!open) setCopied(false);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Open wallet account ${truncateAddress(address)}`}
          aria-expanded={accountOpen}
          className="flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-2.5 outline-none transition-colors hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Wallet className="size-3.5 shrink-0 text-primary-glow" />
          <span className="num text-xs text-muted-foreground">{truncateAddress(address)}</span>
          <span className="h-4 w-px bg-border" />
          <WalletBalance />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={8}
        collisionPadding={16}
        className="w-[min(21rem,calc(100vw-2rem))] border-border bg-popover p-0 shadow-2xl"
      >
        <div className="border-b border-border p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary-glow">
                Dominion account
              </p>
              <p className="mt-1 text-sm font-semibold text-foreground">Connected wallet</p>
            </div>
            <span className="rounded-md bg-primary-soft px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-primary-glow">
              Active
            </span>
          </div>
          <div className="mt-4 rounded-lg border border-border bg-surface p-3">
            <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              Wallet address
            </p>
            <p className="num mt-1 break-all text-sm font-semibold text-foreground">
              {truncateAddress(address)}
            </p>
            <button
              type="button"
              onClick={copyAddress}
              aria-label="Copy full wallet address"
              className="mt-2 inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] font-semibold text-primary-glow outline-none transition-colors hover:bg-primary-soft focus-visible:ring-2 focus-visible:ring-ring"
            >
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {copied ? "Copied" : "Copy full address"}
            </button>
          </div>
        </div>
        <div className="space-y-1 p-4">
          <AccountInfoRow
            label="Network"
            value={chainId === BRADBURY_CHAIN_ID ? "Bradbury Testnet" : "Wrong network"}
            detail={`Chain ID ${chainId ?? "—"}`}
            positive={chainId === BRADBURY_CHAIN_ID}
          />
          <AccountBalance />
        </div>
        <div className="border-t border-border p-4">
          <button
            type="button"
            onClick={() => {
              setAccountOpen(false);
              disconnect();
            }}
            className="flex h-10 w-full items-center justify-center rounded-lg border border-destructive/30 bg-destructive/10 text-xs font-semibold text-destructive outline-none transition-colors hover:bg-destructive/15 focus-visible:ring-2 focus-visible:ring-ring"
          >
            Disconnect Wallet
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function AccountInfoRow({
  label,
  value,
  detail,
  positive = false,
}: {
  label: string;
  value: string;
  detail: string;
  positive?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg px-2 py-2">
      <div>
        <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
        <p className="mt-1 text-xs font-semibold text-foreground">{value}</p>
      </div>
      <div className="flex items-center gap-1.5 text-right">
        <span
          className={cn("size-1.5 rounded-full", positive ? "bg-positive" : "bg-destructive")}
        />
        <span className="num text-[10px] text-muted-foreground">{detail}</span>
      </div>
    </div>
  );
}

function AccountBalance() {
  const { address } = useAccount();
  const balance = useBalance({ address, chainId: BRADBURY_CHAIN_ID });
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg px-2 py-2">
      <div>
        <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Native GEN</p>
        <p className="mt-1 text-xs font-semibold text-foreground">Wallet balance</p>
      </div>
      <p className="num text-sm font-semibold text-primary-glow">
        {balance.isPending
          ? "Loading…"
          : balance.isError || !balance.data
            ? "Unavailable"
            : `${gen(balance.data.value, 4)} GEN`}
      </p>
    </div>
  );
}

function WalletBalance() {
  const { address } = useAccount();
  const balance = useBalance({ address, chainId: BRADBURY_CHAIN_ID });
  if (balance.isPending) return <span className="num text-xs text-muted-foreground">… GEN</span>;
  if (balance.isError || !balance.data)
    return <span className="num text-xs text-muted-foreground">— GEN</span>;
  return (
    <span className="num text-xs font-semibold text-foreground">{gen(balance.data.value)} GEN</span>
  );
}

function NetworkPill() {
  const { chainId, isConnected } = useAccount();
  const { switchChain, isPending } = useSwitchChain();
  const wrongNetwork = isConnected && chainId !== BRADBURY_CHAIN_ID;
  const { disconnect } = useDisconnect();
  return (
    <div className="flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-2.5">
      <span
        className={cn("size-1.5 rounded-full", wrongNetwork ? "bg-destructive" : "bg-positive")}
      />
      {wrongNetwork ? (
        <button
          type="button"
          disabled={isPending}
          onClick={() =>
            switchChain(
              { chainId: BRADBURY_CHAIN_ID },
              { onError: (error) => toast.error(contractError(error)) },
            )
          }
          className="text-[11px] font-medium text-destructive hover:text-foreground"
        >
          {isPending ? "Switching…" : "Switch to Bradbury"}
        </button>
      ) : (
        <span className="text-[11px] font-medium text-muted-foreground">Bradbury Testnet</span>
      )}
      {isConnected && wrongNetwork && (
        <button type="button" onClick={() => disconnect()} className="sr-only">
          Disconnect
        </button>
      )}
    </div>
  );
}

export function TopNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto grid max-w-[1400px] grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-2.5 lg:px-6">
        <div className="flex min-w-0 items-center gap-6">
          <Logo />
          <nav className="hidden items-center gap-1 lg:flex">
            {LINKS.map((l) => (
              <Link
                key={l.to}
                to={l.to}
                className={cn(
                  "rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
                  pathname.startsWith(l.to)
                    ? "bg-elevated text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {l.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="hidden justify-self-center lg:block lg:w-full lg:max-w-sm">
          <SearchBox />
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden lg:block">
            <NetworkPill />
          </div>
          <NotificationBell />
          <div className="hidden sm:block">
            <WalletPill />
          </div>
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="icon" className="border-border bg-surface lg:hidden">
                <Menu className="size-4" />
                <span className="sr-only">Open menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72 border-border bg-surface">
              <div className="mt-6 space-y-4">
                <SearchBox />
                <nav className="flex flex-col gap-1">
                  {LINKS.map((l) => (
                    <Link
                      key={l.to}
                      to={l.to}
                      onClick={() => setOpen(false)}
                      className={cn(
                        "rounded-lg px-3 py-2 text-sm font-medium",
                        pathname.startsWith(l.to)
                          ? "bg-elevated text-foreground"
                          : "text-muted-foreground",
                      )}
                    >
                      {l.label}
                    </Link>
                  ))}
                </nav>
                <NetworkPill />
                <WalletPill />
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
