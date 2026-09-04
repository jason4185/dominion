import type { MarketStatus, MarketView, Position } from "./types";

type ReadStatus = "pending" | "error" | "success";

interface MarketRead {
  status: ReadStatus;
  isFetching?: boolean;
  data?: MarketView | null | undefined;
}

interface PositionRead {
  status: ReadStatus;
  data?: Position | null | undefined;
}

export type PositionUiState = "DISCONNECTED" | "LOADING" | "ERROR" | "NO_POSITION" | "HAS_POSITION";

/**
 * A wallet is not known to have no position until the contract query has
 * completed for the current, hydrated address.
 */
export function resolvePositionUiState({
  address,
  walletHydrating,
  query,
}: {
  address?: string | undefined;
  walletHydrating: boolean;
  query: PositionRead;
}): PositionUiState {
  if (walletHydrating) return "LOADING";
  if (!address) return "DISCONNECTED";
  if (query.status === "pending") return "LOADING";
  if (query.status === "error") return "ERROR";
  if (query.data === undefined) return "LOADING";
  return query.data?.hasPosition ? "HAS_POSITION" : "NO_POSITION";
}

/**
 * Resolve a definitive market status only after both independent public
 * reads agree. A null result is an intentional neutral/revalidating state.
 */
export function resolveMarketStatus(
  marketRead: MarketRead,
  bettingStateRead: MarketRead,
  now: number,
): MarketStatus | null {
  if (
    now <= 0 ||
    marketRead.status !== "success" ||
    bettingStateRead.status !== "success" ||
    marketRead.isFetching ||
    bettingStateRead.isFetching
  ) {
    return null;
  }

  const market = marketRead.data;
  const bettingState = bettingStateRead.data;
  if (!market || !bettingState) return null;

  if (
    market.id !== bettingState.id ||
    market.startMs !== bettingState.startMs ||
    market.endMs !== bettingState.endMs ||
    market.bettingOpen !== bettingState.bettingOpen ||
    market.settlementAvailable !== bettingState.settlementAvailable
  ) {
    return null;
  }

  const marketTerminal = market.status === "SETTLED" || market.status === "INCONCLUSIVE";
  const bettingStateTerminal =
    bettingState.status === "SETTLED" || bettingState.status === "INCONCLUSIVE";
  if (marketTerminal || bettingStateTerminal) {
    return market.status === bettingState.status && marketTerminal ? market.status : null;
  }

  if (now < market.startMs) {
    return bettingState.settlementAvailable ? null : "UPCOMING";
  }

  if (now < market.endMs) {
    return bettingState.bettingOpen ? "OPEN" : null;
  }

  return bettingState.settlementAvailable ? "PENDING_SETTLEMENT" : null;
}
