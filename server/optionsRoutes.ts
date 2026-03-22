import { Router, Request, Response } from "express";
import {
  getStockQuote,
  getHistoricalPrices,
  getOptionsChain,
  searchTickers,
} from "./services/yahooFinance";
import { calculatePL } from "./services/optionsCalculator";
import { calculateSupportResistance } from "./services/supportResistance";
import { getUpcomingEarnings } from "./services/earningsService";
import { generateTradeIdeas, generateStrategyComparison } from "./services/tradeIdeaGenerator";
import { generateFrameworkAnalysis } from "./services/frameworkAnalysis";
import { plCalculationSchema, DEFAULT_TRADE_CONFIG } from "../shared/optionsSchema";
import type { TickerAnalysis } from "../shared/optionsSchema";

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
    const [quote, chain, historicalPrices, earnings] = await Promise.all([
      getStockQuote(upperTicker),
      getOptionsChain(upperTicker),
      getHistoricalPrices(upperTicker, 6),
      getUpcomingEarnings(upperTicker),
    ]);

    // Calculate support/resistance
    const supportResistance = calculateSupportResistance(historicalPrices, quote.price);

    // Generate trade ideas and strategy comparisons
    const tradeIdeas = generateTradeIdeas(chain, earnings, DEFAULT_TRADE_CONFIG);
    const strategyComparisons = generateStrategyComparison(chain, earnings, quote);

    // Generate framework analysis with auto-calculated checks and scores
    const frameworkAnalysis = await generateFrameworkAnalysis(
      quote,
      historicalPrices,
      chain,
      supportResistance,
      earnings,
      tradeIdeas
    );

    const analysis: TickerAnalysis = {
      quote,
      optionsChain: chain,
      supportResistance,
      upcomingEarnings: earnings,
      tradeIdeas,
      strategyComparisons,
      frameworkAnalysis,
    };

    res.json(analysis);
  } catch (error) {
    console.error(`Error analyzing ${req.params.ticker}:`, error);
    res.status(500).json({ error: "Failed to analyze ticker", details: (error as Error).message });
  }
});

export default router;
