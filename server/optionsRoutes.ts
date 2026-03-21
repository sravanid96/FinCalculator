import { Router, Request, Response } from "express";
import {
  getStockQuote,
  getHistoricalPrices,
  getOptionsChain,
  searchTickers,
} from "./services/yahooFinance";
import { calculatePL, calculateParityMetrics } from "./services/optionsCalculator";
import { calculateSupportResistance } from "./services/supportResistance";
import { getUpcomingEarnings } from "./services/earningsService";
import { generateTradeIdeas, generateStrategyComparison } from "./services/tradeIdeaGenerator";
import { getRiskFreeRate } from "./services/fedRateService";
import { checkParityViolation, recordAlert } from "./services/parityAlertService";
import { recordParityDataPoint, getParityHistory, exportParityHistoryAsCSV, exportParityStatisticsAsJSON, getHistoryStats } from "./services/parityHistoryService";
import { calculateAllParityPairs, filterParityPairsByThreshold, calculateParityStatistics } from "./services/parityAnalysisService";
import { plCalculationSchema, DEFAULT_TRADE_CONFIG } from "../shared/optionsSchema";
import type { TickerAnalysis, TradeIdea, OptionsChain, OptionContract } from "../shared/optionsSchema";

const router = Router();

// Search for tickers
router.get("/search", async (req: Request, res: Response) => {
  try {
    const query = req.query.q as string;
    if (!query) {
      return res.json([]);
    }
    const results = await searchTickers(query);
    res.json(results);
  } catch (error) {
    console.error("Error searching tickers:", error);
    res.status(500).json({ error: "Failed to search tickers" });
  }
});

// Get stock quote
router.get("/quote/:ticker", async (req: Request, res: Response) => {
  try {
    const { ticker } = req.params;
    const quote = await getStockQuote(ticker.toUpperCase());
    res.json(quote);
  } catch (error) {
    console.error(`Error fetching quote for ${req.params.ticker}:`, error);
    res.status(500).json({ error: "Failed to fetch stock quote" });
  }
});

// Get options chain
router.get("/chain/:ticker", async (req: Request, res: Response) => {
  try {
    const { ticker } = req.params;
    const chain = await getOptionsChain(ticker.toUpperCase());
    res.json(chain);
  } catch (error) {
    console.error(`Error fetching options chain for ${req.params.ticker}:`, error);
    res.status(500).json({ error: "Failed to fetch options chain" });
  }
});

// Get historical prices
router.get("/historical/:ticker", async (req: Request, res: Response) => {
  try {
    const { ticker } = req.params;
    const months = parseInt(req.query.months as string) || 6;
    const prices = await getHistoricalPrices(ticker.toUpperCase(), months);
    res.json(prices);
  } catch (error) {
    console.error(`Error fetching historical data for ${req.params.ticker}:`, error);
    res.status(500).json({ error: "Failed to fetch historical data" });
  }
});

// Get support/resistance levels
router.get("/support-resistance/:ticker", async (req: Request, res: Response) => {
  try {
    const { ticker } = req.params;
    const [prices, quote] = await Promise.all([
      getHistoricalPrices(ticker.toUpperCase(), 6),
      getStockQuote(ticker.toUpperCase()),
    ]);

    const levels = calculateSupportResistance(prices, quote.price);
    res.json({ levels, currentPrice: quote.price, historicalPrices: prices });
  } catch (error) {
    console.error(`Error calculating S/R for ${req.params.ticker}:`, error);
    res.status(500).json({ error: "Failed to calculate support/resistance" });
  }
});

// Get upcoming earnings
router.get("/earnings/:ticker", async (req: Request, res: Response) => {
  try {
    const { ticker } = req.params;
    const earnings = await getUpcomingEarnings(ticker.toUpperCase());
    res.json(earnings);
  } catch (error) {
    console.error(`Error fetching earnings for ${req.params.ticker}:`, error);
    res.status(500).json({ error: "Failed to fetch earnings data" });
  }
});

// Calculate P&L for a trade
router.post("/calculate", async (req: Request, res: Response) => {
  try {
    const validation = plCalculationSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: validation.error.issues });
    }

    const { legs, underlyingPrice, priceRange, daysToExpiration } = validation.data;
    const result = calculatePL(legs, underlyingPrice, priceRange, daysToExpiration);
    res.json(result);
  } catch (error) {
    console.error("Error calculating P&L:", error);
    res.status(500).json({ error: "Failed to calculate P&L" });
  }
});

// Generate trade ideas for a ticker
router.get("/trade-ideas/:ticker", async (req: Request, res: Response) => {
  try {
    const { ticker } = req.params;
    const upperTicker = ticker.toUpperCase();

    const [chain, earnings] = await Promise.all([
      getOptionsChain(upperTicker),
      getUpcomingEarnings(upperTicker),
    ]);

    const ideas = generateTradeIdeas(chain, earnings, DEFAULT_TRADE_CONFIG);
    res.json(ideas);
  } catch (error) {
    console.error(`Error generating trade ideas for ${req.params.ticker}:`, error);
    res.status(500).json({ error: "Failed to generate trade ideas" });
  }
});

// Compare strategies for a ticker
router.get("/strategies/:ticker", async (req: Request, res: Response) => {
  try {
    const { ticker } = req.params;
    const upperTicker = ticker.toUpperCase();

    const [chain, earnings, quote] = await Promise.all([
      getOptionsChain(upperTicker),
      getUpcomingEarnings(upperTicker),
      getStockQuote(upperTicker),
    ]);

    const comparisons = generateStrategyComparison(chain, earnings, quote);
    res.json(comparisons);
  } catch (error) {
    console.error(`Error comparing strategies for ${req.params.ticker}:`, error);
    res.status(500).json({ error: "Failed to compare strategies" });
  }
});

// Full analysis for a ticker (combines all data)
router.get("/analysis/:ticker", async (req: Request, res: Response) => {
  try {
    const { ticker } = req.params;
    const upperTicker = ticker.toUpperCase();

    // Fetch all data in parallel
    const [quote, chain, historicalPrices, earnings, riskFreeRate] = await Promise.all([
      getStockQuote(upperTicker),
      getOptionsChain(upperTicker),
      getHistoricalPrices(upperTicker, 6),
      getUpcomingEarnings(upperTicker),
      getRiskFreeRate(),
    ]);

    // Calculate support/resistance
    const supportResistance = calculateSupportResistance(historicalPrices, quote.price);

    // Generate trade ideas and strategy comparisons
    let tradeIdeas = generateTradeIdeas(chain, earnings, DEFAULT_TRADE_CONFIG);
    const strategyComparisons = generateStrategyComparison(chain, earnings, quote);

    // Calculate parity metrics for trade ideas and all available call-put pairs
    tradeIdeas = enrichTradeIdeasWithParity(
      tradeIdeas,
      upperTicker,
      quote.price,
      riskFreeRate,
      chain
    );

    const analysis: TickerAnalysis = {
      quote,
      optionsChain: chain,
      supportResistance,
      upcomingEarnings: earnings,
      tradeIdeas,
      strategyComparisons,
    };

    res.json(analysis);
  } catch (error) {
    console.error(`Error analyzing ${req.params.ticker}:`, error);
    res.status(500).json({ error: "Failed to analyze ticker" });
  }
});

/**
 * Enrich trade ideas with put-call parity metrics
 * For trades with matching call-put legs at same strike, calculate parity
 */
function enrichTradeIdeasWithParity(
  tradeIdeas: TradeIdea[],
  ticker: string,
  stockPrice: number,
  riskFreeRate: number,
  chain: OptionsChain
): TradeIdea[] {
  // Helper: find option contracts for a given expiration/strike (exact expiration match only)
  const findContractsAtStrike = (
    expiration: string,
    strike: number
  ): { call?: OptionContract; put?: OptionContract; daysToExpiration?: number } => {
    const exp = chain.expirations.find((e) => e.expirationDate === expiration);
    if (!exp) return {};
    return {
      call: exp.calls.find((c) => c.strike === strike),
      put: exp.puts.find((p) => p.strike === strike),
      daysToExpiration: exp.daysToExpiration,
    };
  };

  // First, enrich trade ideas with parity
  const enrichedIdeas = tradeIdeas.map((idea) => {
    let metrics = idea.parityMetrics;

    // Prefer direct call+put legs at same strike if present
    const callLeg = idea.legs.find((l) => l.type === "call");
    const putLeg = idea.legs.find((l) => l.type === "put");

    if (!metrics && callLeg && putLeg && callLeg.strike === putLeg.strike) {
      metrics = calculateParityMetrics(
        callLeg.price,
        putLeg.price,
        callLeg.strike,
        stockPrice,
        idea.daysToExpiration,
        riskFreeRate
      );
    }

    // If strategy only has a short put or short call (credit spreads, CSP, covered call),
    // derive parity from the chain at the short leg's strike/expiration.
    if (!metrics) {
      const shortPut = idea.legs.find((l) => l.type === "put" && l.action === "sell");
      const shortCall = idea.legs.find((l) => l.type === "call" && l.action === "sell");

      const primaryLeg = shortPut || shortCall;
      if (primaryLeg) {
        const { call, put, daysToExpiration } = findContractsAtStrike(
          primaryLeg.expiration,
          primaryLeg.strike
        );

        if (call && put && daysToExpiration !== undefined) {
          const callMid = (call.bid + call.ask) / 2;
          const putMid = (put.bid + put.ask) / 2;

          metrics = calculateParityMetrics(
            callMid,
            putMid,
            primaryLeg.strike,
            stockPrice,
            daysToExpiration,
            riskFreeRate
          );
        }
      }
    }

    if (!metrics) {
      return idea;
    }

    // Record parity data point for historical tracking
    recordParityDataPoint(
      ticker,
      callLeg?.strike ?? putLeg?.strike ?? 0,
      stockPrice,
      idea.daysToExpiration,
      metrics,
      riskFreeRate
    );

    // Check if this violates parity threshold for alerts
    const alertThreshold = 0.5;
    const alertStrike = callLeg?.strike ?? putLeg?.strike;
    if (alertStrike !== undefined) {
      const violation = checkParityViolation(ticker, alertStrike, metrics, alertThreshold);
      if (violation) {
        recordAlert(violation);
      }
    }

    return {
      ...idea,
      parityMetrics: metrics,
    };
  });

  // Second, calculate parity for ALL available call-put pairs in the options chain
  // This ensures we always have parity data, even if trade ideas don't have matching legs
  const firstExpiration = chain.expirations[0];
  if (firstExpiration) {
    // Create a map of call and put prices by strike
    const callsByStrike = new Map(
      firstExpiration.calls.map((c) => [c.strike, c])
    );
    const putsByStrike = new Map(
      firstExpiration.puts.map((p) => [p.strike, p])
    );

    // Calculate parity for all strikes that have both call and put
    const allStrikes = Array.from(
      new Set([...callsByStrike.keys(), ...putsByStrike.keys()])
    ).sort();

    for (const strike of allStrikes) {
      const call = callsByStrike.get(strike);
      const put = putsByStrike.get(strike);

      if (call && put) {
        // Use bid price for selling, ask for buying (conservative estimate)
        const callPrice = (call.bid + call.ask) / 2;
        const putPrice = (put.bid + put.ask) / 2;

        const metrics = calculateParityMetrics(
          callPrice,
          putPrice,
          strike,
          stockPrice,
          firstExpiration.daysToExpiration,
          riskFreeRate
        );

        // Record parity data point for historical tracking
        recordParityDataPoint(
          ticker,
          strike,
          stockPrice,
          firstExpiration.daysToExpiration,
          metrics,
          riskFreeRate
        );

        // Check for alerts
        const alertThreshold = 0.5;
        const violation = checkParityViolation(ticker, strike, metrics, alertThreshold);
        if (violation) {
          recordAlert(violation);
        }
      }
    }
  }

  return enrichedIdeas;
}

// Get parity history for a ticker
router.get("/parity-history/:ticker", async (req: Request, res: Response) => {
  try {
    const { ticker } = req.params;
    const hoursBack = parseInt(req.query.hours as string) || 24;

    const history = getParityHistory(ticker.toUpperCase(), { hoursBack });
    res.json({
      ticker: ticker.toUpperCase(),
      hoursBack,
      entries: history.length,
      data: history,
    });
  } catch (error) {
    console.error("Error fetching parity history:", error);
    res.status(500).json({ error: "Failed to fetch parity history" });
  }
});

// Export parity data as CSV
router.get("/parity-export/csv/:ticker", async (req: Request, res: Response) => {
  try {
    const { ticker } = req.params;
    const hoursBack = parseInt(req.query.hours as string) || 24;

    const csv = exportParityHistoryAsCSV(ticker.toUpperCase(), hoursBack);

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="parity-${ticker}-${new Date().toISOString().split("T")[0]}.csv"`
    );
    res.send(csv);
  } catch (error) {
    console.error("Error exporting parity CSV:", error);
    res.status(500).json({ error: "Failed to export parity data" });
  }
});

// Export parity statistics as JSON
router.get("/parity-export/stats/:ticker", async (req: Request, res: Response) => {
  try {
    const { ticker } = req.params;
    const hoursBack = parseInt(req.query.hours as string) || 24;

    const stats = exportParityStatisticsAsJSON(ticker.toUpperCase(), hoursBack);
    res.json(stats);
  } catch (error) {
    console.error("Error exporting parity stats:", error);
    res.status(500).json({ error: "Failed to export parity statistics" });
  }
});

// Get parity tracking statistics
router.get("/parity-stats", async (req: Request, res: Response) => {
  try {
    const stats = getHistoryStats();
    res.json({
      message: "Parity history tracking statistics",
      ...stats,
      maxHistorySize: 10000,
      retentionDays: 7,
    });
  } catch (error) {
    console.error("Error fetching parity stats:", error);
    res.status(500).json({ error: "Failed to fetch parity statistics" });
  }
});

// Get all parity pairs for a ticker
// Calculates parity for ALL call-put combinations in the options chain
router.get("/parity-all/:ticker", async (req: Request, res: Response) => {
  try {
    const { ticker } = req.params;
    const upperTicker = ticker.toUpperCase();

    // Get options chain and risk-free rate
    const [chain, riskFreeRate] = await Promise.all([
      getOptionsChain(upperTicker),
      getRiskFreeRate(),
    ]);

    // Calculate parity for ALL call-put pairs
    let allPairs = calculateAllParityPairs(chain, riskFreeRate);

    // Apply threshold filter if provided
    const threshold = req.query.threshold ? parseFloat(req.query.threshold as string) : 0;
    if (threshold > 0) {
      allPairs = filterParityPairsByThreshold(allPairs, threshold);
    }

    // Apply expiration filter if provided
    const expiration = req.query.expiration as string;
    if (expiration) {
      allPairs = allPairs.filter((p) => p.expiration === expiration);
    }

    // Apply sorting
    const sortBy = (req.query.sortBy as string) || "violation";
    if (sortBy === "strike") {
      allPairs.sort((a, b) => a.strike - b.strike);
    } else if (sortBy === "arbitrage") {
      allPairs.sort(
        (a, b) => b.parityMetrics.arbitrageProfitPercent - a.parityMetrics.arbitrageProfitPercent
      );
    } else if (sortBy === "violation") {
      allPairs.sort((a, b) => {
        const aViolation = Math.abs(a.parityMetrics.purityViolation);
        const bViolation = Math.abs(b.parityMetrics.purityViolation);
        return bViolation - aViolation;
      });
    }

    const stats = calculateParityStatistics(allPairs);

    res.json({
      ticker: upperTicker,
      underlyingPrice: chain.underlyingPrice,
      riskFreeRate,
      totalPairs: allPairs.length,
      statistics: stats,
      expirations: [...new Set(allPairs.map((p) => p.expiration))],
      pairs: allPairs,
    });
  } catch (error) {
    console.error(`Error fetching all parity pairs for ${req.params.ticker}:`, error);
    res.status(500).json({ error: "Failed to fetch all parity pairs" });
  }
});

export default router;
