import { createFileRoute } from "@tanstack/react-router";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Panel } from "@/components/dominion/primitives";

export const Route = createFileRoute("/how-it-works")({
  head: () => ({
    meta: [
      { title: "How it works — DOMINION" },
      {
        name: "description",
        content:
          "How DOMINION hourly stock dominance markets work: pari-mutuel pools, 1-hour UTC windows, and 2-of-3 source settlement.",
      },
      { property: "og:title", content: "How it works — DOMINION" },
      {
        property: "og:description",
        content: "Pari-mutuel hourly stock dominance markets, settled by exchange source consensus.",
      },
    ],
  }),
  component: HowItWorks,
});

const STEPS = [
  {
    title: "1. Choose a category",
    body: "Every market belongs to one of three fixed categories: Big Tech (AAPL, META, GOOGL), AI & Growth (NVDA, PLTR, TSLA) or Crypto & Fintech (MSTR, COIN, HOOD). The three assets are locked by the category — there is no arbitrary stock selection.",
  },
  {
    title: "2. Pick one stock",
    body: "One wallet backs exactly one asset per market. You can top up the same asset as often as you like while betting is open, but switching to another asset after your first bet is not allowed.",
  },
  {
    title: "3. Pari-mutuel pool",
    body: "There are no odds, no order book, no AMM and no yes/no shares. Every stake joins the pool of its asset. Winners split the entire market pool proportionally to their share of the winning pool. Minimum bet is 1 GEN, there is no app-level maximum, and the protocol fee is 0%.",
  },
  {
    title: "4. One-hour reference window",
    body: "Markets run on clean 1-hour UTC windows, for example 15:00→16:00 UTC. Performance is measured from the window's reference open candle to its close candle.",
  },
  {
    title: "5. 2-of-3 source settlement",
    body: "Reference/index candles are read from Binance, Bitget and Gate. At least two sources must agree on the same winner. If fewer than two usable sources report, the market resolves INCONCLUSIVE.",
  },
  {
    title: "6. Highest percentage return wins",
    body: "The winner is the asset with the highest numerical percentage return over the window — including the least-negative asset when all three return negative.",
  },
  {
    title: "7. Claims and refunds",
    body: "After settlement, winning position owners claim their share of the pool. If a market is inconclusive, every position owner claims a full refund of their stake. Only the position owner can claim or refund.",
  },
  {
    title: "8. Permissionless create and settlement",
    body: "Any wallet can create a market for an upcoming 1-hour window, and any wallet can trigger settlement of an expired market. No admin, no gatekeeper.",
  },
];

const FAQ = [
  { q: "Can I bet on two assets in the same market?", a: "No. One wallet backs exactly one asset per market. Top-ups on that same asset are always allowed while betting is open." },
  { q: "What is my payout?", a: "Your share of the winning pool multiplied by the total market pool. Since the fee is 0%, the entire pool is distributed to winners." },
  { q: "What happens if two assets tie?", a: "Ties are resolved by source consensus. If two or more sources cannot agree on a single winner, the market resolves inconclusive and all stakes are refundable." },
  { q: "What if all three stocks fall?", a: "The least-negative return wins. Dominance is relative, not absolute." },
  { q: "Who can settle a market?", a: "Any wallet. Settlement is permissionless once the window has expired and reference candles are available." },
  { q: "Is there a maximum bet?", a: "No app-level maximum. Your wallet balance is the only limit." },
];

function HowItWorks() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-10 lg:px-6">
      <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">How DOMINION works</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        A permissionless, pari-mutuel hourly stock dominance market on GenLayer.
      </p>

      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        {STEPS.map((s) => (
          <Panel key={s.title} className="p-5">
            <h2 className="text-sm font-semibold text-foreground">{s.title}</h2>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{s.body}</p>
          </Panel>
        ))}
      </div>

      <h2 className="mt-10 text-xl font-semibold text-foreground">FAQ</h2>
      <Panel className="mt-3 px-4">
        <Accordion type="single" collapsible>
          {FAQ.map((f) => (
            <AccordionItem key={f.q} value={f.q} className="border-border">
              <AccordionTrigger className="text-left text-sm text-foreground">{f.q}</AccordionTrigger>
              <AccordionContent className="text-xs leading-relaxed text-muted-foreground">
                {f.a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </Panel>
    </main>
  );
}
