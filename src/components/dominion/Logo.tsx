import { Link } from "@tanstack/react-router";
import { Crown } from "lucide-react";

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link to="/markets" className="flex shrink-0 items-center gap-2">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-primary/40 bg-primary-soft">
        <Crown className="size-4 text-primary-glow" />
      </span>
      {!compact && (
        <span className="font-display text-base font-bold uppercase tracking-[0.22em] text-foreground">
          Dominion
        </span>
      )}
    </Link>
  );
}
