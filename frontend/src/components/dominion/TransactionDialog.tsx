import { AlertCircle, CheckCircle2, LoaderCircle, RefreshCw, WalletCards } from "lucide-react";
import { useCallback, useRef, useState, type ReactNode } from "react";
import type { TransactionStage } from "@/lib/dominion/contractAdapter";
import {
  isTransactionBusy,
  isTransactionLocked,
  transactionStageCopy,
} from "@/lib/dominion/transactionState";
import type {
  TransactionAction,
  TransactionDialogStage,
  TransactionDialogState,
} from "@/lib/dominion/transactionState";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type {
  TransactionAction,
  TransactionDialogStage,
  TransactionDialogState,
} from "@/lib/dominion/transactionState";

function StageIcon({ stage }: { stage: TransactionDialogStage }) {
  if (stage === "SUCCESS" || stage === "DONE")
    return <CheckCircle2 className="size-6 text-positive" />;
  if (stage === "ERROR" || stage === "UNCERTAIN")
    return <AlertCircle className="size-6 text-destructive" />;
  if (stage === "RECONCILING") return <RefreshCw className="size-6 text-primary-glow" />;
  if (stage === "AWAITING_SIGNATURE") return <WalletCards className="size-6 text-primary-glow" />;
  return <LoaderCircle className="size-6 animate-spin text-primary-glow" />;
}

export function useTransactionDialog() {
  const [state, setState] = useState<TransactionDialogState>({
    open: false,
    stage: "IDLE",
    action: "bet",
  });
  const activeWrite = useRef(false);

  const begin = useCallback((action: TransactionAction): boolean => {
    if (activeWrite.current) return false;
    activeWrite.current = true;
    setState({ open: true, stage: "AWAITING_SIGNATURE", action });
    return true;
  }, []);

  const update = useCallback((stage: TransactionStage) => {
    setState((current) => ({ ...current, open: true, stage, error: undefined }));
  }, []);

  const success = useCallback((hash?: string, message?: string) => {
    setState((current) => ({
      ...current,
      open: true,
      stage: "SUCCESS",
      hash: hash ?? current.hash,
      message,
      error: undefined,
    }));
  }, []);

  const done = useCallback((hash?: string, message?: string) => {
    activeWrite.current = false;
    setState((current) => ({
      ...current,
      open: true,
      stage: "DONE",
      hash: hash ?? current.hash,
      message,
      error: undefined,
    }));
  }, []);

  const reconcile = useCallback((message: string) => {
    setState((current) => ({
      ...current,
      open: true,
      stage: "RECONCILING",
      message,
      error: undefined,
    }));
  }, []);

  const uncertain = useCallback((hash?: string) => {
    setState((current) => ({
      ...current,
      open: true,
      stage: "UNCERTAIN",
      hash: hash ?? current.hash,
      error: undefined,
      message: undefined,
    }));
  }, []);

  const fail = useCallback((error: string) => {
    activeWrite.current = false;
    setState((current) => ({
      ...current,
      open: true,
      stage: "ERROR",
      error: error || "Something went wrong. Please try again.",
      message: undefined,
    }));
  }, []);

  const close = useCallback(() => {
    setState((current) =>
      current.stage === "DONE"
        ? { open: false, stage: "IDLE", action: current.action }
        : { ...current, open: false },
    );
  }, []);

  const busy = isTransactionBusy(state.stage);
  const isReconciling = state.stage === "RECONCILING";
  const locked = isTransactionLocked(state.stage);

  return {
    state,
    busy,
    locked,
    isReconciling,
    begin,
    update,
    success,
    done,
    reconcile,
    uncertain,
    fail,
    close,
  };
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
  const copy = transactionStageCopy(state);
  const showProcessingHint = state.stage === "SUBMITTED" || state.stage === "PROCESSING";
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
              state.stage === "SUCCESS" || state.stage === "DONE"
                ? "bg-positive-soft"
                : state.stage === "ERROR" || state.stage === "UNCERTAIN"
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
        {showProcessingHint ? (
          <div className="rounded-lg border border-border bg-surface px-3 py-2.5 text-center text-[11px] text-muted-foreground">
            Waiting for the GenLayer transaction status to reach ACCEPTED with a finished execution
            result.
          </div>
        ) : null}
        {state.stage === "RECONCILING" ? (
          <div className="rounded-lg border border-primary/25 bg-primary-soft px-3 py-2.5 text-center text-[11px] text-primary-glow">
            {state.message ?? "Updating state..."}
          </div>
        ) : null}
        {state.hash ? (
          <div className="rounded-lg border border-border bg-surface px-3 py-2.5 text-center text-[11px] text-muted-foreground">
            Transaction hash: <span className="break-all font-mono">{state.hash}</span>
          </div>
        ) : null}
        {state.stage === "ERROR" ? (
          <p className="rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-center text-sm text-destructive">
            {state.error}
          </p>
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
