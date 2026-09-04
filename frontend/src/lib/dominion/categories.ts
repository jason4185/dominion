import type { Asset, CategoryDef, CategoryId } from "./types";

export const CATEGORIES: CategoryDef[] = [
  {
    id: "BIG_TECH",
    label: "Big Tech",
    short: "BIG TECH",
    assets: [
      { symbol: "AAPL", company: "Apple Inc." },
      { symbol: "META", company: "Meta Platforms" },
      { symbol: "GOOGL", company: "Alphabet Inc." },
    ],
  },
  {
    id: "AI_GROWTH",
    label: "AI & Growth",
    short: "AI & GROWTH",
    assets: [
      { symbol: "NVDA", company: "NVIDIA Corp." },
      { symbol: "PLTR", company: "Palantir Technologies" },
      { symbol: "TSLA", company: "Tesla Inc." },
    ],
  },
  {
    id: "CRYPTO_FINTECH",
    label: "Crypto & Fintech",
    short: "CRYPTO & FINTECH",
    assets: [
      { symbol: "MSTR", company: "MicroStrategy" },
      { symbol: "COIN", company: "Coinbase Global" },
      { symbol: "HOOD", company: "Robinhood Markets" },
    ],
  },
];

export const categoryById = (id: CategoryId): CategoryDef =>
  CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[0]!;

export const assetBySymbol = (category: CategoryId, symbol: string): Asset =>
  categoryById(category).assets.find((asset) => asset.symbol === symbol) ?? {
    symbol,
    company: symbol,
  };
