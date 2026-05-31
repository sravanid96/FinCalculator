import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { db } from "./db";
import { optionsWatchlist } from "@shared/schema";
import { storage } from "./storage";
import { calculatePLAtPrice } from "./services/optionsCalculator";
import { getUnderlyingCloseOnOrBefore } from "./services/ideaWatchlistSettlement";
import { computeWatchlistLearning } from "./services/ideaWatchlistLearning";
import { evaluateWatchlistModel } from "./services/ideaWatchlistEvaluation";
import { getFundamentals } from "./services/fundamentalsService";
import type {
  OptionStrategy,
  TradeIdea,
  TradeLeg,
  WatchlistContextSnapshot,
} from "../shared/optionsSchema";

const router = Router();

function getUserId(req: Request): string | null {
  const u = (req as any).user;
  return u?.claims?.sub || u?.id || null;
}

/** Best-effort fundamentals snapshot for learning. Returns null on any failure. */
async function captureFundamentals(symbol: string): Promise<{
  sector: string | null;
  trailingPe: number | null;
  fundamentals: NonNullable<WatchlistContextSnapshot["fundamentals"]>;
} | null> {
  try {
    const f = await getFundamentals(symbol);
    return {
      sector: f.sector,
      trailingPe: f.trailingPE,
      fundamentals: {
        revenueGrowthYoy: f.revenueGrowthYoy,
        roic: f.roic,
        fcfMargin: f.fcfMargin,
        netDebtToEbitda: f.netDebtToEbitda,
        epsQoqGrowth: f.earnings?.epsQoqGrowth ?? null,
        grossMarginDeltaPp: f.earnings?.margins?.grossMarginDeltaPp ?? null,
        recommendationMean: f.recommendationMean,
      },
    };
  } catch {
    return null;
  }
}

function legsFromIdea(idea: TradeIdea): TradeLeg[] {
  return idea.legs.map((l) => ({
    type: l.type,
    action: l.action,
    strike: l.strike,
    expiration: l.expiration,
    quantity: l.quantity,
    price: l.price,
    delta: l.delta,
  }));
}

function pnlAtUnderlying(idea: TradeIdea, underlying: number): number {
  const legs = legsFromIdea(idea);
  const entryPrices = legs.map((l) => l.price);
  return calculatePLAtPrice(legs, underlying, entryPrices);
}

/** Net premium per share: sells add, buys subtract (matches analysis `entryPrice` for typical credit spreads). */
function netPremiumPerShare(idea: TradeIdea): number {
  let net = 0;
  for (const l of idea.legs) {
    const sign = l.action === "sell" ? 1 : -1;
    net += sign * l.price * l.quantity;
  }
  return Math.round(net * 1e6) / 1e6;
}

/** Shift short-leg entry prices so net matches actual fill; keeps strikes/structure, fixes P/L vs real credit. */
function ideaWithAdjustedEntryPrice(idea: TradeIdea, targetNetPerShare: number): TradeIdea {
  const current = netPremiumPerShare(idea);
  const diff = targetNetPerShare - current;
  const shortQty = idea.legs
    .filter((l) => l.action === "sell")
    .reduce((s, l) => s + l.quantity, 0);
  const longQty = idea.legs
    .filter((l) => l.action === "buy")
    .reduce((s, l) => s + l.quantity, 0);

  if (Math.abs(diff) < 1e-9) {
    return { ...idea, entryPrice: Math.round(targetNetPerShare * 1e4) / 1e4 };
  }

  if (shortQty > 0) {
    const perShortShare = diff / shortQty;
    const newLegs = idea.legs.map((l) =>
      l.action === "sell"
        ? { ...l, price: Math.round((l.price + perShortShare) * 1e4) / 1e4 }
        : { ...l },
    );
    return {
      ...idea,
      legs: newLegs,
      entryPrice: Math.round(targetNetPerShare * 1e4) / 1e4,
    };
  }

  if (longQty > 0) {
    const perLongShare = -diff / longQty;
    const newLegs = idea.legs.map((l) =>
      l.action === "buy"
        ? { ...l, price: Math.round((l.price + perLongShare) * 1e4) / 1e4 }
        : { ...l },
    );
    return {
      ...idea,
      legs: newLegs,
      entryPrice: Math.round(targetNetPerShare * 1e4) / 1e4,
    };
  }

  return { ...idea, entryPrice: Math.round(targetNetPerShare * 1e4) / 1e4 };
}

function outcomeFromPnl(pnl: number): "win" | "loss" | "breakeven" {
  if (Math.abs(pnl) < 0.01) return "breakeven";
  return pnl > 0 ? "win" : "loss";
}

function journalSideForIdea(idea: TradeIdea): "long" | "short" {
  const longStrategies: OptionStrategy[] = ["long_call", "long_put"];
  if (longStrategies.includes(idea.strategy)) return "long";
  return "short";
}

async function settleWatchlistRowDb(
  userId: string,
  row: typeof optionsWatchlist.$inferSelect,
  underlying: number
) {
  const idea = row.ideaJson as unknown as TradeIdea;
  const pnl = pnlAtUnderlying(idea, underlying);
  const outcome = outcomeFromPnl(pnl);
  const now = new Date();
  const [updated] = await db
    .update(optionsWatchlist)
    .set({
      settledAt: now,
      settlementUnderlying: String(underlying),
      settlementPnl: String(Math.round(pnl * 100) / 100),
      outcome,
      updatedAt: now,
    })
    .where(and(eq(optionsWatchlist.id, row.id), eq(optionsWatchlist.userId, userId)))
    .returning();
  return updated;
}

/** Create one trade journal row per watchlist settlement; skips if already linked. */
async function syncWatchlistRowToTradeJournal(
  userId: string,
  row: typeof optionsWatchlist.$inferSelect
): Promise<void> {
  if (row.tradeJournalEntryId) return;
  if (row.settlementPnl == null) return;

  const idea = row.ideaJson as unknown as TradeIdea;
  if (!idea?.legs?.length) return;

  const pnl = Number(row.settlementPnl);
  const qty = 1;
  const mult = 100;
  const side = journalSideForIdea(idea);
  const entryPrice = String(idea.entryPrice);
  const exitPriceRaw =
    side === "short"
      ? idea.entryPrice - pnl / (qty * mult)
      : idea.entryPrice + pnl / (qty * mult);
  const exitPrice = String(Math.round(exitPriceRaw * 1e6) / 1e6);
  const realizedPnl = String(Math.round(pnl * 100) / 100);

  const journalRow = await storage.createTradeJournalEntry(userId, {
    symbol: row.symbol,
    strategy: idea.strategyName ?? row.strategy,
    side,
    instrumentType: "option",
    quantity: qty,
    contractMultiplier: String(mult),
    entryDate: row.createdAt ?? new Date(),
    exitDate: new Date(`${row.expirationDate}T21:00:00.000Z`),
    entryPrice,
    exitPrice,
    fees: "0",
    notes: `Options watchlist ${row.id} (settlement sync)`,
    realizedPnl,
  });

  await db
    .update(optionsWatchlist)
    .set({ tradeJournalEntryId: journalRow.id, updatedAt: new Date() })
    .where(and(eq(optionsWatchlist.id, row.id), eq(optionsWatchlist.userId, userId)));
}

const watchlistContextSchema = z
  .object({
    capturedAt: z.string().optional(),
    strategy: z.string().optional(),
    recommendation: z.enum(["strong_buy", "buy", "neutral", "avoid"]).optional(),
    hasEarningsRisk: z.boolean().optional(),
    earningsDate: z.string().optional(),
    probabilityOfProfit: z.number().optional(),
    daysToExpiration: z.number().optional(),
    pillarScores: z.any().optional(),
    technical: z.any().optional(),
    historicalEdge: z.enum(["strong", "positive", "flat", "negative"]).optional(),
    backtestWinRate: z.number().optional(),
    quotePe: z.number().optional(),
    sector: z.string().optional(),
    fundamentals: z
      .object({
        revenueGrowthYoy: z.number().nullable().optional(),
        roic: z.number().nullable().optional(),
        fcfMargin: z.number().nullable().optional(),
        netDebtToEbitda: z.number().nullable().optional(),
      })
      .optional(),
  })
  .passthrough();

const addBodySchema = z.object({
  symbol: z.string().trim().min(1).max(32),
  idea: z
    .object({
      id: z.union([z.string(), z.number()]).transform(String),
      symbol: z.union([z.string(), z.number()]).transform(String),
      strategy: z.string(),
      strategyName: z.string().nullish().optional(),
      legs: z.array(z.any()).min(1),
      expirationDate: z.string().min(8),
      underlyingPrice: z.coerce.number().finite().positive(),
    })
    .passthrough(),
  context: watchlistContextSchema.optional(),
  entryUnderlyingPrice: z
    .preprocess((v) => (v === null ? undefined : v), z.coerce.number().finite().positive().optional()),
});

const settleBodySchema = z.object({
  underlyingPrice: z.number().positive().optional(),
});

const patchWatchlistBodySchema = z.object({
  /** Net premium per share in the same convention as Trade ideas (e.g. credit received for credit spreads). */
  entryPrice: z.number().finite(),
});

router.get("/learning", async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ message: "Unauthorized" });

  const rows = await db
    .select()
    .from(optionsWatchlist)
    .where(eq(optionsWatchlist.userId, userId));

  res.json(computeWatchlistLearning(rows));
});

router.get("/evaluation", async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ message: "Unauthorized" });

  const rows = await db
    .select()
    .from(optionsWatchlist)
    .where(eq(optionsWatchlist.userId, userId));

  res.json(evaluateWatchlistModel(rows));
});

router.get("/stats", async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ message: "Unauthorized" });

  const rows = await db
    .select()
    .from(optionsWatchlist)
    .where(eq(optionsWatchlist.userId, userId));

  const settled = rows.filter((r) => r.settlementPnl != null);
  const wins = settled.filter((r) => Number(r.settlementPnl) > 0).length;
  const losses = settled.filter((r) => Number(r.settlementPnl) < 0).length;
  const breakevens = settled.filter((r) => Math.abs(Number(r.settlementPnl)) < 0.01).length;
  const totalPnl = settled.reduce((s, r) => s + Number(r.settlementPnl || 0), 0);
  const winRatePct =
    settled.length > 0 ? Math.round((wins / settled.length) * 1000) / 10 : null;

  res.json({
    total: rows.length,
    settledCount: settled.length,
    openCount: rows.length - settled.length,
    wins,
    losses,
    breakevens,
    winRatePct,
    lossRatePct:
      settled.length > 0 ? Math.round((losses / settled.length) * 1000) / 10 : null,
    totalSettlementPnl: Math.round(totalPnl * 100) / 100,
  });
});

router.get("/", async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ message: "Unauthorized" });

  const rows = await db
    .select()
    .from(optionsWatchlist)
    .where(eq(optionsWatchlist.userId, userId))
    .orderBy(desc(optionsWatchlist.createdAt));

  res.json({ items: rows });
});

router.post("/", async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ message: "Unauthorized" });

  const parsed = addBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid body", issues: parsed.error.issues });
  }

  const { symbol, idea, entryUnderlyingPrice, context } = parsed.data;
  const ideaFull = idea as unknown as TradeIdea;
  const entry = entryUnderlyingPrice ?? ideaFull.underlyingPrice;

  // Capture fundamentals at save time (moat/growth/leverage) so settlement learning can
  // correlate outcomes with company quality. Best-effort: never block a save on this.
  const savedFundamentals = await captureFundamentals(symbol.toUpperCase());

  const ideaToStore: TradeIdea = { ...ideaFull };
  ideaToStore.watchlistContext = {
    ...(context ?? {}),
    capturedAt: context?.capturedAt ?? new Date().toISOString(),
    strategy: (context?.strategy as TradeIdea["strategy"]) ?? ideaFull.strategy,
    recommendation: context?.recommendation ?? ideaFull.recommendation,
    hasEarningsRisk: context?.hasEarningsRisk ?? ideaFull.hasEarningsRisk,
    probabilityOfProfit: context?.probabilityOfProfit ?? ideaFull.probabilityOfProfit,
    daysToExpiration: context?.daysToExpiration ?? ideaFull.daysToExpiration,
    sector: context?.sector ?? savedFundamentals?.sector ?? undefined,
    quotePe: context?.quotePe ?? savedFundamentals?.trailingPe ?? undefined,
    fundamentals: {
      ...(context?.fundamentals ?? {}),
      ...(savedFundamentals?.fundamentals ?? {}),
    },
  } as WatchlistContextSnapshot;

  const [row] = await db
    .insert(optionsWatchlist)
    .values({
      userId,
      symbol: symbol.toUpperCase(),
      strategy: ideaFull.strategy,
      ideaJson: ideaToStore as unknown as Record<string, unknown>,
      entryUnderlyingPrice: String(entry),
      expirationDate: ideaFull.expirationDate,
    })
    .returning();

  res.status(201).json({ item: row });
});

/** Settle all expired, unsettled rows (Yahoo close on/before expiry). Syncs each to trade journal once. */
router.post("/auto-settle", async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ message: "Unauthorized" });

  const today = new Date().toISOString().slice(0, 10);
  const rows = await db
    .select()
    .from(optionsWatchlist)
    .where(eq(optionsWatchlist.userId, userId));

  let settled = 0;
  let skipped = 0;
  const errors: { id: string; reason: string }[] = [];

  for (const row of rows) {
    if (row.settlementPnl != null) continue;
    if (row.expirationDate >= today) continue;

    const idea = row.ideaJson as unknown as TradeIdea;
    if (!idea?.legs?.length) {
      errors.push({ id: row.id, reason: "invalid_idea" });
      continue;
    }

    const underlying = await getUnderlyingCloseOnOrBefore(row.symbol, row.expirationDate);
    if (underlying == null) {
      skipped++;
      continue;
    }

    try {
      const updated = await settleWatchlistRowDb(userId, row, underlying);
      await syncWatchlistRowToTradeJournal(userId, updated);
      settled++;
    } catch (e) {
      errors.push({ id: row.id, reason: e instanceof Error ? e.message : String(e) });
    }
  }

  res.json({ settled, skipped, errors });
});

router.delete("/:id", async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ message: "Unauthorized" });

  const { id } = req.params;
  await db
    .delete(optionsWatchlist)
    .where(and(eq(optionsWatchlist.id, id), eq(optionsWatchlist.userId, userId)));

  res.json({ ok: true });
});

router.patch("/:id", async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ message: "Unauthorized" });

  const parsed = patchWatchlistBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid body", issues: parsed.error.issues });
  }

  const [row] = await db
    .select()
    .from(optionsWatchlist)
    .where(and(eq(optionsWatchlist.id, req.params.id), eq(optionsWatchlist.userId, userId)));

  if (!row) return res.status(404).json({ message: "Not found" });
  if (row.settlementPnl != null) {
    return res.status(400).json({ message: "Cannot change entry credit after settlement" });
  }

  const idea = row.ideaJson as unknown as TradeIdea;
  if (!idea?.legs?.length) {
    return res.status(400).json({ message: "Stored idea is invalid" });
  }

  const updatedIdea = ideaWithAdjustedEntryPrice(idea, parsed.data.entryPrice);
  const now = new Date();
  const [out] = await db
    .update(optionsWatchlist)
    .set({
      ideaJson: updatedIdea as unknown as Record<string, unknown>,
      updatedAt: now,
    })
    .where(and(eq(optionsWatchlist.id, row.id), eq(optionsWatchlist.userId, userId)))
    .returning();

  res.json({ item: out });
});

router.post("/:id/settle", async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ message: "Unauthorized" });

  const parsed = settleBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid body", issues: parsed.error.issues });
  }

  const [row] = await db
    .select()
    .from(optionsWatchlist)
    .where(and(eq(optionsWatchlist.id, req.params.id), eq(optionsWatchlist.userId, userId)));

  if (!row) return res.status(404).json({ message: "Not found" });

  const idea = row.ideaJson as unknown as TradeIdea;
  if (!idea?.legs?.length) {
    return res.status(400).json({ message: "Stored idea is invalid" });
  }

  let underlying = parsed.data.underlyingPrice;
  if (underlying == null) {
    underlying =
      (await getUnderlyingCloseOnOrBefore(row.symbol, row.expirationDate)) ?? undefined;
  }
  if (underlying == null) {
    return res.status(400).json({
      message:
        "Could not load settlement underlying (Yahoo history). Pass underlyingPrice in the request body.",
    });
  }

  const updated = await settleWatchlistRowDb(userId, row, underlying);
  await syncWatchlistRowToTradeJournal(userId, updated);

  const [fresh] = await db
    .select()
    .from(optionsWatchlist)
    .where(and(eq(optionsWatchlist.id, row.id), eq(optionsWatchlist.userId, userId)));

  const pnl = Number(updated.settlementPnl);
  const outcome = outcomeFromPnl(pnl);

  res.json({
    item: fresh ?? updated,
    settlementUnderlying: underlying,
    settlementPnl: pnl,
    outcome,
  });
});

/** Hypothetical P/L at expiry for a given underlying (backtest / what-if). */
router.post("/:id/simulate", async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ message: "Unauthorized" });

  const body = z.object({ underlyingPrice: z.number().positive() }).safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ message: "underlyingPrice required" });
  }

  const [row] = await db
    .select()
    .from(optionsWatchlist)
    .where(and(eq(optionsWatchlist.id, req.params.id), eq(optionsWatchlist.userId, userId)));

  if (!row) return res.status(404).json({ message: "Not found" });

  const idea = row.ideaJson as unknown as TradeIdea;
  const pnl = pnlAtUnderlying(idea, body.data.underlyingPrice);

  res.json({
    underlyingPrice: body.data.underlyingPrice,
    pnlAtExpiry: Math.round(pnl * 100) / 100,
    outcome: outcomeFromPnl(pnl),
  });
});

export default router;
