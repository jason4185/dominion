import type { TransactionStage } from "./contractAdapter";

export type TransactionAction = "create" | "bet" | "top_up" | "settle" | "claim" | "refund";
export type TransactionDialogStage = "IDLE" | TransactionStage | "RECONCILING" | "DONE" | "ERROR";

export interface TransactionDialogState {
  open: boolean;
  stage: TransactionDialogStage;
  action: TransactionAction;
  hash?: string | undefined;
  error?: string | undefined;
  message?: string | undefined;
}

const ACTION_LABEL: Record<TransactionAction, string> = {
  create: "market creation",
  bet: "your bet",
  top_up: "your top-up",
  settle: "market settlement",
  claim: "your winnings claim",
  refund: "your refund claim",
};

export function transactionStageCopy(state: TransactionDialogState): {
  title: string;
  message: string;
} {
  if (state.stage === "AWAITING_SIGNATURE") {
    return {
      title: "Awaiting wallet",
      message: "Confirm this transaction in your wallet.",
    };
  }
  if (state.stage === "SUBMITTED") {
    return { title: "Transaction submitted.", message: "Transaction submitted." };
  }
  if (state.stage === "PROCESSING") {
    return {
      title: "Waiting for ACCEPTED",
      message: "Waiting for GenLayer acceptance...",
    };
  }
  if (state.stage === "RECONCILING") {
    return {
      title: "Transaction accepted.",
      message: state.message ?? "Updating state...",
    };
  }
  if (state.stage === "SUCCESS" || state.stage === "DONE") {
    return state.message
      ? { title: state.message, message: "Transaction accepted." }
      : { title: "Transaction accepted.", message: "Transaction accepted." };
  }
  if (state.stage === "UNCERTAIN") {
    return {
      title: "Confirmation is taking longer",
      message:
        "Transaction submitted, but confirmation is taking longer than expected. Check again before trying again.",
    };
  }
  if (state.stage === "ERROR") {
    return {
      title: "Transaction failed",
      message: state.error ?? "Something went wrong. Please try again.",
    };
  }
  return { title: ACTION_LABEL[state.action], message: "" };
}

export function isTransactionBusy(stage: TransactionDialogStage): boolean {
  return stage === "AWAITING_SIGNATURE" || stage === "SUBMITTED" || stage === "PROCESSING";
}

export function isTransactionLocked(stage: TransactionDialogStage): boolean {
  return (
    isTransactionBusy(stage) ||
    stage === "RECONCILING" ||
    stage === "SUCCESS" ||
    stage === "DONE" ||
    stage === "UNCERTAIN"
  );
}
