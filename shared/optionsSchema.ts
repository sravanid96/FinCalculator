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

// RSI zone classification for confidence boost
export type RSIZone = "overbought" | "oversold" | "neutral";

export interface RSIAnalysis {
  value: number;
  zone: RSIZone;
  confidenceBoost: number; // -20 to +20 based on zone alignment with strategy
  signal: string; // Human-readable signal description
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
  rsiAnalysis?: RSIAnalysis; // RSI-based confidence analysis
  /** Snapshot at watchlist save — used for self-improving outcome analysis. */
  watchlistContext?: WatchlistContextSnapshot;
}

/** Context captured when an idea is saved to the watchlist (for learning from settlements). */
export interface WatchlistContextSnapshot {
  capturedAt: string;
  strategy: OptionStrategy;
  recommendation: TradeIdea["recommendation"];
  hasEarningsRisk: boolean;
  earningsDate?: string;
  probabilityOfProfit: number;
  daysToExpiration: number;
  pillarScores?: PillarScores;
  technical?: Pick<TechnicalIndicators, "rsi" | "trend" | "ivRank">;
  historicalEdge?: BacktestSymbolResult["historicalEdge"];
  backtestWinRate?: number;
  quotePe?: number;
  sector?: string;
  /** Fundamentals captured at save time (fractions unless noted) — revenue/profit growth + moat proxies. */
  fundamentals?: {
    revenueGrowthYoy?: number | null; // fraction, e.g. 0.15 = 15%
    roic?: number | null; // fraction — moat / capital efficiency proxy
    fcfMargin?: number | null; // fraction
    netDebtToEbitda?: number | null; // ratio — leverage
    epsQoqGrowth?: number | null; // fraction — profit growth
    grossMarginDeltaPp?: number | null; // percentage points (latest - prior)
    recommendationMean?: number | null; // 1=Strong Buy ... 5=Sell
  };
}

/** One point in the running re-evaluation, recomputed as each trade settles. */
export interface WatchlistEvaluationPoint {
  atSettled: number; // cumulative settled win/loss trades at this point
  date: string; // settle date (YYYY-MM-DD) of the trade producing this point
  actualWinRatePct: number;
  predictedWinRatePctLearned: number;
  brierLearned: number;
  brierBaseRate: number;
  brierImprovementVsBaseRate: number; // >0 means learned beating base-rate so far
}

/** Out-of-sample (walk-forward) evaluation of whether the self-improving model
 *  predicts win rate more accurately than naive baselines. */
export interface WatchlistEvaluationReport {
  /** Trades scored out-of-sample (time-ordered, predicted from prior trades only). */
  evaluated: number;
  /** Subset where the learned model actually moved the prediction (multiplier ≠ 1). */
  adjustedCount: number;
  minRequired: number;
  ready: boolean;
  breakevensExcluded: number;

  actualWinRatePct: number;
  predictedWinRatePctPop: number | null; // mean stated POP
  predictedWinRatePctLearned: number; // mean learned probability

  // Brier score: mean squared error of probability vs outcome. Lower = more accurate.
  brierPop: number | null;
  brierBaseRate: number;
  brierLearned: number;
  brierImprovementVsBaseRate: number; // baseRate - learned (positive = learned better)
  brierImprovementVsPop: number | null;

  // Discrimination: does the prediction rank winners above losers? 0.5 = coin flip.
  aucPop: number | null;
  aucLearned: number | null;

  calibration: { bucket: string; predictedPct: number; actualPct: number; n: number }[];
  /** Realized win rate of above-median vs below-median learned predictions. */
  lift: { highWinRatePct: number | null; lowWinRatePct: number | null; n: number };

  /** Running re-evaluation: one point per settlement, so the trend is visible over time. */
  history: WatchlistEvaluationPoint[];

  verdict: "improving" | "no_evidence" | "degrading" | "not_enough_data";
  notes: string[];
}

/** Per-idea adjustment derived from a user's own settled outcomes. */
export interface LearnedSignal {
  /** Score multiplier in [0.82, 1.18]; 1 = no adjustment. */
  multiplier: number;
  deltaWinRatePct: number | null;
  direction: "favor" | "caution" | "neutral";
  matched: string[];
  note: string;
  suggestedRecommendation?: TradeIdea["recommendation"];
}

export type WatchlistLearningReadiness = "not_enough_data" | "learning" | "calibrated";

export interface WatchlistLearningBucket {
  key: string;
  label: string;
  sampleSize: number;
  winRatePct: number;
  avgPnl: number;
  deltaWinRatePct: number;
  /** Suggested score multiplier when this bucket matches (0.85–1.15). */
  weightMultiplier: number;
}

export interface WatchlistLearningReport {
  readiness: WatchlistLearningReadiness;
  settledCount: number;
  baselineWinRatePct: number;
  baselineAvgPnl: number;
  buckets: WatchlistLearningBucket[];
  suggestions: string[];
  /** Pillar-level pass rate vs outcomes (when framework scores were captured). */
  pillarInsights: { pillar: string; highWinRatePct: number | null; lowWinRatePct: number | null; n: number }[];
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

// Framework check data
export interface FrameworkCheck {
  id: string;
  label: string;
  passed: boolean;
  pillar: "fundamental" | "technical" | "options" | "macro" | "risk";
  value?: string | number;
  description?: string;
}

// Technical indicators from analysis
export interface TechnicalIndicators {
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  rsi: number | null;
  atr: number | null;
  ivRank: number | null;
  avgVolume: number;
  recentVolume: number;
  trend: "bullish" | "bearish" | "neutral" | "mixed";
  percentFrom52WeekHigh: number | null;
  percentFrom52WeekLow: number | null;
}

// Pillar scores
export interface PillarScores {
  fundamental: { checked: number; total: number; pct: number };
  technical: { checked: number; total: number; pct: number };
  options: { checked: number; total: number; pct: number };
  macro: { checked: number; total: number; pct: number };
  risk: { checked: number; total: number; pct: number };
  overall: number;
}

// Framework analysis result
export interface FrameworkAnalysis {
  indicators: TechnicalIndicators;
  checks: FrameworkCheck[];
  scores: PillarScores;
  suggestions: string[];
}

// Full analysis response
export interface TickerAnalysis {
  quote: StockQuote;
  optionsChain: OptionsChain;
  supportResistance: SupportResistanceLevel[];
  upcomingEarnings: EarningsEvent | null;
  tradeIdeas: TradeIdea[];
  strategyComparisons: StrategyComparison[];
  frameworkAnalysis?: FrameworkAnalysis;
}

// Backtest result for a single simulated trade
export interface BacktestTradeResult {
  entryDate: string; // ISO date when position opened
  exitDate: string; // ISO date when position closed (expiry / target hit / mgmt)
  exitReason: "expiry" | "profit_target" | "dte_management" | "stop_loss";
  daysHeld: number;
  entryPrice: number; // Underlying price at entry
  exitUnderlyingPrice: number; // Underlying price at exit
  shortStrike: number;
  longStrike: number;
  creditReceived: number; // Per share
  maxLoss: number; // Per share
  pnl: number; // Dollar P&L (net, per 1 contract: *100)
  pnlPct: number; // P&L as % of max loss (risk-adjusted)
  isWin: boolean;
  regime: "low_vol" | "normal_vol" | "high_vol"; // Based on 20d realized vol at entry
  nearEarnings: boolean; // True if earnings date fell within holding window
}

// Aggregated stats for one symbol + strategy combo
export interface BacktestSymbolResult {
  symbol: string;
  strategy: OptionStrategy;
  strategyName: string;
  tradesCount: number;
  wins: number;
  losses: number;
  winRate: number; // 0-100
  avgPnl: number; // $ per contract
  totalPnl: number; // $ cumulative
  avgWin: number;
  avgLoss: number;
  maxWin: number;
  maxLoss: number;
  profitFactor: number; // Gross wins / gross losses
  sharpe: number; // Annualized on per-trade returns
  maxDrawdown: number; // $ peak-to-trough on cumulative P&L
  maxDrawdownPct: number; // % of peak cumulative
  // Split by regime
  earningsWinRate: number | null; // win rate on earnings-adjacent trades
  earningsTradeCount: number;
  nonEarningsWinRate: number;
  nonEarningsTradeCount: number;
  highVolWinRate: number | null;
  lowVolWinRate: number | null;
  // Benchmark
  buyHoldReturnPct: number; // Buy & hold over same window for context
  // Recommendation
  historicalEdge: "strong" | "positive" | "flat" | "negative"; // Based on win rate + profit factor
  recommendedConfig: BacktestConfig;
  trades: BacktestTradeResult[]; // Full trade log (may be truncated for payload size)
  startDate: string;
  endDate: string;
  priceAtEnd: number;
}

// Configuration used for a backtest run
export interface BacktestConfig {
  strategy: OptionStrategy;
  dte: number;
  targetDelta: number; // e.g. 30 = 30 delta short strike
  spreadWidth: number; // points
  takeProfitPct: number; // e.g. 50 = close at 50% of max profit
  stopLossMult: number; // e.g. 2 = close if loss reaches 2x credit
  entryFrequencyDays: number; // simulate a new entry every N trading days
}

// Response from /api/options/backtest/top20
export interface BacktestTop20Response {
  generatedAt: string;
  yearsTested: number;
  config: BacktestConfig;
  results: BacktestSymbolResult[];
  summary: {
    totalTrades: number;
    aggregateWinRate: number;
    aggregateAvgPnl: number;
    aggregateTotalPnl: number;
    symbolsWithPositiveEdge: number;
    symbolsWithNegativeEdge: number;
    benchmarkSpyReturnPct: number | null;
  };
  methodology: string[]; // Bullet list of caveats shown to user
}

// Aggregated (multi-ticker) trade ideas for the "most active" list
export interface TopOptionTradeIdea {
  symbol: string;
  name: string;
  price: number;
  changePercent: number;
  volume: number;
  updatedAt: string; // ISO timestamp
  idea: TradeIdea;
  score: number; // 0-100
  liquidityScore: number; // 0-100 (heuristic from volume/OI)
  reasons: string[];
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
