import { storage } from "../storage";
import { getStockQuote } from "./yahooFinance";
import type { DigestTradeIdea } from "@shared/schema";

export interface MonitorResult {
  checked: number;
  updated: number;
  won: number;
  lost: number;
  expired: number;
  errors: string[];
}

/**
 * Check all open digest trade ideas and update their status based on current prices.
 * 
 * Exit conditions:
 * 1. Profit target: current spread value <= 50% of entry credit (won)
 * 2. Stop loss: underlying breaches short strike (lost)
 * 3. Expiration: trade expires (settled based on final price)
 * 4. DTE management: close at 21 DTE if not yet at profit target
 */
export async function monitorOpenDigestTrades(): Promise<MonitorResult> {
  const openTrades = await storage.getOpenDigestTradeIdeas();
  
  const result: MonitorResult = {
    checked: openTrades.length,
    updated: 0,
    won: 0,
    lost: 0,
    expired: 0,
    errors: [],
  };

  if (openTrades.length === 0) {
    console.log("No open digest trades to monitor");
    return result;
  }

  console.log(`Monitoring ${openTrades.length} open digest trades...`);

  for (const trade of openTrades) {
    try {
      const outcome = await evaluateTrade(trade);
      
      if (outcome) {
        await storage.updateDigestTradeIdeaOutcome(trade.id, outcome);
        result.updated += 1;
        
        if (outcome.status === "won") result.won += 1;
        else if (outcome.status === "lost") result.lost += 1;
        else if (outcome.status === "expired") result.expired += 1;
        
        console.log(
          `${trade.symbol} ${trade.strategy}: ${outcome.status} (${outcome.exitReason}) P&L: $${outcome.actualPnl.toFixed(2)}`
        );
      }
    } catch (err) {
      result.errors.push(`${trade.symbol}: ${(err as Error).message}`);
    }
  }

  console.log(
    `Monitor complete: ${result.updated} updated (${result.won} wins, ${result.lost} losses, ${result.expired} expired)`
  );

  return result;
}

interface TradeOutcome {
  status: string;
  exitDate: Date;
  exitReason: string;
  underlyingPriceAtExit: number;
  actualPnl: number;
  actualPnlPct: number;
  daysHeld: number;
}

async function evaluateTrade(trade: DigestTradeIdea): Promise<TradeOutcome | null> {
  const now = new Date();
  const entryDate = new Date(trade.entryDate);
  const expirationDate = new Date(trade.expirationDate);
  const daysHeld = Math.floor((now.getTime() - entryDate.getTime()) / (1000 * 60 * 60 * 24));
  const daysToExpiration = Math.floor(
    (expirationDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  );

  // Get current price
  let currentPrice: number;
  try {
    const quote = await getStockQuote(trade.symbol);
    currentPrice = quote.price;
  } catch {
    return null; // Can't evaluate without current price
  }

  const entryCredit = parseFloat(trade.entryCredit);
  const maxLoss = parseFloat(trade.maxLoss);
  const maxProfit = parseFloat(trade.maxProfit);
  const shortStrike = parseFloat(trade.shortStrike);
  const longStrike = trade.longStrike ? parseFloat(trade.longStrike) : null;
  const profitTarget = entryCredit * 0.5; // 50% profit target

  const isPutSpread = trade.strategy.includes("put");
  const isCallSpread = trade.strategy.includes("call");

  // Check expiration first
  if (now >= expirationDate || daysToExpiration <= 0) {
    const isOTM = isPutSpread
      ? currentPrice > shortStrike
      : isCallSpread
      ? currentPrice < shortStrike
      : false;

    if (isOTM) {
      // Expired worthless = max profit
      return {
        status: "won",
        exitDate: expirationDate,
        exitReason: "expiration",
        underlyingPriceAtExit: currentPrice,
        actualPnl: maxProfit,
        actualPnlPct: 100,
        daysHeld,
      };
    } else {
      // Expired ITM = loss
      const lossAmount = calculateLoss(currentPrice, shortStrike, longStrike, entryCredit, isPutSpread);
      return {
        status: "lost",
        exitDate: expirationDate,
        exitReason: "expiration",
        underlyingPriceAtExit: currentPrice,
        actualPnl: -Math.abs(lossAmount),
        actualPnlPct: (-Math.abs(lossAmount) / maxLoss) * 100,
        daysHeld,
      };
    }
  }

  // Check if underlying breached short strike (immediate loss)
  const breached = isPutSpread
    ? currentPrice < shortStrike
    : isCallSpread
    ? currentPrice > shortStrike
    : false;

  if (breached) {
    // Calculate current loss based on how much it's ITM
    const lossAmount = calculateLoss(currentPrice, shortStrike, longStrike, entryCredit, isPutSpread);
    
    // Only close if loss exceeds 2x credit (stop loss) or very deep ITM
    if (lossAmount >= maxLoss * 0.9) {
      return {
        status: "lost",
        exitDate: now,
        exitReason: "stop_loss",
        underlyingPriceAtExit: currentPrice,
        actualPnl: -Math.abs(lossAmount),
        actualPnlPct: (-Math.abs(lossAmount) / maxLoss) * 100,
        daysHeld,
      };
    }
  }

  // Estimate current spread value (simplified - assumes linear decay)
  // In reality would need options pricing, but this is a reasonable approximation
  const timeDecayFactor = daysToExpiration / Math.max(1, daysHeld + daysToExpiration);
  const distanceFromStrike = isPutSpread
    ? (currentPrice - shortStrike) / shortStrike
    : (shortStrike - currentPrice) / shortStrike;
  
  // Rough estimate of current spread value
  const estimatedCurrentValue = entryCredit * timeDecayFactor * Math.max(0.1, 1 - distanceFromStrike * 5);

  // Check profit target (spread value <= 50% of entry credit)
  if (estimatedCurrentValue <= profitTarget && distanceFromStrike > 0.02) {
    const profit = entryCredit - estimatedCurrentValue;
    return {
      status: "won",
      exitDate: now,
      exitReason: "profit_target",
      underlyingPriceAtExit: currentPrice,
      actualPnl: profit * 100, // Per contract
      actualPnlPct: (profit / entryCredit) * 100,
      daysHeld,
    };
  }

  // DTE management: close at 21 DTE if still open
  if (daysToExpiration <= 21 && daysToExpiration > 0) {
    const profit = entryCredit - estimatedCurrentValue;
    return {
      status: profit > 0 ? "won" : "lost",
      exitDate: now,
      exitReason: "dte_management",
      underlyingPriceAtExit: currentPrice,
      actualPnl: profit * 100,
      actualPnlPct: (profit / entryCredit) * 100,
      daysHeld,
    };
  }

  // Still open, no action
  return null;
}

function calculateLoss(
  currentPrice: number,
  shortStrike: number,
  longStrike: number | null,
  entryCredit: number,
  isPutSpread: boolean
): number {
  if (!longStrike) {
    // Naked option - unlimited risk, cap at some multiple
    const intrinsicValue = isPutSpread
      ? Math.max(0, shortStrike - currentPrice)
      : Math.max(0, currentPrice - shortStrike);
    return (intrinsicValue - entryCredit) * 100;
  }

  // Spread - capped at width minus credit
  const spreadWidth = Math.abs(shortStrike - longStrike);
  const intrinsicValue = isPutSpread
    ? Math.min(spreadWidth, Math.max(0, shortStrike - currentPrice))
    : Math.min(spreadWidth, Math.max(0, currentPrice - shortStrike));
  
  return (intrinsicValue - entryCredit) * 100;
}
