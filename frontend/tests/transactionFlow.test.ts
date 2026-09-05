import { describe, expect, test } from "bun:test";
import { reconcileAcceptedWrite } from "../src/lib/dominion/retry";
import {
  TRANSACTION_MAX_ATTEMPTS,
  TRANSACTION_POLL_INTERVAL_MS,
  waitForAcceptedExecution,
} from "../src/lib/dominion/contractAdapter";
import {
  isTransactionBusy,
  isTransactionLocked,
  transactionStageCopy,
} from "../src/lib/dominion/transactionState";

const HASH = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";

describe("Dominion accepted transaction lifecycle", () => {
  test("locks success at ACCEPTED plus FINISHED_WITH_RETURN without waiting for FINALIZED", async () => {
    const receipts = [
      { statusName: "PROPOSING" },
      { statusName: "ACCEPTED", txExecutionResultName: "FINISHED_WITH_RETURN" },
      { statusName: "FINALIZED", txExecutionResultName: "FINISHED_WITH_RETURN" },
    ];
    let polls = 0;
    const result = await waitForAcceptedExecution({
      client: {
        getTransaction: async () => receipts[polls++] ?? receipts[2],
      },
      hash: HASH,
      wait: async () => undefined,
    });

    expect(result.confirmed).toBe(true);
    expect(result.status).toBe("ACCEPTED");
    expect(polls).toBe(2);
  });

  test("reconciles an accepted bet after the first position read is stale", async () => {
    let reads = 0;
    let waitingNotifications = 0;
    const result = await reconcileAcceptedWrite(
      { ok: true, confirmed: true, hash: HASH },
      async () => ({ stake: reads++ === 0 ? 1n : 2n }),
      (position) => position.stake === 2n,
      { attempts: 3, delayMs: 0, onWaiting: () => (waitingNotifications += 1) },
    );

    expect(result).toEqual({ stake: 2n });
    expect(reads).toBe(2);
    expect(waitingNotifications).toBe(1);
  });

  test("does not enter reconciliation when the expected state is already visible", async () => {
    let waitingNotifications = 0;
    const result = await reconcileAcceptedWrite(
      { ok: true, confirmed: true, hash: HASH },
      async () => ({ stake: 2n }),
      (position) => position.stake === 2n,
      { attempts: 3, delayMs: 0, onWaiting: () => (waitingNotifications += 1) },
    );

    expect(result).toEqual({ stake: 2n });
    expect(waitingNotifications).toBe(0);
  });

  test("keeps an accepted bet successful when reconciliation reads fail", async () => {
    const accepted = { ok: true, confirmed: true, hash: HASH };
    const result = await reconcileAcceptedWrite(
      accepted,
      async () => {
        throw new Error("temporary RPC failure");
      },
      () => false,
      { attempts: 2, delayMs: 0 },
    );

    expect(result).toBeUndefined();
    expect(accepted.confirmed).toBe(true);
    expect(transactionStageCopy({ open: true, stage: "RECONCILING", action: "bet" }).title).toBe(
      "Transaction accepted.",
    );
  });

  test("keeps delayed market propagation in reconciliation instead of failure", async () => {
    const result = await reconcileAcceptedWrite(
      { ok: true, confirmed: true },
      async () => ({ status: "OPEN" }),
      (market) => market.status === "SETTLED",
      { attempts: 2, delayMs: 0 },
    );

    expect(result).toBeUndefined();
    expect(
      transactionStageCopy({
        open: true,
        stage: "RECONCILING",
        action: "settle",
        message: "Settlement accepted. Updating market state...",
      }).message,
    ).toBe("Settlement accepted. Updating market state...");
  });

  test("does not show reconciliation messaging while the transaction is pending", () => {
    const copy = transactionStageCopy({ open: true, stage: "PROCESSING", action: "bet" });
    expect(copy.message).toBe("Waiting for GenLayer acceptance...");
    expect(copy.message).not.toContain("Updating");
    expect(isTransactionBusy("PROCESSING")).toBe(true);
    expect(isTransactionLocked("PROCESSING")).toBe(true);
  });

  test("stops the transaction confirmation spinner once acceptance is locked", () => {
    expect(isTransactionBusy("SUCCESS")).toBe(false);
    expect(isTransactionBusy("DONE")).toBe(false);
    expect(isTransactionBusy("RECONCILING")).toBe(false);
    expect(isTransactionLocked("SUCCESS")).toBe(true);
    expect(isTransactionLocked("DONE")).toBe(true);
    expect(transactionStageCopy({ open: true, stage: "SUCCESS", action: "bet" }).message).toBe(
      "Transaction accepted.",
    );
  });

  test("uses reconciliation only while settlement waits for a terminal market state", async () => {
    let reads = 0;
    const result = await reconcileAcceptedWrite(
      { ok: true, confirmed: true },
      async () => ({ status: reads++ === 0 ? "PENDING_SETTLEMENT" : "SETTLED" }),
      (market) => market.status === "SETTLED" || market.status === "INCONCLUSIVE",
      { attempts: 3, delayMs: 0 },
    );

    expect(result?.status).toBe("SETTLED");
  });

  test("preserves claim success while balance propagation is delayed", async () => {
    const result = await reconcileAcceptedWrite(
      { ok: true, confirmed: true },
      async () => ({ claimed: false }),
      (position) => position.claimed,
      { attempts: 1, delayMs: 0 },
    );

    expect(result).toBeUndefined();
    expect(
      transactionStageCopy({
        open: true,
        stage: "RECONCILING",
        action: "claim",
        message: "Claim accepted. Updating your balance...",
      }).message,
    ).toBe("Claim accepted. Updating your balance...");
  });

  test("returns a neutral uncertain outcome after bounded submission polling", async () => {
    let polls = 0;
    const result = await waitForAcceptedExecution({
      client: {
        getTransaction: async () => {
          polls += 1;
          return { statusName: "PENDING" };
        },
      },
      hash: HASH,
      maxAttempts: 2,
      pollIntervalMs: 0,
      wait: async () => undefined,
    });

    expect(result.confirmed).toBe(false);
    expect(polls).toBe(2);
    expect(isTransactionLocked("UNCERTAIN")).toBe(true);
    expect(
      transactionStageCopy({ open: true, stage: "UNCERTAIN", action: "bet" }).message,
    ).toContain("confirmation is taking longer");
  });

  test("treats FINISHED_WITH_ERROR as a true transaction failure", async () => {
    await expect(
      waitForAcceptedExecution({
        client: {
          getTransaction: async () => ({
            statusName: "ACCEPTED",
            txExecutionResultName: "FINISHED_WITH_ERROR",
          }),
        },
        hash: HASH,
        maxAttempts: 1,
        wait: async () => undefined,
      }),
    ).rejects.toThrow("FINISHED_WITH_ERROR");
  });

  test("keeps the proven bounded polling values explicit", () => {
    expect(TRANSACTION_POLL_INTERVAL_MS).toBe(2_000);
    expect(TRANSACTION_MAX_ATTEMPTS).toBe(75);
    expect(TRANSACTION_POLL_INTERVAL_MS * TRANSACTION_MAX_ATTEMPTS).toBe(150_000);
  });
});
