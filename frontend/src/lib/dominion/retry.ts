export interface RetryReadOptions {
  attempts?: number;
  delayMs?: number;
  onWaiting?: () => void;
}

export const MAX_QUERY_RETRIES = 2;
export const POST_WRITE_RECONCILIATION_ATTEMPTS = 10;
export const POST_WRITE_RECONCILIATION_DELAY_MS = 1_500;

function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value =
    (error as { status?: unknown; statusCode?: unknown }).status ??
    (error as { statusCode?: unknown }).statusCode;
  return typeof value === "number" ? value : undefined;
}

/**
 * Only infrastructure failures should be retried automatically. Response
 * validation and application errors must remain visible to their local UI.
 */
export function isRecoverableReadError(error: unknown): boolean {
  const status = errorStatus(error);
  if (status === 429 || (status !== undefined && status >= 500)) return true;
  if (status !== undefined && status >= 400) return false;

  const message = error instanceof Error ? error.message : String(error);
  if (/source evidence unavailable/i.test(message)) return true;
  if (
    /invalid|mismatch|not found|not supported|outside the supported|already exists|already claimed|already refunded|closed|has started|not open|not refundable|minimum bet|invalid market|programmer/i.test(
      message,
    )
  ) {
    return false;
  }
  return /failed to fetch|network|timeout|timed out|temporar|rate limit|too many requests|rpc|genlayer|gateway|connection refused|service unavailable|bad gateway/i.test(
    message,
  );
}

export function shouldRetryRead(failureCount: number, error: unknown): boolean {
  return failureCount < MAX_QUERY_RETRIES && isRecoverableReadError(error);
}

export function queryRetryDelay(attemptIndex: number): number {
  return Math.min(250 * 2 ** attemptIndex, 1_000);
}

export async function retryRead<T>(
  read: () => Promise<T>,
  isReady: (value: T) => boolean,
  { attempts = 15, delayMs = 1_500, onWaiting }: RetryReadOptions = {},
): Promise<T | undefined> {
  const count = Math.max(1, Math.floor(attempts));
  const delay = Math.max(0, Math.floor(delayMs));

  for (let attempt = 0; attempt < count; attempt += 1) {
    try {
      const value = await read();
      if (isReady(value)) return value;
    } catch {
      // A confirmed write must remain successful while contract reads catch up.
    }
    onWaiting?.();
    if (attempt < count - 1 && delay > 0) {
      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, delay));
    }
  }
  return undefined;
}

/**
 * Reconcile only after the write has already reached ACCEPTED with a
 * successful execution result. Read lag and read failures never rewrite that
 * successful transaction outcome.
 */
export async function reconcileAcceptedWrite<T>(
  result: { ok: boolean; confirmed?: boolean },
  read: () => Promise<T>,
  isReady: (value: T) => boolean,
  options: RetryReadOptions = {},
): Promise<T | undefined> {
  if (!result.ok || result.confirmed !== true) return undefined;
  let waitingNotified = false;
  return retryRead(read, isReady, {
    attempts: options.attempts ?? POST_WRITE_RECONCILIATION_ATTEMPTS,
    delayMs: options.delayMs ?? POST_WRITE_RECONCILIATION_DELAY_MS,
    onWaiting: () => {
      if (waitingNotified) return;
      waitingNotified = true;
      options.onWaiting?.();
    },
  });
}
