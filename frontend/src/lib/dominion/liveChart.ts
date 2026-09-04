export interface PerformancePoint {
  timestamp: number;
  [symbol: string]: number;
}

export interface LivePerformanceData {
  points: PerformancePoint[];
  updatedAt: number;
}

const BINANCE_INDEX_KLINES = "https://fapi.binance.com/fapi/v1/indexPriceKlines";
const MAX_CANDLES = 60;
const MAX_RESPONSE_BYTES = 200_000;
const REQUEST_TIMEOUT_MS = 8_000;

type Kline = { timestamp: number; open: number; close: number };

function parseKline(value: unknown): Kline | null {
  if (!Array.isArray(value) || value.length < 5) return null;
  const timestamp = Number(value[0]);
  const open = Number(value[1]);
  const close = Number(value[4]);
  if (!Number.isSafeInteger(timestamp) || open <= 0 || close <= 0) return null;
  if (!Number.isFinite(open) || !Number.isFinite(close)) return null;
  return { timestamp, open, close };
}

async function fetchSeries(
  symbol: string,
  startMs: number,
  endMs: number,
  signal: AbortSignal,
): Promise<Kline[]> {
  const params = new URLSearchParams({
    pair: `${symbol}USDT`,
    interval: "1m",
    startTime: String(startMs),
    endTime: String(endMs),
    limit: String(MAX_CANDLES),
  });
  const response = await fetch(`${BINANCE_INDEX_KLINES}?${params}`, { signal });
  const contentLength = Number(response.headers.get("content-length"));
  if (contentLength > MAX_RESPONSE_BYTES) throw new Error("Live price response is too large.");
  if (!response.ok) throw new Error(`Live price request failed with status ${response.status}.`);
  const body = await response.text();
  if (body.length > MAX_RESPONSE_BYTES) throw new Error("Live price response is too large.");
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new Error("Live price response is not valid JSON.");
  }
  if (!Array.isArray(payload) || payload.length > MAX_CANDLES)
    throw new Error("Live price response has an invalid shape.");
  const series = payload.map(parseKline).filter((item): item is Kline => item !== null);
  if (!series.length) throw new Error(`No live index prices are available for ${symbol}.`);
  return series.filter((item) => item.timestamp >= startMs && item.timestamp < endMs);
}

export async function fetchLivePerformance(
  symbols: string[],
  marketStartMs: number,
  marketEndMs: number,
): Promise<LivePerformanceData> {
  const endMs = Math.min(marketEndMs, Date.now());
  if (!symbols.length || endMs <= marketStartMs)
    throw new Error("The market window has not opened.");

  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const series = await Promise.all(
      symbols.map((symbol) => fetchSeries(symbol, marketStartMs, endMs, controller.signal)),
    );
    const opens = series.map((rows, index) => {
      const opening = rows.find((row) => row.timestamp === marketStartMs);
      if (!opening) throw new Error(`Opening index price is unavailable for ${symbols[index]}.`);
      return opening.open;
    });
    const timestamps = new Set<number>([marketStartMs]);
    series.forEach((rows) => {
      rows.forEach((row) => timestamps.add(row.timestamp));
    });
    const rowsByTimestamp = series.map(
      (rows) => new Map(rows.map((row) => [row.timestamp, row] as const)),
    );
    const points = [...timestamps]
      .sort((left, right) => left - right)
      .map((timestamp) => {
        const point: PerformancePoint = { timestamp };
        symbols.forEach((symbol, index) => {
          if (timestamp === marketStartMs) {
            point[symbol] = 0;
            return;
          }
          const candle = rowsByTimestamp[index]?.get(timestamp);
          if (candle) point[symbol] = ((candle.close - opens[index]!) / opens[index]!) * 100;
        });
        return point;
      });
    if (!points.length) throw new Error("No live performance data is available.");
    return { points, updatedAt: Date.now() };
  } finally {
    globalThis.clearTimeout(timeout);
  }
}
