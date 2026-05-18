import { Router, Request, Response } from "express";
import { buildWeeklyMarketDigest } from "./services/weeklyMarketDigest";
import { sendWeeklyDigestEmail } from "./services/emailService";
import { monitorOpenDigestTrades } from "./services/digestTradeMonitor";
import { storage } from "./storage";
import type { InsertDigestTradeIdea } from "@shared/schema";

const router = Router();

function isAuthorizedCron(req: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;

  const authHeader = req.get("authorization");
  if (authHeader === `Bearer ${secret}`) return true;

  const cronHeader = req.get("x-cron-secret");
  if (cronHeader === secret) return true;

  return false;
}

function parseExtraNotifyEmails(): string[] {
  const raw = process.env.DIGEST_NOTIFY_EMAILS?.trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.includes("@"));
}

export interface WeeklyDigestRunResult {
  generatedAt: string;
  ideasCount: number;
  subscribers: number;
  sent: number;
  failed: number;
  errors: string[];
  skipped?: boolean;
  reason?: string;
}

/** POST /api/internal/cron/weekly-market-digest — trigger weekly email (Render cron or manual). */
router.post("/weekly-market-digest", async (req: Request, res: Response) => {
  if (!isAuthorizedCron(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const dryRun = req.query.dryRun === "true" || req.body?.dryRun === true;

  try {
    const result = await runWeeklyMarketDigest({ dryRun });
    const status = result.skipped ? 200 : result.failed > 0 ? 207 : 200;
    return res.status(status).json(result);
  } catch (error) {
    console.error("Weekly digest cron failed:", error);
    return res.status(500).json({
      error: "Weekly digest failed",
      message: (error as Error).message,
    });
  }
});

export async function runWeeklyMarketDigest(opts?: {
  dryRun?: boolean;
}): Promise<WeeklyDigestRunResult> {
  const digest = await buildWeeklyMarketDigest();
  
  // Get subscribers from three sources:
  // 1. Logged-in users who opted in via Settings
  const dbSubscribers = await storage.getWeeklyDigestSubscribers();
  // 2. Public email subscriptions (no account required)
  const publicSubscriptions = await storage.getActiveEmailSubscriptions("weekly_market");
  // 3. Admin/testing emails from env
  const extraEmails = parseExtraNotifyEmails();

  const byEmail = new Map<string, { email: string; firstName: string | null }>();
  
  // Add logged-in user subscribers
  for (const sub of dbSubscribers) {
    if (sub.email) byEmail.set(sub.email.toLowerCase(), sub);
  }
  
  // Add public subscribers
  for (const sub of publicSubscriptions) {
    if (!byEmail.has(sub.email.toLowerCase())) {
      byEmail.set(sub.email.toLowerCase(), { email: sub.email, firstName: null });
    }
  }
  
  // Add env-configured emails
  for (const email of extraEmails) {
    if (!byEmail.has(email)) {
      byEmail.set(email, { email, firstName: null });
    }
  }

  const subscribers = Array.from(byEmail.values());
  const errors: string[] = [];

  if (subscribers.length === 0) {
    return {
      generatedAt: digest.generatedAt,
      ideasCount: digest.highConvictionIdeas.length,
      subscribers: 0,
      sent: 0,
      failed: 0,
      errors: [],
      skipped: true,
      reason:
        "No subscribers. Opt in via Settings or set DIGEST_NOTIFY_EMAILS.",
    };
  }

  if (opts?.dryRun) {
    return {
      generatedAt: digest.generatedAt,
      ideasCount: digest.highConvictionIdeas.length,
      subscribers: subscribers.length,
      sent: 0,
      failed: 0,
      errors: [],
      skipped: true,
      reason: "dryRun — digest built but no emails sent",
    };
  }

  let sent = 0;
  let failed = 0;

  for (const sub of subscribers) {
    const result = await sendWeeklyDigestEmail(
      sub.email,
      digest,
      sub.firstName,
    );
    if (result.ok) {
      sent += 1;
    } else {
      failed += 1;
      errors.push(`${sub.email}: ${result.error ?? "unknown error"}`);
    }
  }

  // Save ideas to watchlist for performance tracking
  if (digest.highConvictionIdeas.length > 0) {
    try {
      const digestDate = new Date(digest.generatedAt);
      const ideasToSave: InsertDigestTradeIdea[] = digest.highConvictionIdeas.map(
        ({ idea, backtest }) => {
          const shortLeg = idea.idea.legs.find((l) => l.action === "sell");
          const longLeg = idea.idea.legs.find((l) => l.action === "buy");

          return {
            digestDate,
            symbol: idea.symbol,
            strategy: idea.idea.strategy,
            legsJson: idea.idea.legs,
            entryDate: digestDate,
            entryCredit: String(idea.idea.entryPrice),
            expirationDate: idea.idea.expirationDate,
            underlyingPriceAtEntry: String(idea.price),
            shortStrike: String(shortLeg?.strike ?? 0),
            longStrike: longLeg ? String(longLeg.strike) : null,
            maxProfit: String(idea.idea.maxProfit),
            maxLoss: String(idea.idea.maxLoss),
            profitTargetPrice: String(idea.idea.entryPrice * 0.5), // 50% profit target
            probabilityOfProfit: String(idea.idea.probabilityOfProfit),
            historicalEdge: backtest?.historicalEdge ?? null,
            status: "open",
          };
        }
      );

      await storage.saveDigestTradeIdeas(ideasToSave);
      console.log(`Saved ${ideasToSave.length} digest ideas to watchlist for tracking`);
    } catch (err) {
      console.error("Failed to save digest ideas to watchlist:", err);
    }
  }

  console.log(
    `Weekly digest: ${sent} sent, ${failed} failed, ${digest.highConvictionIdeas.length} ideas`,
  );

  return {
    generatedAt: digest.generatedAt,
    ideasCount: digest.highConvictionIdeas.length,
    subscribers: subscribers.length,
    sent,
    failed,
    errors,
  };
}

/** POST /api/internal/cron/monitor-digest-trades — daily check on open positions. */
router.post("/monitor-digest-trades", async (req: Request, res: Response) => {
  if (!isAuthorizedCron(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const result = await monitorOpenDigestTrades();
    return res.json(result);
  } catch (error) {
    console.error("Monitor digest trades failed:", error);
    return res.status(500).json({
      error: "Monitor failed",
      message: (error as Error).message,
    });
  }
});

/** GET /api/internal/cron/digest-stats — get performance stats for digest trades. */
router.get("/digest-stats", async (req: Request, res: Response) => {
  if (!isAuthorizedCron(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const stats = await storage.getDigestTradeIdeaStats();
    return res.json(stats);
  } catch (error) {
    console.error("Get digest stats failed:", error);
    return res.status(500).json({
      error: "Stats failed",
      message: (error as Error).message,
    });
  }
});

/** GET /api/internal/cron/open-trades — list all open digest trades (debug). */
router.get("/open-trades", async (req: Request, res: Response) => {
  if (!isAuthorizedCron(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const openTrades = await storage.getOpenDigestTradeIdeas();
    return res.json({
      count: openTrades.length,
      trades: openTrades.map((t) => ({
        id: t.id,
        symbol: t.symbol,
        strategy: t.strategy,
        entryDate: t.entryDate,
        expirationDate: t.expirationDate,
        status: t.status,
      })),
    });
  } catch (error) {
    console.error("Get open trades failed:", error);
    return res.status(500).json({
      error: "Failed",
      message: (error as Error).message,
    });
  }
});

export default router;
