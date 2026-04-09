import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { extractPgMeta } from "./pgErrors";
import { setupAuth, isAuthenticated } from "./replitAuth";
import {
  insertAccountSchema,
  insertTransactionSchema,
  insertCategorySchema,
  accounts,
  transactions,
} from "@shared/schema";
import { z } from "zod";
import { computeRealizedPnl, tradeJournalStats } from "./tradeJournalUtils";
import { subDays, startOfMonth, endOfMonth, startOfYear, subMonths, subYears } from "date-fns";
import multer from "multer";
import { parse } from "csv-parse/sync";
import { eq } from "drizzle-orm";
import optionsRoutes from "./optionsRoutes";
import healthRoutes from "./healthRoutes";
// pdf-parse will be loaded dynamically

const upload = multer({ 
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    // Accept CSV and PDF files
    if (file.mimetype === "text/csv" || 
        file.mimetype === "application/csv" ||
        file.mimetype === "text/plain" ||
        file.mimetype === "application/pdf" ||
        file.originalname.endsWith(".csv") ||
        file.originalname.endsWith(".pdf")) {
      cb(null, true);
    } else {
      cb(new Error("Only CSV and PDF files are allowed"));
    }
  }
});

// Helper function to get user ID from request (works with both JWT and session auth)
function getUserId(req: any): string | null {
  const userId = req.user?.claims?.sub || req.user?.id || null;
  if (!userId) {
    console.error("❌ No user ID found in request:", JSON.stringify(req.user, null, 2));
  } else {
    console.log("✅ Extracted user ID:", userId);
  }
  return userId;
}

function getDateRange(period: string): { start: Date; end: Date } {
  const now = new Date();
  switch (period) {
    case "current_month":
      return { start: startOfMonth(now), end: now };
    case "last_month":
      const lastMonth = subMonths(now, 1);
      return { start: startOfMonth(lastMonth), end: endOfMonth(lastMonth) };
    case "last_90_days":
      return { start: subDays(now, 90), end: now };
    case "last_6_months":
      return { start: subMonths(now, 6), end: now };
    case "last_12_months":
      return { start: subMonths(now, 12), end: now };
    case "year_to_date":
      return { start: startOfYear(now), end: now };
    case "prior_year":
      const lastYear = subYears(now, 1);
      return { start: startOfYear(lastYear), end: new Date(lastYear.getFullYear(), 11, 31) };
    default:
      return { start: subDays(now, 30), end: now };
  }
}

/** Default `source` when the client omits it: cloud on Render/Neon; local only if LOCAL_DATABASE_URL is set. */
function defaultFinanceDataSource(): "local" | "cloud" {
  return process.env.LOCAL_DATABASE_URL?.trim() ? "local" : "cloud";
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  await setupAuth(app);

  // Register options trading routes (public, no auth required for market data)
  app.use("/api/options", optionsRoutes);

  // Register health routes (auth required, local DB only)
  app.use("/api/health", healthRoutes);

  // Import new auth functions
  const { register, login, setupGoogleAuth, setupGoogleRoutes, verifyToken } = await import("./auth");
  // Setup Google auth (returns true if configured)
  const googleAuthConfigured = setupGoogleAuth(app);
  // Setup Google routes (will handle errors if not configured)
  setupGoogleRoutes(app);

  // Initialize Plaid (async, but don't block)
  const { initializePlaid, isPlaidConfigured } = await import("./plaid");
  initializePlaid().catch((err) => {
    console.warn("Plaid initialization failed:", err.message);
  });

  // Auth routes - Register
  app.post("/api/auth/register", register);

  // Auth routes - Login
  app.post("/api/auth/login", login);

  // Auth routes - Get current user
  app.get("/api/auth/user", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims?.sub || req.user.id;
      console.log("🔍 Fetching user with ID:", userId);
      console.log("🔍 Request user object:", JSON.stringify(req.user, null, 2));
      
      if (!userId) {
        console.error("❌ No user ID found in request");
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const user = await storage.getUser(userId);
      console.log("🔍 User found in database:", user ? "Yes" : "No");
      
      if (!user) {
        console.error("❌ User not found in database for ID:", userId);
        return res.status(404).json({ message: "User not found" });
      }

      try {
        await storage.createDefaultCategories(userId);
      } catch (catErr) {
        console.error("createDefaultCategories failed (non-fatal):", catErr);
      }

      console.log("✅ Returning user data");
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      const { message } = extractPgMeta(error);
      res.status(500).json({
        message: "Failed to fetch user",
        detail: message.slice(0, 400),
      });
    }
  });

  // Delete user account
  app.delete("/api/user", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      await storage.deleteUser(userId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting user:", error);
      res.status(500).json({ message: "Failed to delete user" });
    }
  });

  // Accounts routes
  app.get("/api/accounts", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const { source } = req.query;
      const dataSource = (source as string) || defaultFinanceDataSource();
      
      let allAccounts: any[] = [];
      
      // Fetch from cloud database if source is "cloud" or "both"
      if (dataSource === "cloud" || dataSource === "both") {
        const cloudAccounts = await storage.getAccounts(userId);
        allAccounts.push(...cloudAccounts);
      }
      
      // Fetch from local database if source is "local" or "both"
      if (dataSource === "local" || dataSource === "both") {
        try {
          const { getLocalDb, localSchema } = await import("./dbLocal");
          const localDb = getLocalDb();
          const localAccounts = localSchema.accounts;
          const { eq } = await import("drizzle-orm");
          
          // @ts-ignore
          const localAccountsResult = await localDb
            .select()
            .from(localAccounts)
            .where(eq(localAccounts.userId, userId));
          
          allAccounts.push(...localAccountsResult);
        } catch (localError: any) {
          console.warn("⚠️  Could not fetch from local database:", localError.message);
          if (dataSource === "local") {
            throw localError;
          }
        }
      }
      
      // Deduplicate accounts by ID
      const accountMap = new Map<string, any>();
      for (const acc of allAccounts) {
        if (!accountMap.has(acc.id)) {
          accountMap.set(acc.id, acc);
        }
      }
      const uniqueAccounts = Array.from(accountMap.values());
      
      res.json({ accounts: uniqueAccounts });
    } catch (error) {
      console.error("Error fetching accounts:", error);
      res.status(500).json({ message: "Failed to fetch accounts" });
    }
  });

  app.get("/api/accounts/summary", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const { source } = req.query;
      const dataSource = (source as string) || defaultFinanceDataSource();
      
      let allAccounts: any[] = [];
      
      // Fetch from cloud database if source is "cloud" or "both"
      if (dataSource === "cloud" || dataSource === "both") {
        const cloudAccounts = await storage.getAccounts(userId);
        allAccounts.push(...cloudAccounts);
      }
      
      // Fetch from local database if source is "local" or "both"
      if (dataSource === "local" || dataSource === "both") {
        try {
          const { getLocalDb, localSchema } = await import("./dbLocal");
          const localDb = getLocalDb();
          const localAccounts = localSchema.accounts;
          const { eq } = await import("drizzle-orm");
          
          // @ts-ignore
          const localAccountsResult = await localDb
            .select()
            .from(localAccounts)
            .where(eq(localAccounts.userId, userId));
          
          allAccounts.push(...localAccountsResult);
        } catch (localError: any) {
          console.warn("⚠️  Could not fetch from local database:", localError.message);
          if (dataSource === "local") {
            throw localError;
          }
        }
      }
      
      // Deduplicate accounts by ID
      const accountMap = new Map<string, any>();
      for (const acc of allAccounts) {
        if (!accountMap.has(acc.id)) {
          accountMap.set(acc.id, acc);
        }
      }
      const uniqueAccounts = Array.from(accountMap.values());
      
      const totalBalance = uniqueAccounts.reduce(
        (sum, acc) => sum + parseFloat(acc.currentBalance || "0"),
        0
      );
      res.json({ totalBalance, accountCount: uniqueAccounts.length });
    } catch (error) {
      console.error("Error fetching account summary:", error);
      res.status(500).json({ message: "Failed to fetch account summary" });
    }
  });

  app.post("/api/accounts/manual", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      // Ensure currentBalance is a string (decimal type expects string)
      const balance = req.body.currentBalance 
        ? String(req.body.currentBalance) 
        : "0";
      
      const data = insertAccountSchema.parse({
        institutionName: req.body.institutionName,
        accountName: req.body.accountName,
        accountType: req.body.accountType,
        currentBalance: balance,
        userId,
        isManual: true,
      });
      
      const account = await storage.createAccount(data);
      res.json(account);
    } catch (error: any) {
      console.error("Error creating account:", error);
      const errorMessage = error?.issues?.[0]?.message || error?.message || "Failed to create account";
      res.status(400).json({ message: errorMessage });
    }
  });

  app.post("/api/accounts/:id/sync", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const account = await storage.getAccount(req.params.id);
      if (!account) {
        return res.status(404).json({ message: "Account not found" });
      }
      
      if (!account.plaidAccessToken || !account.plaidAccountId) {
        return res.status(400).json({ message: "Account is not connected via Plaid" });
      }

      const { syncTransactions } = await import("./plaid");
      const count = await syncTransactions(
        account.plaidAccessToken,
        account.plaidAccountId,
        userId
      );
      
      res.json({ success: true, synced: count });
    } catch (error: any) {
      console.error("Error syncing account:", error);
      res.status(500).json({ message: error.message || "Failed to sync account" });
    }
  });

  app.delete("/api/accounts/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const accountId = req.params.id;
      const { source } = req.query;
      const dataSource = (source as string) || defaultFinanceDataSource();

      console.log(`🗑️  Deleting account ${accountId} from ${dataSource} database`);

      let deleted = false;

      // Delete from cloud database if source is "cloud" or "both"
      if (dataSource === "cloud" || dataSource === "both") {
        try {
          // Verify account belongs to user before deleting
          const account = await storage.getAccount(accountId);
          if (account && account.userId === userId) {
            // Delete account (cascade will delete transactions in cloud DB)
            await storage.deleteAccount(accountId);
            deleted = true;
            console.log(`✅ Deleted account ${accountId} from cloud database`);
          } else {
            console.warn(`⚠️  Account ${accountId} not found in cloud or doesn't belong to user`);
          }
        } catch (cloudError: any) {
          console.warn(`⚠️  Could not delete from cloud:`, cloudError.message);
          if (dataSource === "cloud") {
            throw cloudError;
          }
        }
      }

      // Delete from local database if source is "local" or "both"
      if (dataSource === "local" || dataSource === "both") {
        try {
          const { getLocalDb, localSchema } = await import("./dbLocal");
          const localDb = getLocalDb();
          const localAccounts = localSchema.accounts;
          const localTransactions = localSchema.transactions;
          const { eq, and } = await import("drizzle-orm");

          // Verify account belongs to user before deleting
          // @ts-ignore
          const [localAccount] = await localDb
            .select()
            .from(localAccounts)
            .where(and(
              eq(localAccounts.id, accountId),
              eq(localAccounts.userId, userId)
            ))
            .limit(1);

          if (localAccount) {
            // First delete all transactions for this account (cascade should handle it, but let's be explicit)
            // @ts-ignore
            await localDb
              .delete(localTransactions)
              .where(eq(localTransactions.accountId, accountId));
            console.log(`✅ Deleted transactions for account ${accountId} from local database`);

            // Then delete the account
            // @ts-ignore
            await localDb
              .delete(localAccounts)
              .where(eq(localAccounts.id, accountId));
            deleted = true;
            console.log(`✅ Deleted account ${accountId} from local database`);
          } else {
            console.warn(`⚠️  Account ${accountId} not found in local DB or doesn't belong to user`);
          }
        } catch (localError: any) {
          console.error(`❌ Error deleting from local database:`, localError);
          if (dataSource === "local") {
            throw localError;
          }
        }
      }

      if (!deleted) {
        return res.status(404).json({ message: "Account not found" });
      }

      res.json({ success: true, message: "Account deleted" });
    } catch (error: any) {
      console.error("Error deleting account:", error);
      res.status(500).json({ message: "Failed to delete account", error: error.message });
    }
  });

  // Plaid routes
  app.post("/api/plaid/link-token", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const { createLinkToken, initializePlaid } = await import("./plaid");
      
      // Ensure Plaid is initialized
      const initialized = await initializePlaid();
      if (!initialized) {
        return res.status(503).json({ 
          message: "Plaid is not configured. Please install the plaid package (npm install plaid) and set PLAID_CLIENT_ID and PLAID_SECRET environment variables." 
        });
      }

      const linkToken = await createLinkToken(userId);
      res.json({ link_token: linkToken });
    } catch (error: any) {
      console.error("Error creating link token:", error);
      const errorMessage = error.message || "Failed to create link token";
      res.status(500).json({ message: errorMessage });
    }
  });

  app.post("/api/plaid/exchange-token", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const { public_token } = req.body;
      if (!public_token) {
        return res.status(400).json({ message: "public_token is required" });
      }

      const { exchangePublicToken, syncTransactions, initializePlaid } = await import("./plaid");
      
      // Ensure Plaid is initialized
      const initialized = await initializePlaid();
      if (!initialized) {
        return res.status(503).json({ 
          message: "Plaid is not configured. Please install the plaid package (npm install plaid) and set PLAID_CLIENT_ID and PLAID_SECRET environment variables." 
        });
      }

      const { itemId, accessToken, accounts } = await exchangePublicToken(public_token, userId);

      // Create accounts in database
      const createdAccounts = [];
      for (const acc of accounts) {
        // Check if account already exists
        const existingAccounts = await storage.getAccounts(userId);
        const existing = existingAccounts.find((a) => a.plaidAccountId === acc.accountId);
        
        if (!existing) {
          const account = await storage.createAccount({
            userId,
            institutionName: "Plaid",
            accountName: acc.name,
            accountType: acc.type as any,
            accountSubtype: acc.subtype || null,
            mask: acc.mask || null,
            currentBalance: String(acc.balances.current),
            availableBalance: acc.balances.available ? String(acc.balances.available) : null,
            plaidItemId: itemId,
            plaidAccessToken: accessToken,
            plaidAccountId: acc.accountId,
            isManual: false,
            lastSynced: new Date(),
          });
          createdAccounts.push(account);

          // Sync initial transactions
          try {
            await syncTransactions(accessToken, acc.accountId, userId);
          } catch (error) {
            console.error(`Error syncing initial transactions for account ${acc.accountId}:`, error);
          }
        } else {
          // Update existing account
          await storage.updateAccount(existing.id, {
            plaidItemId: itemId,
            plaidAccessToken: accessToken,
            currentBalance: String(acc.balances.current),
            availableBalance: acc.balances.available ? String(acc.balances.available) : null,
            lastSynced: new Date(),
          });
          createdAccounts.push(existing);
        }
      }

      res.json({ 
        success: true, 
        accounts: createdAccounts,
        message: `Successfully connected ${createdAccounts.length} account(s)` 
      });
    } catch (error: any) {
      console.error("Error exchanging public token:", error);
      res.status(500).json({ message: error.message || "Failed to exchange public token" });
    }
  });

  // Transactions routes
  app.get("/api/transactions", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const { startDate, endDate, categoryId, search, limit, offset, source } = req.query;
      
      // source can be "cloud", "local", or "both"
      const dataSource = (source as string) || defaultFinanceDataSource();

      console.log("📊 Fetching transactions for user:", userId, {
        startDate,
        endDate,
        categoryId,
        search,
        limit,
        offset,
        source: dataSource
      });

      let allTransactions: any[] = [];
      let totalCount = 0;

      // Fetch from cloud database if source is "cloud" or "both"
      if (dataSource === "cloud" || dataSource === "both") {
        const cloudResult = await storage.getTransactions(userId, {
        startDate: startDate ? new Date(startDate as string) : undefined,
        endDate: endDate ? new Date(endDate as string) : undefined,
        categoryId: categoryId && categoryId !== "all" ? categoryId as string : undefined,
        search: search as string,
          limit: dataSource === "both" ? undefined : (limit ? parseInt(limit as string) : 100),
          offset: dataSource === "both" ? undefined : (offset ? parseInt(offset as string) : 0),
        });
        allTransactions.push(...cloudResult.transactions);
        totalCount += cloudResult.total;
        console.log(`📊 Found ${cloudResult.transactions.length} transactions in cloud (total: ${cloudResult.total})`);
      }

      // Fetch from local database if source is "local" or "both"
      if (dataSource === "local" || dataSource === "both") {
        try {
          const { getLocalDb, localSchema } = await import("./dbLocal");
          const localDb = getLocalDb();
          const localTransactions = localSchema.transactions;
          const localCategories = localSchema.categories;
          const localAccounts = localSchema.accounts;
          const { and, or, gte, lte, eq, ilike, desc } = await import("drizzle-orm");

          console.log(`🔍 Querying local database for user: ${userId}`);

          // First, let's check if there are ANY transactions in local DB for debugging
          // @ts-ignore
          const allLocalTransactions = await localDb.select().from(localTransactions).limit(5);
          console.log(`🔍 Sample transactions in local DB (first 5):`, allLocalTransactions.map((t: any) => ({
            id: t.id,
            userId: t.userId,
            description: t.description?.substring(0, 30),
            date: t.date
          })));

          // Build conditions for local DB query
          const conditions: any[] = [eq(localTransactions.userId, userId)];
          console.log(`🔍 Query conditions: userId=${userId}, startDate=${startDate}, endDate=${endDate}, categoryId=${categoryId}, search=${search}`);

          if (startDate) {
            conditions.push(gte(localTransactions.date, new Date(startDate as string)));
          }
          if (endDate) {
            conditions.push(lte(localTransactions.date, new Date(endDate as string)));
          }
          if (categoryId && categoryId !== "all") {
            conditions.push(eq(localTransactions.categoryId, categoryId as string));
          }
          if (search) {
            conditions.push(
              or(
                ilike(localTransactions.description, `%${search}%`),
                ilike(localTransactions.merchantName, `%${search}%`)
              )!
            );
          }

          const whereClause = and(...conditions);

          // Get count
          const { sql } = await import("drizzle-orm");
          // @ts-ignore
          const [{ count }] = await localDb
            .select({ count: sql<number>`count(*)::int` })
            .from(localTransactions)
            .where(whereClause);

          console.log(`📊 Local DB count query result: ${count} transactions`);

          // Get transactions (if "both", get all; otherwise apply limit/offset)
          let localQuery = localDb
            .select()
            .from(localTransactions)
            .where(whereClause)
            .orderBy(desc(localTransactions.date));

          if (dataSource === "local") {
            const limitNum = limit ? parseInt(limit as string) : 100;
            const offsetNum = offset ? parseInt(offset as string) : 0;
            localQuery = localQuery
              .limit(limitNum)
              .offset(offsetNum) as any;
            console.log(`📊 Applying limit: ${limitNum}, offset: ${offsetNum}`);
          }

          // @ts-ignore
          const localResult = await localQuery;

          console.log(`📊 Local DB query returned ${localResult.length} transactions`);
          console.log(`📊 Sample transaction IDs:`, localResult.slice(0, 3).map((t: any) => t.id));

          allTransactions.push(...localResult);
          totalCount += count;
          console.log(`✅ Found ${localResult.length} transactions in local DB (total: ${count})`);
        } catch (localError: any) {
          console.error("❌ Error fetching from local database:", localError);
          console.error("❌ Error stack:", localError.stack);
          // If source is "local" only and it fails, throw error
          if (dataSource === "local") {
            throw new Error(`Failed to fetch from local database: ${localError.message}`);
          }
          // If "both" and local fails, continue with cloud data only
        }
      }

      // Deduplicate transactions by ID first, then by content (description + amount + date)
      // This handles cases where same transaction might have different IDs in different databases
      const transactionMapById = new Map<string, any>();
      const transactionMapByContent = new Map<string, any>();
      
      for (const txn of allTransactions) {
        // First deduplicate by ID
        if (!transactionMapById.has(txn.id)) {
          transactionMapById.set(txn.id, txn);
        }
        
        // Also deduplicate by content (description + amount + date) to catch duplicates with different IDs
        const dateStr = txn.date instanceof Date ? txn.date.toISOString().split('T')[0] : String(txn.date).split('T')[0];
        const contentKey = `${txn.userId}_${txn.description}_${txn.amount}_${dateStr}`;
        if (!transactionMapByContent.has(contentKey)) {
          transactionMapByContent.set(contentKey, txn);
        }
      }
      
      // Use the smaller set (more strict deduplication)
      // If we have duplicates by content, prefer keeping the one with the ID we've seen
      const finalTransactions: any[] = [];
      const seenContent = new Set<string>();
      
      for (const txn of Array.from(transactionMapById.values())) {
        const dateStr = txn.date instanceof Date ? txn.date.toISOString().split('T')[0] : String(txn.date).split('T')[0];
        const contentKey = `${txn.userId}_${txn.description}_${txn.amount}_${dateStr}`;
        if (!seenContent.has(contentKey)) {
          seenContent.add(contentKey);
          finalTransactions.push(txn);
        }
      }
      
      allTransactions = finalTransactions;
      console.log(`📊 After deduplication: ${allTransactions.length} unique transactions (was ${transactionMapById.size} by ID, ${transactionMapByContent.size} by content)`);

      // Sort all transactions by date (newest first) and apply limit/offset if needed
      allTransactions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      // Apply limit/offset if source is "both" (we fetched all, now need to paginate)
      let paginatedTransactions = allTransactions;
      if (dataSource === "both") {
        const limitNum = limit ? parseInt(limit as string) : 100;
        const offsetNum = offset ? parseInt(offset as string) : 0;
        paginatedTransactions = allTransactions.slice(offsetNum, offsetNum + limitNum);
      }

      console.log(`📊 Returning ${paginatedTransactions.length} transactions (total: ${totalCount}) from ${dataSource}`);

      // Fetch categories and accounts for enrichment (from cloud - they should be synced)
      const categories = await storage.getCategories(userId);
      const accounts = await storage.getAccounts(userId);
      
      // Also get local accounts if needed
      let localAccounts: any[] = [];
      if (dataSource === "local" || dataSource === "both") {
        try {
          const { getLocalDb, localSchema } = await import("./dbLocal");
          const localDb = getLocalDb();
          const localAccountsTable = localSchema.accounts;
          const { eq } = await import("drizzle-orm");
          // @ts-ignore
          localAccounts = await localDb.select().from(localAccountsTable).where(eq(localAccountsTable.userId, userId));
        } catch {
          // Ignore local accounts fetch error
        }
      }

      const categoryMap = new Map(categories.map((c) => [c.id, c]));
      const accountMap = new Map(accounts.map((a) => [a.id, a]));
      localAccounts.forEach((a: any) => {
        if (!accountMap.has(a.id)) {
          accountMap.set(a.id, a);
        }
      });

      const enrichedTransactions = paginatedTransactions.map((t) => ({
        ...t,
        category: t.categoryId ? categoryMap.get(t.categoryId) : undefined,
        account: accountMap.get(t.accountId),
      }));

      res.json({ transactions: enrichedTransactions, total: totalCount });
    } catch (error) {
      console.error("Error fetching transactions:", error);
      res.status(500).json({ message: "Failed to fetch transactions" });
    }
  });

  app.get("/api/transactions/recent", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const { source } = req.query;
      const dataSource = (source as string) || defaultFinanceDataSource();
      
      let allTransactions: any[] = [];
      
      // Fetch from cloud database if source is "cloud" or "both"
      if (dataSource === "cloud" || dataSource === "both") {
        const cloudResult = await storage.getTransactions(userId, { limit: 10 });
        allTransactions.push(...cloudResult.transactions);
      }
      
      // Fetch from local database if source is "local" or "both"
      if (dataSource === "local" || dataSource === "both") {
        try {
          const { getLocalDb, localSchema } = await import("./dbLocal");
          const localDb = getLocalDb();
          const localTransactions = localSchema.transactions;
          const { eq, desc } = await import("drizzle-orm");
          
          // @ts-ignore
          const localResult = await localDb
            .select()
            .from(localTransactions)
            .where(eq(localTransactions.userId, userId))
            .orderBy(desc(localTransactions.date))
            .limit(10);
          
          allTransactions.push(...localResult);
        } catch (localError: any) {
          console.warn("⚠️  Could not fetch from local database:", localError.message);
          if (dataSource === "local") {
            throw localError;
          }
        }
      }
      
      // Deduplicate and sort
      const transactionMap = new Map<string, any>();
      for (const txn of allTransactions) {
        if (!transactionMap.has(txn.id)) {
          transactionMap.set(txn.id, txn);
        }
      }
      const uniqueTransactions = Array.from(transactionMap.values())
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .slice(0, 10);

      const categories = await storage.getCategories(userId);
      const accounts = await storage.getAccounts(userId);
      
      // Also get local accounts if needed
      if (dataSource === "local" || dataSource === "both") {
        try {
          const { getLocalDb, localSchema } = await import("./dbLocal");
          const localDb = getLocalDb();
          const localAccounts = localSchema.accounts;
          const { eq } = await import("drizzle-orm");
          
          // @ts-ignore
          const localAccountsResult = await localDb
            .select()
            .from(localAccounts)
            .where(eq(localAccounts.userId, userId));
          
          localAccountsResult.forEach((a: any) => {
            if (!accounts.find(acc => acc.id === a.id)) {
              accounts.push(a);
            }
          });
        } catch {
          // Ignore local accounts fetch error
        }
      }
      
      const categoryMap = new Map(categories.map((c) => [c.id, c]));
      const accountMap = new Map(accounts.map((a) => [a.id, a]));

      const enrichedTransactions = uniqueTransactions.map((t) => ({
        ...t,
        category: t.categoryId ? categoryMap.get(t.categoryId) : undefined,
        account: accountMap.get(t.accountId),
      }));

      res.json({ transactions: enrichedTransactions });
    } catch (error) {
      console.error("Error fetching recent transactions:", error);
      res.status(500).json({ message: "Failed to fetch recent transactions" });
    }
  });

  app.patch("/api/transactions/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const transactionId = req.params.id;
      const { source } = req.query;
      const dataSource = (source as string) || defaultFinanceDataSource();
      const updates = req.body;

      console.log(`✏️  Updating transaction ${transactionId} in ${dataSource} database`);

      let updatedTransaction: any = null;

      // Update in cloud database if source is "cloud" or "both"
      if (dataSource === "cloud" || dataSource === "both") {
        try {
          // Verify transaction belongs to user before updating
          const transaction = await storage.getTransaction(transactionId);
          if (transaction && transaction.userId === userId) {
            // If categoryId is being updated, also update isIncome based on category type
            const cloudUpdates = { ...updates };
            if (updates.categoryId !== undefined) {
              const categories = await storage.getCategories(userId);
              const category = categories.find(c => c.id === updates.categoryId);
              if (category) {
                // Update isIncome based on category type
                // Income, investment, and savings categories should be counted as income
                // Only expense categories should be counted as expenses
                cloudUpdates.isIncome = category.type === "income" || 
                                        category.type === "investment" || 
                                        category.type === "savings";
                console.log(`✅ Updated isIncome to ${cloudUpdates.isIncome} based on category type: ${category.type} (${category.name})`);
              } else if (updates.categoryId === null) {
                // Category removed, keep existing isIncome
                console.log(`ℹ️  Category removed, keeping existing isIncome flag`);
              }
            }
            
            const updated = await storage.updateTransaction(transactionId, cloudUpdates);
            if (updated) {
              updatedTransaction = updated;
              console.log(`✅ Updated transaction ${transactionId} in cloud database`);
            }
          } else {
            console.warn(`⚠️  Transaction ${transactionId} not found in cloud or doesn't belong to user`);
          }
        } catch (cloudError: any) {
          console.warn(`⚠️  Could not update in cloud:`, cloudError.message);
          if (dataSource === "cloud") {
            throw cloudError;
          }
        }
      }

      // Update in local database if source is "local" or "both"
      if (dataSource === "local" || dataSource === "both") {
        try {
          const { getLocalDb, localSchema } = await import("./dbLocal");
          const localDb = getLocalDb();
          const localTransactions = localSchema.transactions;
          const { eq, and } = await import("drizzle-orm");

          // Verify transaction belongs to user before updating
          // @ts-ignore
          const [localTransaction] = await localDb
            .select()
            .from(localTransactions)
            .where(and(
              eq(localTransactions.id, transactionId),
              eq(localTransactions.userId, userId)
            ))
            .limit(1);

          if (localTransaction) {
            // Prepare update object - only include valid fields
            const updateData: any = {
              updatedAt: new Date(),
            };

            // Map updates to local schema fields
            if (updates.description !== undefined) updateData.description = updates.description;
            if (updates.categoryId !== undefined) {
              // Verify category exists in local DB
              const localCategories = localSchema.categories;
              // @ts-ignore
              const [category] = await localDb
                .select()
                .from(localCategories)
                .where(eq(localCategories.id, updates.categoryId))
                .limit(1);
              
              if (category || updates.categoryId === null) {
                updateData.categoryId = updates.categoryId;
                
                // CRITICAL: Update isIncome flag based on category type
                // This ensures income/expense calculations are correct in analytics
                if (category) {
                  // Category type: "income", "expense", "savings", "investment"
                  // Income, investment, and savings categories should be counted as income
                  // Only expense categories should be counted as expenses
                  updateData.isIncome = category.type === "income" || 
                                        category.type === "investment" || 
                                        category.type === "savings";
                  console.log(`✅ Updated isIncome to ${updateData.isIncome} based on category type: ${category.type} (${category.name})`);
                } else if (updates.categoryId === null) {
                  // If category is removed, keep existing isIncome flag (don't change it)
                  // Or you could set it based on the transaction amount sign if needed
                  console.log(`ℹ️  Category removed, keeping existing isIncome flag`);
                }
              } else {
                console.warn(`⚠️  Category ${updates.categoryId} not found in local DB, setting to null`);
                updateData.categoryId = null;
              }
            }
            if (updates.notes !== undefined) updateData.notes = updates.notes;
            if (updates.tags !== undefined) updateData.tags = updates.tags;
            if (updates.isRecurring !== undefined) updateData.isRecurring = updates.isRecurring;
            if (updates.merchantName !== undefined) updateData.merchantName = updates.merchantName;
            if (updates.amount !== undefined) updateData.amount = updates.amount;
            if (updates.date !== undefined) updateData.date = updates.date instanceof Date ? updates.date : new Date(updates.date);
            if (updates.isIncome !== undefined) updateData.isIncome = updates.isIncome;

            // @ts-ignore
            const [updated] = await localDb
              .update(localTransactions)
              .set(updateData)
              .where(eq(localTransactions.id, transactionId))
              .returning();

            if (updated) {
              updatedTransaction = updated;
              console.log(`✅ Updated transaction ${transactionId} in local database`);
            }
          } else {
            console.warn(`⚠️  Transaction ${transactionId} not found in local DB or doesn't belong to user`);
          }
        } catch (localError: any) {
          console.error(`❌ Error updating in local database:`, localError);
          if (dataSource === "local") {
            throw localError;
          }
        }
      }

      if (!updatedTransaction) {
        return res.status(404).json({ message: "Transaction not found" });
      }

      res.json(updatedTransaction);
    } catch (error: any) {
      console.error("Error updating transaction:", error);
      res.status(500).json({ message: "Failed to update transaction", error: error.message });
    }
  });

  app.delete("/api/transactions/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const transactionId = req.params.id;
      const { source } = req.query;
      const dataSource = (source as string) || defaultFinanceDataSource();

      console.log(`🗑️  Deleting transaction ${transactionId} from ${dataSource} database`);

      let deleted = false;

      // Delete from cloud database if source is "cloud" or "both"
      if (dataSource === "cloud" || dataSource === "both") {
        try {
          // Verify transaction belongs to user before deleting
          const transaction = await storage.getTransaction(transactionId);
          if (transaction && transaction.userId === userId) {
            await storage.deleteTransaction(transactionId);
            deleted = true;
            console.log(`✅ Deleted transaction ${transactionId} from cloud database`);
          } else {
            console.warn(`⚠️  Transaction ${transactionId} not found in cloud or doesn't belong to user`);
          }
        } catch (cloudError: any) {
          console.warn(`⚠️  Could not delete from cloud:`, cloudError.message);
          if (dataSource === "cloud") {
            throw cloudError;
          }
        }
      }

      // Delete from local database if source is "local" or "both"
      if (dataSource === "local" || dataSource === "both") {
        try {
          const { getLocalDb, localSchema } = await import("./dbLocal");
          const localDb = getLocalDb();
          const localTransactions = localSchema.transactions;
          const { eq, and } = await import("drizzle-orm");

          // Verify transaction belongs to user before deleting
          // @ts-ignore
          const [localTransaction] = await localDb
            .select()
            .from(localTransactions)
            .where(and(
              eq(localTransactions.id, transactionId),
              eq(localTransactions.userId, userId)
            ))
            .limit(1);

          if (localTransaction) {
            // @ts-ignore
            await localDb
              .delete(localTransactions)
              .where(eq(localTransactions.id, transactionId));
            deleted = true;
            console.log(`✅ Deleted transaction ${transactionId} from local database`);
          } else {
            console.warn(`⚠️  Transaction ${transactionId} not found in local DB or doesn't belong to user`);
          }
        } catch (localError: any) {
          console.error(`❌ Error deleting from local database:`, localError);
          if (dataSource === "local") {
            throw localError;
          }
        }
      }

      if (!deleted) {
        return res.status(404).json({ message: "Transaction not found" });
      }

      res.json({ success: true, message: "Transaction deleted" });
    } catch (error: any) {
      console.error("Error deleting transaction:", error);
      res.status(500).json({ message: "Failed to delete transaction", error: error.message });
    }
  });

  // PDF to CSV Conversion endpoint
  app.post(
    "/api/transactions/convert-pdf",
    isAuthenticated,
    upload.single("file"),
    async (req: any, res) => {
      try {
        const file = req.file;
        if (!file) {
          return res.status(400).json({ message: "No file provided" });
        }

        if (file.mimetype !== "application/pdf" && !file.originalname.endsWith(".pdf")) {
          return res.status(400).json({ message: "File must be a PDF" });
        }

        // Lazy load pdf-parse
        const { PDFParse } = await import("pdf-parse");
        const pdfParser = new PDFParse({ data: file.buffer });
        const pdfResult = await pdfParser.getText();
        let fullText = pdfResult.text || "";

        // AGGRESSIVE filtering: Check if this is mostly HTML/JS code
        const htmlJsIndicators = [
          /<!DOCTYPE\s+html>/i,
          /<html[^>]*>/i,
          /<head>/i,
          /<script[^>]*>/i,
          /import\s+.*from\s+["']/,
          /createHotContext/,
          /injectIntoGlobalHook/,
          /@vite/,
          /@react-refresh/,
          /window\.\$RefreshReg/,
          /window\.\$RefreshSig/,
        ];
        
        const htmlJsCount = htmlJsIndicators.filter(pattern => pattern.test(fullText)).length;
        const isMostlyCode = htmlJsCount >= 3; // If 3+ indicators, it's likely a web page
        
        if (isMostlyCode) {
          console.warn("⚠️  PDF appears to be a web page, attempting to extract only visible text...");
          
          // Try to extract only lines that look like actual content, not code
          const lines = fullText.split("\n");
          const filteredLines: string[] = [];
          
          for (const line of lines) {
            const trimmed = line.trim();
            
            // Skip empty lines
            if (!trimmed) continue;
            
            // STRICT filtering: Skip if it contains ANY code-like patterns
            const codePatterns = [
              /^<!DOCTYPE/i,
              /^<html/i,
              /^<head/i,
              /^<meta/i,
              /^<script/i,
              /^<\/script/i,
              /^import\s+/,
              /^export\s+/,
              /^const\s+\w+\s*=/,
              /^function\s+\w+/,
              /^window\./,
              /^document\./,
              /createHotContext/,
              /injectIntoGlobalHook/,
              /@vite/,
              /@react-refresh/,
              /\$RefreshReg/,
              /\$RefreshSig/,
              /addEventListener/,
              /\.send\(/,
              /^\/\//,
              /^\/\*/,
              /^\{/,
              /^\}/,
              /^\(/,
              /^\)/,
            ];
            
            // Skip if line matches any code pattern
            if (codePatterns.some(pattern => pattern.test(trimmed))) {
              continue;
            }
            
            // Skip if line contains HTML tags
            if (/<[^>]+>/.test(trimmed)) {
              continue;
            }
            
            // Skip if line is mostly symbols/punctuation
            if (/^[^\w\s]{3,}$/.test(trimmed)) {
              continue;
            }
            
            // Skip if line looks like code (has braces, semicolons, etc. and is short)
            if (/[{}();=]/.test(trimmed) && trimmed.length < 30) {
              continue;
            }
            
            // Only keep lines that look like actual text content
            // Must have at least some letters or numbers
            if (/[a-zA-Z0-9]/.test(trimmed) && trimmed.length >= 3) {
              filteredLines.push(trimmed);
            }
          }
          
          fullText = filteredLines.join("\n");
          
          // If after aggressive filtering we have very little text, reject it
          if (fullText.trim().length < 200) {
            console.error("❌ After filtering, PDF has insufficient text. Original length:", pdfResult.text?.length || 0);
            return res.status(400).json({ 
              message: "This PDF appears to be a web page or contains only code, not a bank statement. Please use a proper bank statement PDF downloaded directly from your bank.",
              error: "PDF contains web code instead of transaction data. Try downloading the statement directly from your bank's website, not printing a web page to PDF."
            });
          }
        }

        // Convert PDF text to CSV format
        // Extract transactions and format as CSV
        const lines = fullText.split("\n").map((line: string) => line.trim()).filter((line: string) => line.length > 0);
        
        // Patterns for dates and amounts - be more specific
        const datePattern = /\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/;
        // Amount pattern: look for currency symbols or parentheses, and decimal amounts
        const amountPattern = /[\$]?\s*\(?(\d{1,}\.?\d{0,2})\)?/;
        
        // EXTRA STRICT patterns to exclude (code-like content)
        const excludePatterns = [
          /^<!DOCTYPE/i,
          /^<html/i,
          /^<head/i,
          /^<meta/i,
          /^<script/i,
          /^<\/script/i,
          /^import\s+/,
          /^export\s+/,
          /^const\s+\w+\s*=/,
          /^function\s+\w+/,
          /^<[^>]+>$/,
          /^\/\/.*$/,
          /^\/\*.*\*\/$/,
          /^window\./,
          /^document\./,
          /\.addEventListener/,
          /\.send\(/,
          /createHotContext/,
          /injectIntoGlobalHook/,
          /@vite/,
          /@react-refresh/,
          /\$RefreshReg/,
          /\$RefreshSig/,
          /^\{/,
          /^\}/,
          /^\(/,
          /^\)/,
          /^if\s*\(/,
          /^return\s+/,
        ];
        
        const csvRows: string[] = [];
        csvRows.push("Date,Description,Amount"); // CSV header
        
        let transactionCount = 0;
        
        for (const line of lines) {
          const trimmed = line.trim();
          
          // Skip empty lines
          if (!trimmed) continue;
          
          // STRICT: Skip lines that look like code (check start of line)
          if (excludePatterns.some(pattern => pattern.test(trimmed))) {
            continue;
          }
          
          // Skip if line contains HTML tags anywhere
          if (/<[^>]+>/.test(trimmed)) {
            continue;
          }
          
          // Skip very short lines (likely not transactions)
          if (trimmed.length < 5) continue;
          
          // Skip lines that are mostly punctuation/symbols
          if (/^[^\w\s]{3,}$/.test(trimmed)) continue;
          
          // Skip lines that are mostly code characters
          if (/[{}();=]/.test(trimmed) && trimmed.length < 30 && !/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(trimmed)) {
            continue;
          }
          
          // Skip if line doesn't contain any letters or numbers (must be actual content)
          if (!/[a-zA-Z0-9]/.test(trimmed)) {
            continue;
          }
          
          const dateMatch = trimmed.match(datePattern);
          const allAmountMatches = Array.from(trimmed.matchAll(amountPattern));
          
          // Filter amounts to only include reasonable transaction amounts
          const validAmountMatches = allAmountMatches.filter(m => {
            const value = m[1];
            // Must be a number with at least one digit
            if (!/^\d+\.?\d*$/.test(value)) return false;
            // If it has decimals, should be 2 decimal places
            if (value.includes('.')) {
              const parts = value.split('.');
              if (parts[1] && parts[1].length > 2) return false;
            }
            // Amount should be reasonable (between 0.01 and 999999.99)
            const numValue = parseFloat(value);
            return numValue >= 0.01 && numValue <= 999999.99;
          });
          
          if (dateMatch || validAmountMatches.length > 0) {
            const date = dateMatch ? dateMatch[1] : "";
            const amount = validAmountMatches.length > 0 
              ? validAmountMatches[validAmountMatches.length - 1][1].replace(/[\$\(\)]/g, '')
              : "";
            
            // Extract description
            let description = "";
            if (dateMatch && validAmountMatches.length > 0) {
              const dateEnd = (dateMatch.index || 0) + dateMatch[0].length;
              const amountStart = validAmountMatches[validAmountMatches.length - 1].index || trimmed.length;
              description = trimmed.substring(dateEnd, amountStart).trim();
            } else if (dateMatch) {
              description = trimmed.substring((dateMatch.index || 0) + dateMatch[0].length).trim();
            } else if (validAmountMatches.length > 0) {
              description = trimmed.substring(0, validAmountMatches[0].index || 0).trim();
            }
            
            // Clean description
            description = description
              .replace(/^\W+|\W+$/g, '') // Remove leading/trailing punctuation
              .replace(/\s+/g, ' ') // Normalize whitespace
              .trim();
            
            // STRICT: Skip if description looks like code
            const codeKeywords = /import|export|const|function|window|document|createHotContext|injectIntoGlobalHook|@vite|@react-refresh|\$RefreshReg|\$RefreshSig|addEventListener|\.send\(/i;
            if (/^[{}();=]+$/.test(description) || codeKeywords.test(description) || /<[^>]+>/.test(description)) {
              continue;
            }
            
            // Only add if we have both date and amount, or a valid date with meaningful description
            if ((date && amount) || (date && description && description.length > 3 && !/^\d+$/.test(description))) {
              // Escape commas and quotes in CSV
              const escapeCsv = (str: string) => `"${str.replace(/"/g, '""')}"`;
              csvRows.push(`${date || ""},${escapeCsv(description || "Transaction")},${amount || ""}`);
              transactionCount++;
            }
          }
        }
        
        // Validate we found actual transactions
        if (transactionCount === 0) {
          console.error("❌ No valid transactions found in PDF. Sample text:", fullText.substring(0, 500));
          return res.status(400).json({ 
            message: "No valid transactions found in PDF. The PDF may contain only web code or be in an unsupported format.",
            error: "Please ensure your PDF is a proper bank statement with transaction dates and amounts."
          });
        }
        
        const csvContent = csvRows.join("\n");
        console.log(`✅ Converted PDF to CSV: ${transactionCount} transactions found`);
        
        // Return CSV as downloadable file
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename="${file.originalname.replace(/\.pdf$/i, '')}_converted.csv"`);
        res.send(csvContent);
      } catch (error: any) {
        console.error("Error converting PDF to CSV:", error);
        res.status(500).json({ 
          message: "Failed to convert PDF to CSV",
          error: error.message 
        });
      }
    }
  );

  // CSV Upload
  app.post(
    "/api/transactions/upload",
    isAuthenticated,
    upload.single("file"),
    async (req: any, res) => {
      try {
        const userId = getUserId(req);
        if (!userId) {
          console.error("❌ No user ID in CSV upload request");
          return res.status(401).json({ message: "Unauthorized" });
        }

        // Verify user exists in database
        const user = await storage.getUser(userId);
        if (!user) {
          console.error("❌ User not found in database for CSV upload:", userId);
          return res.status(404).json({ message: "User not found. Please log in again." });
        }
        
        const file = req.file;
        const destination = (req.body.destination as "cloud" | "local" | "both") || "cloud";

        if (!file) {
          return res.status(400).json({ message: "No file provided" });
        }

        // Parse CSV or PDF file
        let records: any[] = [];
        const isPDF = file.mimetype === "application/pdf" || file.originalname.endsWith(".pdf");
        
        if (isPDF) {
          try {
            // Lazy load pdf-parse - v2 uses PDFParse class
            // @ts-ignore - pdf-parse export structure
            const { PDFParse } = await import("pdf-parse");
            
            // Parse PDF using PDFParse class (v2 API)
            const pdfParser = new PDFParse({ data: file.buffer });
            const pdfResult = await pdfParser.getText();
            const fullText = pdfResult.text || "";
            
            // Split text by page breaks (common patterns: "Page X", form feeds, etc.)
            // Most PDFs have page numbers or clear separators
            const pageBreaks = /(?:^|\n)(?:Page\s+\d+|^\f|^.{0,20}Statement\s+Page)/gmi;
            const pages = fullText.split(pageBreaks).filter(p => p.trim().length > 0);
            
            // If no clear page breaks, treat as single page or split by large gaps
            const allPagesText = pages.length > 1 ? pages : 
              fullText.split(/\n{3,}/).filter(p => p.trim().length > 50);
            
            // If still single, use the full text
            if (allPagesText.length === 0) {
              allPagesText.push(fullText);
            }
            
            // Detect bank type from PDF content
            const combinedText = allPagesText.join("\n").toLowerCase();
            let bankType: "capitalone" | "sofi" | "chase" | "amex" | "unknown" = "unknown";
            
            if (combinedText.includes("capital one") || combinedText.includes("capitalone")) {
              bankType = "capitalone";
            } else if (combinedText.includes("sofi") || combinedText.includes("sofi bank")) {
              bankType = "sofi";
            } else if (combinedText.includes("chase") || combinedText.includes("jpmorgan")) {
              bankType = "chase";
            } else if (combinedText.includes("american express") || combinedText.includes("amex")) {
              bankType = "amex";
            }
            
            console.log(`🔍 Detected bank type: ${bankType}, Pages: ${allPagesText.length}`);
            
            // Determine which pages to process based on bank type
            let pagesToProcess: number[] = [];
            if (bankType === "capitalone") {
              // Capital One: Skip page 1 (account summary), process pages 2+
              pagesToProcess = allPagesText.slice(1).map((_, i) => i + 1);
            } else if (bankType === "sofi") {
              // Sofi: Process pages 1-2, skip 3+
              pagesToProcess = [0, 1].filter(i => i < allPagesText.length);
            } else if (bankType === "chase") {
              // Chase: Process pages 1-2
              pagesToProcess = [0, 1].filter(i => i < allPagesText.length);
            } else if (bankType === "amex") {
              // Amex: Process pages 3-4 (0-indexed: 2-3)
              pagesToProcess = [2, 3].filter(i => i < allPagesText.length);
            } else {
              // Unknown: Try all pages, skip obvious summary pages
              pagesToProcess = allPagesText.map((_, i) => i);
            }
            
            // Process each page - VERY LENIENT: just find any date + amount patterns
            for (const pageIndex of pagesToProcess) {
              const pageText = allPagesText[pageIndex];
              if (!pageText) continue;
              
              // Skip obvious account summary pages (but still check for transactions)
              const isSummaryPage = /account.*summary/i.test(pageText) && 
                                    !/transaction|date.*description|purchase/i.test(pageText);
              if (isSummaryPage) {
                console.log(`⏭️  Skipping page ${pageIndex + 1} (account summary)`);
                continue;
              }
              
              // Split into lines
              const lines = pageText.split("\n").map((line: string) => line.trim()).filter((line: string) => line.length > 0);
              
              // Patterns for dates and amounts - be very flexible
              const datePattern = /\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/;
              const amountPattern = /[\$\(]?(\d{1,}\.?\d{0,2})[\)]?/;
              
              // Process each line looking for transaction patterns
              for (const line of lines) {
                // Skip obvious non-transaction lines
                if (/^(page\s+\d+|statement.*period|account.*number|total|subtotal|opening|beginning|starting)$/i.test(line)) {
                  continue;
                }
                
                // Skip lines that are too short
                if (line.length < 10) continue;
                
                // Find date and amount in the line
                const dateMatch = line.match(datePattern);
                const allAmountMatches = Array.from(line.matchAll(amountPattern));
                
                // Need at least a date OR an amount to consider it a transaction
                if (!dateMatch && allAmountMatches.length === 0) {
                  continue;
                }
                
                // Extract date
                let dateStr = "";
                if (dateMatch) {
                  dateStr = dateMatch[1];
                }
                
                // Extract amount (use the last/biggest amount found, or first if only one)
                let amountStr = "";
                if (allAmountMatches.length > 0) {
                  // Prefer amounts that look like transaction amounts (2 decimal places, reasonable size)
                  const validAmounts = allAmountMatches
                    .map(m => ({ value: m[1], index: m.index || 0 }))
                    .filter(m => /^\d+\.\d{2}$/.test(m.value) || /^\d{3,}$/.test(m.value));
                  
                  if (validAmounts.length > 0) {
                    amountStr = validAmounts[validAmounts.length - 1].value;
                  } else {
                    amountStr = allAmountMatches[allAmountMatches.length - 1][1];
                  }
                }
                
                // Extract description - everything between date and amount, or everything if no date/amount
                let description = "";
                if (dateMatch && allAmountMatches.length > 0) {
                  const dateEnd = (dateMatch.index || 0) + dateMatch[0].length;
                  const amountStart = allAmountMatches[allAmountMatches.length - 1].index || line.length;
                  description = line.substring(dateEnd, amountStart).trim();
                } else if (dateMatch) {
                  description = line.substring((dateMatch.index || 0) + dateMatch[0].length).trim();
                } else if (allAmountMatches.length > 0) {
                  description = line.substring(0, allAmountMatches[0].index || 0).trim();
                } else {
                  description = line;
                }
                
                // Clean up description
                description = description
                  .replace(/^\W+|\W+$/g, '') // Remove leading/trailing punctuation
                  .replace(/\s+/g, ' ') // Normalize whitespace
                  .trim();
                
                // If description is just numbers or too short, try to get more context
                if (/^\d+$/.test(description) || description.length < 3) {
                  // Try to get text from surrounding lines or use a default
                  description = description || "Transaction";
                }
                
                // Create record if we have at least date or amount
                // Be very lenient - accept if we have either date OR amount
                if (dateStr || amountStr) {
                  const record: any = {};
                  
                  if (dateStr) {
                    record.date = dateStr;
                  }
                  
                  if (amountStr) {
                    // Remove currency symbols and parentheses, but keep the number
                    record.amount = amountStr.replace(/[\$\(\)]/g, '');
                  }
                  
                  // Always include description, even if it's just "Transaction"
                  record.description = description || "Transaction";
                  
                  // Accept if we have date OR amount (very lenient)
                  // But prefer records with both
                  if (record.date || record.amount) {
                    records.push(record);
                  }
                }
              }
            }
            
            if (records.length === 0) {
              // Log extensive debug info
              const samplePages = pagesToProcess.slice(0, 2).map(idx => ({
                index: idx,
                length: allPagesText[idx]?.length || 0,
                preview: allPagesText[idx]?.substring(0, 1000) || "",
                lineCount: allPagesText[idx]?.split('\n').length || 0,
              }));
              
              console.error("❌ No transactions found in PDF. Debug info:", {
                bankType,
                pagesProcessed: pagesToProcess.length,
                totalPages: allPagesText.length,
                pagesToProcess,
                samplePages,
                fullTextLength: fullText.length,
                fullTextPreview: fullText.substring(0, 2000),
              });
              
              throw new Error("No transactions found in PDF. Please ensure the PDF contains readable transaction data with dates (MM/DD/YY format) and amounts ($X.XX format).");
            }
            
            console.log(`✅ Extracted ${records.length} transactions from PDF (${bankType}, ${pagesToProcess.length} pages processed)`);
          } catch (pdfError: any) {
            console.error("❌ Error parsing PDF:", pdfError);
            return res.status(400).json({ 
              message: "Failed to parse PDF", 
              error: pdfError.message 
            });
          }
        } else {
          // Parse CSV with robust error handling
        const csvContent = file.buffer.toString("utf-8");
          
          try {
            // Try to auto-detect delimiter by checking first few lines
            const firstLines = csvContent.split('\n').slice(0, 5).join('\n');
            let delimiter = ',';
            const delimiters = [',', ';', '\t', '|'];
            let maxCount = 0;
            
            for (const delim of delimiters) {
              const count = (firstLines.split(delim).length - 1);
              if (count > maxCount) {
                maxCount = count;
                delimiter = delim;
              }
            }
            
            console.log(`🔍 Detected CSV delimiter: "${delimiter}"`);
            
            // Parse with relaxed column handling
            records = parse(csvContent, {
          columns: true,
          skip_empty_lines: true,
          trim: true,
              delimiter: delimiter,
              relax_column_count: true, // Allow inconsistent column counts
              relax_quotes: true, // Handle malformed quotes
              skip_records_with_error: true, // Skip problematic rows instead of failing
              cast: false, // Don't auto-cast, we'll handle it manually
            });
            
            // Filter out records that are clearly invalid (missing essential fields)
            records = records.filter((record: any) => {
              const keys = Object.keys(record);
              // Must have at least 2 fields and one should look like a date or amount
              return keys.length >= 2 && (
                keys.some(k => /date|amount|description/i.test(k)) ||
                Object.values(record).some((v: any) => v && String(v).trim().length > 0)
              );
            });
            
            console.log(`✅ Parsed ${records.length} CSV records`);
          } catch (csvError: any) {
            console.error("❌ Error parsing CSV:", csvError);
            // Try with even more relaxed settings
            try {
              records = parse(csvContent, {
                columns: true,
                skip_empty_lines: true,
                trim: true,
                relax_column_count: true,
                relax_quotes: true,
                skip_records_with_error: true,
                skip_records_with_empty_values: false,
              });
              
              records = records.filter((record: any) => {
                const keys = Object.keys(record);
                return keys.length >= 2;
              });
              
              console.log(`✅ Parsed ${records.length} CSV records (relaxed mode)`);
            } catch (retryError: any) {
              return res.status(400).json({ 
                message: "Failed to parse CSV file", 
                error: `CSV parsing error: ${csvError.message}. Please ensure your CSV file is properly formatted.` 
              });
            }
          }
        }

        // Get or create a manual account for CSV imports
        let accounts = await storage.getAccounts(userId);
        let importAccount = accounts.find(
          (a) => a.accountName === "CSV Import" && a.isManual
        );

        if (!importAccount) {
          importAccount = await storage.createAccount({
            userId,
            institutionName: "Manual Import",
            accountName: "CSV Import",
            accountType: "checking",
            isManual: true,
          });
        }

        // Get categories for auto-categorization
        const categories = await storage.getCategories(userId);
        
        // Helper function to find column by multiple possible names (case-insensitive)
        const findColumn = (record: any, possibleNames: string[]): string | undefined => {
          const recordKeys = Object.keys(record);
          for (const name of possibleNames) {
            // Exact match (case-insensitive)
            const found = recordKeys.find(key => key.toLowerCase() === name.toLowerCase());
            if (found && record[found]) return record[found];
            // Partial match
            const partial = recordKeys.find(key => key.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(key.toLowerCase()));
            if (partial && record[partial]) return record[partial];
          }
          return undefined;
        };

        // Helper function to parse date from various formats
        const parseDate = (dateStr: string | undefined): Date => {
          if (!dateStr) return new Date();
          
          const str = String(dateStr).trim();
          if (!str) return new Date();

          try {
            // Try ISO format first
            const isoDate = new Date(str);
            if (!Number.isNaN(isoDate.getTime())) {
              return isoDate;
            }

            // Try MM/DD/YY, MM/DD/YYYY, M/D/YY, M/D/YYYY formats
            const parts = str.split(/[-\/]/).map(p => p.trim());
            if (parts.length === 3) {
              let month = Number.parseInt(parts[0], 10);
              let day = Number.parseInt(parts[1], 10);
              let year = Number.parseInt(parts[2], 10);
              
              // Handle 2-digit years
              if (year < 100) {
                year += 2000; // Assume 2000s
              }
              
              // Validate month/day
              if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
                const date = new Date(year, month - 1, day);
                if (!Number.isNaN(date.getTime())) {
                  return date;
                }
              }
            }
          } catch {
            // Fall through to default
          }
          
          return new Date();
        };

        // Helper function to extract merchant name from description
        const extractMerchantName = (description: string): string | null => {
          if (!description) return null;
          
          // Remove common prefixes/suffixes
          let merchant = description
            .replace(/^TST\*/i, '')
            .replace(/^APLPAY\s*/i, '')
            .replace(/\s*#\d+.*$/i, '') // Remove store numbers
            .replace(/\s*\d{10,}.*$/i, '') // Remove long numbers
            .trim();
          
          // Take first line if multi-line
          merchant = merchant.split('\n')[0].split('/')[0].trim();
          
          return merchant || null;
        };
        
        // Auto-categorization function
        const categorizeTransaction = (description: string, amount: number, isIncome: boolean): string | null => {
          if (!description) return null;
          
          const descLower = description.toLowerCase();
          
          // Income categories
          if (isIncome) {
            if (descLower.includes("salary") || descLower.includes("payroll") || descLower.includes("paycheck")) {
              return categories.find(c => c.name === "Salary" && c.type === "income")?.id || null;
            }
            if (descLower.includes("freelance") || descLower.includes("contract")) {
              return categories.find(c => c.name === "Freelance" && c.type === "income")?.id || null;
            }
            if (descLower.includes("investment") || descLower.includes("dividend")) {
              return categories.find(c => c.name === "Investments" && c.type === "income")?.id || null;
            }
            return categories.find(c => c.name === "Other Income" && c.type === "income")?.id || null;
          }
          
          // Expense categories
          if (descLower.includes("grocery") || descLower.includes("supermarket") || descLower.includes("walmart") || descLower.includes("target") || descLower.includes("costco") || descLower.includes("trader joe")) {
            return categories.find(c => c.name === "Groceries" && c.type === "expense")?.id || null;
          }
          if (descLower.includes("restaurant") || descLower.includes("cafe") || descLower.includes("starbucks") || descLower.includes("mcdonald") || descLower.includes("dining") || descLower.includes("taco bell")) {
            return categories.find(c => c.name === "Dining" && c.type === "expense")?.id || null;
          }
          if (descLower.includes("gas") || descLower.includes("fuel") || descLower.includes("uber") || descLower.includes("lyft") || descLower.includes("taxi") || descLower.includes("parking")) {
            return categories.find(c => c.name === "Transportation" && c.type === "expense")?.id || null;
          }
          if (descLower.includes("hotel") || descLower.includes("airline") || descLower.includes("flight") || descLower.includes("airbnb") || descLower.includes("travel") || descLower.includes("frontier")) {
            return categories.find(c => c.name === "Travel" && c.type === "expense")?.id || null;
          }
          if (descLower.includes("netflix") || descLower.includes("spotify") || descLower.includes("subscription") || descLower.includes("prime") || descLower.includes("apple") || descLower.includes("cable & pay tv")) {
            return categories.find(c => c.name === "Subscriptions" && c.type === "expense")?.id || null;
          }
          if (descLower.includes("insurance") || descLower.includes("geico") || descLower.includes("state farm")) {
            return categories.find(c => c.name === "Insurance" && c.type === "expense")?.id || null;
          }
          if (descLower.includes("hospital") || descLower.includes("pharmacy") || descLower.includes("medical") || descLower.includes("doctor") || descLower.includes("cvs") || descLower.includes("walgreens")) {
            return categories.find(c => c.name === "Healthcare" && c.type === "expense")?.id || null;
          }
          if (descLower.includes("amazon") || descLower.includes("shop") || descLower.includes("store") || descLower.includes("retail")) {
            return categories.find(c => c.name === "Shopping" && c.type === "expense")?.id || null;
          }
          if (descLower.includes("movie") || descLower.includes("theater") || descLower.includes("entertainment") || descLower.includes("game")) {
            return categories.find(c => c.name === "Entertainment" && c.type === "expense")?.id || null;
          }
          if (descLower.includes("rent") || descLower.includes("mortgage") || descLower.includes("housing") || descLower.includes("apartment")) {
            return categories.find(c => c.name === "Housing" && c.type === "expense")?.id || null;
          }
          if (descLower.includes("electric") || descLower.includes("water") || descLower.includes("utility") || descLower.includes("internet") || descLower.includes("phone")) {
            return categories.find(c => c.name === "Utilities" && c.type === "expense")?.id || null;
          }
          if (descLower.includes("fee") || descLower.includes("interest") || descLower.includes("charge")) {
            return categories.find(c => c.name === "Fees & Interest" && c.type === "expense")?.id || null;
          }
          
          // Default to "Other" if no match
          return categories.find(c => c.name === "Other" && c.type === "expense")?.id || null;
        };

        // Parse transactions from CSV
        const transactionsToCreate = records
          .map((record: any) => {
            // Find date column - support multiple formats
            const dateStr = findColumn(record, [
              "date", "transaction date", "tran date", "post date", 
              "transaction_date", "tran_date", "post_date"
            ]);
            
            // Find description column - support multiple formats
            const description = findColumn(record, [
              "description", "transaction description", "memo", "name",
              "transaction_description", "merchant", "vendor"
            ]);
            
            // Find amount column
            const amount = findColumn(record, ["amount", "transaction amount"]);
            
            // Find type column (for debit/credit detection)
            const type = findColumn(record, ["type", "transaction type"]);
            
            // Skip balance rows
            const descLower = (description || "").toLowerCase();
            if (descLower.includes("opening balance") || 
                descLower.includes("beginning balance") || 
                descLower.includes("starting balance") ||
                descLower.includes("balance") && !amount) {
              return null;
            }

            // Skip if missing essential fields
            if (!dateStr || !description || !amount) {
              return null;
            }

            // Parse amount - remove currency symbols and commas
            const amountStr = String(amount).replace(/[$,()]/g, "");
            let parsedAmount = Number.parseFloat(amountStr);
            
            // Handle parentheses as negative (accounting format)
            if (String(amount).includes("(") && String(amount).includes(")")) {
              parsedAmount = -Math.abs(parsedAmount);
            }
            
            // Determine income/expense
            // Credit cards: positive = expense, negative = income (refund)
            // Debit cards: positive = expense, negative = income (deposit)
            // Some banks use TYPE column: "DEBIT" = expense, "CREDIT" = income
            let isIncome = false;
            if (type) {
              const typeUpper = String(type).toUpperCase();
              isIncome = typeUpper.includes("CREDIT") || typeUpper.includes("DEPOSIT");
            } else {
              // Default: negative amount = income (money coming in)
              isIncome = parsedAmount < 0;
            }

            // Parse date
            const parsedDate = parseDate(dateStr);

            // Clean up description (handle multi-line, remove extra whitespace)
            const cleanDescription = String(description)
              .split('\n')
              .map(line => line.trim())
              .filter(line => line)
              .join(' / ')
              .replace(/\s+/g, ' ')
              .trim() || "Unknown";

            // Extract merchant name
            const merchantName = extractMerchantName(cleanDescription);

          // Auto-categorize
            let categoryId = categorizeTransaction(cleanDescription, Math.abs(parsedAmount), isIncome);
            
            // CRITICAL: If a category is assigned, update isIncome based on category type
            // This ensures income/expense calculations are correct even if initial isIncome was wrong
            if (categoryId) {
              const category = categories.find(c => c.id === categoryId);
              if (category) {
                // Income, investment, and savings categories should be counted as income
                // Only expense categories should be counted as expenses
                isIncome = category.type === "income" || 
                          category.type === "investment" || 
                          category.type === "savings";
                console.log(`✅ Set isIncome to ${isIncome} based on category type: ${category.type} (${category.name})`);
              }
            }

          return {
            userId,
            accountId: importAccount!.id,
            date: parsedDate,
              description: cleanDescription,
              originalDescription: cleanDescription,
              amount: String(Math.abs(parsedAmount)),
            isIncome,
            categoryId,
              merchantName,
          };
          })
          .filter((t): t is NonNullable<typeof t> => t !== null); // Remove skipped rows

        let cloudImported = 0;
        let localImported = 0;
        
        // Save to cloud database if destination is "cloud" or "both"
        if (destination === "cloud" || destination === "both") {
        const created = await storage.createTransactions(transactionsToCreate);
          cloudImported = created.length;
          console.log(`✅ Imported ${cloudImported} transactions to cloud database`);
          
          // Calculate and update account balance from all transactions
          const allTransactions = await storage.getTransactions(userId, {
            startDate: undefined,
            endDate: undefined,
          });
          
          const accountTransactions = allTransactions.transactions.filter(
            (t) => t.accountId === importAccount!.id
          );
          
          const balance = accountTransactions.reduce((sum, t) => {
            const amount = parseFloat(t.amount);
            return sum + (t.isIncome ? amount : -amount);
          }, 0);
          
          await storage.updateAccount(importAccount!.id, {
            currentBalance: String(balance),
          });
        }
        
        // Save to local database if destination is "local" or "both"
        if (destination === "local" || destination === "both") {
          try {
            const { getLocalDb, localSchema } = await import("./dbLocal");
            const localDb = getLocalDb();
            
            // Use the exact same schema reference that was used to create localDb
            const localAccounts = localSchema.accounts;
            const localTransactionsTable = localSchema.transactions;
            
            // Verify local database connection and schema
            try {
              // @ts-ignore - drizzle type inference issue with dynamic imports
              await localDb.select().from(localAccounts).limit(1);
            } catch (schemaError: any) {
              console.error("❌ Local database schema error:", schemaError.message);
              throw new Error(
                `Local database schema may not be set up. Please run: LOCAL_DATABASE_URL=your_url npm run db:push\n` +
                `Original error: ${schemaError.message}`
              );
            }
            
            // Ensure user exists in local database (fix foreign key constraint)
            const localUsers = localSchema.users;
            const localCategories = localSchema.categories;
            // @ts-ignore
            const [existingUser] = await localDb.select().from(localUsers).where(eq(localUsers.id, userId)).limit(1);
            
            // IMPORTANT: Sync categories FIRST before processing transactions
            // This ensures all category IDs exist in local DB before we try to use them
            console.log("🔄 Syncing categories to local database...");
            
            if (!existingUser) {
              // Get user from cloud database and create in local
              const cloudUser = await storage.getUser(userId);
              if (cloudUser) {
                try {
                  // @ts-ignore
                  await localDb.insert(localUsers).values({
                    id: cloudUser.id,
                    email: cloudUser.email || null,
                    firstName: cloudUser.firstName || null,
                    lastName: cloudUser.lastName || null,
                    authProvider: cloudUser.authProvider || "email",
                  }).onConflictDoNothing();
                  console.log("✅ Created user in local database");
                } catch (insertError: any) {
                  // If onConflictDoNothing doesn't work, try regular insert and catch duplicate
                  if (insertError.code === '23505') { // Unique violation
                    console.log("ℹ️  User already exists in local database");
                  } else {
                    throw insertError;
                  }
                }
              } else {
                throw new Error("User not found. Please log in again.");
              }
            }
            
            // Ensure categories exist in local database (fix category foreign key constraint)
            // Get categories from cloud database
            const cloudCategories = await storage.getCategories(userId);
            
            // Get existing local categories
            // @ts-ignore
            let existingLocalCategories = await localDb.select().from(localCategories).where(eq(localCategories.userId, userId));
            const localCategoryMap = new Map(existingLocalCategories.map((c: any) => [c.id, c]));
            
            // Create missing categories in local database
            for (const cloudCat of cloudCategories) {
              if (!localCategoryMap.has(cloudCat.id)) {
                try {
                  // @ts-ignore
                  await localDb.insert(localCategories).values({
                    id: cloudCat.id,
                    userId: cloudCat.userId || userId,
                    name: cloudCat.name,
                    type: cloudCat.type,
                    icon: cloudCat.icon || null,
                    color: cloudCat.color || null,
                    isDefault: cloudCat.isDefault || false,
                    isSystem: cloudCat.isSystem || false,
                    parentId: cloudCat.parentId || null,
                  }).onConflictDoNothing();
                  console.log(`✅ Created category "${cloudCat.name}" (${cloudCat.id}) in local database`);
                  // Add to local map immediately
                  localCategoryMap.set(cloudCat.id, { ...cloudCat, id: cloudCat.id });
                } catch (catError: any) {
                  // Handle duplicate or other errors
                  if (catError.code === '23505') { // Unique violation - already exists
                    console.log(`ℹ️  Category "${cloudCat.name}" already exists in local database`);
                  } else {
                    console.warn(`⚠️  Could not create category "${cloudCat.name}":`, catError.message, catError.code);
                    // Try to get it anyway in case it was created by another process
                    try {
                      // @ts-ignore
                      const [existing] = await localDb.select().from(localCategories).where(eq(localCategories.id, cloudCat.id)).limit(1);
                      if (existing) {
                        localCategoryMap.set(cloudCat.id, existing);
                      }
                    } catch {
                      // Ignore
                    }
                  }
                }
              }
            }
            
            // Refresh local categories after inserts to get updated list
            // @ts-ignore
            existingLocalCategories = await localDb.select().from(localCategories).where(eq(localCategories.userId, userId));
            
            // Create category ID mapping - use same IDs since we're syncing them
            const categoryIdMap = new Map<string, string>();
            for (const cloudCat of cloudCategories) {
              // Since we sync with same IDs, map to itself
              const localCat = existingLocalCategories.find((c: any) => c.id === cloudCat.id);
              if (localCat) {
                categoryIdMap.set(cloudCat.id, localCat.id);
              } else {
                // Fallback: find by name and type
                const localCatByName = existingLocalCategories.find((c: any) => 
                  c.name === cloudCat.name && c.type === cloudCat.type
                );
                if (localCatByName) {
                  categoryIdMap.set(cloudCat.id, localCatByName.id);
                } else {
                  console.warn(`⚠️  Category "${cloudCat.name}" (${cloudCat.id}) not found in local DB after sync`);
                }
              }
            }
            
            console.log(`✅ Synced ${cloudCategories.length} categories to local DB, ${existingLocalCategories.length} total local categories, mapped ${categoryIdMap.size} category IDs`);
            
            // Get or create account in local DB
            // @ts-ignore - drizzle type inference issue with dynamic imports
            const localAccountsResult = await localDb.select().from(localAccounts).where(eq(localAccounts.userId, userId));
            
            // @ts-ignore
            let localImportAccount = localAccountsResult.find(
              (a: any) => a.accountName === "CSV Import" && a.isManual === true
            );
            
            if (!localImportAccount) {
              // @ts-ignore
              const createdAccounts = await localDb.insert(localAccounts).values({
                userId,
                institutionName: "Manual Import",
                accountName: "CSV Import",
                accountType: "checking",
                isManual: true,
                currentBalance: "0",
              }).returning();
              localImportAccount = createdAccounts[0];
            }
            
            // Insert transactions into local DB
            const localImportAccountId = (localImportAccount as any).id;
            
            // Prepare transactions for local DB insert - use InsertTransaction type
            const localTransactionsToInsert = transactionsToCreate.map((t) => {
              // Ensure date is a proper Date object
              let transactionDate: Date;
              if (t.date instanceof Date) {
                transactionDate = t.date;
              } else if (typeof t.date === 'string') {
                transactionDate = new Date(t.date);
              } else {
                transactionDate = new Date();
              }
              
              // Validate required fields
              if (!t.userId || !t.description || !t.amount) {
                throw new Error(`Missing required fields: userId=${!!t.userId}, description=${!!t.description}, amount=${!!t.amount}`);
              }
              
              // Map categoryId from cloud to local if needed
              // CRITICAL: Only use category IDs that exist in local DB
              let localCategoryId: string | null = null;
              if (t.categoryId) {
                // First check if category exists in local DB by ID
                const localCatById = existingLocalCategories.find((c: any) => c.id === t.categoryId);
                if (localCatById) {
                  localCategoryId = t.categoryId;
                } else {
                  // Try to find via mapping
                  const mappedId = categoryIdMap.get(t.categoryId);
                  if (mappedId) {
                    // Verify mapped ID exists
                    const mappedCat = existingLocalCategories.find((c: any) => c.id === mappedId);
                    if (mappedCat) {
                      localCategoryId = mappedId;
                    } else {
                      console.warn(`⚠️  Mapped category ${mappedId} not found in local DB for category ${t.categoryId}`);
                      localCategoryId = null;
                    }
                  } else {
                    // Category doesn't exist in local DB - set to null to avoid foreign key error
                    localCategoryId = null;
                  }
                }
              }
              
              // Final safety check: verify category exists before including it
              if (localCategoryId) {
                const categoryExists = existingLocalCategories.find((c: any) => c.id === localCategoryId);
                if (!categoryExists) {
                  console.warn(`⚠️  Category ${localCategoryId} failed final check, setting to null for transaction: ${t.description?.substring(0, 30)}`);
                  localCategoryId = null;
                }
              }
              
              // Build transaction object matching InsertTransaction type exactly
              const transaction: any = {
                userId: String(t.userId),
                accountId: String(localImportAccountId),
                date: transactionDate,
                description: String(t.description || "Unknown"),
                amount: String(t.amount), // decimal accepts string
                isIncome: Boolean(t.isIncome),
              };
              
              // Only add optional fields if they have truthy values
              if (t.originalDescription && String(t.originalDescription).trim()) {
                transaction.originalDescription = String(t.originalDescription).trim();
              }
              
              // Only include categoryId if it's valid and exists
              // We've already verified it exists in the checks above, so just add it
              if (localCategoryId) {
                transaction.categoryId = localCategoryId;
                
                // CRITICAL: Update isIncome based on category type
                // Income, investment, and savings categories should be counted as income
                // Only expense categories should be counted as expenses
                const category = existingLocalCategories.find((c: any) => c.id === localCategoryId);
                if (category) {
                  transaction.isIncome = category.type === "income" || 
                                         category.type === "investment" || 
                                         category.type === "savings";
                  console.log(`✅ Set isIncome to ${transaction.isIncome} based on category type: ${category.type} (${category.name})`);
                }
              }
              // If localCategoryId is null, we simply don't include it (which is fine - categoryId is nullable in schema)
              
              if (t.merchantName && String(t.merchantName).trim()) {
                transaction.merchantName = String(t.merchantName).trim();
              }
              
              return transaction;
            });
            
            // Insert transactions - drizzle will handle defaults for currency, pending, isRecurring, etc.
            if (localTransactionsToInsert.length > 0) {
              try {
                // Deduplicate by checking for existing transactions with same description, amount, and date
                // This prevents inserting the same transaction multiple times
                const existingTransactions = await localDb
                  .select()
                  .from(localTransactionsTable)
                  .where(eq(localTransactionsTable.userId, userId))
                  .limit(1000); // Get recent transactions to check against
                
                const existingKeys = new Set(
                  existingTransactions.map((t: any) => 
                    `${t.userId}_${t.description}_${t.amount}_${t.date?.toISOString().split('T')[0]}`
                  )
                );
                
                const uniqueTransactions = localTransactionsToInsert.filter((t: any) => {
                  const key = `${t.userId}_${t.description}_${t.amount}_${t.date instanceof Date ? t.date.toISOString().split('T')[0] : t.date}`;
                  return !existingKeys.has(key);
                });
                
                if (uniqueTransactions.length < localTransactionsToInsert.length) {
                  const skipped = localTransactionsToInsert.length - uniqueTransactions.length;
                  console.log(`⚠️  Skipping ${skipped} duplicate transactions (already exist in local DB)`);
                }
                
                if (uniqueTransactions.length > 0) {
                  // @ts-ignore - drizzle type inference issue with dynamic imports
                  await localDb.insert(localTransactionsTable).values(uniqueTransactions);
                  localImported = uniqueTransactions.length;
                  console.log(`✅ Inserted ${localImported} unique transactions to local DB`);
                } else {
                  localImported = 0;
                  console.log(`ℹ️  All transactions already exist in local DB, skipping insert`);
                }
              } catch (insertError: any) {
                console.error("❌ Error inserting transactions to local DB:", {
                  error: insertError.message,
                  code: insertError.code,
                  detail: insertError.detail,
                  hint: insertError.hint,
                  position: insertError.position,
                  firstTransaction: localTransactionsToInsert[0] ? {
                    keys: Object.keys(localTransactionsToInsert[0]),
                    userId: localTransactionsToInsert[0].userId,
                    accountId: localTransactionsToInsert[0].accountId,
                    date: localTransactionsToInsert[0].date,
                    description: localTransactionsToInsert[0].description?.substring(0, 50),
                    amount: localTransactionsToInsert[0].amount,
                    isIncome: localTransactionsToInsert[0].isIncome,
                  } : null,
                });
                throw insertError;
              }
            }
            
            // localImported is already set in the try block above when transactions are inserted
            // If it wasn't set (error case or no transactions), ensure it has a value
            if (localImported === undefined || localImported === null) {
              localImported = 0;
            }
            
            // Update local account balance - recalculate from ALL transactions for this account
            // @ts-ignore
            const allLocalTransactions = await localDb
              .select()
              .from(localTransactionsTable)
              .where(eq(localTransactionsTable.accountId, localImportAccountId));
            
            const localBalance = allLocalTransactions.reduce((sum: number, t: any) => {
              const amount = parseFloat(t.amount);
              return sum + (t.isIncome ? amount : -amount);
            }, 0);
            
            // @ts-ignore - drizzle type inference issue
            await localDb.update(localAccounts)
              .set({ currentBalance: String(localBalance) })
              // @ts-ignore
              .where(eq(localAccounts.id, localImportAccountId));
              
            console.log(`✅ Imported ${localImported} transactions to local PostgreSQL`);
          } catch (localError: any) {
            console.error("⚠️  Error saving to local database:", localError.message);
            if (destination === "local") {
              // If local-only and it fails, throw error
              throw new Error(`Failed to save to local database: ${localError.message}`);
            }
            // If "both" and local fails, continue but report the error
          }
        }
        
        res.json({ 
          imported: cloudImported + localImported,
          cloudImported: destination === "cloud" || destination === "both" ? cloudImported : undefined,
          localImported: destination === "local" || destination === "both" ? localImported : undefined,
          destination
        });
      } catch (error: any) {
        console.error("Error uploading CSV:", error);
        res.status(500).json({ 
          message: "Failed to import transactions",
          error: error.message || String(error)
        });
      }
    }
  );

  // Categories routes
  app.get("/api/categories", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const categories = await storage.getCategories(userId);
      res.json({ categories });
    } catch (error) {
      console.error("Error fetching categories:", error);
      res.status(500).json({ message: "Failed to fetch categories" });
    }
  });

  app.post("/api/categories", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const data = insertCategorySchema.parse({ ...req.body, userId });
      const category = await storage.createCategory(data);
      res.json(category);
    } catch (error) {
      console.error("Error creating category:", error);
      res.status(500).json({ message: "Failed to create category" });
    }
  });

  app.patch("/api/categories/:id", isAuthenticated, async (req: any, res) => {
    try {
      const updated = await storage.updateCategory(req.params.id, req.body);
      if (!updated) {
        return res.status(404).json({ message: "Category not found" });
      }
      res.json(updated);
    } catch (error) {
      console.error("Error updating category:", error);
      res.status(500).json({ message: "Failed to update category" });
    }
  });

  app.delete("/api/categories/:id", isAuthenticated, async (req: any, res) => {
    try {
      await storage.deleteCategory(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting category:", error);
      res.status(500).json({ message: "Failed to delete category" });
    }
  });

  // Analytics routes
  app.get("/api/analytics", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const period = (req.query.period as string) || "current_month";
      const { source } = req.query;
      const dataSource = (source as string) || defaultFinanceDataSource();
      const { start, end } = getDateRange(period);

      let allTransactions: any[] = [];

      // Fetch from cloud database if source is "cloud" or "both"
      if (dataSource === "cloud" || dataSource === "both") {
        const cloudTxns = await storage.getTransactions(userId, {
          startDate: start,
          endDate: end,
        });
        allTransactions.push(...cloudTxns.transactions);
      }

      // Fetch from local database if source is "local" or "both"
      if (dataSource === "local" || dataSource === "both") {
        try {
          const { getLocalDb, localSchema } = await import("./dbLocal");
          const localDb = getLocalDb();
          const localTransactions = localSchema.transactions;
          const { and, eq, gte, lte } = await import("drizzle-orm");
          
          // @ts-ignore
          const localTxns = await localDb
            .select()
            .from(localTransactions)
            .where(and(
              eq(localTransactions.userId, userId),
              gte(localTransactions.date, start),
              lte(localTransactions.date, end)
            ));
          
          allTransactions.push(...localTxns);
        } catch (localError: any) {
          console.warn("⚠️  Could not fetch from local database:", localError.message);
          if (dataSource === "local") {
            throw localError;
          }
        }
      }

      // Deduplicate transactions by ID
      const transactionMap = new Map<string, any>();
      for (const txn of allTransactions) {
        if (!transactionMap.has(txn.id)) {
          transactionMap.set(txn.id, txn);
        }
      }
      const uniqueTransactions = Array.from(transactionMap.values());

      // Calculate analytics from combined transactions
      let totalIncome = 0;
      let totalExpenses = 0;
      const categoryTotals: Record<string, { value: number; name: string; color: string }> = {};
      const monthlyData: Record<string, { income: number; expenses: number }> = {};

      const categories = await storage.getCategories(userId);
      const categoryMap = new Map(categories.map((c) => [c.id, c]));

      for (const tx of uniqueTransactions) {
        const amount = parseFloat(tx.amount);
        const monthKey = tx.date instanceof Date 
          ? tx.date.toISOString().slice(0, 7) 
          : new Date(tx.date).toISOString().slice(0, 7);

        if (!monthlyData[monthKey]) {
          monthlyData[monthKey] = { income: 0, expenses: 0 };
        }

        if (tx.isIncome) {
          totalIncome += Math.abs(amount);
          monthlyData[monthKey].income += Math.abs(amount);
        } else {
          totalExpenses += Math.abs(amount);
          monthlyData[monthKey].expenses += Math.abs(amount);

          if (tx.categoryId) {
            const category = categoryMap.get(tx.categoryId);
            if (category) {
              if (!categoryTotals[category.id]) {
                categoryTotals[category.id] = {
                  name: category.name,
                  value: 0,
                  color: category.color || "#6366f1",
                };
              }
              categoryTotals[category.id].value += Math.abs(amount);
            }
          }
        }
      }

      const netCashFlow = totalIncome - totalExpenses;
      const savingsRate = totalIncome > 0 ? (netCashFlow / totalIncome) * 100 : 0;

      const categoryBreakdown = Object.values(categoryTotals)
        .sort((a, b) => b.value - a.value)
        .slice(0, 10);

      const cashFlowTrend = Object.entries(monthlyData)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, data]) => ({
          date,
          income: data.income,
          expenses: data.expenses,
        }));

      const analytics = {
        totalIncome,
        totalExpenses,
        netCashFlow,
        savingsRate,
        categoryBreakdown,
        cashFlowTrend,
      };

      // Get previous period for comparison
      const periodDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
      const prevEnd = new Date(start.getTime() - 1);
      const prevStart = new Date(prevEnd.getTime() - periodDays * 24 * 60 * 60 * 1000);
      
      // Fetch previous period transactions
      let prevTransactions: any[] = [];
      if (dataSource === "cloud" || dataSource === "both") {
        const prevCloudTxns = await storage.getTransactions(userId, {
          startDate: prevStart,
          endDate: prevEnd,
        });
        prevTransactions.push(...prevCloudTxns.transactions);
      }
      if (dataSource === "local" || dataSource === "both") {
        try {
          const { getLocalDb, localSchema } = await import("./dbLocal");
          const localDb = getLocalDb();
          const localTransactions = localSchema.transactions;
          const { and, eq, gte, lte } = await import("drizzle-orm");
          
          // @ts-ignore
          const prevLocalTxns = await localDb
            .select()
            .from(localTransactions)
            .where(and(
              eq(localTransactions.userId, userId),
              gte(localTransactions.date, prevStart),
              lte(localTransactions.date, prevEnd)
            ));
          
          prevTransactions.push(...prevLocalTxns);
        } catch (localError: any) {
          // Ignore local error for previous period
        }
      }

      // Deduplicate previous transactions
      const prevTransactionMap = new Map<string, any>();
      for (const txn of prevTransactions) {
        if (!prevTransactionMap.has(txn.id)) {
          prevTransactionMap.set(txn.id, txn);
        }
      }
      const uniquePrevTransactions = Array.from(prevTransactionMap.values());

      let previousIncome = 0;
      let previousExpenses = 0;
      for (const tx of uniquePrevTransactions) {
        const amount = parseFloat(tx.amount);
        if (tx.isIncome) {
          previousIncome += Math.abs(amount);
        } else {
          previousExpenses += Math.abs(amount);
        }
      }
      const previousNetCashFlow = previousIncome - previousExpenses;

      res.json({
        ...analytics,
        previousIncome,
        previousExpenses,
        previousNetCashFlow,
      });
    } catch (error) {
      console.error("Error fetching analytics:", error);
      res.status(500).json({ message: "Failed to fetch analytics" });
    }
  });

  // Reports routes
  app.get("/api/reports", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const period = (req.query.period as string) || "last_6_months";
      const { source } = req.query;
      const dataSource = (source as string) || defaultFinanceDataSource();
      const { start, end } = getDateRange(period);

      // Use the same analytics logic as /api/analytics endpoint
      let allTransactions: any[] = [];

      // Fetch from cloud database if source is "cloud" or "both"
      if (dataSource === "cloud" || dataSource === "both") {
        const cloudTxns = await storage.getTransactions(userId, {
          startDate: start,
          endDate: end,
        });
        allTransactions.push(...cloudTxns.transactions);
      }

      // Fetch from local database if source is "local" or "both"
      if (dataSource === "local" || dataSource === "both") {
        try {
          const { getLocalDb, localSchema } = await import("./dbLocal");
          const localDb = getLocalDb();
          const localTransactions = localSchema.transactions;
          const { and, eq, gte, lte } = await import("drizzle-orm");
          
          // @ts-ignore
          const localTxns = await localDb
            .select()
            .from(localTransactions)
            .where(and(
              eq(localTransactions.userId, userId),
              gte(localTransactions.date, start),
              lte(localTransactions.date, end)
            ));
          
          allTransactions.push(...localTxns);
        } catch (localError: any) {
          console.warn("⚠️  Could not fetch from local database:", localError.message);
          if (dataSource === "local") {
            throw localError;
          }
        }
      }

      // Deduplicate transactions by ID
      const transactionMap = new Map<string, any>();
      for (const txn of allTransactions) {
        if (!transactionMap.has(txn.id)) {
          transactionMap.set(txn.id, txn);
        }
      }
      const uniqueTransactions = Array.from(transactionMap.values());

      // Calculate analytics from combined transactions
      let totalIncome = 0;
      let totalExpenses = 0;
      const categoryTotals: Record<string, { value: number; name: string; color: string }> = {};
      const monthlyData: Record<string, { income: number; expenses: number }> = {};

      // Fetch categories from both cloud and local DB
      let allCategories = await storage.getCategories(userId);
      
      // Also get local categories if needed
      if (dataSource === "local" || dataSource === "both") {
        try {
          const { getLocalDb, localSchema } = await import("./dbLocal");
          const localDb = getLocalDb();
          const localCategories = localSchema.categories;
          const { eq } = await import("drizzle-orm");
          
          // @ts-ignore
          const localCats = await localDb
            .select()
            .from(localCategories)
            .where(eq(localCategories.userId, userId));
          
          // Merge categories, preferring local if duplicate
          const categoryMap = new Map(allCategories.map((c) => [c.id, c]));
          localCats.forEach((c: any) => {
            categoryMap.set(c.id, c);
          });
          allCategories = Array.from(categoryMap.values());
        } catch {
          // Ignore local categories fetch error
        }
      }
      
      const categoryMap = new Map(allCategories.map((c) => [c.id, c]));

      for (const tx of uniqueTransactions) {
        const amount = parseFloat(tx.amount);
        const monthKey = tx.date instanceof Date 
          ? tx.date.toISOString().slice(0, 7) 
          : new Date(tx.date).toISOString().slice(0, 7);

        if (!monthlyData[monthKey]) {
          monthlyData[monthKey] = { income: 0, expenses: 0 };
        }

        // Use isIncome flag to determine income vs expense
        // This flag should be kept in sync with category type when category is updated
        if (tx.isIncome) {
          totalIncome += Math.abs(amount);
          monthlyData[monthKey].income += Math.abs(amount);
        } else {
          totalExpenses += Math.abs(amount);
          monthlyData[monthKey].expenses += Math.abs(amount);

          // Only count expenses in category breakdown (not income)
          if (tx.categoryId) {
            const category = categoryMap.get(tx.categoryId);
            if (category) {
              if (!categoryTotals[category.id]) {
                categoryTotals[category.id] = {
                  name: category.name,
                  value: 0,
                  color: category.color || "#6366f1",
                };
              }
              categoryTotals[category.id].value += Math.abs(amount);
            }
          }
        }
      }

      const netCashFlow = totalIncome - totalExpenses;
      const savingsRate = totalIncome > 0 ? (netCashFlow / totalIncome) * 100 : 0;

      const categoryBreakdown = Object.values(categoryTotals)
        .sort((a, b) => b.value - a.value)
        .slice(0, 10);

      const cashFlowTrend = Object.entries(monthlyData)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, data]) => ({
          date,
          income: data.income,
          expenses: data.expenses,
        }));

      const analytics = {
        totalIncome,
        totalExpenses,
        netCashFlow,
        savingsRate,
        categoryBreakdown,
        cashFlowTrend,
      };

      // Calculate monthly averages
      const months = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 30)));

      res.json({
        incomeVsExpenses: analytics.cashFlowTrend.map((item) => ({
          month: item.date,
          income: item.income,
          expenses: item.expenses,
        })),
        categorySpending: analytics.categoryBreakdown.map((c) => ({
          ...c,
          percentage:
            analytics.totalExpenses > 0
              ? (c.value / analytics.totalExpenses) * 100
              : 0,
        })),
        netWorthTrend: analytics.cashFlowTrend.map((item, index) => {
          let runningTotal = 0;
          for (let i = 0; i <= index; i++) {
            runningTotal += analytics.cashFlowTrend[i].income - analytics.cashFlowTrend[i].expenses;
          }
          return { date: item.date, netWorth: runningTotal };
        }),
        topCategories: analytics.categoryBreakdown.slice(0, 5).map((c) => ({
          ...c,
          amount: c.value,
          change: 0,
        })),
        monthlyStats: {
          avgIncome: analytics.totalIncome / months,
          avgExpenses: analytics.totalExpenses / months,
          avgSavings: analytics.netCashFlow / months,
          bestMonth:
            analytics.cashFlowTrend.length > 0
              ? analytics.cashFlowTrend.reduce((best, current) =>
                  current.income - current.expenses > best.income - best.expenses
                    ? current
                    : best
                ).date
              : "N/A",
          worstMonth:
            analytics.cashFlowTrend.length > 0
              ? analytics.cashFlowTrend.reduce((worst, current) =>
                  current.income - current.expenses < worst.income - worst.expenses
                    ? current
                    : worst
                ).date
              : "N/A",
        },
      });
    } catch (error) {
      console.error("Error fetching reports:", error);
      res.status(500).json({ message: "Failed to fetch reports" });
    }
  });

  // Preferences routes
  app.get("/api/preferences", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      let preferences = await storage.getPreferences(userId);
      if (!preferences) {
        preferences = await storage.upsertPreferences(userId, {});
      }
      res.json({ preferences });
    } catch (error) {
      console.error("Error fetching preferences:", error);
      res.status(500).json({ message: "Failed to fetch preferences" });
    }
  });

  app.patch("/api/preferences", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const preferences = await storage.upsertPreferences(userId, req.body);
      res.json({ preferences });
    } catch (error) {
      console.error("Error updating preferences:", error);
      res.status(500).json({ message: "Failed to update preferences" });
    }
  });

  const tradeJournalCreateBody = z.object({
    symbol: z.string().min(1).max(32),
    strategy: z.string().max(500).optional().nullable(),
    side: z.enum(["long", "short"]),
    instrumentType: z.enum(["stock", "option", "other"]).default("stock"),
    quantity: z.number().int().positive(),
    contractMultiplier: z
      .union([z.string(), z.number()])
      .optional()
      .transform((v) => (v === undefined ? "1" : String(v))),
    entryDate: z.coerce.date(),
    exitDate: z.coerce.date().optional().nullable(),
    entryPrice: z.union([z.string(), z.number()]).transform(String),
    exitPrice: z
      .union([z.string(), z.number()])
      .optional()
      .nullable()
      .transform((v) => (v === null || v === undefined ? null : String(v))),
    fees: z
      .union([z.string(), z.number()])
      .optional()
      .transform((v) => (v === undefined ? "0" : String(v))),
    notes: z.string().optional().nullable(),
  });

  const tradeJournalPatchBody = z.object({
    symbol: z.string().min(1).max(32).optional(),
    strategy: z.string().max(500).optional().nullable(),
    side: z.enum(["long", "short"]).optional(),
    instrumentType: z.enum(["stock", "option", "other"]).optional(),
    quantity: z.number().int().positive().optional(),
    contractMultiplier: z.union([z.string(), z.number()]).optional(),
    entryDate: z.coerce.date().optional(),
    exitDate: z.union([z.coerce.date(), z.null()]).optional(),
    entryPrice: z.union([z.string(), z.number()]).optional(),
    exitPrice: z.union([z.string(), z.number(), z.null()]).optional(),
    fees: z.union([z.string(), z.number()]).optional(),
    notes: z.string().optional().nullable(),
  });

  app.get("/api/trade-journal", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const entries = await storage.getTradeJournalEntries(userId);
      const stats = tradeJournalStats(entries);
      res.json({ entries, stats });
    } catch (error) {
      console.error("Error fetching trade journal:", error);
      res.status(500).json({ message: "Failed to fetch trade journal" });
    }
  });

  app.post("/api/trade-journal", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const parsed = tradeJournalCreateBody.parse(req.body);
      let realizedPnl: string | null = null;
      if (parsed.exitDate && parsed.exitPrice != null) {
        realizedPnl = String(
          computeRealizedPnl({
            side: parsed.side,
            entryPrice: parsed.entryPrice,
            exitPrice: parsed.exitPrice,
            quantity: parsed.quantity,
            contractMultiplier: parsed.contractMultiplier,
            fees: parsed.fees,
          })
        );
      }
      const row = await storage.createTradeJournalEntry(userId, {
        symbol: parsed.symbol.toUpperCase(),
        strategy: parsed.strategy ?? null,
        side: parsed.side,
        instrumentType: parsed.instrumentType,
        quantity: parsed.quantity,
        contractMultiplier: parsed.contractMultiplier,
        entryDate: parsed.entryDate,
        exitDate: parsed.exitDate ?? null,
        entryPrice: parsed.entryPrice,
        exitPrice: parsed.exitPrice ?? null,
        fees: parsed.fees,
        notes: parsed.notes ?? null,
        realizedPnl,
      });
      const entries = await storage.getTradeJournalEntries(userId);
      res.status(201).json({ entry: row, stats: tradeJournalStats(entries) });
    } catch (error: any) {
      if (error?.name === "ZodError") {
        return res.status(400).json({ message: "Invalid trade data", issues: error.issues });
      }
      console.error("Error creating trade journal entry:", error);
      res.status(500).json({ message: "Failed to create trade" });
    }
  });

  app.patch("/api/trade-journal/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const { id } = req.params;
      const partial = tradeJournalPatchBody.parse(req.body);
      const existing = await storage.getTradeJournalEntry(userId, id);
      if (!existing) return res.status(404).json({ message: "Trade not found" });

      const symbol = partial.symbol !== undefined ? partial.symbol.toUpperCase() : existing.symbol;
      const strategy = partial.strategy !== undefined ? partial.strategy : existing.strategy;
      const side = partial.side ?? existing.side;
      const instrumentType = partial.instrumentType ?? existing.instrumentType;
      const quantity = partial.quantity ?? existing.quantity;
      const contractMultiplier =
        partial.contractMultiplier !== undefined ? partial.contractMultiplier : existing.contractMultiplier ?? "1";
      const entryDate = partial.entryDate ?? existing.entryDate;
      const exitDate = partial.exitDate !== undefined ? partial.exitDate : existing.exitDate;
      const entryPrice = partial.entryPrice ?? existing.entryPrice;
      const exitPrice =
        partial.exitPrice !== undefined ? partial.exitPrice : existing.exitPrice != null ? existing.exitPrice : null;
      const fees = partial.fees ?? existing.fees ?? "0";
      const notes = partial.notes !== undefined ? partial.notes : existing.notes;

      let realizedPnl: string | null = null;
      if (exitDate && exitPrice != null) {
        realizedPnl = String(
          computeRealizedPnl({
            side,
            entryPrice,
            exitPrice,
            quantity,
            contractMultiplier: String(contractMultiplier),
            fees: String(fees),
          })
        );
      }

      const row = await storage.updateTradeJournalEntry(userId, id, {
        symbol,
        strategy,
        side,
        instrumentType,
        quantity,
        contractMultiplier: String(contractMultiplier),
        entryDate,
        exitDate,
        entryPrice: String(entryPrice),
        exitPrice: exitPrice != null ? String(exitPrice) : null,
        fees: String(fees),
        notes,
        realizedPnl,
      });
      const entries = await storage.getTradeJournalEntries(userId);
      res.json({ entry: row, stats: tradeJournalStats(entries) });
    } catch (error: any) {
      if (error?.name === "ZodError") {
        return res.status(400).json({ message: "Invalid trade data", issues: error.issues });
      }
      console.error("Error updating trade journal entry:", error);
      res.status(500).json({ message: "Failed to update trade" });
    }
  });

  app.delete("/api/trade-journal/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const { id } = req.params;
      await storage.deleteTradeJournalEntry(userId, id);
      const entries = await storage.getTradeJournalEntries(userId);
      res.json({ stats: tradeJournalStats(entries) });
    } catch (error) {
      console.error("Error deleting trade journal entry:", error);
      res.status(500).json({ message: "Failed to delete trade" });
    }
  });

  return httpServer;
}
