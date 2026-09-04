import { describe, expect, test } from "bun:test";
import { gen } from "../src/lib/dominion/format";
import { GEN_SCALE, parseGenAmount } from "../src/lib/dominion/contractAdapter";
import {
  isRecoverableReadError,
  queryRetryDelay,
  retryRead,
  shouldRetryRead,
} from "../src/lib/dominion/retry";

describe("retryRead", () => {
  test("returns a fresh read immediately", async () => {
    let calls = 0;
    const result = await retryRead(
      async () => {
        calls += 1;
        return { state: "SETTLED" };
      },
      (value) => value.state === "SETTLED",
      { attempts: 3, delayMs: 0 },
    );

    expect(result).toEqual({ state: "SETTLED" });
    expect(calls).toBe(1);
  });

  test("retries a stale read until the authoritative state is visible", async () => {
    let calls = 0;
    const result = await retryRead(
      async () => {
        calls += 1;
        return { state: calls === 1 ? "OPEN" : "SETTLED" };
      },
      (value) => value.state === "SETTLED",
      { attempts: 3, delayMs: 0 },
    );

    expect(result).toEqual({ state: "SETTLED" });
    expect(calls).toBe(2);
  });

  test("retries through a temporary read error", async () => {
    let calls = 0;
    const result = await retryRead(
      async () => {
        calls += 1;
        if (calls === 1) throw new Error("temporary RPC failure");
        return { state: "INCONCLUSIVE" };
      },
      (value) => value.state === "INCONCLUSIVE",
      { attempts: 3, delayMs: 0 },
    );

    expect(result).toEqual({ state: "INCONCLUSIVE" });
    expect(calls).toBe(2);
  });

  test("returns no value after the bounded retry window", async () => {
    let calls = 0;
    const result = await retryRead(
      async () => {
        calls += 1;
        throw new Error("unavailable");
      },
      () => false,
      { attempts: 3, delayMs: 0 },
    );

    expect(result).toBeUndefined();
    expect(calls).toBe(3);
  });
});

describe("contract read retry policy", () => {
  test("retries transient RPC failures twice with short backoff", () => {
    const error = new Error("GenLayer RPC error: Failed to fetch");
    expect(isRecoverableReadError(error)).toBe(true);
    expect(shouldRetryRead(0, error)).toBe(true);
    expect(shouldRetryRead(1, error)).toBe(true);
    expect(shouldRetryRead(2, error)).toBe(false);
    expect(queryRetryDelay(0)).toBe(250);
    expect(queryRetryDelay(1)).toBe(500);
  });

  test("does not retry deterministic malformed responses or programmer errors", () => {
    expect(isRecoverableReadError(new Error("Invalid contract response shape."))).toBe(false);
    expect(isRecoverableReadError(new Error("Contract market pool totals are inconsistent."))).toBe(
      false,
    );
    expect(isRecoverableReadError(new Error("Unexpected programmer failure."))).toBe(false);
  });
});

describe("GEN amount safety", () => {
  test("parses exact base-unit amounts without floating point", () => {
    expect(parseGenAmount("1")).toBe(GEN_SCALE);
    expect(parseGenAmount("1.000000000000000001")).toBe(GEN_SCALE + 1n);
    expect(parseGenAmount("0.1")).toBe(100_000_000_000_000_000n);
  });

  test("rejects malformed or over-precision amounts", () => {
    expect(parseGenAmount("1.0000000000000000001")).toBeNull();
    expect(parseGenAmount("-1")).toBeNull();
    expect(parseGenAmount("1e18")).toBeNull();
    expect(parseGenAmount("")).toBeNull();
  });

  test("formats bigint balances without converting base units to Number", () => {
    expect(gen(1_000_000_000_000_000_001n, 4)).toBe("1.0000");
    expect(gen(123_456_789_000_000_000_000_000n, 2)).toBe("123,456.78");
  });
});
