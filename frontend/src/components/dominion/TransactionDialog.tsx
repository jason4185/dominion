import { AlertCircle, CheckCircle2, LoaderCircle, WalletCards } from "lucide-react";
import { useCallback, useState, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { TransactionStage } from "@/lib/dominion/contractAdapter";
import { cn } from "@/lib/utils";

export type TransactionAction = "create" | "bet" | "top_up" | "settle" | "claim" | "refund";
export type TransactionDialogStage = "IDLE" | TransactionStage | "ERROR";
export const TRANSACTION_UPDATE_MESSAGE = "Transaction confirmed. Updating data...";
export const TRANSACTION_DELAYED_MESSAGE =
  "Transaction confirmed, but the latest data is taking longer to load.";

export interface TransactionDialogState {
  open: boolean;
  stage: TransactionDialogStage;
  action: TransactionAction;
  error?: string;
  postWriteMessage?: string;
}

const ACTION_LABEL: Record<TransactionAction, string> = {
  create: "market creation",
  bet: "your bet",
  top_up: "your top-up",
  settle: "market settlement",
  claim: "your winnings claim",
  refund: "your refund claim",
};

function successCopy(action: TransactionAction): string {
  if (action === "create") return "Market created successfully.";
  if (action === "bet") return "Bet placed successfully.";
  if (action === "top_up") return "Bet increased successfully.";
  if (action === "settle") return "Market settled successfully.";
  if (action === "claim") return "Winnings claimed successfully.";
  return "Refund claimed successfully.";
}

function stageCopy(state: TransactionDialogState): { title: string; message: string } {
  if (state.stage === "AWAITING_SIGNATURE") {
    return {
      title: "Confirm in your wallet",
      message: `Approve ${ACTION_LABEL[state.action]} in your wallet.`,
    };
  }
  if (state.stage === "SUBMITTED") {
    return {
      title: "Transaction submitted",
      message: "Waiting for Bradbury to confirm your transaction.",
    };
  }
  if (state.stage === "PROCESSING") {
    return {
      title: "Processing transaction",
      message: "GenLayer is processing your transaction on Bradbury.",
    };
  }
  if (state.stage === "SUCCESS") return { title: "Success", message: successCopy(state.action) };
  if (state.stage === "ERROR") {
    return {
      title: "Transaction failed",
      message: state.error ?? "Something went wrong. Please try again.",
    };
  }
  return { title: "Transaction", message: "" };
}

function StageIcon({ stage }: { stage: TransactionDialogStage }) {
  if (stage === "SUCCESS") return <CheckCircle2 className="size-6 text-positive" />;
  if (stage === "ERROR") return <AlertCircle className="size-6 text-destructive" />;
  if (stage === "AWAITING_SIGNATURE") return <WalletCards className="size-6 text-primary-glow" />;
  return <LoaderCircle className="size-6 animate-spin text-primary-glow" />;
}

export function useTransactionDialog() {
  const [state, setState] = useState<TransactionDialogState>({
    open: false,
    stage: "IDLE",
    action: "bet",
  });

  const begin = useCallback((action: TransactionAction) => {
    setState({ open: true, stage: "AWAITING_SIGNATURE", action });
  }, []);
  const update = useCallback((stage: TransactionStage) => {
    setState((current) => {
      const { error: _error, ...rest } = current;
      return { ...rest, open: true, stage };
    });
  }, []);
  const success = useCallback((postWriteMessage?: string) => {
    setState((current) => {
      const { error: _error, postWriteMessage: _oldMessage, ...rest } = current;
      return postWriteMessage
        ? { ...rest, open: true, stage: "SUCCESS", postWriteMessage }
        : { ...rest, open: true, stage: "SUCCESS" };
    });
  }, []);
  const fail = useCallback((error: string) => {
    setState((current) => ({
      ...current,
      open: true,
      stage: "ERROR",
      error: error || "Something went wrong. Please try again.",
    }));
  }, []);
  const close = useCallback(() => {
    setState((current) => ({ ...current, open: false }));
  }, []);

  const busy =
    state.stage === "AWAITING_SIGNATURE" ||
    state.stage === "SUBMITTED" ||
    state.stage === "PROCESSING";
  const locked = busy || (state.stage === "SUCCESS" && Boolean(state.postWriteMessage));

  return { state, busy, locked, begin, update, success, fail, close };
}

export type TransactionDialogController = ReturnType<typeof useTransactionDialog>;

export function TransactionDialog({
  state,
  busy,
  onClose,
  footer,
}: {
  state: TransactionDialogState;
  busy: boolean;
  onClose: () => void;
  footer?: ReactNode;
}) {
  const copy = stageCopy(state);
  return (
    <Dialog
      open={state.open}
      onOpenChange={(open) => {
        if (open || busy) return;
        onClose();
      }}
    >
      <DialogContent className="w-[calc(100%-2rem)] max-w-md border-border bg-popover shadow-2xl sm:rounded-xl">
        <DialogHeader>
          <div
            className={cn(
              "mx-auto grid size-12 place-items-center rounded-xl",
              state.stage === "SUCCESS"
                ? "bg-positive-soft"
                : state.stage === "ERROR"
                  ? "bg-destructive/10"
                  : "bg-primary-soft",
            )}
          >
            <StageIcon stage={state.stage} />
          </div>
          <DialogTitle className="pt-1 text-center text-lg text-foreground">
            {copy.title}
          </DialogTitle>
          <DialogDescription className="text-center text-sm leading-relaxed">
            {copy.message}
          </DialogDescription>
        </DialogHeader>
        {state.stage === "SUBMITTED" || state.stage === "PROCESSING" ? (
          <div className="rounded-lg border border-border bg-surface px-3 py-2.5 text-center text-[11px] text-muted-foreground">
            Keep this window open while Bradbury processes the transaction.
          </div>
        ) : null}
        {state.stage === "SUCCESS" && state.postWriteMessage ? (
          <div className="rounded-lg border border-primary/25 bg-primary-soft px-3 py-2.5 text-center text-[11px] text-primary-glow">
            {state.postWriteMessage}
          </div>
        ) : null}
        {footer ?? (
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="h-10 w-full rounded-lg border border-border bg-surface text-xs font-semibold text-foreground outline-none transition-colors hover:border-border-strong focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            {state.stage === "ERROR" ? "Close and try again" : "Close"}
          </button>
        )}
      </DialogContent>
    </Dialog>
  );
}
