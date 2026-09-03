import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { categoryById } from "@/lib/dominion/categories";
import type { CategoryId, MarketStatus } from "@/lib/dominion/types";

export function CategoryBadge({ category, className }: { category: CategoryId; className?: string }) {
  const def = categoryById(category);
  const tone =
    category === "BIG_TECH"
      ? "bg-primary-soft text-primary-glow"
      : category === "AI_GROWTH"
        ? "bg-gold-soft text-gold"
        : "bg-positive-soft text-positive";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]",
        tone,
        className,
      )}
    >
      {def.short}
    </span>
  );
}

const STATUS_TONE: Record<MarketStatus, string> = {
  OPEN: "bg-positive-soft text-positive",
  UPCOMING: "bg-muted text-muted-foreground",
  PENDING_SETTLEMENT: "bg-gold-soft text-gold",
  SETTLED: "bg-primary-soft text-primary-glow",
  INCONCLUSIVE: "bg-destructive-soft text-destructive",
};

const STATUS_LABEL: Record<MarketStatus, string> = {
  OPEN: "Open",
  UPCOMING: "Upcoming",
  PENDING_SETTLEMENT: "Awaiting settlement",
  SETTLED: "Settled",
  INCONCLUSIVE: "Inconclusive",
};

export function StatusPill({ status, className }: { status: MarketStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]",
        STATUS_TONE[status],
        className,
      )}
    >
      {status === "OPEN" && <span className="size-1.5 rounded-full bg-positive" />}
      {STATUS_LABEL[status]}
    </span>
  );
}

export function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("rounded-xl border border-border bg-card", className)}>{children}</div>
  );
}

export function StatCard({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "positive" | "gold" | "primary";
}) {
  const valueTone =
    tone === "positive"
      ? "text-positive"
      : tone === "gold"
        ? "text-gold"
        : tone === "primary"
          ? "text-primary-glow"
          : "text-foreground";
  return (
    <Panel className="p-4">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className={cn("num mt-2 text-2xl font-semibold", valueTone)}>{value}</p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </Panel>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <Panel className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="max-w-sm text-xs text-muted-foreground">{description}</p>
      {action && <div className="mt-3">{action}</div>}
    </Panel>
  );
}

export function PoolBar({
  shares,
  symbols,
  className,
}: {
  shares: Record<string, number>;
  symbols: string[];
  className?: string;
}) {
  const tones = ["bg-primary", "bg-gold", "bg-positive"];
  return (
    <div className={cn("flex h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}>
      {symbols.map((s, i) => (
        <div key={s} className={cn(tones[i % 3])} style={{ width: `${shares[s] ?? 0}%` }} />
      ))}
    </div>
  );
}

export const ASSET_DOT = ["bg-primary", "bg-gold", "bg-positive"];

export function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
        active
          ? "border-primary/50 bg-primary-soft text-primary-glow"
          : "border-border bg-surface text-muted-foreground hover:border-border-strong hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
