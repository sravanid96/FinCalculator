import { z } from "zod";

// Stock quote data
export interface StockQuote {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  marketCap?: number;
  high52Week?: number;
  low52Week?: number;
  avgVolume?: number;
  pe?: number;
  dividend?: number;
  dividendYield?: number;
}

// Historical price data point
export interface PriceDataPoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// Options contract
export interface OptionContract {
  contractSymbol: string;
  strike: number;
  expiration: string;
  daysToExpiration: number;
  type: "call" | "put";
  bid: number;
  ask: number;
  lastPrice: number;
  volume: number;
  openInterest: number;
  impliedVolatility: number;
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  rho?: number;
  inTheMoney: boolean;
}

// Options chain for a specific expiration
export interface OptionsExpiration {
  expirationDate: string;
  daysToExpiration: number;
  calls: OptionContract[];
  puts: OptionContract[];
}

// Full options chain
export interface OptionsChain {
  symbol: string;
  underlyingPrice: number;
  expirations: OptionsExpiration[];
}

// Support/Resistance level
export interface SupportResistanceLevel {
  price: number;
  type: "support" | "resistance";
  strength: number; // 1-5 based on touches and recency
  touches: number;
  lastTouchDate: string;
}

// Earnings event
export interface EarningsEvent {
  symbol: string;
  companyName: string;
  reportDate: string;
  fiscalQuarter: string;
  estimatedEPS?: number;
  actualEPS?: number;
  reportTime: "before_market" | "after_market" | "unknown";
  daysUntil: number;
}

// Trade idea configuration
export interface TradeIdeaConfig {
  strategy: OptionStrategy;
  targetDelta: number;
  targetDTE: number;
  spreadWidth: number;
  takeProfitPercent: number;
  managementDTE: number;
}

// Option strategy types
export type OptionStrategy =
  | "put_credit_spread"
  | "call_credit_spread"
  | "iron_condor"
  | "iron_butterfly"
  | "long_call"
  | "long_put"
  | "covered_call"
  | "cash_secured_put"
  | "straddle"
  | "strangle";

// Put-call parity metrics
export interface ParityMetrics {
  callPriceDeviation: number; // % deviation of call from parity-implied price
  putPriceDeviation: number; // % deviation of put from parity-implied price
  parityImpliedCallPrice: number; // What call should be worth per parity
  parityImpliedPutPrice: number; // What put should be worth per parity
  arbitrageProfitPercent: number; // % profit from arbitrage opportunity
  arbitrageProfitDollars: number; // $ profit from arbitrage (per contract)
  direction: "call_expensive" | "put_expensive" | "fair";
  purityViolation: number; // Raw deviation: C + PV(X) - P - S in dollars
}

// Trade idea result
export interface TradeIdea {
  id: string;
  symbol: string;
  strategy: OptionStrategy;
  strategyName: string;
  legs: TradeLeg[];
  entryPrice: number;
  maxProfit: number;
  maxLoss: number;
  breakeven: number[];
  probabilityOfProfit: number;
  riskRewardRatio: number;
  daysToExpiration: number;
  expirationDate: string;
  underlyingPrice: number;
  hasEarningsRisk: boolean;
  earningsDate?: string;
  recommendation: "strong_buy" | "buy" | "neutral" | "avoid";
  notes: string[];
  parityMetrics?: ParityMetrics; // Optional put-call parity analysis
}

// Individual leg of a trade
export interface TradeLeg {
  type: "call" | "put";
  action: "buy" | "sell";
  strike: number;
  expiration: string;
  quantity: number;
  price: number;
  delta?: number;
}

// P&L calculation request
export interface PLCalculationRequest {
  legs: TradeLeg[];
  underlyingPrice: number;
  priceRange?: { min: number; max: number };
  daysToExpiration?: number;
}

// P&L data point for chart
export interface PLDataPoint {
  underlyingPrice: number;
  profit: number;
  profitPercent: number;
}

// P&L calculation result
export interface PLCalculationResult {
  maxProfit: number;
  maxLoss: number;
  breakeven: number[];
  currentPL: number;
  dataPoints: PLDataPoint[];
  greeks: {
    delta: number;
    gamma: number;
    theta: number;
    vega: number;
  };
}

// Strategy comparison item
export interface StrategyComparison {
  strategy: OptionStrategy;
  strategyName: string;
  maxProfit: number;
  maxLoss: number;
  probabilityOfProfit: number;
  riskRewardRatio: number;
  breakeven: number[];
  capitalRequired: number;
  recommendation: "strong_buy" | "buy" | "neutral" | "avoid";
  pros: string[];
  cons: string[];
}

// Full analysis response
export interface TickerAnalysis {
  quote: StockQuote;
  optionsChain: OptionsChain;
  supportResistance: SupportResistanceLevel[];
  upcomingEarnings: EarningsEvent | null;
  tradeIdeas: TradeIdea[];
  strategyComparisons: StrategyComparison[];
}

// API request/response schemas for validation
export const tickerParamSchema = z.object({
  ticker: z.string().min(1).max(10).toUpperCase(),
});

export const plCalculationSchema = z.object({
  legs: z.array(
    z.object({
      type: z.enum(["call", "put"]),
      action: z.enum(["buy", "sell"]),
      strike: z.number().positive(),
      expiration: z.string(),
      quantity: z.number().int().positive(),
      price: z.number().min(0),
      delta: z.number().optional(),
    })
  ),
  underlyingPrice: z.number().positive(),
  priceRange: z
    .object({
      min: z.number(),
      max: z.number(),
    })
    .optional(),
  daysToExpiration: z.number().int().min(0).optional(),
});

// Default trade idea configuration (based on user's rules)
export const DEFAULT_TRADE_CONFIG: TradeIdeaConfig = {
  strategy: "put_credit_spread",
  targetDelta: 30,
  targetDTE: 45,
  spreadWidth: 5,
  takeProfitPercent: 50,
  managementDTE: 21,
};

// Strategy display names
export const STRATEGY_NAMES: Record<OptionStrategy, string> = {
  put_credit_spread: "Put Credit Spread",
  call_credit_spread: "Call Credit Spread",
  iron_condor: "Iron Condor",
  iron_butterfly: "Iron Butterfly",
  long_call: "Long Call",
  long_put: "Long Put",
  covered_call: "Covered Call",
  cash_secured_put: "Cash Secured Put",
  straddle: "Straddle",
  strangle: "Strangle",
};
