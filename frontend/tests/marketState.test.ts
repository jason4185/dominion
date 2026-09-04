import { describe, expect, test } from "bun:test";
import { resolveMarketStatus, resolvePositionUiState } from "../src/lib/dominion/marketState";
import type { MarketView, Position } from "../src/lib/dominion/types";

const startMs = 1_800_000_000_000;
const endMs = startMs + 3_600_000;

function market(overrides: Partial<MarketView> = {}): MarketView {
  return {
    id: "1",
    category: "BIG_TECH",
    assets: [],
    startMs,
    endMs,
    status: "UPCOMING",
    pools: {},
    totalPool: 0n,
    winner: null,
    claimedPool: 0n,
    bettingOpen: true,
    settlementAvailable: false,
    poolShares: {},
    winningPool: 0n,
    remainingPool: 0n,
    userSelectedAsset: null,
    userStake: 0n,
    canTopUp: false,
    positionWon: false,
    positionLost: false,
    claimAvailable: false,
    refundAvailable: false,
    claimableAmount: 0n,
    claimType: null,
    ...overrides,
  };
}

function read(data: MarketView, isFetching = false) {
  return { status: "success" as const, data, isFetching };
}

describe("market refresh state gating", () => {
  test("does not resolve a status before the clock and both reads are ready", () => {
    const snapshot = market();
    expect(resolveMarketStatus({ status: "pending" }, read(snapshot), 0)).toBeNull();
    expect(resolveMarketStatus(read(snapshot, true), read(snapshot), startMs - 1)).toBeNull();
  });

  test("does not show upcoming while betting state is delayed", () => {
    const snapshot = market();
    expect(resolveMarketStatus(read(snapshot), { status: "pending" }, startMs - 1)).toBeNull();
  });

  test("keeps the zero countdown boundary neutral until settlement is available", () => {
    const boundary = market({ status: "UPCOMING", bettingOpen: false });
    expect(resolveMarketStatus(read(boundary), read(boundary), startMs)).toBeNull();
  });

  test("resolves open, awaiting settlement, and terminal states from agreed reads", () => {
    const open = market({ status: "UPCOMING" });
    expect(resolveMarketStatus(read(open), read(open), startMs + 1)).toBe("OPEN");

    const awaiting = market({
      status: "OPEN",
      bettingOpen: false,
      settlementAvailable: true,
    });
    expect(resolveMarketStatus(read(awaiting), read(awaiting), endMs)).toBe("PENDING_SETTLEMENT");

    const settled = market({ status: "SETTLED", bettingOpen: false });
    expect(resolveMarketStatus(read(settled), read(settled), endMs + 1)).toBe("SETTLED");
  });

  test("returns neutral state for disagreeing reads instead of choosing a stale label", () => {
    const oldRead = market({ status: "OPEN", bettingOpen: true });
    const newRead = market({ status: "OPEN", bettingOpen: false, settlementAvailable: true });
    expect(resolveMarketStatus(read(oldRead), read(newRead), endMs)).toBeNull();
  });
});

describe("wallet position hydration states", () => {
  test("keeps a delayed wallet and pending query out of no-position", () => {
    expect(
      resolvePositionUiState({
        address: undefined,
        walletHydrating: true,
        query: { status: "pending" },
      }),
    ).toBe("LOADING");
    expect(
      resolvePositionUiState({
        address: "0xabc",
        walletHydrating: false,
        query: { status: "pending" },
      }),
    ).toBe("LOADING");
  });

  test("distinguishes no position, a real position, and read error", () => {
    expect(
      resolvePositionUiState({
        address: "0xabc",
        walletHydrating: false,
        query: { status: "success", data: undefined },
      }),
    ).toBe("LOADING");
    expect(
      resolvePositionUiState({
        address: "0xabc",
        walletHydrating: false,
        query: { status: "success", data: null },
      }),
    ).toBe("NO_POSITION");
    expect(
      resolvePositionUiState({
        address: "0xabc",
        walletHydrating: false,
        query: {
          status: "success",
          data: { hasPosition: true } as Position,
        },
      }),
    ).toBe("HAS_POSITION");
    expect(
      resolvePositionUiState({
        address: "0xabc",
        walletHydrating: false,
        query: { status: "error" },
      }),
    ).toBe("ERROR");
  });
});
