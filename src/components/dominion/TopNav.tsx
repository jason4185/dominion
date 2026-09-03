import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Bell, Menu, Search, Wallet } from "lucide-react";
import { useState } from "react";
import { Logo } from "./Logo";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { contractAdapter } from "@/lib/dominion/contractAdapter";
import { markNotificationsRead } from "@/lib/dominion/store";
import { gen, relativeTime, truncateAddress } from "@/lib/dominion/format";
import { useNow, useProtocolVersion } from "@/lib/dominion/useDominion";
import { cn } from "@/lib/utils";

const LINKS = [
  { to: "/markets", label: "Markets" },
  { to: "/portfolio", label: "Portfolio" },
  { to: "/activity", label: "Activity" },
  { to: "/create", label: "Create Market" },
  { to: "/how-it-works", label: "How it works" },
] as const;

const ACTIVITY_LABEL: Record<string, string> = {
  BET_PLACED: "Bet placed",
  BET_TOPPED_UP: "Position topped up",
  PAYOUT_CLAIMED: "Payout claimed",
  REFUND_CLAIMED: "Refund claimed",
  MARKET_CREATED: "Market created",
  MARKET_SETTLED: "Market settled",
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
  useProtocolVersion();
  const now = useNow(30_000);
  const activity = contractAdapter.getUserActivity().slice(0, 6);
  const unread = contractAdapter.getUserActivityCount();
  return (
    <DropdownMenu onOpenChange={(open) => open && unread > 0 && markNotificationsRead()}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Notifications"
          className="relative grid size-9 cursor-pointer place-items-center rounded-lg border border-border bg-surface text-muted-foreground transition-colors hover:text-foreground"
        >
          <Bell className="size-4" />
          {unread > 0 && (
            <span className="num absolute -right-1 -top-1 grid min-w-4 place-items-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
              {unread}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 border-border bg-popover p-0">
        <div className="border-b border-border px-3 py-2 text-xs font-semibold text-foreground">
          Recent activity
        </div>
        <div className="max-h-80 overflow-y-auto">
          {activity.length === 0 && (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">No activity yet.</p>
          )}
          {activity.map((a) => (
            <Link
              key={a.id}
              to="/market/$id"
              params={{ id: a.marketId }}
              className="flex items-start gap-2 border-b border-border px-3 py-2.5 last:border-0 hover:bg-elevated"
            >
              <span className="mt-1 size-1.5 shrink-0 rounded-full bg-primary" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-foreground">
                  {ACTIVITY_LABEL[a.kind]} {a.asset ? `· ${a.asset}` : ""}
                </p>
                <p className="num truncate text-[11px] text-muted-foreground">
                  {a.marketId} · {a.amount > 0 ? `${gen(a.amount)} GEN · ` : ""}
                  {relativeTime(a.timestamp, now)}
                </p>
              </div>
            </Link>
          ))}
        </div>
        <Link
          to="/activity"
          className="block border-t border-border px-3 py-2 text-center text-xs font-semibold text-primary-glow"
        >
          View all activity
        </Link>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function WalletPill() {
  useProtocolVersion();
  const wallet = contractAdapter.getWallet();
  return (
    <div className="flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-2.5">
      <Wallet className="size-3.5 shrink-0 text-primary-glow" />
      <span className="num text-xs text-muted-foreground">{truncateAddress(wallet.address)}</span>
      <span className="h-4 w-px bg-border" />
      <span className="num text-xs font-semibold text-foreground">{gen(wallet.balance)} GEN</span>
    </div>
  );
}

function NetworkPill() {
  return (
    <div className="flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-2.5">
      <span className="size-1.5 rounded-full bg-positive" />
      <span className="text-[11px] font-medium text-muted-foreground">Bradbury Testnet</span>
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
          <div className="hidden xl:block">
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
