import * as React from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { contractAdapter } from "./contractAdapter";
import { fetchLivePerformance } from "./liveChart";
import { queryRetryDelay, shouldRetryRead } from "./retry";
import type { CategoryId, MarketView, SourceId } from "./types";

export function useNow(intervalMs = 1000) {
  const [now, setNow] = React.useState(0);
  React.useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function useWalletAddress(): string | undefined {
  const address = useAccount().address;
  const queryClient = useQueryClient();
  const previousAddress = React.useRef<string | undefined>(undefined);

  React.useEffect(() => {
    if (previousAddress.current !== address) {
      [
        ["dominion", "position"],
        ["dominion", "positions"],
        ["dominion", "claimable"],
        ["dominion", "activity"],
        ["dominion", "activity-count"],
      ].forEach((queryKey) => queryClient.removeQueries({ queryKey }));
    }
    previousAddress.current = address;
  }, [address, queryClient]);

  return address;
}

export function useProtocolConfig() {
  return useQuery({
    queryKey: ["dominion", "config"],
    queryFn: () => contractAdapter.getConfig(),
    staleTime: 300_000,
    retry: shouldRetryRead,
    retryDelay: queryRetryDelay,
  });
}

export function useCategories() {
  return useQuery({
    queryKey: ["dominion", "categories"],
    queryFn: () => contractAdapter.categories(),
    staleTime: 300_000,
    retry: shouldRetryRead,
    retryDelay: queryRetryDelay,
  });
}

export function useCategoryAssets(categories: CategoryId[]) {
  return useQueries({
    queries: categories.map((category) => ({
      queryKey: ["dominion", "category-assets", category],
      queryFn: () => contractAdapter.categoryAssets(category),
      staleTime: 300_000,
      retry: shouldRetryRead,
      retryDelay: queryRetryDelay,
    })),
  });
}

export function useMarkets(now: number, openOnly = false) {
  return useQuery({
    queryKey: ["dominion", openOnly ? "open-markets" : "markets"],
    queryFn: () =>
      openOnly ? contractAdapter.getOpenMarkets(now) : contractAdapter.getMarkets(now),
    refetchInterval: 20_000,
    enabled: now > 0,
    retry: shouldRetryRead,
    retryDelay: queryRetryDelay,
  });
}

export function useMarket(marketId: string, now: number, address?: string) {
  return useQuery({
    queryKey: ["dominion", "market", marketId, address ?? "public"],
    queryFn: () => contractAdapter.getMarket(marketId, now, address),
    refetchInterval: 20_000,
    enabled: Boolean(marketId) && now > 0,
    retry: shouldRetryRead,
    retryDelay: queryRetryDelay,
  });
}

export function useBettingState(marketId: string, now: number, address?: string) {
  return useQuery({
    queryKey: ["dominion", "betting-state", marketId, address ?? "public"],
    queryFn: () => contractAdapter.getBettingState(marketId, now, address),
    refetchInterval: 20_000,
    enabled: Boolean(marketId) && now > 0,
    retry: shouldRetryRead,
    retryDelay: queryRetryDelay,
  });
}

export function useSourceEvidence(marketId: string, source?: SourceId, enabled = true) {
  return useQuery({
    queryKey: ["dominion", "evidence", marketId, source ?? "all"],
    queryFn: () => contractAdapter.getSourceEvidence(marketId, source),
    enabled: Boolean(marketId) && enabled,
    staleTime: 300_000,
    retry: shouldRetryRead,
    retryDelay: queryRetryDelay,
  });
}

export function useLivePerformance(market: MarketView, now: number) {
  return useQuery({
    queryKey: [
      "dominion",
      "live-performance",
      market.id,
      market.status,
      market.startMs,
      market.endMs,
      market.assets.map((asset) => asset.symbol).join(","),
    ],
    queryFn: () =>
      fetchLivePerformance(
        market.assets.map((asset) => asset.symbol),
        market.startMs,
        market.endMs,
      ),
    enabled: typeof window !== "undefined" && market.status !== "UPCOMING" && now >= market.startMs,
    staleTime: market.status === "OPEN" ? 10_000 : 300_000,
    refetchInterval: market.status === "OPEN" ? 20_000 : false,
    retry: shouldRetryRead,
    retryDelay: queryRetryDelay,
  });
}

export function useUserPosition(marketId: string, address?: string) {
  return useQuery({
    queryKey: ["dominion", "position", marketId, address ?? "disconnected"],
    queryFn: () => contractAdapter.getUserPosition(marketId, address!),
    enabled: Boolean(marketId && address),
    refetchInterval: 20_000,
    retry: shouldRetryRead,
    retryDelay: queryRetryDelay,
  });
}

export function useUserPositions(now: number, address?: string) {
  return useQuery({
    queryKey: ["dominion", "positions", address ?? "disconnected"],
    queryFn: () => contractAdapter.getUserPositions(now, address!),
    enabled: Boolean(address) && now > 0,
    refetchInterval: 20_000,
    retry: shouldRetryRead,
    retryDelay: queryRetryDelay,
  });
}

export function useClaimableMarkets(now: number, address?: string) {
  return useQuery({
    queryKey: ["dominion", "claimable", address ?? "disconnected"],
    queryFn: () => contractAdapter.getClaimableMarkets(now, address!),
    enabled: Boolean(address) && now > 0,
    refetchInterval: 20_000,
    retry: shouldRetryRead,
    retryDelay: queryRetryDelay,
  });
}

export function useUserActivity(address?: string, limit = 6) {
  return useQuery({
    queryKey: ["dominion", "activity", address ?? "disconnected", limit],
    queryFn: () => contractAdapter.getUserActivity(address!, 0, limit),
    enabled: Boolean(address),
    refetchInterval: 30_000,
    retry: shouldRetryRead,
    retryDelay: queryRetryDelay,
  });
}

export function useUserActivityCount(address?: string) {
  return useQuery({
    queryKey: ["dominion", "activity-count", address ?? "disconnected"],
    queryFn: () => contractAdapter.getUserActivityCount(address!),
    enabled: Boolean(address),
    refetchInterval: 30_000,
    retry: shouldRetryRead,
    retryDelay: queryRetryDelay,
  });
}

export type DominionWriteKind = "create" | "place_bet" | "settle" | "claim" | "refund";

function writeQueryKeys(
  kind: DominionWriteKind,
  marketId?: string,
): readonly (readonly unknown[])[] {
  const market = marketId ? [["dominion", "market", marketId]] : [["dominion", "market"]];
  if (kind === "create") {
    return [
      ["dominion", "markets"],
      ["dominion", "open-markets"],
    ];
  }
  if (kind === "place_bet") {
    return [
      ...market,
      ["dominion", "betting-state", marketId],
      ["dominion", "position", marketId],
      ["dominion", "positions"],
      ["dominion", "activity"],
      ["dominion", "activity-count"],
      ["balance"],
    ];
  }
  if (kind === "settle") {
    return [
      ...market,
      ["dominion", "betting-state", marketId],
      ["dominion", "evidence", marketId],
      ["dominion", "markets"],
      ["dominion", "open-markets"],
      ["dominion", "positions"],
      ["dominion", "claimable"],
    ];
  }
  return [
    ...market,
    ["dominion", "position", marketId],
    ["dominion", "positions"],
    ["dominion", "claimable"],
    ["dominion", "activity"],
    ["dominion", "activity-count"],
    ["balance"],
  ];
}

export function useRefreshDominion() {
  const queryClient = useQueryClient();
  return async (kind: DominionWriteKind, marketId?: string): Promise<void> => {
    await Promise.allSettled(
      writeQueryKeys(kind, marketId).map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    );
  };
}

export function categoryQueryKey(category: CategoryId) {
  return ["dominion", "category-assets", category] as const;
}
