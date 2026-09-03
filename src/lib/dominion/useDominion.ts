import { useEffect, useState, useSyncExternalStore } from "react";
import { getVersion, subscribe } from "./store";

/** Re-renders whenever the mock protocol state changes. */
export function useProtocolVersion() {
  return useSyncExternalStore(
    (cb) => subscribe(cb),
    () => getVersion(),
    () => 0,
  );
}

/** Ticking clock, SSR-safe (starts at a stable value, updates after mount). */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
