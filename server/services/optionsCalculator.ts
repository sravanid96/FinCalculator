import type {
  TradeLeg,
  PLCalculationResult,
  PLDataPoint,
  OptionStrategy,
} from "../../shared/optionsSchema";

// Standard normal cumulative distribution function
function normCDF(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);

  const t = 1.0 / (1.0 + p * x);
  const y =
    1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return 0.5 * (1.0 + sign * y);
}

// Standard normal probability density function
function normPDF(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

// Black-Scholes d1 and d2 calculations
function calcD1D2(
  S: number, // Spot price
  K: number, // Strike price
  T: number, // Time to expiration (years)
  r: number, // Risk-free rate
  sigma: number // Volatility
): { d1: number; d2: number } {
  const d1 = (Math.log(S / K) + (r + (sigma * sigma) / 2) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  return { d1, d2 };
}

// Black-Scholes option pricing
export function blackScholesPrice(
  type: "call" | "put",
  S: number, // Spot price
  K: number, // Strike price
  T: number, // Time to expiration (years)
  r: number = 0.05, // Risk-free rate
  sigma: number = 0.3 // Volatility
): number {
  if (T <= 0) {
    // At expiration
    return type === "call" ? Math.max(0, S - K) : Math.max(0, K - S);
  }

  const { d1, d2 } = calcD1D2(S, K, T, r, sigma);

  if (type === "call") {
    return S * normCDF(d1) - K * Math.exp(-r * T) * normCDF(d2);
  } else {
    return K * Math.exp(-r * T) * normCDF(-d2) - S * normCDF(-d1);
  }
}

// Calculate Greeks for an option
export function calculateGreeks(
  type: "call" | "put",
  S: number,
  K: number,
  T: number,
  r: number = 0.05,
  sigma: number = 0.3
): { delta: number; gamma: number; theta: number; vega: number; rho: number } {
  if (T <= 0) {
    return {
      delta: type === "call" ? (S > K ? 1 : 0) : (S < K ? -1 : 0),
      gamma: 0,
      theta: 0,
      vega: 0,
      rho: 0,
    };
  }

  const { d1, d2 } = calcD1D2(S, K, T, r, sigma);
  const sqrtT = Math.sqrt(T);

  // Delta
  const delta = type === "call" ? normCDF(d1) : normCDF(d1) - 1;

  // Gamma (same for calls and puts)
  const gamma = normPDF(d1) / (S * sigma * sqrtT);

  // Theta (per day)
  const thetaAnnual =
    type === "call"
      ? ((-S * normPDF(d1) * sigma) / (2 * sqrtT) -
          r * K * Math.exp(-r * T) * normCDF(d2))
      : ((-S * normPDF(d1) * sigma) / (2 * sqrtT) +
          r * K * Math.exp(-r * T) * normCDF(-d2));
  const theta = thetaAnnual / 365;

  // Vega (per 1% change in IV)
  const vega = (S * sqrtT * normPDF(d1)) / 100;

  // Rho (per 1% change in rate)
  const rho =
    type === "call"
      ? (K * T * Math.exp(-r * T) * normCDF(d2)) / 100
      : (-K * T * Math.exp(-r * T) * normCDF(-d2)) / 100;

  return { delta, gamma, theta, vega, rho };
}

// Calculate P&L at a specific underlying price
export function calculatePLAtPrice(
  legs: TradeLeg[],
  underlyingPrice: number,
  entryPrices: number[] // Original entry prices for each leg
): number {
  let totalPL = 0;

  legs.forEach((leg, index) => {
    const entryPrice = entryPrices[index];
    const intrinsicValue =
      leg.type === "call"
        ? Math.max(0, underlyingPrice - leg.strike)
        : Math.max(0, leg.strike - underlyingPrice);

    if (leg.action === "sell") {
      totalPL += (entryPrice - intrinsicValue) * leg.quantity * 100;
    } else {
      totalPL += (intrinsicValue - entryPrice) * leg.quantity * 100;
    }
  });

  return totalPL;
}

// Calculate full P&L for a trade
export function calculatePL(
  legs: TradeLeg[],
  underlyingPrice: number,
  priceRange?: { min: number; max: number },
  daysToExpiration?: number
): PLCalculationResult {
  // Determine price range for analysis
  const minPrice = priceRange?.min || underlyingPrice * 0.8;
  const maxPrice = priceRange?.max || underlyingPrice * 1.2;
  const steps = 50;
  const stepSize = (maxPrice - minPrice) / steps;

  // Calculate net entry cost/credit
  let netEntry = 0;
  legs.forEach((leg) => {
    const multiplier = leg.action === "sell" ? 1 : -1;
    netEntry += leg.price * leg.quantity * 100 * multiplier;
  });

  // Calculate P&L data points at expiration
  const dataPoints: PLDataPoint[] = [];
  const entryPrices = legs.map((leg) => leg.price);

  for (let i = 0; i <= steps; i++) {
    const price = minPrice + i * stepSize;
    const profit = calculatePLAtPrice(legs, price, entryPrices);

    dataPoints.push({
      underlyingPrice: Math.round(price * 100) / 100,
      profit: Math.round(profit * 100) / 100,
      profitPercent:
        netEntry !== 0
          ? Math.round((profit / Math.abs(netEntry)) * 10000) / 100
          : 0,
    });
  }

  // Calculate max profit and max loss from data points
  const profits = dataPoints.map((d) => d.profit);
  const maxProfit = Math.max(...profits);
  const maxLoss = Math.min(...profits);

  // Find breakeven points
  const breakeven: number[] = [];
  for (let i = 1; i < dataPoints.length; i++) {
    const prev = dataPoints[i - 1];
    const curr = dataPoints[i];
    if ((prev.profit <= 0 && curr.profit >= 0) || (prev.profit >= 0 && curr.profit <= 0)) {
      // Linear interpolation for breakeven
      const ratio = Math.abs(prev.profit) / (Math.abs(prev.profit) + Math.abs(curr.profit));
      const be = prev.underlyingPrice + ratio * (curr.underlyingPrice - prev.underlyingPrice);
      breakeven.push(Math.round(be * 100) / 100);
    }
  }

  // Calculate current P&L
  const currentPL = calculatePLAtPrice(legs, underlyingPrice, entryPrices);

  // Calculate aggregate Greeks
  const T = (daysToExpiration || 30) / 365;
  const r = 0.05;
  let totalDelta = 0;
  let totalGamma = 0;
  let totalTheta = 0;
  let totalVega = 0;

  legs.forEach((leg) => {
    const sigma = 0.3; // Default IV
    const greeks = calculateGreeks(leg.type, underlyingPrice, leg.strike, T, r, sigma);
    const multiplier = (leg.action === "sell" ? -1 : 1) * leg.quantity;

    totalDelta += greeks.delta * multiplier * 100;
    totalGamma += greeks.gamma * multiplier * 100;
    totalTheta += greeks.theta * multiplier * 100;
    totalVega += greeks.vega * multiplier * 100;
  });

  return {
    maxProfit,
    maxLoss,
    breakeven,
    currentPL,
    dataPoints,
    greeks: {
      delta: Math.round(totalDelta * 100) / 100,
      gamma: Math.round(totalGamma * 1000) / 1000,
      theta: Math.round(totalTheta * 100) / 100,
      vega: Math.round(totalVega * 100) / 100,
    },
  };
}

// Calculate probability of profit using delta
export function calculateProbabilityOfProfit(
  strategy: OptionStrategy,
  legs: TradeLeg[],
  breakeven: number[]
): number {
  // For credit spreads, POP is roughly the short leg's delta (for puts) or 1-delta (for calls)
  // This is a simplification - real POP requires more complex calculations

  const shortLeg = legs.find((l) => l.action === "sell");
  if (!shortLeg || !shortLeg.delta) {
    // Rough estimate based on strategy type
    switch (strategy) {
      case "put_credit_spread":
      case "call_credit_spread":
        return 65; // Typical for ~30 delta spreads
      case "iron_condor":
        return 50;
      case "long_call":
      case "long_put":
        return 30;
      case "covered_call":
      case "cash_secured_put":
        return 70;
      default:
        return 50;
    }
  }

  // For put credit spread, POP ≈ 1 - |short put delta|
  // For call credit spread, POP ≈ 1 - short call delta
  const shortDelta = Math.abs(shortLeg.delta);

  if (strategy === "put_credit_spread") {
    return Math.round((1 - shortDelta) * 100);
  } else if (strategy === "call_credit_spread") {
    return Math.round((1 - shortDelta) * 100);
  }

  return Math.round((1 - shortDelta) * 100);
}

// Calculate risk/reward ratio
export function calculateRiskReward(maxProfit: number, maxLoss: number): number {
  if (maxLoss === 0) return Infinity;
  return Math.abs(Math.round((maxProfit / Math.abs(maxLoss)) * 100) / 100);
}

/**
 * Calculate put-call parity metrics
 * Parity relationship: C + PV(X) = P + S
 * Where: C = call price, P = put price, X = strike, S = stock price, PV(X) = present value of strike
 */
export interface ParityMetrics {
  callPriceDeviation: number; // % deviation of call from parity-implied price
  putPriceDeviation: number; // % deviation of put from parity-implied price
  parityImpliedCallPrice: number; // What call should be worth per parity
  parityImpliedPutPrice: number; // What put should be worth per parity
  arbitrageProfitPercent: number; // % profit from arbitrage
  arbitrageProfitDollars: number; // $ profit from arbitrage (per contract)
  direction: "call_expensive" | "put_expensive" | "fair";
  purityViolation: number; // Raw deviation: C + PV(X) - P - S (in dollars)
}

/**
 * Calculate parity metrics for a call-put pair at same strike/expiration
 */
export function calculateParityMetrics(
  callPrice: number,
  putPrice: number,
  strikePrice: number,
  stockPrice: number,
  timeToExpirationDays: number,
  riskFreeRate: number
): ParityMetrics {
  // Convert days to years
  const T = timeToExpirationDays / 365;
  
  // Calculate present value of strike: X / (1 + r)^T
  const pvStrike = strikePrice / Math.pow(1 + riskFreeRate, T);
  
  // Parity relationship: C + PV(X) = P + S
  // Therefore: C_theoretical = P + S - PV(X)
  const theoreticalCallPrice = putPrice + stockPrice - pvStrike;
  
  // And: P_theoretical = C + PV(X) - S
  const theoreticalPutPrice = callPrice + pvStrike - stockPrice;
  
  // Calculate deviations
  const callDeviation = (callPrice - theoreticalCallPrice) / theoreticalCallPrice;
  const putDeviation = (putPrice - theoreticalPutPrice) / theoreticalPutPrice;
  
  // Calculate parity violation (raw dollar value)
  const violation = callPrice + pvStrike - putPrice - stockPrice;
  
  // Arbitrage profit: If C + PV(X) - P - S > 0, you could:
  // - Buy put and stock, sell call = receive this much profit
  // If C + PV(X) - P - S < 0, you could:
  // - Sell put and stock, buy call = profit from this
  const arbitrageProfitPercent =
    Math.abs(violation) / ((callPrice + putPrice + strikePrice + stockPrice) / 4);
  const arbitrageProfitDollars = Math.abs(violation) * 100; // Options are per 100 shares
  
  // Determine direction of mispricing
  let direction: "call_expensive" | "put_expensive" | "fair" = "fair";
  if (violation > 0.01) {
    direction = "call_expensive";
  } else if (violation < -0.01) {
    direction = "put_expensive";
  }
  
  return {
    callPriceDeviation: Math.round(callDeviation * 10000) / 100, // percentage
    putPriceDeviation: Math.round(putDeviation * 10000) / 100, // percentage
    parityImpliedCallPrice: Math.round(theoreticalCallPrice * 100) / 100,
    parityImpliedPutPrice: Math.round(theoreticalPutPrice * 100) / 100,
    arbitrageProfitPercent: Math.round(arbitrageProfitPercent * 10000) / 100, // percentage
    arbitrageProfitDollars: Math.round(arbitrageProfitDollars * 100) / 100,
    direction,
    purityViolation: Math.round(violation * 100) / 100,
  };
}
