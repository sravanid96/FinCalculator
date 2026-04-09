import { getHistoricalPrices } from "./yahooFinance";

/** Last available daily close on or before expiry (YYYY-MM-DD). */
export async function getUnderlyingCloseOnOrBefore(
  symbol: string,
  expiryYmd: string,
): Promise<number | null> {
  try {
    const prices = await getHistoricalPrices(symbol.toUpperCase(), 8);
    const onOrBefore = prices
      .filter((p) => p.date <= expiryYmd)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (onOrBefore.length === 0) return null;
    return onOrBefore[onOrBefore.length - 1].close;
  } catch {
    return null;
  }
}
