import { getStockQuote } from "./yahooFinance";
import type { StockQuote } from "@shared/optionsSchema";

export interface MarketIndexSnapshot {
  symbol: string;
  label: string;
  quote: StockQuote | null;
  error?: string;
}

const MARKET_INDICES: Array<{ symbol: string; label: string }> = [
  { symbol: "SPY", label: "S&P 500 (SPY)" },
  { symbol: "QQQ", label: "Nasdaq 100 (QQQ)" },
  { symbol: "DIA", label: "Dow (DIA)" },
  { symbol: "IWM", label: "Russell 2000 (IWM)" },
];

export async function fetchMarketSnapshot(): Promise<{
  generatedAt: string;
  indices: MarketIndexSnapshot[];
}> {
  const indices = await Promise.all(
    MARKET_INDICES.map(async ({ symbol, label }) => {
      try {
        const quote = await getStockQuote(symbol);
        return { symbol, label, quote };
      } catch (e) {
        return {
          symbol,
          label,
          quote: null,
          error: (e as Error).message,
        };
      }
    }),
  );

  return {
    generatedAt: new Date().toISOString(),
    indices,
  };
}
