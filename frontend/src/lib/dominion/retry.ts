export interface RetryReadOptions {
  attempts?: number;
  delayMs?: number;
}

export async function retryRead<T>(
  read: () => Promise<T>,
  isReady: (value: T) => boolean,
  { attempts = 15, delayMs = 1_500 }: RetryReadOptions = {},
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
    if (attempt < count - 1 && delay > 0) {
      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, delay));
    }
  }
  return undefined;
}
