import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Panel } from "@/components/dominion/primitives";
import { useLivePerformance } from "@/lib/dominion/useDominion";
import type { MarketView } from "@/lib/dominion/types";

const LINE_COLORS = ["#9b8cff", "#e5b95c", "#5ed6a0"];

function timeLabel(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(11, 16);
}

function formatReturn(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function chartConfig(market: MarketView): ChartConfig {
  return Object.fromEntries(
    market.assets.map((asset, index) => [
      asset.symbol,
      { label: asset.symbol, color: LINE_COLORS[index % LINE_COLORS.length] },
    ]),
  ) as ChartConfig;
}

export function LivePerformanceChart({ market, now }: { market: MarketView; now: number }) {
  const query = useLivePerformance(market, now);
  const isUpcoming = market.status === "UPCOMING";

  return (
    <section className="mt-7">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">Live Performance</p>
          <p className="mt-1 text-xs text-muted-foreground">Relative return since market open</p>
        </div>
        <span className="rounded-md bg-elevated px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Informational only
        </span>
      </div>
      <Panel className="p-4">
        {isUpcoming ? (
          <div className="grid min-h-60 place-items-center text-center">
            <div>
              <p className="text-sm font-semibold text-foreground">
                Live performance starts when the market opens.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                All returns are measured from the contract market start.
              </p>
            </div>
          </div>
        ) : query.isPending ? (
          <div className="grid min-h-60 place-items-center text-center text-xs text-muted-foreground">
            Loading live index performance…
          </div>
        ) : query.isError || !query.data ? (
          <div className="grid min-h-60 place-items-center text-center">
            <div>
              <p className="text-sm font-semibold text-foreground">Live performance unavailable</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Public index-price data could not be loaded right now.
              </p>
              <Button
                type="button"
                variant="outline"
                className="mt-4 h-9 border-border text-xs"
                onClick={() => void query.refetch()}
              >
                Retry chart
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
              {market.assets.map((asset, index) => (
                <div key={asset.symbol} className="flex items-center gap-2 text-[11px]">
                  <span
                    className="size-2 rounded-full"
                    style={{ backgroundColor: LINE_COLORS[index % LINE_COLORS.length] }}
                  />
                  <span className="num font-semibold text-foreground">{asset.symbol}</span>
                </div>
              ))}
            </div>
            <ChartContainer config={chartConfig(market)} className="h-[300px] w-full aspect-auto">
              <LineChart data={query.data.points} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="timestamp"
                  tickLine={false}
                  axisLine={false}
                  minTickGap={28}
                  tickFormatter={timeLabel}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={48}
                  tickFormatter={(value) => `${Number(value).toFixed(1)}%`}
                />
                <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      labelFormatter={(label) => `${timeLabel(Number(label))} UTC`}
                      formatter={(value, name) => (
                        <span className="num font-semibold">
                          {formatReturn(Number(value))} {name}
                        </span>
                      )}
                    />
                  }
                />
                {market.assets.map((asset, index) => (
                  <Line
                    key={asset.symbol}
                    type="monotone"
                    dataKey={asset.symbol}
                    name={asset.symbol}
                    stroke={LINE_COLORS[index % LINE_COLORS.length]}
                    strokeWidth={2}
                    dot={false}
                    connectNulls={false}
                  />
                ))}
              </LineChart>
            </ChartContainer>
            <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">
              Reference prices are fetched from Binance index-price candles for display only. This
              chart never determines the winner or changes Dominion state.
            </p>
          </>
        )}
      </Panel>
    </section>
  );
}
