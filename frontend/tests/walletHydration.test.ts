import { describe, expect, test } from "bun:test";
import { wagmiConfig } from "../src/lib/walletConfig";

describe("wallet hydration configuration", () => {
  test("does not attempt persistence rehydration without a storage backend", () => {
    expect(wagmiConfig.storage).toBeNull();
    expect(wagmiConfig._internal.ssr).toBe(false);
  });
});
