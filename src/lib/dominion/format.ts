export const HOUR_MS = 3_600_000;

export function floorHour(ms: number): number {
  return Math.floor(ms / HOUR_MS) * HOUR_MS;
}

export function utcHour(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getUTCHours()).padStart(2, "0")}:00`;
}

export function utcWindow(startMs: number, endMs: number): string {
  return `${utcHour(startMs)}–${utcHour(endMs)} UTC`;
}

export function utcDate(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function gen(n: number, digits = 2): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function pct(n: number, digits = 1): string {
  return `${n.toFixed(digits)}%`;
}

export function truncateAddress(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function countdown(targetMs: number, nowMs: number): string {
  let diff = Math.max(0, targetMs - nowMs);
  const h = Math.floor(diff / HOUR_MS);
  diff -= h * HOUR_MS;
  const m = Math.floor(diff / 60_000);
  const s = Math.floor((diff - m * 60_000) / 1000);
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
}

export function relativeTime(ms: number, nowMs: number): string {
  const diff = Math.max(0, nowMs - ms);
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
