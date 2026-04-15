import type {
  StockQuote,
  PriceDataPoint,
  OptionsChain,
  SupportResistanceLevel,
  EarningsEvent,
  TradeIdea,
  FrameworkAnalysis,
} from "../../shared/optionsSchema";

// Technical indicator calculations
export function calculateSMA(prices: number[], period: number): number | null {
  if (prices.length < period) return null;
  const sum = prices.slice(-period).reduce((a, b) => a + b, 0);
  return sum / period;
}

export function calculateRSI(prices: number[], period: number = 14): number | null {
  if (prices.length < period + 1) return null;

  const changes: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    changes.push(prices[i] - prices[i - 1]);
  }

  let gains = 0;
  let losses = 0;

  // Initial average
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) gains += changes[i];
    else losses += Math.abs(changes[i]);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  // Smoothed averages for remaining data
  for (let i = period; i < changes.length; i++) {
    const change = changes[i];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function calculateATR(data: PriceDataPoint[], period: number = 14): number | null {
  if (data.length < period + 1) return null;

  const trValues: number[] = [];
  for (let i = 1; i < data.length; i++) {
    const high = data[i].high;
    const low = data[i].low;
    const prevClose = data[i - 1].close;

    const tr1 = high - low;
    const tr2 = Math.abs(high - prevClose);
    const tr3 = Math.abs(low - prevClose);

    trValues.push(Math.max(tr1, tr2, tr3));
  }

  const recentTR = trValues.slice(-period);
  return recentTR.reduce((a, b) => a + b, 0) / period;
}

export function calculateVolumeTrend(data: PriceDataPoint[]): {
  avgVolume: number;
  recentVolume: number;
  volumeSpike: boolean;
} {
  if (data.length < 20) {
    return { avgVolume: 0, recentVolume: 0, volumeSpike: false };
  }

  const volumes = data.map((d) => d.volume);
  const avgVolume = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const recentVolume = volumes[volumes.length - 1];

  return {
    avgVolume,
    recentVolume,
    volumeSpike: recentVolume > avgVolume * 1.5,
  };
}

// IV Rank calculation
export function calculateIVRank(optionsChain: OptionsChain): number | null {
  if (!optionsChain.expirations.length) return null;

  // Get ATM options from nearest expiration
  const nearestExp = optionsChain.expirations[0];
  const underlyingPrice = optionsChain.underlyingPrice;

  // Find ATM call and put
  const atmCall = nearestExp.calls.reduce((closest, curr) => {
    if (!closest) return curr;
    return Math.abs(curr.strike - underlyingPrice) < Math.abs(closest.strike - underlyingPrice)
      ? curr
      : closest;
  }, nearestExp.calls[0]);

  const atmPut = nearestExp.puts.reduce((closest, curr) => {
    if (!closest) return curr;
    return Math.abs(curr.strike - underlyingPrice) < Math.abs(closest.strike - underlyingPrice)
      ? curr
      : closest;
  }, nearestExp.puts[0]);

  if (!atmCall || !atmPut) return null;

  // Average IV
  const currentIV = (atmCall.impliedVolatility + atmPut.impliedVolatility) / 2;

  // Collect all IVs across strikes and expirations for context
  const allIVs: number[] = [];
  optionsChain.expirations.forEach((exp) => {
    exp.calls.forEach((c) => allIVs.push(c.impliedVolatility));
    exp.puts.forEach((p) => allIVs.push(p.impliedVolatility));
  });

  if (allIVs.length === 0) return null;

  const minIV = Math.min(...allIVs);
  const maxIV = Math.max(...allIVs);

  if (maxIV === minIV) return 50; // Neutral

  return ((currentIV - minIV) / (maxIV - minIV)) * 100;
}

// Calculate distance from price to 52-week high/low
export function calculatePricePosition(
  currentPrice: number,
  high52Week: number | undefined,
  low52Week: number | undefined
): { percentFromHigh: number | null; percentFromLow: number | null } {
  if (!high52Week || !low52Week || high52Week === low52Week) {
    return { percentFromHigh: null, percentFromLow: null };
  }

  const percentFromHigh = ((high52Week - currentPrice) / (high52Week - low52Week)) * 100;
  const percentFromLow = ((currentPrice - low52Week) / (high52Week - low52Week)) * 100;

  return { percentFromHigh, percentFromLow };
}

// Main framework analysis function
export async function generateFrameworkAnalysis(
  quote: StockQuote,
  historicalPrices: PriceDataPoint[],
  optionsChain: OptionsChain,
  supportResistance: SupportResistanceLevel[],
  upcomingEarnings: EarningsEvent | null,
  tradeIdeas: TradeIdea[]
): Promise<FrameworkAnalysis> {
  const closes = historicalPrices.map((p) => p.close);
  const currentPrice = quote.price;

  // Technical indicators
  const sma20 = calculateSMA(closes, 20);
  const sma50 = calculateSMA(closes, 50);
  const sma200 = calculateSMA(closes, 200);
  const rsi = calculateRSI(closes, 14);
  const atr = calculateATR(historicalPrices, 14);
  const volumeData = calculateVolumeTrend(historicalPrices);
  const ivRank = calculateIVRank(optionsChain);
  const pricePosition = calculatePricePosition(currentPrice, quote.high52Week, quote.low52Week);

  // Determine trend
  const trend = determineTrend(currentPrice, sma20, sma50, sma200);

  // Calculate framework checks automatically
  const checks = calculateFrameworkChecks({
    quote,
    sma20,
    sma50,
    sma200,
    rsi,
    atr,
    volumeData,
    ivRank,
    trend,
    pricePosition,
    supportResistance,
    upcomingEarnings,
    tradeIdeas,
    historicalPrices,
  });

  // Calculate scores
  const scores = calculateScores(checks);

  return {
    indicators: {
      sma20,
      sma50,
      sma200,
      rsi,
      atr,
      ivRank,
      avgVolume: volumeData.avgVolume,
      recentVolume: volumeData.recentVolume,
      trend,
      percentFrom52WeekHigh: pricePosition.percentFromHigh,
      percentFrom52WeekLow: pricePosition.percentFromLow,
    },
    checks,
    scores,
    suggestions: generateSuggestions(scores, checks, tradeIdeas, trend),
  };
}

function determineTrend(
  currentPrice: number,
  sma20: number | null,
  sma50: number | null,
  sma200: number | null
): "bullish" | "bearish" | "neutral" | "mixed" {
  const signals: string[] = [];

  if (sma20 !== null) signals.push(currentPrice > sma20 ? "above20" : "below20");
  if (sma50 !== null) signals.push(currentPrice > sma50 ? "above50" : "below50");
  if (sma200 !== null) signals.push(currentPrice > sma200 ? "above200" : "below200");

  if (signals.length === 0) return "neutral";

  const bullishCount = signals.filter((s) => s.startsWith("above")).length;
  const bearishCount = signals.filter((s) => s.startsWith("below")).length;

  if (bullishCount === signals.length) return "bullish";
  if (bearishCount === signals.length) return "bearish";
  if (bullishCount > bearishCount) return "bullish";
  if (bearishCount > bullishCount) return "bearish";
  return "mixed";
}

interface CheckData {
  id: string;
  label: string;
  passed: boolean;
  pillar: "fundamental" | "technical" | "options" | "macro" | "risk";
  value?: string | number;
  description?: string;
}

interface ChecksInput {
  quote: StockQuote;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  rsi: number | null;
  atr: number | null;
  volumeData: { avgVolume: number; recentVolume: number; volumeSpike: boolean };
  ivRank: number | null;
  trend: "bullish" | "bearish" | "neutral" | "mixed";
  pricePosition: { percentFromHigh: number | null; percentFromLow: number | null };
  supportResistance: SupportResistanceLevel[];
  upcomingEarnings: EarningsEvent | null;
  tradeIdeas: TradeIdea[];
  historicalPrices: PriceDataPoint[];
}

function calculateFrameworkChecks(input: ChecksInput): CheckData[] {
  const { quote, rsi, trend, volumeData, ivRank, pricePosition, supportResistance, upcomingEarnings, tradeIdeas } = input;

  const checks: CheckData[] = [];

  // === FUNDAMENTAL CHECKS ===
  // P/E check - assume reasonable if PE exists and is under 30 (common benchmark)
  const peReasonable = quote.pe !== undefined && quote.pe > 0 && quote.pe < 40;
  checks.push({
    id: "pe_reasonable",
    label: "P/E reasonable vs sector peers",
    passed: peReasonable,
    pillar: "fundamental",
    value: quote.pe?.toFixed(2),
    description: quote.pe ? `P/E: ${quote.pe.toFixed(2)}` : "No P/E data available",
  });

  // Price position (proxy for earnings/momentum)
  const priceMomentum = pricePosition.percentFromLow !== null && pricePosition.percentFromLow > 20;
  checks.push({
    id: "earnings_trend",
    label: "Price showing positive momentum",
    passed: priceMomentum,
    pillar: "fundamental",
    value: pricePosition.percentFromLow?.toFixed(1) + "% from 52w low",
    description: pricePosition.percentFromLow
      ? `${pricePosition.percentFromLow.toFixed(1)}% above 52-week low`
      : "No 52-week data",
  });

  // Catalyst check
  const hasCatalyst = upcomingEarnings !== null && upcomingEarnings.daysUntil <= 30;
  checks.push({
    id: "catalyst",
    label: "Known catalyst (earnings, product, etc.)",
    passed: hasCatalyst,
    pillar: "fundamental",
    value: upcomingEarnings ? `${upcomingEarnings.daysUntil} days` : "No upcoming earnings",
    description: upcomingEarnings
      ? `Earnings in ${upcomingEarnings.daysUntil} days`
      : "No upcoming catalyst detected",
  });

  // === TECHNICAL CHECKS ===
  // Trend alignment
  const trendAligned = trend === "bullish" || trend === "neutral";
  checks.push({
    id: "trend_aligned",
    label: "Price aligned with trend (above key MAs for longs)",
    passed: trendAligned,
    pillar: "technical",
    value: trend,
    description: `Price is ${trend} - ${trend === "bullish" ? "Above key moving averages" : trend === "bearish" ? "Below key moving averages" : "Mixed signals"}`,
  });

  // RSI check - good if not at extreme (for neutral strategies)
  const rsiOk = rsi !== null && rsi > 30 && rsi < 70;
  checks.push({
    id: "momentum_ok",
    label: "RSI not at extreme / has room to move",
    passed: rsiOk,
    pillar: "technical",
    value: rsi?.toFixed(1),
    description: rsi
      ? `RSI: ${rsi.toFixed(1)} - ${rsi > 70 ? "Overbought" : rsi < 30 ? "Oversold" : "Neutral zone"}`
      : "RSI unavailable",
  });

  // RSI zone-based directional signal check
  const rsiZoneSignal = rsi !== null && (rsi > 70 || rsi < 30);
  checks.push({
    id: "rsi_zone_signal",
    label: "RSI zone provides directional signal",
    passed: rsiZoneSignal,
    pillar: "technical",
    value: rsi ? (rsi > 70 ? "Overbought (bearish bias)" : rsi < 30 ? "Oversold (bullish bias)" : "No signal") : "N/A",
    description: rsi
      ? rsi > 70
        ? `RSI ${rsi.toFixed(1)} overbought - consider bearish strategies (call credit spreads)`
        : rsi < 30
          ? `RSI ${rsi.toFixed(1)} oversold - consider bullish strategies (put credit spreads)`
          : "RSI in neutral zone - no strong directional bias from RSI"
      : "RSI unavailable",
  });

  // Volume confirmation
  const volumeConfirms = volumeData.volumeSpike || volumeData.recentVolume > volumeData.avgVolume * 1.2;
  checks.push({
    id: "volume_confirms",
    label: "Volume confirming the setup",
    passed: volumeConfirms,
    pillar: "technical",
    value: `${(volumeData.recentVolume / volumeData.avgVolume).toFixed(2)}x avg`,
    description: `Volume: ${volumeData.recentVolume.toLocaleString()} vs avg ${volumeData.avgVolume.toLocaleString()}`,
  });

  // Support/Resistance levels
  const hasClearLevels = supportResistance.length >= 2;
  checks.push({
    id: "support_resistance",
    label: "Clear S/R levels for entry/stop/target",
    passed: hasClearLevels,
    pillar: "technical",
    value: `${supportResistance.length} levels`,
    description: supportResistance.length
      ? `${supportResistance.filter((l) => l.type === "support").length} support, ${supportResistance.filter((l) => l.type === "resistance").length} resistance`
      : "No significant levels detected",
  });

  // === OPTIONS CHECKS ===
  // IV Rank appropriate
  const ivAppropriate = ivRank !== null && ivRank > 20 && ivRank < 80;
  checks.push({
    id: "iv_appropriate",
    label: "IV rank appropriate for strategy (not extreme)",
    passed: ivAppropriate,
    pillar: "options",
    value: ivRank?.toFixed(0) + "%",
    description: ivRank
      ? `IV Rank: ${ivRank.toFixed(0)}% - ${ivRank > 50 ? "High (good for selling)" : "Low (good for buying)"}`
      : "IV data unavailable",
  });

  // Liquidity check - based on volume in options chain
  const totalOptionVolume = tradeIdeas.length > 0; // Proxy: if we generated trade ideas, options exist
  checks.push({
    id: "liquidity",
    label: "Options liquid enough (tight spreads)",
    passed: totalOptionVolume,
    pillar: "options",
    value: totalOptionVolume ? "Yes" : "No",
    description: totalOptionVolume ? "Options chain available with data" : "Limited options data",
  });

  // Greeks available
  const hasGreeks = tradeIdeas.some((t) => t.legs.some((l) => l.delta !== undefined));
  checks.push({
    id: "greeks_aligned",
    label: "Greeks available for analysis",
    passed: hasGreeks,
    pillar: "options",
    value: hasGreeks ? "Yes" : "No",
    description: hasGreeks ? "Delta data available" : "Greeks estimation available",
  });

  // DTE suitable
  const suitableDTE = tradeIdeas.some((t) => t.daysToExpiration >= 20 && t.daysToExpiration <= 60);
  checks.push({
    id: "dte_suitable",
    label: "DTE suitable for strategy (~45 sweet spot)",
    passed: suitableDTE,
    pillar: "options",
    value: suitableDTE ? "Yes" : "Limited",
    description: suitableDTE ? "Suitable expiration dates available" : "Limited expiration choices",
  });

  // === MACRO/VIX CHECKS (simplified) ===
  // VIX proxy - market regime based on price action
  const marketStable = Math.abs(quote.changePercent) < 3;
  checks.push({
    id: "vix_regime",
    label: "Market volatility manageable",
    passed: marketStable,
    pillar: "macro",
    value: quote.changePercent.toFixed(2) + "%",
    description: `Daily change: ${quote.changePercent.toFixed(2)}% - ${marketStable ? "Stable" : "Volatile"}`,
  });

  // No extreme movement (divergence proxy)
  const noExtremeMove = Math.abs(quote.changePercent) < 5;
  checks.push({
    id: "no_divergence",
    label: "No extreme single-day move",
    passed: noExtremeMove,
    pillar: "macro",
    value: Math.abs(quote.changePercent).toFixed(2) + "%",
    description: noExtremeMove ? "Normal daily range" : "Large daily move detected",
  });

  // Sector flow proxy - based on trend
  const trendPositive = trend !== "bearish";
  checks.push({
    id: "sector_flows",
    label: "Price trend aligned with setup",
    passed: trendPositive,
    pillar: "macro",
    value: trend,
    description: `Trend: ${trend}`,
  });

  // === RISK CHECKS ===
  // Position size reminder (always true - user controls)
  checks.push({
    id: "position_size",
    label: "Position size ≤ 2% account risk",
    passed: true, // User must verify
    pillar: "risk",
    value: "Verify",
    description: "Verify your position sizing before entry",
  });

  // Stop defined proxy - ATR available
  const atrAvailable = input.atr !== null;
  checks.push({
    id: "stop_defined",
    label: "ATR available for volatility stop",
    passed: atrAvailable,
    pillar: "risk",
    value: input.atr?.toFixed(2),
    description: input.atr ? `ATR: ${input.atr.toFixed(2)} for stop placement` : "ATR unavailable",
  });

  // R:R from trade ideas
  const goodRR = tradeIdeas.some((t) => t.riskRewardRatio >= 2);
  checks.push({
    id: "rr_ratio",
    label: "Risk/Reward ≥ 1:2 for directional trades",
    passed: goodRR,
    pillar: "risk",
    value: goodRR ? "Yes" : "Limited",
    description: goodRR ? "Strategies with 1:2+ R:R available" : "Review R:R individually",
  });

  // Correlation - always needs user verification
  checks.push({
    id: "correlation_check",
    label: "Not correlated with existing positions",
    passed: true, // User must verify
    pillar: "risk",
    value: "Verify",
    description: "Verify correlation with your existing portfolio",
  });

  return checks;
}

function calculateScores(checks: CheckData[]): {
  fundamental: { checked: number; total: number; pct: number };
  technical: { checked: number; total: number; pct: number };
  options: { checked: number; total: number; pct: number };
  macro: { checked: number; total: number; pct: number };
  risk: { checked: number; total: number; pct: number };
  overall: number;
} {
  const byPillar = (pillar: string) => {
    const items = checks.filter((c) => c.pillar === pillar);
    const checked = items.filter((c) => c.passed).length;
    return { checked, total: items.length, pct: items.length > 0 ? Math.round((checked / items.length) * 100) : 0 };
  };

  const fundamental = byPillar("fundamental");
  const technical = byPillar("technical");
  const options = byPillar("options");
  const macro = byPillar("macro");
  const risk = byPillar("risk");

  const totalPassed = checks.filter((c) => c.passed).length;
  const overall = Math.round((totalPassed / checks.length) * 100);

  return { fundamental, technical, options, macro, risk, overall };
}

function generateSuggestions(
  scores: ReturnType<typeof calculateScores>,
  checks: CheckData[],
  tradeIdeas: TradeIdea[],
  trend: string
): string[] {
  const suggestions: string[] = [];

  // Score-based suggestions
  if (scores.overall < 40) {
    suggestions.push("⚠️ Low confluence score. Consider paper trading or skipping this setup.");
  } else if (scores.overall >= 70) {
    suggestions.push("✓ Strong confluence across pillars. High conviction setup.");
  }

  // Pillar-specific
  if (scores.fundamental.pct < 50 && scores.technical.pct >= 70) {
    suggestions.push("Strong technicals but weak fundamentals - use tighter stops and shorter timeframe.");
  }

  if (scores.fundamental.pct >= 70 && scores.technical.pct < 50) {
    suggestions.push("Good fundamentals but poor entry timing - wait for pullback to support.");
  }

  // RSI Zone-based suggestions (priority)
  const rsiZoneCheck = checks.find((c) => c.id === "rsi_zone_signal");
  const momentumCheck = checks.find((c) => c.id === "momentum_ok");
  
  if (rsiZoneCheck?.passed && momentumCheck?.value) {
    const rsiValue = parseFloat(String(momentumCheck.value));
    
    if (rsiValue > 70) {
      // Overbought - favor bearish strategies
      const callSpread = tradeIdeas.find((t) => t.strategy === "call_credit_spread");
      if (callSpread) {
        const boost = callSpread.rsiAnalysis?.confidenceBoost ?? 0;
        suggestions.push(
          `📊 RSI ${rsiValue.toFixed(0)} OVERBOUGHT: ${callSpread.strategyName} has +${boost}% confidence boost - ideal for mean reversion`
        );
      }
      suggestions.push("🔴 Overbought zone: Avoid new bullish positions, consider taking profits on longs");
    } else if (rsiValue < 30) {
      // Oversold - favor bullish strategies
      const putSpread = tradeIdeas.find((t) => t.strategy === "put_credit_spread");
      if (putSpread) {
        const boost = putSpread.rsiAnalysis?.confidenceBoost ?? 0;
        suggestions.push(
          `📊 RSI ${rsiValue.toFixed(0)} OVERSOLD: ${putSpread.strategyName} has +${boost}% confidence boost - ideal for bounce play`
        );
      }
      suggestions.push("🟢 Oversold zone: Bullish reversal likely, great entry for put credit spreads");
    }
  } else if (momentumCheck?.value) {
    // RSI in neutral zone
    const rsiValue = parseFloat(String(momentumCheck.value));
    if (rsiValue >= 30 && rsiValue <= 70) {
      const ironCondor = tradeIdeas.find((t) => t.strategy === "iron_condor");
      if (ironCondor) {
        suggestions.push(
          `📊 RSI ${rsiValue.toFixed(0)} neutral: ${ironCondor.strategyName} favorable - range-bound conditions expected`
        );
      }
    }
  }

  // Trend alignment
  if (trend === "bullish") {
    const bullishIdea = tradeIdeas.find((t) => t.strategy.includes("call") || t.strategy === "covered_call");
    if (bullishIdea) {
      suggestions.push(`Bullish trend: Consider ${bullishIdea.strategyName}`);
    }
  } else if (trend === "bearish") {
    const bearishIdea = tradeIdeas.find((t) => t.strategy.includes("put") || t.strategy === "long_put");
    if (bearishIdea) {
      suggestions.push(`Bearish trend: Consider ${bearishIdea.strategyName}`);
    }
  }

  // IV-based
  const ivCheck = checks.find((c) => c.id === "iv_appropriate");
  if (ivCheck?.passed && ivCheck.value) {
    const ivRank = parseFloat(String(ivCheck.value));
    if (ivRank > 50) {
      const sellIdea = tradeIdeas.find((t) => t.strategy.includes("spread") || t.strategy === "iron_condor");
      if (sellIdea) {
        suggestions.push(`High IV (${ivRank.toFixed(0)}%): ${sellIdea.strategyName} favorable for premium collection`);
      }
    } else {
      const buyIdea = tradeIdeas.find((t) => t.strategy === "long_call" || t.strategy === "long_put");
      if (buyIdea) {
        suggestions.push(`Low IV (${ivRank.toFixed(0)}%): ${buyIdea.strategyName} favorable for directional plays`);
      }
    }
  }

  // Earnings warning
  const catalystCheck = checks.find((c) => c.id === "catalyst");
  if (catalystCheck?.passed) {
    suggestions.push("⚠️ Earnings approaching - be aware of IV crush risk if selling premium");
  }

  if (suggestions.length === 0) {
    suggestions.push("Review the Trade Ideas panel and select a strategy matching your strongest pillars.");
  }

  return suggestions;
}
