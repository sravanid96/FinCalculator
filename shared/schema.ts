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
  uniqueIndex,
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
  password: varchar("password"), // Hashed password, null for OAuth users
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  authProvider: varchar("auth_provider").default("email"), // email, google, replit
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

// Digest trade ideas tracking (performance monitoring)
export const digestTradeIdeas = pgTable("digest_trade_ideas", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  digestDate: timestamp("digest_date").notNull(), // When the digest was sent
  symbol: varchar("symbol").notNull(),
  strategy: varchar("strategy").notNull(), // put_credit_spread, call_credit_spread, etc.
  legsJson: jsonb("legs_json").notNull(), // Full leg details
  entryDate: timestamp("entry_date").notNull(),
  entryCredit: decimal("entry_credit", { precision: 10, scale: 4 }).notNull(), // Credit received
  expirationDate: varchar("expiration_date").notNull(),
  underlyingPriceAtEntry: decimal("underlying_price_at_entry", { precision: 12, scale: 2 }).notNull(),
  shortStrike: decimal("short_strike", { precision: 12, scale: 2 }).notNull(),
  longStrike: decimal("long_strike", { precision: 12, scale: 2 }),
  maxProfit: decimal("max_profit", { precision: 10, scale: 2 }).notNull(),
  maxLoss: decimal("max_loss", { precision: 10, scale: 2 }).notNull(),
  profitTargetPrice: decimal("profit_target_price", { precision: 10, scale: 4 }), // 50% of credit
  probabilityOfProfit: decimal("probability_of_profit", { precision: 5, scale: 2 }),
  historicalEdge: varchar("historical_edge"), // strong, positive, flat, negative at time of pick
  // Outcome tracking
  status: varchar("status").notNull().default("open"), // open, won, lost, expired, closed_early
  exitDate: timestamp("exit_date"),
  exitReason: varchar("exit_reason"), // profit_target, stop_loss, expiration, dte_management
  underlyingPriceAtExit: decimal("underlying_price_at_exit", { precision: 12, scale: 2 }),
  actualPnl: decimal("actual_pnl", { precision: 10, scale: 2 }),
  actualPnlPct: decimal("actual_pnl_pct", { precision: 6, scale: 2 }),
  daysHeld: integer("days_held"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_digest_ideas_status").on(table.status),
  index("idx_digest_ideas_symbol").on(table.symbol),
]);

export type DigestTradeIdea = typeof digestTradeIdeas.$inferSelect;
export type InsertDigestTradeIdea = typeof digestTradeIdeas.$inferInsert;

// Public email subscriptions (no account required)
export const emailSubscriptions = pgTable("email_subscriptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").notNull().unique(),
  digestType: varchar("digest_type").notNull().default("weekly_market"), // weekly_market, etc.
  isVerified: boolean("is_verified").default(false),
  verifyToken: varchar("verify_token"),
  unsubscribeToken: varchar("unsubscribe_token").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  unsubscribedAt: timestamp("unsubscribed_at"),
});

export const insertEmailSubscriptionSchema = createInsertSchema(emailSubscriptions).omit({
  id: true,
  createdAt: true,
});
export type EmailSubscription = typeof emailSubscriptions.$inferSelect;
export type InsertEmailSubscription = typeof emailSubscriptions.$inferInsert;

// User preferences
export const userPreferences = pgTable("user_preferences", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  theme: varchar("theme").default("system"),
  currency: varchar("currency").default("USD"),
  dateFormat: varchar("date_format").default("MM/DD/YYYY"),
  /** Opt-in for weekly market + options ideas email digest */
  weeklyMarketDigestEmail: boolean("weekly_market_digest_email").default(false),
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

// Trading journal (win rate, profit factor on closed trades)
export const tradeJournal = pgTable(
  "trade_journal",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    symbol: varchar("symbol").notNull(),
    strategy: varchar("strategy"),
    side: varchar("side").notNull(), // long | short
    instrumentType: varchar("instrument_type").notNull().default("stock"), // stock | option | other
    quantity: integer("quantity").notNull(),
    contractMultiplier: decimal("contract_multiplier", { precision: 12, scale: 4 }).default("1"),
    entryDate: timestamp("entry_date").notNull(),
    exitDate: timestamp("exit_date"),
    entryPrice: decimal("entry_price", { precision: 16, scale: 6 }).notNull(),
    exitPrice: decimal("exit_price", { precision: 16, scale: 6 }),
    fees: decimal("fees", { precision: 12, scale: 2 }).default("0"),
    realizedPnl: decimal("realized_pnl", { precision: 16, scale: 2 }),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [index("idx_trade_journal_user").on(table.userId)]
);

export const insertTradeJournalSchema = createInsertSchema(tradeJournal).omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
});

export type TradeJournalEntry = typeof tradeJournal.$inferSelect;
export type InsertTradeJournal = z.infer<typeof insertTradeJournalSchema>;

// Saved option trade ideas (watchlist) — backtest P/L at expiry vs underlying settlement
export const optionsWatchlist = pgTable(
  "options_watchlist",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    symbol: varchar("symbol").notNull(),
    strategy: varchar("strategy").notNull(),
    ideaJson: jsonb("idea_json").notNull(),
    entryUnderlyingPrice: decimal("entry_underlying_price", { precision: 14, scale: 4 }).notNull(),
    expirationDate: varchar("expiration_date").notNull(),
    settledAt: timestamp("settled_at"),
    settlementUnderlying: decimal("settlement_underlying", { precision: 14, scale: 4 }),
    settlementPnl: decimal("settlement_pnl", { precision: 16, scale: 2 }),
    outcome: varchar("outcome"),
    /** When set, a trade journal row was created for this settlement (idempotent sync). */
    tradeJournalEntryId: varchar("trade_journal_entry_id"),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [index("idx_options_watchlist_user").on(table.userId)]
);

export type OptionsWatchlistRow = typeof optionsWatchlist.$inferSelect;

// Raw brokerage activity rows imported from monthly CSV exports.
// Aggregated client-side/server-side into positions, gains, and option P&L.
export const brokerageActivities = pgTable(
  "brokerage_activities",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    activityDate: timestamp("activity_date").notNull(),
    processDate: timestamp("process_date"),
    settleDate: timestamp("settle_date"),
    instrument: varchar("instrument"),
    description: text("description").notNull(),
    transCode: varchar("trans_code").notNull(),
    quantity: decimal("quantity", { precision: 20, scale: 8 }),
    price: decimal("price", { precision: 20, scale: 6 }),
    amount: decimal("amount", { precision: 18, scale: 2 }).notNull(),
    optionType: varchar("option_type"),
    optionStrike: decimal("option_strike", { precision: 18, scale: 4 }),
    optionExpiration: timestamp("option_expiration"),
    rowHash: varchar("row_hash").notNull(),
    sourceFileName: varchar("source_file_name"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("idx_brokerage_user_date").on(table.userId, table.activityDate),
    uniqueIndex("uq_brokerage_user_hash").on(table.userId, table.rowHash),
  ]
);

export type BrokerageActivity = typeof brokerageActivities.$inferSelect;
export type InsertBrokerageActivity = typeof brokerageActivities.$inferInsert;

// Relations
export const usersRelations = relations(users, ({ many, one }) => ({
  accounts: many(accounts),
  transactions: many(transactions),
  categories: many(categories),
  preferences: one(userPreferences),
  tradeJournalEntries: many(tradeJournal),
  optionsWatchlistEntries: many(optionsWatchlist),
  brokerageActivities: many(brokerageActivities),
}));

export const brokerageActivitiesRelations = relations(brokerageActivities, ({ one }) => ({
  user: one(users, { fields: [brokerageActivities.userId], references: [users.id] }),
}));

export const tradeJournalRelations = relations(tradeJournal, ({ one }) => ({
  user: one(users, { fields: [tradeJournal.userId], references: [users.id] }),
}));

export const optionsWatchlistRelations = relations(optionsWatchlist, ({ one }) => ({
  user: one(users, { fields: [optionsWatchlist.userId], references: [users.id] }),
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

// ==================== Health Tables (local DB only) ====================

export const healthLabReports = pgTable("health_lab_reports", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  fileName: varchar("file_name").notNull(),
  reportDate: varchar("report_date"),
  labName: varchar("lab_name"),
  parsedResults: jsonb("parsed_results").notNull().default([]),
  rawText: text("raw_text").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const healthConditions = pgTable("health_conditions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  name: varchar("name").notNull(),
  severity: varchar("severity").notNull().default("moderate"),
  diagnosedDate: varchar("diagnosed_date"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const healthMedications = pgTable("health_medications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  name: varchar("name").notNull(),
  dosage: varchar("dosage").notNull(),
  frequency: varchar("frequency").notNull(),
  timesOfDay: jsonb("times_of_day").notNull().default([]),
  purpose: varchar("purpose"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const healthDietEntries = pgTable("health_diet_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  mealType: varchar("meal_type").notNull(),
  foods: jsonb("foods").notNull().default([]),
  typicalTime: varchar("typical_time"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const healthRecommendations = pgTable("health_recommendations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  medicationSchedule: jsonb("medication_schedule").notNull().default([]),
  mealPlan: jsonb("meal_plan").notNull().default([]),
  foodAdjustments: jsonb("food_adjustments").notNull().default([]),
  exerciseRoutine: jsonb("exercise_routine").notNull().default({}),
  insights: jsonb("insights").notNull().default([]),
  summary: text("summary").notNull().default(""),
  generatedAt: timestamp("generated_at").defaultNow(),
});

export const insertHealthLabReportSchema = createInsertSchema(healthLabReports).omit({ id: true, createdAt: true });
export const insertHealthConditionSchema = createInsertSchema(healthConditions).omit({ id: true, createdAt: true });
export const insertHealthMedicationSchema = createInsertSchema(healthMedications).omit({ id: true, createdAt: true });
export const insertHealthDietEntrySchema = createInsertSchema(healthDietEntries).omit({ id: true, createdAt: true });
export const insertHealthRecommendationSchema = createInsertSchema(healthRecommendations).omit({ id: true, generatedAt: true });

export type HealthLabReport = typeof healthLabReports.$inferSelect;
export type InsertHealthLabReport = z.infer<typeof insertHealthLabReportSchema>;
export type HealthCondition = typeof healthConditions.$inferSelect;
export type InsertHealthCondition = z.infer<typeof insertHealthConditionSchema>;
export type HealthMedication = typeof healthMedications.$inferSelect;
export type InsertHealthMedication = z.infer<typeof insertHealthMedicationSchema>;
export type HealthDietEntry = typeof healthDietEntries.$inferSelect;
export type InsertHealthDietEntry = z.infer<typeof insertHealthDietEntrySchema>;
export type HealthRecommendation = typeof healthRecommendations.$inferSelect;
export type InsertHealthRecommendation = z.infer<typeof insertHealthRecommendationSchema>;
