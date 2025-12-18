import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { setupAuth, isAuthenticated } from "./replitAuth";
import {
  insertAccountSchema,
  insertTransactionSchema,
  insertCategorySchema,
} from "@shared/schema";
import { subDays, startOfMonth, endOfMonth, startOfYear, subMonths, subYears } from "date-fns";
import multer from "multer";
import { parse } from "csv-parse/sync";

const upload = multer({ storage: multer.memoryStorage() });

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

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  await setupAuth(app);

  // Auth routes
  app.get("/api/auth/user", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      // Create default categories for new users
      await storage.createDefaultCategories(userId);
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // Delete user account
  app.delete("/api/user", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
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
      const userId = req.user.claims.sub;
      const accounts = await storage.getAccounts(userId);
      res.json({ accounts });
    } catch (error) {
      console.error("Error fetching accounts:", error);
      res.status(500).json({ message: "Failed to fetch accounts" });
    }
  });

  app.get("/api/accounts/summary", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const accounts = await storage.getAccounts(userId);
      const totalBalance = accounts.reduce(
        (sum, acc) => sum + parseFloat(acc.currentBalance || "0"),
        0
      );
      res.json({ totalBalance, accountCount: accounts.length });
    } catch (error) {
      console.error("Error fetching account summary:", error);
      res.status(500).json({ message: "Failed to fetch account summary" });
    }
  });

  app.post("/api/accounts/manual", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const data = insertAccountSchema.parse({
        ...req.body,
        userId,
        isManual: true,
      });
      const account = await storage.createAccount(data);
      res.json(account);
    } catch (error) {
      console.error("Error creating account:", error);
      res.status(500).json({ message: "Failed to create account" });
    }
  });

  app.post("/api/accounts/:id/sync", isAuthenticated, async (req: any, res) => {
    try {
      const account = await storage.getAccount(req.params.id);
      if (!account) {
        return res.status(404).json({ message: "Account not found" });
      }
      // Plaid sync would happen here
      await storage.updateAccount(req.params.id, { lastSynced: new Date() });
      res.json({ success: true });
    } catch (error) {
      console.error("Error syncing account:", error);
      res.status(500).json({ message: "Failed to sync account" });
    }
  });

  app.delete("/api/accounts/:id", isAuthenticated, async (req: any, res) => {
    try {
      await storage.deleteAccount(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting account:", error);
      res.status(500).json({ message: "Failed to delete account" });
    }
  });

  // Transactions routes
  app.get("/api/transactions", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { startDate, endDate, categoryId, search, limit, offset } = req.query;

      const result = await storage.getTransactions(userId, {
        startDate: startDate ? new Date(startDate as string) : undefined,
        endDate: endDate ? new Date(endDate as string) : undefined,
        categoryId: categoryId as string,
        search: search as string,
        limit: limit ? parseInt(limit as string) : undefined,
        offset: offset ? parseInt(offset as string) : undefined,
      });

      // Fetch categories and accounts for enrichment
      const categories = await storage.getCategories(userId);
      const accounts = await storage.getAccounts(userId);
      const categoryMap = new Map(categories.map((c) => [c.id, c]));
      const accountMap = new Map(accounts.map((a) => [a.id, a]));

      const enrichedTransactions = result.transactions.map((t) => ({
        ...t,
        category: t.categoryId ? categoryMap.get(t.categoryId) : undefined,
        account: accountMap.get(t.accountId),
      }));

      res.json({ transactions: enrichedTransactions, total: result.total });
    } catch (error) {
      console.error("Error fetching transactions:", error);
      res.status(500).json({ message: "Failed to fetch transactions" });
    }
  });

  app.get("/api/transactions/recent", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const result = await storage.getTransactions(userId, { limit: 10 });

      const categories = await storage.getCategories(userId);
      const accounts = await storage.getAccounts(userId);
      const categoryMap = new Map(categories.map((c) => [c.id, c]));
      const accountMap = new Map(accounts.map((a) => [a.id, a]));

      const enrichedTransactions = result.transactions.map((t) => ({
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
      const updated = await storage.updateTransaction(req.params.id, req.body);
      if (!updated) {
        return res.status(404).json({ message: "Transaction not found" });
      }
      res.json(updated);
    } catch (error) {
      console.error("Error updating transaction:", error);
      res.status(500).json({ message: "Failed to update transaction" });
    }
  });

  app.delete("/api/transactions/:id", isAuthenticated, async (req: any, res) => {
    try {
      await storage.deleteTransaction(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting transaction:", error);
      res.status(500).json({ message: "Failed to delete transaction" });
    }
  });

  // CSV Upload
  app.post(
    "/api/transactions/upload",
    isAuthenticated,
    upload.single("file"),
    async (req: any, res) => {
      try {
        const userId = req.user.claims.sub;
        const file = req.file;

        if (!file) {
          return res.status(400).json({ message: "No file provided" });
        }

        const csvContent = file.buffer.toString("utf-8");
        const records = parse(csvContent, {
          columns: true,
          skip_empty_lines: true,
          trim: true,
        });

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

        // Parse transactions from CSV
        const transactionsToCreate = records.map((record: any) => {
          // Try to detect column names
          const date = record.Date || record.date || record.DATE || record["Transaction Date"];
          const description =
            record.Description || record.description || record.DESCRIPTION || record.Memo || record.Name;
          const amount = record.Amount || record.amount || record.AMOUNT;

          const parsedAmount = parseFloat(String(amount).replace(/[$,]/g, ""));

          return {
            userId,
            accountId: importAccount!.id,
            date: new Date(date),
            description: description || "Unknown",
            originalDescription: description,
            amount: String(parsedAmount),
            isIncome: parsedAmount > 0,
          };
        });

        const created = await storage.createTransactions(transactionsToCreate);
        res.json({ imported: created.length });
      } catch (error) {
        console.error("Error uploading CSV:", error);
        res.status(500).json({ message: "Failed to import transactions" });
      }
    }
  );

  // Categories routes
  app.get("/api/categories", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const categories = await storage.getCategories(userId);
      res.json({ categories });
    } catch (error) {
      console.error("Error fetching categories:", error);
      res.status(500).json({ message: "Failed to fetch categories" });
    }
  });

  app.post("/api/categories", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
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
      const userId = req.user.claims.sub;
      const period = (req.query.period as string) || "current_month";
      const { start, end } = getDateRange(period);

      const analytics = await storage.getAnalytics(userId, start, end);

      // Get previous period for comparison
      const periodDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
      const prevEnd = new Date(start.getTime() - 1);
      const prevStart = new Date(prevEnd.getTime() - periodDays * 24 * 60 * 60 * 1000);
      const prevAnalytics = await storage.getAnalytics(userId, prevStart, prevEnd);

      res.json({
        ...analytics,
        previousIncome: prevAnalytics.totalIncome,
        previousExpenses: prevAnalytics.totalExpenses,
        previousNetCashFlow: prevAnalytics.netCashFlow,
      });
    } catch (error) {
      console.error("Error fetching analytics:", error);
      res.status(500).json({ message: "Failed to fetch analytics" });
    }
  });

  // Reports routes
  app.get("/api/reports", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const period = (req.query.period as string) || "last_6_months";
      const { start, end } = getDateRange(period);

      const analytics = await storage.getAnalytics(userId, start, end);

      // Calculate monthly averages
      const months = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 30)));

      res.json({
        incomeVsExpenses: analytics.cashFlowTrend,
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
      const userId = req.user.claims.sub;
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
      const userId = req.user.claims.sub;
      const preferences = await storage.upsertPreferences(userId, req.body);
      res.json({ preferences });
    } catch (error) {
      console.error("Error updating preferences:", error);
      res.status(500).json({ message: "Failed to update preferences" });
    }
  });

  return httpServer;
}
