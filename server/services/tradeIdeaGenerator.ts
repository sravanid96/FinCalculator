import type {
  OptionsChain,
  OptionsExpiration,
  OptionContract,
  TradeIdea,
  TradeLeg,
  TradeIdeaConfig,
  OptionStrategy,
  StrategyComparison,
  EarningsEvent,
  StockQuote,
} from "../../shared/optionsSchema";
import { DEFAULT_TRADE_CONFIG, STRATEGY_NAMES } from "../../shared/optionsSchema";
import {
  calculatePL,
  calculateProbabilityOfProfit,
  calculateRiskReward,
} from "./optionsCalculator";
import { hasEarningsWithinWindow } from "./earningsService";

// Generate a unique ID for trade ideas
function generateId(): string {
  return `trade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Find the expiration closest to target DTE
function findTargetExpiration(
  expirations: OptionsExpiration[],
  targetDTE: number
): OptionsExpiration | null {
  if (expirations.length === 0) return null;

  // Find expiration closest to target DTE
  let closest = expirations[0];
  let minDiff = Math.abs(expirations[0].daysToExpiration - targetDTE);

  for (const exp of expirations) {
    const diff = Math.abs(exp.daysToExpiration - targetDTE);
    if (diff < minDiff) {
      minDiff = diff;
      closest = exp;
    }
  }

  return closest;
}

// Find option with delta closest to target
function findOptionByDelta(
  options: OptionContract[],
  targetDelta: number,
  type: "call" | "put"
): OptionContract | null {
  if (options.length === 0) return null;

  // For puts, delta is negative, so we compare absolute values
  const target = type === "put" ? -Math.abs(targetDelta) / 100 : Math.abs(targetDelta) / 100;

  let closest = options[0];
  let minDiff = Math.abs((options[0].delta || 0) - target);

  for (const opt of options) {
    const diff = Math.abs((opt.delta || 0) - target);
    if (diff < minDiff) {
      minDiff = diff;
      closest = opt;
    }
  }

  return closest;
}

// Find option by strike price
function findOptionByStrike(
  options: OptionContract[],
  strike: number
): OptionContract | null {
  return options.find((o) => o.strike === strike) || null;
}

function findNearestStrike(
  options: OptionContract[],
  targetStrike: number,
  direction: "below" | "above"
): OptionContract | null {
  if (!options.length) return null;

  const sorted = [...options].sort((a, b) => a.strike - b.strike);
  if (direction === "below") {
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (sorted[i].strike <= targetStrike) return sorted[i];
    }
    return sorted[0] || null;
  }

  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].strike >= targetStrike) return sorted[i];
  }
  return sorted[sorted.length - 1] || null;
}

// Generate Put Credit Spread trade idea
function generatePutCreditSpread(
  chain: OptionsChain,
  config: TradeIdeaConfig,
  earnings: EarningsEvent | null
): TradeIdea | null {
  const expiration = findTargetExpiration(chain.expirations, config.targetDTE);
  if (!expiration) return null;

  // Find short put (sell) at target delta
  const shortPut = findOptionByDelta(expiration.puts, config.targetDelta, "put");
  if (!shortPut) return null;

  // Find long put (buy) at spread width below short
  const longStrike = shortPut.strike - config.spreadWidth;
  const longPut =
    findOptionByStrike(expiration.puts, longStrike) ??
    findNearestStrike(expiration.puts, longStrike, "below");
  if (!longPut) return null;

  // Use mid price for calculations
  const shortPrice = (shortPut.bid + shortPut.ask) / 2;
  const longPrice = (longPut.bid + longPut.ask) / 2;
  const netCredit = shortPrice - longPrice;

  if (netCredit <= 0) return null;

  const legs: TradeLeg[] = [
    {
      type: "put",
      action: "sell",
      strike: shortPut.strike,
      expiration: expiration.expirationDate,
      quantity: 1,
      price: shortPrice,
      delta: shortPut.delta,
    },
    {
      type: "put",
      action: "buy",
      strike: longPut.strike,
      expiration: expiration.expirationDate,
      quantity: 1,
      price: longPrice,
      delta: longPut.delta,
    },
  ];

  const maxProfit = netCredit * 100;
  const maxLoss = (config.spreadWidth - netCredit) * 100;
  const breakeven = [shortPut.strike - netCredit];

  const plResult = calculatePL(
    legs,
    chain.underlyingPrice,
    { min: longPut.strike - 5, max: shortPut.strike + 10 },
    expiration.daysToExpiration
  );

  const pop = calculateProbabilityOfProfit("put_credit_spread", legs, breakeven);
  const riskReward = calculateRiskReward(maxProfit, maxLoss);
  const hasEarnings = hasEarningsWithinWindow(earnings, expiration.daysToExpiration);

  const notes: string[] = [
    `Collect $${netCredit.toFixed(2)} credit per spread`,
    `Take profit at $${(netCredit * 0.5).toFixed(2)} (50% of max)`,
    `Manage position at 21 DTE`,
  ];

  if (hasEarnings && earnings) {
    notes.push(`⚠️ Earnings on ${earnings.reportDate} - consider closing before`);
  }

  const recommendation = getRecommendation(pop, riskReward, hasEarnings);

  return {
    id: generateId(),
    symbol: chain.symbol,
    strategy: "put_credit_spread",
    strategyName: STRATEGY_NAMES.put_credit_spread,
    legs,
    entryPrice: netCredit,
    maxProfit,
    maxLoss,
    breakeven,
    probabilityOfProfit: pop,
    riskRewardRatio: riskReward,
    daysToExpiration: expiration.daysToExpiration,
    expirationDate: expiration.expirationDate,
    underlyingPrice: chain.underlyingPrice,
    hasEarningsRisk: hasEarnings,
    earningsDate: earnings?.reportDate,
    recommendation,
    notes,
  };
}

// Generate Call Credit Spread trade idea
function generateCallCreditSpread(
  chain: OptionsChain,
  config: TradeIdeaConfig,
  earnings: EarningsEvent | null
): TradeIdea | null {
  const expiration = findTargetExpiration(chain.expirations, config.targetDTE);
  if (!expiration) return null;

  // Find short call (sell) at target delta
  const shortCall = findOptionByDelta(expiration.calls, config.targetDelta, "call");
  if (!shortCall) return null;

  // Find long call (buy) at spread width above short
  const longStrike = shortCall.strike + config.spreadWidth;
  const longCall =
    findOptionByStrike(expiration.calls, longStrike) ??
    findNearestStrike(expiration.calls, longStrike, "above");
  if (!longCall) return null;

  const shortPrice = (shortCall.bid + shortCall.ask) / 2;
  const longPrice = (longCall.bid + longCall.ask) / 2;
  const netCredit = shortPrice - longPrice;

  if (netCredit <= 0) return null;

  const legs: TradeLeg[] = [
    {
      type: "call",
      action: "sell",
      strike: shortCall.strike,
      expiration: expiration.expirationDate,
      quantity: 1,
      price: shortPrice,
      delta: shortCall.delta,
    },
    {
      type: "call",
      action: "buy",
      strike: longCall.strike,
      expiration: expiration.expirationDate,
      quantity: 1,
      price: longPrice,
      delta: longCall.delta,
    },
  ];

  const maxProfit = netCredit * 100;
  const maxLoss = (config.spreadWidth - netCredit) * 100;
  const breakeven = [shortCall.strike + netCredit];

  const pop = calculateProbabilityOfProfit("call_credit_spread", legs, breakeven);
  const riskReward = calculateRiskReward(maxProfit, maxLoss);
  const hasEarnings = hasEarningsWithinWindow(earnings, expiration.daysToExpiration);

  const notes: string[] = [
    `Collect $${netCredit.toFixed(2)} credit per spread`,
    `Take profit at $${(netCredit * 0.5).toFixed(2)} (50% of max)`,
    `Manage position at 21 DTE`,
  ];

  if (hasEarnings && earnings) {
    notes.push(`⚠️ Earnings on ${earnings.reportDate} - consider closing before`);
  }

  return {
    id: generateId(),
    symbol: chain.symbol,
    strategy: "call_credit_spread",
    strategyName: STRATEGY_NAMES.call_credit_spread,
    legs,
    entryPrice: netCredit,
    maxProfit,
    maxLoss,
    breakeven,
    probabilityOfProfit: pop,
    riskRewardRatio: riskReward,
    daysToExpiration: expiration.daysToExpiration,
    expirationDate: expiration.expirationDate,
    underlyingPrice: chain.underlyingPrice,
    hasEarningsRisk: hasEarnings,
    earningsDate: earnings?.reportDate,
    recommendation: getRecommendation(pop, riskReward, hasEarnings),
    notes,
  };
}

// Generate Iron Condor trade idea
function generateIronCondor(
  chain: OptionsChain,
  config: TradeIdeaConfig,
  earnings: EarningsEvent | null
): TradeIdea | null {
  const expiration = findTargetExpiration(chain.expirations, config.targetDTE);
  if (!expiration) return null;

  // Short put at 30 delta
  const shortPut = findOptionByDelta(expiration.puts, config.targetDelta, "put");
  // Short call at 30 delta
  const shortCall = findOptionByDelta(expiration.calls, config.targetDelta, "call");

  if (!shortPut || !shortCall) return null;

  // Long legs
  const longPutStrike = shortPut.strike - config.spreadWidth;
  const longCallStrike = shortCall.strike + config.spreadWidth;
  const longPut =
    findOptionByStrike(expiration.puts, longPutStrike) ??
    findNearestStrike(expiration.puts, longPutStrike, "below");
  const longCall =
    findOptionByStrike(expiration.calls, longCallStrike) ??
    findNearestStrike(expiration.calls, longCallStrike, "above");

  if (!longPut || !longCall) return null;

  const shortPutPrice = (shortPut.bid + shortPut.ask) / 2;
  const longPutPrice = (longPut.bid + longPut.ask) / 2;
  const shortCallPrice = (shortCall.bid + shortCall.ask) / 2;
  const longCallPrice = (longCall.bid + longCall.ask) / 2;

  const netCredit = shortPutPrice - longPutPrice + shortCallPrice - longCallPrice;

  if (netCredit <= 0) return null;

  const legs: TradeLeg[] = [
    {
      type: "put",
      action: "buy",
      strike: longPut.strike,
      expiration: expiration.expirationDate,
      quantity: 1,
      price: longPutPrice,
      delta: longPut.delta,
    },
    {
      type: "put",
      action: "sell",
      strike: shortPut.strike,
      expiration: expiration.expirationDate,
      quantity: 1,
      price: shortPutPrice,
      delta: shortPut.delta,
    },
    {
      type: "call",
      action: "sell",
      strike: shortCall.strike,
      expiration: expiration.expirationDate,
      quantity: 1,
      price: shortCallPrice,
      delta: shortCall.delta,
    },
    {
      type: "call",
      action: "buy",
      strike: longCall.strike,
      expiration: expiration.expirationDate,
      quantity: 1,
      price: longCallPrice,
      delta: longCall.delta,
    },
  ];

  const maxProfit = netCredit * 100;
  const maxLoss = (config.spreadWidth - netCredit) * 100;
  const breakeven = [shortPut.strike - netCredit, shortCall.strike + netCredit];

  const pop = calculateProbabilityOfProfit("iron_condor", legs, breakeven);
  const riskReward = calculateRiskReward(maxProfit, maxLoss);
  const hasEarnings = hasEarningsWithinWindow(earnings, expiration.daysToExpiration);

  const notes: string[] = [
    `Collect $${netCredit.toFixed(2)} credit per iron condor`,
    `Profit zone: $${shortPut.strike.toFixed(0)} - $${shortCall.strike.toFixed(0)}`,
    `Take profit at 50% of max`,
  ];

  if (hasEarnings && earnings) {
    notes.push(`⚠️ Earnings on ${earnings.reportDate} - high risk!`);
  }

  return {
    id: generateId(),
    symbol: chain.symbol,
    strategy: "iron_condor",
    strategyName: STRATEGY_NAMES.iron_condor,
    legs,
    entryPrice: netCredit,
    maxProfit,
    maxLoss,
    breakeven,
    probabilityOfProfit: pop,
    riskRewardRatio: riskReward,
    daysToExpiration: expiration.daysToExpiration,
    expirationDate: expiration.expirationDate,
    underlyingPrice: chain.underlyingPrice,
    hasEarningsRisk: hasEarnings,
    earningsDate: earnings?.reportDate,
    recommendation: getRecommendation(pop, riskReward, hasEarnings),
    notes,
  };
}

// Get recommendation based on metrics
function getRecommendation(
  pop: number,
  riskReward: number,
  hasEarnings: boolean
): "strong_buy" | "buy" | "neutral" | "avoid" {
  if (hasEarnings) return "avoid";
  if (pop >= 70 && riskReward >= 0.3) return "strong_buy";
  if (pop >= 60 && riskReward >= 0.2) return "buy";
  if (pop >= 50) return "neutral";
  return "avoid";
}

// Main function to generate trade ideas
export function generateTradeIdeas(
  chain: OptionsChain,
  earnings: EarningsEvent | null,
  config: TradeIdeaConfig = DEFAULT_TRADE_CONFIG
): TradeIdea[] {
  const ideas: TradeIdea[] = [];

  // Generate primary strategy (put credit spread based on user's rules)
  const putSpread = generatePutCreditSpread(chain, config, earnings);
  if (putSpread) ideas.push(putSpread);

  // Generate alternative strategies
  const callSpread = generateCallCreditSpread(chain, config, earnings);
  if (callSpread) ideas.push(callSpread);

  const ironCondor = generateIronCondor(chain, config, earnings);
  if (ironCondor) ideas.push(ironCondor);

  // Sort by recommendation quality
  const recommendationOrder = { strong_buy: 0, buy: 1, neutral: 2, avoid: 3 };
  ideas.sort(
    (a, b) => recommendationOrder[a.recommendation] - recommendationOrder[b.recommendation]
  );

  return ideas;
}

// Generate strategy comparison
export function generateStrategyComparison(
  chain: OptionsChain,
  earnings: EarningsEvent | null,
  quote: StockQuote
): StrategyComparison[] {
  const config = DEFAULT_TRADE_CONFIG;
  const comparisons: StrategyComparison[] = [];

  // Put Credit Spread
  const putSpread = generatePutCreditSpread(chain, config, earnings);
  if (putSpread) {
    comparisons.push({
      strategy: "put_credit_spread",
      strategyName: STRATEGY_NAMES.put_credit_spread,
      maxProfit: putSpread.maxProfit,
      maxLoss: putSpread.maxLoss,
      probabilityOfProfit: putSpread.probabilityOfProfit,
      riskRewardRatio: putSpread.riskRewardRatio,
      breakeven: putSpread.breakeven,
      capitalRequired: putSpread.maxLoss,
      recommendation: putSpread.recommendation,
      pros: [
        "Defined risk",
        "Benefits from time decay",
        "High probability of profit",
        "Works in neutral to bullish markets",
      ],
      cons: [
        "Limited profit potential",
        "Requires margin",
        "Early assignment risk",
      ],
    });
  }

  // Call Credit Spread
  const callSpread = generateCallCreditSpread(chain, config, earnings);
  if (callSpread) {
    comparisons.push({
      strategy: "call_credit_spread",
      strategyName: STRATEGY_NAMES.call_credit_spread,
      maxProfit: callSpread.maxProfit,
      maxLoss: callSpread.maxLoss,
      probabilityOfProfit: callSpread.probabilityOfProfit,
      riskRewardRatio: callSpread.riskRewardRatio,
      breakeven: callSpread.breakeven,
      capitalRequired: callSpread.maxLoss,
      recommendation: callSpread.recommendation,
      pros: [
        "Defined risk",
        "Benefits from time decay",
        "Works in neutral to bearish markets",
      ],
      cons: [
        "Limited profit potential",
        "Requires margin",
        "Early assignment risk",
      ],
    });
  }

  // Iron Condor
  const ironCondor = generateIronCondor(chain, config, earnings);
  if (ironCondor) {
    comparisons.push({
      strategy: "iron_condor",
      strategyName: STRATEGY_NAMES.iron_condor,
      maxProfit: ironCondor.maxProfit,
      maxLoss: ironCondor.maxLoss,
      probabilityOfProfit: ironCondor.probabilityOfProfit,
      riskRewardRatio: ironCondor.riskRewardRatio,
      breakeven: ironCondor.breakeven,
      capitalRequired: ironCondor.maxLoss,
      recommendation: ironCondor.recommendation,
      pros: [
        "Higher credit received",
        "Wide profit zone",
        "Benefits from low volatility",
        "Defined risk on both sides",
      ],
      cons: [
        "Two-sided risk",
        "More complex to manage",
        "Higher commission costs",
      ],
    });
  }

  // Cash Secured Put
  const expiration = findTargetExpiration(chain.expirations, config.targetDTE);
  if (expiration) {
    const cspPut = findOptionByDelta(expiration.puts, config.targetDelta, "put");
    if (cspPut) {
      const premium = (cspPut.bid + cspPut.ask) / 2;
      const capitalRequired = cspPut.strike * 100;
      const maxProfit = premium * 100;
      const returnOnCapital = (maxProfit / capitalRequired) * 100;

      comparisons.push({
        strategy: "cash_secured_put",
        strategyName: STRATEGY_NAMES.cash_secured_put,
        maxProfit,
        maxLoss: capitalRequired - maxProfit,
        probabilityOfProfit: Math.round((1 - Math.abs(cspPut.delta || 0.3)) * 100),
        riskRewardRatio: maxProfit / (capitalRequired - maxProfit),
        breakeven: [cspPut.strike - premium],
        capitalRequired,
        recommendation: getRecommendation(
          Math.round((1 - Math.abs(cspPut.delta || 0.3)) * 100),
          maxProfit / (capitalRequired - maxProfit),
          hasEarningsWithinWindow(earnings, expiration.daysToExpiration)
        ),
        pros: [
          "Simple strategy",
          "Get paid to buy stock at lower price",
          `${returnOnCapital.toFixed(1)}% return on capital`,
          "No margin required (cash secured)",
        ],
        cons: [
          "High capital requirement",
          "Unlimited downside risk",
          "Opportunity cost of capital",
        ],
      });
    }
  }

  return comparisons;
}
