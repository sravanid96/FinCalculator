export interface ParityMetrics {
  callPriceDeviation: number;
  putPriceDeviation: number;
  parityImpliedCallPrice: number;
  parityImpliedPutPrice: number;
  arbitrageProfitPercent: number;
  arbitrageProfitDollars: number;
  direction: "call_overpriced" | "put_overpriced" | "parity_maintained";
  purityViolation: number;
}

export interface ParityPair {
  strike: number;
  expiration: string;
  daysToExpiration: number;
  callSymbol: string;
  putSymbol: string;
  callPrice: number;
  putPrice: number;
  callBid: number;
  callAsk: number;
  putBid: number;
  putAsk: number;
  parityMetrics: ParityMetrics;
}

export interface ParityAnalysisResponse {
  ticker: string;
  underlyingPrice: number;
  riskFreeRate: number;
  totalPairs: number;
  statistics: {
    totalPairs: number;
    avgArbitragePercent: number;
    maxArbitragePercent: number;
    violationsAbove05Percent: number;
    violationsAbove10Percent: number;
    mostExpensiveOption: "calls" | "puts" | "balanced";
    strikeRange: { min: number; max: number };
  };
  expirations: string[];
  pairs: ParityPair[];
}
