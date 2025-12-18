import {
  users,
  accounts,
  transactions,
  categories,
  transactionSplits,
  userPreferences,
  csvMappings,
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
  type CsvMapping,
  type InsertCsvMapping,
  DEFAULT_CATEGORIES,
} from "@shared/schema";
import { db } from "./db";
import { eq, and, desc, gte, lte, sql, ilike, or } from "drizzle-orm";

export interface IStorage {
  // User operations
  getUser(id: string): Promise<User | undefined>;
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
}

export class DatabaseStorage implements IStorage {
  // User operations
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
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

      if (tx.isIncome || amount > 0) {
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
}

export const storage = new DatabaseStorage();
