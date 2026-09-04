import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

export function DominionMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 40 40"
      aria-hidden="true"
      className={cn("size-8", className)}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M7 9.5 13.5 16 20 7l6.5 9L33 9.5v16.2L20 33 7 25.7V9.5Z"
        fill="currentColor"
        fillOpacity=".12"
      />
      <path
        d="M7 9.5 13.5 16 20 7l6.5 9L33 9.5v16.2L20 33 7 25.7V9.5Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path
        d="M12 19.2h16M14 23.2h12M16 27.2h8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link to="/markets" aria-label="DOMINION markets" className="flex shrink-0 items-center gap-2">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-primary/40 bg-primary-soft text-primary-glow">
        <DominionMark className="size-7" />
      </span>
      {!compact && (
        <span className="font-display text-base font-bold uppercase tracking-[0.22em] text-foreground">
          Dominion
        </span>
      )}
    </Link>
  );
}
