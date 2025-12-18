import { sql, relations } from "drizzle-orm";
import {
  pgTable,
  text,
  varchar,
  timestamp,
  decimal,
  boolean,
  integer,
  index,
  jsonb,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Session storage table for Replit Auth
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)]
);

// Users table for Replit Auth
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Financial accounts (bank accounts, credit cards, investment accounts)
export const accounts = pgTable("accounts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  plaidItemId: varchar("plaid_item_id"),
  plaidAccessToken: varchar("plaid_access_token"),
  plaidAccountId: varchar("plaid_account_id"),
  institutionName: varchar("institution_name").notNull(),
  institutionId: varchar("institution_id"),
  accountName: varchar("account_name").notNull(),
  accountType: varchar("account_type").notNull(), // checking, savings, credit, investment
  accountSubtype: varchar("account_subtype"),
  mask: varchar("mask"), // last 4 digits
  currentBalance: decimal("current_balance", { precision: 12, scale: 2 }).default("0"),
  availableBalance: decimal("available_balance", { precision: 12, scale: 2 }),
  currency: varchar("currency").default("USD"),
  isManual: boolean("is_manual").default(false),
  lastSynced: timestamp("last_synced"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Transaction categories
export const categories = pgTable("categories", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name").notNull(),
  type: varchar("type").notNull(), // income, expense, savings, investment
  icon: varchar("icon"),
  color: varchar("color"),
  isDefault: boolean("is_default").default(false),
  isSystem: boolean("is_system").default(false),
  parentId: varchar("parent_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Transactions
export const transactions = pgTable("transactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  accountId: varchar("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  categoryId: varchar("category_id").references(() => categories.id, { onDelete: "set null" }),
  plaidTransactionId: varchar("plaid_transaction_id"),
  date: timestamp("date").notNull(),
  description: varchar("description").notNull(),
  originalDescription: varchar("original_description"),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  currency: varchar("currency").default("USD"),
  merchantName: varchar("merchant_name"),
  pending: boolean("pending").default(false),
  isRecurring: boolean("is_recurring").default(false),
  isIncome: boolean("is_income").default(false),
  notes: text("notes"),
  tags: text("tags").array(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_transactions_user_date").on(table.userId, table.date),
  index("idx_transactions_category").on(table.categoryId),
]);

// Transaction splits for splitting a transaction across multiple categories
export const transactionSplits = pgTable("transaction_splits", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  transactionId: varchar("transaction_id").notNull().references(() => transactions.id, { onDelete: "cascade" }),
  categoryId: varchar("category_id").notNull().references(() => categories.id, { onDelete: "cascade" }),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  notes: text("notes"),
});

// User preferences
export const userPreferences = pgTable("user_preferences", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  theme: varchar("theme").default("system"),
  currency: varchar("currency").default("USD"),
  dateFormat: varchar("date_format").default("MM/DD/YYYY"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// CSV import mappings saved by user
export const csvMappings = pgTable("csv_mappings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name").notNull(),
  mapping: jsonb("mapping").notNull(), // { date: 0, description: 1, amount: 2, ... }
  dateFormat: varchar("date_format"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Relations
export const usersRelations = relations(users, ({ many, one }) => ({
  accounts: many(accounts),
  transactions: many(transactions),
  categories: many(categories),
  preferences: one(userPreferences),
}));

export const accountsRelations = relations(accounts, ({ one, many }) => ({
  user: one(users, { fields: [accounts.userId], references: [users.id] }),
  transactions: many(transactions),
}));

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  user: one(users, { fields: [categories.userId], references: [users.id] }),
  transactions: many(transactions),
  parent: one(categories, { fields: [categories.parentId], references: [categories.id] }),
}));

export const transactionsRelations = relations(transactions, ({ one, many }) => ({
  user: one(users, { fields: [transactions.userId], references: [users.id] }),
  account: one(accounts, { fields: [transactions.accountId], references: [accounts.id] }),
  category: one(categories, { fields: [transactions.categoryId], references: [categories.id] }),
  splits: many(transactionSplits),
}));

export const transactionSplitsRelations = relations(transactionSplits, ({ one }) => ({
  transaction: one(transactions, { fields: [transactionSplits.transactionId], references: [transactions.id] }),
  category: one(categories, { fields: [transactionSplits.categoryId], references: [categories.id] }),
}));

// Insert schemas
export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true, updatedAt: true });
export const insertAccountSchema = createInsertSchema(accounts).omit({ id: true, createdAt: true, updatedAt: true });
export const insertCategorySchema = createInsertSchema(categories).omit({ id: true, createdAt: true });
export const insertTransactionSchema = createInsertSchema(transactions).omit({ id: true, createdAt: true, updatedAt: true });
export const insertTransactionSplitSchema = createInsertSchema(transactionSplits).omit({ id: true });
export const insertUserPreferencesSchema = createInsertSchema(userPreferences).omit({ id: true, createdAt: true, updatedAt: true });
export const insertCsvMappingSchema = createInsertSchema(csvMappings).omit({ id: true, createdAt: true });

// Types
export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;
export type InsertAccount = z.infer<typeof insertAccountSchema>;
export type Account = typeof accounts.$inferSelect;
export type InsertCategory = z.infer<typeof insertCategorySchema>;
export type Category = typeof categories.$inferSelect;
export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type Transaction = typeof transactions.$inferSelect;
export type InsertTransactionSplit = z.infer<typeof insertTransactionSplitSchema>;
export type TransactionSplit = typeof transactionSplits.$inferSelect;
export type InsertUserPreferences = z.infer<typeof insertUserPreferencesSchema>;
export type UserPreferences = typeof userPreferences.$inferSelect;
export type InsertCsvMapping = z.infer<typeof insertCsvMappingSchema>;
export type CsvMapping = typeof csvMappings.$inferSelect;

// Default expense categories
export const DEFAULT_CATEGORIES = [
  { name: "Housing", type: "expense", icon: "Home", color: "#6366f1" },
  { name: "Utilities", type: "expense", icon: "Zap", color: "#f59e0b" },
  { name: "Groceries", type: "expense", icon: "ShoppingCart", color: "#10b981" },
  { name: "Dining", type: "expense", icon: "Utensils", color: "#ef4444" },
  { name: "Transportation", type: "expense", icon: "Car", color: "#3b82f6" },
  { name: "Travel", type: "expense", icon: "Plane", color: "#8b5cf6" },
  { name: "Subscriptions", type: "expense", icon: "RefreshCw", color: "#ec4899" },
  { name: "Insurance", type: "expense", icon: "Shield", color: "#14b8a6" },
  { name: "Healthcare", type: "expense", icon: "Heart", color: "#f43f5e" },
  { name: "Shopping", type: "expense", icon: "ShoppingBag", color: "#a855f7" },
  { name: "Entertainment", type: "expense", icon: "Film", color: "#06b6d4" },
  { name: "Fees & Interest", type: "expense", icon: "Percent", color: "#84cc16" },
  { name: "Other", type: "expense", icon: "MoreHorizontal", color: "#64748b" },
  { name: "Salary", type: "income", icon: "Briefcase", color: "#22c55e" },
  { name: "Freelance", type: "income", icon: "Laptop", color: "#0ea5e9" },
  { name: "Investments", type: "income", icon: "TrendingUp", color: "#7c3aed" },
  { name: "Other Income", type: "income", icon: "DollarSign", color: "#16a34a" },
  { name: "Savings", type: "savings", icon: "PiggyBank", color: "#0891b2" },
  { name: "Emergency Fund", type: "savings", icon: "Umbrella", color: "#4f46e5" },
  { name: "Stocks", type: "investment", icon: "BarChart3", color: "#059669" },
  { name: "Retirement", type: "investment", icon: "Clock", color: "#7c3aed" },
] as const;

// Time period options for analytics
export const TIME_PERIODS = [
  { value: "current_month", label: "Current Month" },
  { value: "last_month", label: "Last Month" },
  { value: "last_90_days", label: "Last 90 Days" },
  { value: "last_6_months", label: "Last 6 Months" },
  { value: "last_12_months", label: "Last 12 Months" },
  { value: "year_to_date", label: "Year to Date" },
  { value: "prior_year", label: "Prior Year" },
  { value: "all_time", label: "All Time" },
] as const;

export type TimePeriod = typeof TIME_PERIODS[number]["value"];
