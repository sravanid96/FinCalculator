import {
  users,
  accounts,
  transactions,
  categories,
  transactionSplits,
  userPreferences,
  emailSubscriptions,
  digestTradeIdeas,
  csvMappings,
  tradeJournal,
  brokerageActivities,
  type User,
  type UpsertUser,
  type Account,
  type InsertAccount,
  type Transaction,
  type InsertTransaction,
  type Category,
  type InsertCategory,
  type TransactionSplit,
  type InsertTransactionSplit,
  type UserPreferences,
  type InsertUserPreferences,
  type EmailSubscription,
  type InsertEmailSubscription,
  type DigestTradeIdea,
  type InsertDigestTradeIdea,
  type CsvMapping,
  type InsertCsvMapping,
  type TradeJournalEntry,
  type InsertTradeJournal,
  type BrokerageActivity,
  type InsertBrokerageActivity,
  DEFAULT_CATEGORIES,
} from "@shared/schema";
import { db } from "./db";
import { eq, and, desc, gte, lte, sql, ilike, or, inArray } from "drizzle-orm";
import { buildSignature, buildRowHash } from "./services/brokerageAggregation";

export interface IStorage {
  // User operations
  getUser(id: string): Promise<User | undefined>;
  createRegisteredUser(data: {
    email: string;
    passwordHash: string;
    firstName: string | null;
    lastName: string | null;
  }): Promise<User>;
  upsertUser(user: UpsertUser): Promise<User>;
  deleteUser(id: string): Promise<void>;

  // Account operations
  getAccounts(userId: string): Promise<Account[]>;
  getAccount(id: string): Promise<Account | undefined>;
  createAccount(account: InsertAccount): Promise<Account>;
  updateAccount(id: string, updates: Partial<Account>): Promise<Account | undefined>;
  deleteAccount(id: string): Promise<void>;

  // Transaction operations
  getTransactions(
    userId: string,
    options?: {
      startDate?: Date;
      endDate?: Date;
      categoryId?: string;
      search?: string;
      limit?: number;
      offset?: number;
    }
  ): Promise<{ transactions: Transaction[]; total: number }>;
  getTransaction(id: string): Promise<Transaction | undefined>;
  createTransaction(transaction: InsertTransaction): Promise<Transaction>;
  createTransactions(transactions: InsertTransaction[]): Promise<Transaction[]>;
  updateTransaction(id: string, updates: Partial<Transaction>): Promise<Transaction | undefined>;
  deleteTransaction(id: string): Promise<void>;

  // Category operations
  getCategories(userId: string): Promise<Category[]>;
  getCategory(id: string): Promise<Category | undefined>;
  createCategory(category: InsertCategory): Promise<Category>;
  createDefaultCategories(userId: string): Promise<Category[]>;
  updateCategory(id: string, updates: Partial<Category>): Promise<Category | undefined>;
  deleteCategory(id: string): Promise<void>;

  // User preferences operations
  getPreferences(userId: string): Promise<UserPreferences | undefined>;
  upsertPreferences(userId: string, prefs: Partial<InsertUserPreferences>): Promise<UserPreferences>;
  getWeeklyDigestSubscribers(): Promise<Array<{ email: string; firstName: string | null }>>;

  // Public email subscriptions (no account required)
  createEmailSubscription(email: string, digestType: string): Promise<EmailSubscription>;
  getEmailSubscriptionByEmail(email: string): Promise<EmailSubscription | undefined>;
  getEmailSubscriptionByUnsubscribeToken(token: string): Promise<EmailSubscription | undefined>;
  verifyEmailSubscription(token: string): Promise<EmailSubscription | undefined>;
  unsubscribeEmail(token: string): Promise<void>;
  getActiveEmailSubscriptions(digestType: string): Promise<EmailSubscription[]>;

  // Digest trade ideas tracking
  saveDigestTradeIdea(idea: InsertDigestTradeIdea): Promise<DigestTradeIdea>;
  saveDigestTradeIdeas(ideas: InsertDigestTradeIdea[]): Promise<DigestTradeIdea[]>;
  getOpenDigestTradeIdeas(): Promise<DigestTradeIdea[]>;
  updateDigestTradeIdeaOutcome(
    id: string,
    outcome: {
      status: string;
      exitDate: Date;
      exitReason: string;
      underlyingPriceAtExit: number;
      actualPnl: number;
      actualPnlPct: number;
      daysHeld: number;
    }
  ): Promise<DigestTradeIdea | undefined>;
  getDigestTradeIdeaStats(): Promise<{
    totalTrades: number;
    wins: number;
    losses: number;
    winRate: number;
    totalPnl: number;
    avgPnl: number;
    avgDaysHeld: number;
    byStrategy: Record<string, { wins: number; losses: number; winRate: number; totalPnl: number }>;
  }>;

  // Analytics
  getAnalytics(
    userId: string,
    startDate: Date,
    endDate: Date
  ): Promise<{
    totalIncome: number;
    totalExpenses: number;
    netCashFlow: number;
    savingsRate: number;
    categoryBreakdown: Array<{ name: string; value: number; color: string }>;
    cashFlowTrend: Array<{ date: string; income: number; expenses: number }>;
  }>;

  // Options trade journal
  getTradeJournalEntries(userId: string): Promise<TradeJournalEntry[]>;
  getTradeJournalEntry(userId: string, id: string): Promise<TradeJournalEntry | undefined>;
  createTradeJournalEntry(userId: string, data: InsertTradeJournal): Promise<TradeJournalEntry>;
  updateTradeJournalEntry(
    userId: string,
    id: string,
    updates: Partial<InsertTradeJournal>
  ): Promise<TradeJournalEntry | undefined>;
  deleteTradeJournalEntry(userId: string, id: string): Promise<void>;

  // Brokerage activity (CSV-imported transactions)
  getBrokerageActivities(userId: string): Promise<BrokerageActivity[]>;
  insertBrokerageActivities(rows: InsertBrokerageActivity[]): Promise<number>;
  clearBrokerageActivities(userId: string): Promise<number>;
  dedupAndRehashBrokerageActivities(
    userId: string
  ): Promise<{ deduplicated: number; rehashed: number }>;
}

export class DatabaseStorage implements IStorage {
  // User operations
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const normalized = email.trim().toLowerCase();
    const [user] = await db
      .select()
      .from(users)
      .where(sql`lower(trim(${users.email})) = ${normalized}`);
    return user;
  }

  /** Plain insert for email/password signup (avoid upsert-on-id quirks with server-generated UUIDs). */
  async createRegisteredUser(data: {
    email: string;
    passwordHash: string;
    firstName: string | null;
    lastName: string | null;
  }): Promise<User> {
    const [user] = await db
      .insert(users)
      .values({
        email: data.email.trim().toLowerCase(),
        password: data.passwordHash,
        firstName: data.firstName,
        lastName: data.lastName,
        authProvider: "email",
      })
      .returning();
    if (!user) {
      throw new Error("INSERT users returned no row");
    }
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...userData,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  async deleteUser(id: string): Promise<void> {
    await db.delete(users).where(eq(users.id, id));
  }

  // Account operations
  async getAccounts(userId: string): Promise<Account[]> {
    return db.select().from(accounts).where(eq(accounts.userId, userId));
  }

  async getAccount(id: string): Promise<Account | undefined> {
    const [account] = await db.select().from(accounts).where(eq(accounts.id, id));
    return account;
  }

  async createAccount(account: InsertAccount): Promise<Account> {
    const [created] = await db.insert(accounts).values(account).returning();
    return created;
  }

  async updateAccount(id: string, updates: Partial<Account>): Promise<Account | undefined> {
    const [updated] = await db
      .update(accounts)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(accounts.id, id))
      .returning();
    return updated;
  }

  async deleteAccount(id: string): Promise<void> {
    await db.delete(accounts).where(eq(accounts.id, id));
  }

  // Transaction operations
  async getTransactions(
    userId: string,
    options?: {
      startDate?: Date;
      endDate?: Date;
      categoryId?: string;
      search?: string;
      limit?: number;
      offset?: number;
    }
  ): Promise<{ transactions: Transaction[]; total: number }> {
    const conditions = [eq(transactions.userId, userId)];

    if (options?.startDate) {
      conditions.push(gte(transactions.date, options.startDate));
    }
    if (options?.endDate) {
      conditions.push(lte(transactions.date, options.endDate));
    }
    if (options?.categoryId) {
      conditions.push(eq(transactions.categoryId, options.categoryId));
    }
    if (options?.search) {
      conditions.push(
        or(
          ilike(transactions.description, `%${options.search}%`),
          ilike(transactions.merchantName, `%${options.search}%`)
        )!
      );
    }

    const whereClause = and(...conditions);

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(transactions)
      .where(whereClause);

    const result = await db
      .select()
      .from(transactions)
      .where(whereClause)
      .orderBy(desc(transactions.date))
      .limit(options?.limit || 100)
      .offset(options?.offset || 0);

    return { transactions: result, total: count };
  }

  async getTransaction(id: string): Promise<Transaction | undefined> {
    const [transaction] = await db.select().from(transactions).where(eq(transactions.id, id));
    return transaction;
  }

  async createTransaction(transaction: InsertTransaction): Promise<Transaction> {
    const [created] = await db.insert(transactions).values(transaction).returning();
    return created;
  }

  async createTransactions(txns: InsertTransaction[]): Promise<Transaction[]> {
    if (txns.length === 0) return [];
    return db.insert(transactions).values(txns).returning();
  }

  async updateTransaction(id: string, updates: Partial<Transaction>): Promise<Transaction | undefined> {
    const [updated] = await db
      .update(transactions)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(transactions.id, id))
      .returning();
    return updated;
  }

  async deleteTransaction(id: string): Promise<void> {
    await db.delete(transactions).where(eq(transactions.id, id));
  }

  // Category operations
  async getCategories(userId: string): Promise<Category[]> {
    return db
      .select()
      .from(categories)
      .where(or(eq(categories.userId, userId), eq(categories.isSystem, true)));
  }

  async getCategory(id: string): Promise<Category | undefined> {
    const [category] = await db.select().from(categories).where(eq(categories.id, id));
    return category;
  }

  async createCategory(category: InsertCategory): Promise<Category> {
    const [created] = await db.insert(categories).values(category).returning();
    return created;
  }

  async createDefaultCategories(userId: string): Promise<Category[]> {
    const existingCategories = await db
      .select()
      .from(categories)
      .where(eq(categories.userId, userId));

    if (existingCategories.length > 0) {
      return existingCategories;
    }

    const categoriesToCreate = DEFAULT_CATEGORIES.map((cat) => ({
      userId,
      name: cat.name,
      type: cat.type,
      icon: cat.icon,
      color: cat.color,
      isDefault: true,
    }));

    return db.insert(categories).values(categoriesToCreate).returning();
  }

  async updateCategory(id: string, updates: Partial<Category>): Promise<Category | undefined> {
    const [updated] = await db
      .update(categories)
      .set(updates)
      .where(eq(categories.id, id))
      .returning();
    return updated;
  }

  async deleteCategory(id: string): Promise<void> {
    await db.delete(categories).where(eq(categories.id, id));
  }

  // User preferences operations
  async getPreferences(userId: string): Promise<UserPreferences | undefined> {
    const [prefs] = await db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId));
    return prefs;
  }

  async upsertPreferences(
    userId: string,
    prefs: Partial<InsertUserPreferences>
  ): Promise<UserPreferences> {
    const [result] = await db
      .insert(userPreferences)
      .values({ userId, ...prefs })
      .onConflictDoUpdate({
        target: userPreferences.userId,
        set: { ...prefs, updatedAt: new Date() },
      })
      .returning();
    return result;
  }

  async getWeeklyDigestSubscribers(): Promise<
    Array<{ email: string; firstName: string | null }>
  > {
    const rows = await db
      .select({
        email: users.email,
        firstName: users.firstName,
      })
      .from(userPreferences)
      .innerJoin(users, eq(users.id, userPreferences.userId))
      .where(eq(userPreferences.weeklyMarketDigestEmail, true));

    return rows
      .filter((r): r is { email: string; firstName: string | null } => !!r.email)
      .map((r) => ({
        email: r.email!,
        firstName: r.firstName,
      }));
  }

  // Public email subscriptions
  async createEmailSubscription(
    email: string,
    digestType: string
  ): Promise<EmailSubscription> {
    const unsubscribeToken = crypto.randomUUID();
    const verifyToken = crypto.randomUUID();

    const [result] = await db
      .insert(emailSubscriptions)
      .values({
        email: email.toLowerCase().trim(),
        digestType,
        unsubscribeToken,
        verifyToken,
        isVerified: true, // Auto-verify for now (no email confirmation flow)
      })
      .onConflictDoUpdate({
        target: emailSubscriptions.email,
        set: {
          unsubscribedAt: null, // Re-subscribe if they unsubscribed before
          isVerified: true,
        },
      })
      .returning();
    return result;
  }

  async getEmailSubscriptionByEmail(
    email: string
  ): Promise<EmailSubscription | undefined> {
    const [row] = await db
      .select()
      .from(emailSubscriptions)
      .where(eq(emailSubscriptions.email, email.toLowerCase().trim()));
    return row;
  }

  async getEmailSubscriptionByUnsubscribeToken(
    token: string
  ): Promise<EmailSubscription | undefined> {
    const [row] = await db
      .select()
      .from(emailSubscriptions)
      .where(eq(emailSubscriptions.unsubscribeToken, token));
    return row;
  }

  async verifyEmailSubscription(
    token: string
  ): Promise<EmailSubscription | undefined> {
    const [result] = await db
      .update(emailSubscriptions)
      .set({ isVerified: true, verifyToken: null })
      .where(eq(emailSubscriptions.verifyToken, token))
      .returning();
    return result;
  }

  async unsubscribeEmail(token: string): Promise<void> {
    await db
      .update(emailSubscriptions)
      .set({ unsubscribedAt: new Date() })
      .where(eq(emailSubscriptions.unsubscribeToken, token));
  }

  async getActiveEmailSubscriptions(
    digestType: string
  ): Promise<EmailSubscription[]> {
    return db
      .select()
      .from(emailSubscriptions)
      .where(
        and(
          eq(emailSubscriptions.digestType, digestType),
          eq(emailSubscriptions.isVerified, true),
          sql`${emailSubscriptions.unsubscribedAt} IS NULL`
        )
      );
  }

  // Digest trade ideas tracking
  async saveDigestTradeIdea(idea: InsertDigestTradeIdea): Promise<DigestTradeIdea> {
    const [result] = await db
      .insert(digestTradeIdeas)
      .values(idea)
      .returning();
    return result;
  }

  async saveDigestTradeIdeas(ideas: InsertDigestTradeIdea[]): Promise<DigestTradeIdea[]> {
    if (ideas.length === 0) return [];
    return db
      .insert(digestTradeIdeas)
      .values(ideas)
      .returning();
  }

  async getOpenDigestTradeIdeas(): Promise<DigestTradeIdea[]> {
    return db
      .select()
      .from(digestTradeIdeas)
      .where(eq(digestTradeIdeas.status, "open"))
      .orderBy(digestTradeIdeas.entryDate);
  }

  async updateDigestTradeIdeaOutcome(
    id: string,
    outcome: {
      status: string;
      exitDate: Date;
      exitReason: string;
      underlyingPriceAtExit: number;
      actualPnl: number;
      actualPnlPct: number;
      daysHeld: number;
    }
  ): Promise<DigestTradeIdea | undefined> {
    const [result] = await db
      .update(digestTradeIdeas)
      .set({
        status: outcome.status,
        exitDate: outcome.exitDate,
        exitReason: outcome.exitReason,
        underlyingPriceAtExit: String(outcome.underlyingPriceAtExit),
        actualPnl: String(outcome.actualPnl),
        actualPnlPct: String(outcome.actualPnlPct),
        daysHeld: outcome.daysHeld,
        updatedAt: new Date(),
      })
      .where(eq(digestTradeIdeas.id, id))
      .returning();
    return result;
  }

  async getDigestTradeIdeaStats(): Promise<{
    totalTrades: number;
    wins: number;
    losses: number;
    winRate: number;
    totalPnl: number;
    avgPnl: number;
    avgDaysHeld: number;
    byStrategy: Record<string, { wins: number; losses: number; winRate: number; totalPnl: number }>;
  }> {
    const closedTrades = await db
      .select()
      .from(digestTradeIdeas)
      .where(sql`${digestTradeIdeas.status} != 'open'`);

    const totalTrades = closedTrades.length;
    const wins = closedTrades.filter((t) => t.status === "won").length;
    const losses = closedTrades.filter((t) => t.status === "lost").length;
    const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
    const totalPnl = closedTrades.reduce(
      (sum, t) => sum + (parseFloat(t.actualPnl || "0") || 0),
      0
    );
    const avgPnl = totalTrades > 0 ? totalPnl / totalTrades : 0;
    const avgDaysHeld =
      totalTrades > 0
        ? closedTrades.reduce((sum, t) => sum + (t.daysHeld || 0), 0) / totalTrades
        : 0;

    const byStrategy: Record<
      string,
      { wins: number; losses: number; winRate: number; totalPnl: number }
    > = {};

    for (const trade of closedTrades) {
      const strat = trade.strategy;
      if (!byStrategy[strat]) {
        byStrategy[strat] = { wins: 0, losses: 0, winRate: 0, totalPnl: 0 };
      }
      if (trade.status === "won") byStrategy[strat].wins += 1;
      if (trade.status === "lost") byStrategy[strat].losses += 1;
      byStrategy[strat].totalPnl += parseFloat(trade.actualPnl || "0") || 0;
    }

    for (const strat of Object.keys(byStrategy)) {
      const s = byStrategy[strat];
      const total = s.wins + s.losses;
      s.winRate = total > 0 ? (s.wins / total) * 100 : 0;
    }

    return {
      totalTrades,
      wins,
      losses,
      winRate: Math.round(winRate * 10) / 10,
      totalPnl: Math.round(totalPnl * 100) / 100,
      avgPnl: Math.round(avgPnl * 100) / 100,
      avgDaysHeld: Math.round(avgDaysHeld * 10) / 10,
      byStrategy,
    };
  }

  // Analytics
  async getAnalytics(
    userId: string,
    startDate: Date,
    endDate: Date
  ): Promise<{
    totalIncome: number;
    totalExpenses: number;
    netCashFlow: number;
    savingsRate: number;
    categoryBreakdown: Array<{ name: string; value: number; color: string }>;
    cashFlowTrend: Array<{ date: string; income: number; expenses: number }>;
  }> {
    const txns = await db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          gte(transactions.date, startDate),
          lte(transactions.date, endDate)
        )
      );

    let totalIncome = 0;
    let totalExpenses = 0;

    const categoryTotals: Record<string, { value: number; name: string; color: string }> = {};
    const monthlyData: Record<string, { income: number; expenses: number }> = {};

    const userCategories = await this.getCategories(userId);
    const categoryMap = new Map(userCategories.map((c) => [c.id, c]));

    for (const tx of txns) {
      const amount = parseFloat(tx.amount);
      const monthKey = tx.date.toISOString().slice(0, 7); // YYYY-MM

      if (!monthlyData[monthKey]) {
        monthlyData[monthKey] = { income: 0, expenses: 0 };
      }

      // Amounts are stored as absolute values, so we rely on isIncome flag
      if (tx.isIncome) {
        totalIncome += Math.abs(amount);
        monthlyData[monthKey].income += Math.abs(amount);
      } else {
        totalExpenses += Math.abs(amount);
        monthlyData[monthKey].expenses += Math.abs(amount);

        if (tx.categoryId) {
          const category = categoryMap.get(tx.categoryId);
          if (category) {
            if (!categoryTotals[tx.categoryId]) {
              categoryTotals[tx.categoryId] = {
                value: 0,
                name: category.name,
                color: category.color || "#6366f1",
              };
            }
            categoryTotals[tx.categoryId].value += Math.abs(amount);
          }
        }
      }
    }

    const netCashFlow = totalIncome - totalExpenses;
    const savingsRate = totalIncome > 0 ? (netCashFlow / totalIncome) * 100 : 0;

    const categoryBreakdown = Object.values(categoryTotals)
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);

    const cashFlowTrend = Object.entries(monthlyData)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, data]) => ({
        date: new Date(date + "-01").toLocaleDateString("en-US", {
          month: "short",
          year: "2-digit",
        }),
        income: data.income,
        expenses: data.expenses,
      }));

    return {
      totalIncome,
      totalExpenses,
      netCashFlow,
      savingsRate,
      categoryBreakdown,
      cashFlowTrend,
    };
  }

  async getTradeJournalEntries(userId: string): Promise<TradeJournalEntry[]> {
    return db
      .select()
      .from(tradeJournal)
      .where(eq(tradeJournal.userId, userId))
      .orderBy(desc(tradeJournal.entryDate));
  }

  async getTradeJournalEntry(userId: string, id: string): Promise<TradeJournalEntry | undefined> {
    const [row] = await db
      .select()
      .from(tradeJournal)
      .where(and(eq(tradeJournal.userId, userId), eq(tradeJournal.id, id)));
    return row;
  }

  async createTradeJournalEntry(userId: string, data: InsertTradeJournal): Promise<TradeJournalEntry> {
    const [row] = await db
      .insert(tradeJournal)
      .values({ ...data, userId })
      .returning();
    return row;
  }

  async updateTradeJournalEntry(
    userId: string,
    id: string,
    updates: Partial<InsertTradeJournal>
  ): Promise<TradeJournalEntry | undefined> {
    const [row] = await db
      .update(tradeJournal)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(tradeJournal.id, id), eq(tradeJournal.userId, userId)))
      .returning();
    return row;
  }

  async deleteTradeJournalEntry(userId: string, id: string): Promise<void> {
    await db.delete(tradeJournal).where(and(eq(tradeJournal.id, id), eq(tradeJournal.userId, userId)));
  }

  async getBrokerageActivities(userId: string): Promise<BrokerageActivity[]> {
    return db
      .select()
      .from(brokerageActivities)
      .where(eq(brokerageActivities.userId, userId))
      .orderBy(desc(brokerageActivities.activityDate));
  }

  async insertBrokerageActivities(rows: InsertBrokerageActivity[]): Promise<number> {
    if (rows.length === 0) return 0;
    const inserted = await db
      .insert(brokerageActivities)
      .values(rows)
      .onConflictDoNothing({
        target: [brokerageActivities.userId, brokerageActivities.rowHash],
      })
      .returning({ id: brokerageActivities.id });
    return inserted.length;
  }

  async clearBrokerageActivities(userId: string): Promise<number> {
    const deleted = await db
      .delete(brokerageActivities)
      .where(eq(brokerageActivities.userId, userId))
      .returning({ id: brokerageActivities.id });
    return deleted.length;
  }

  /**
   * Idempotent. Walks the user's brokerage activities and:
   *   1. Collapses rows that share the new dedup signature (same date + instrument +
   *      trans code + qty + price + amount) into a single canonical row, deleting the
   *      duplicates that were imported under the older description-inclusive scheme.
   *   2. Updates the canonical row's rowHash to match the new signature-based hash so
   *      future uploads benefit from the DB unique index too.
   */
  async dedupAndRehashBrokerageActivities(
    userId: string
  ): Promise<{ deduplicated: number; rehashed: number }> {
    const rows = await db
      .select()
      .from(brokerageActivities)
      .where(eq(brokerageActivities.userId, userId));

    if (rows.length === 0) {
      return { deduplicated: 0, rehashed: 0 };
    }

    const groups = new Map<string, BrokerageActivity[]>();
    for (const row of rows) {
      const sig = buildSignature(row);
      const bucket = groups.get(sig);
      if (bucket) {
        bucket.push(row);
      } else {
        groups.set(sig, [row]);
      }
    }

    const toDelete: string[] = [];
    const toRehash: Array<{ id: string; hash: string }> = [];

    for (const [, group] of Array.from(groups.entries())) {
      const sorted = [...group].sort((a, b) => {
        const aCreated = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bCreated = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        if (aCreated !== bCreated) return aCreated - bCreated;
        return a.id.localeCompare(b.id);
      });
      const canonical = sorted[0];
      for (let i = 1; i < sorted.length; i += 1) {
        toDelete.push(sorted[i].id);
      }
      const expectedHash = buildRowHash(canonical);
      if (canonical.rowHash !== expectedHash) {
        toRehash.push({ id: canonical.id, hash: expectedHash });
      }
    }

    if (toDelete.length > 0) {
      await db.delete(brokerageActivities).where(inArray(brokerageActivities.id, toDelete));
    }

    for (const item of toRehash) {
      await db
        .update(brokerageActivities)
        .set({ rowHash: item.hash })
        .where(eq(brokerageActivities.id, item.id));
    }

    return { deduplicated: toDelete.length, rehashed: toRehash.length };
  }
}

export const storage = new DatabaseStorage();
