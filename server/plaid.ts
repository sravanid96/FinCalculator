import { storage } from "./storage";

let plaidClient: any = null;
let plaidModule: any = null;
let plaidInitialized = false;

export async function initializePlaid(): Promise<boolean> {
  if (plaidInitialized) {
    return plaidClient !== null;
  }

  plaidInitialized = true;

  try {
    // Try to import Plaid - it may not be installed
    plaidModule = await import("plaid");
  } catch (error) {
    console.warn("⚠️  Plaid package not installed. Run: npm install plaid");
    return false;
  }

  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  const environment = process.env.PLAID_ENV || "sandbox";

  if (!clientId || !secret) {
    console.warn("⚠️  Plaid credentials not configured. Set PLAID_CLIENT_ID and PLAID_SECRET environment variables.");
    return false;
  }

  const { Configuration, PlaidApi, PlaidEnvironments, Products, CountryCode } = plaidModule;

  const configuration = new Configuration({
    basePath: PlaidEnvironments[environment as keyof typeof PlaidEnvironments] || PlaidEnvironments.sandbox,
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": clientId,
        "PLAID-SECRET": secret,
      },
    },
  });

  plaidClient = new PlaidApi(configuration);
  console.log("✅ Plaid client initialized");
  return true;
}

export function isPlaidConfigured(): boolean {
  return plaidClient !== null && plaidModule !== null;
}

export async function createLinkToken(userId: string): Promise<string> {
  if (!plaidClient || !plaidModule) {
    // Try to initialize if not already done
    const initialized = await initializePlaid();
    if (!initialized || !plaidClient || !plaidModule) {
      throw new Error("Plaid is not configured. Please install the plaid package and set PLAID_CLIENT_ID and PLAID_SECRET environment variables.");
    }
  }

  const { Products, CountryCode } = plaidModule;

  const request = {
    user: {
      client_user_id: userId,
    },
    client_name: "FinCal",
    products: [Products.Transactions],
    country_codes: [CountryCode.Us],
    language: "en",
  };

  try {
    const response = await plaidClient.linkTokenCreate(request);
    return response.data.link_token;
  } catch (error: any) {
    console.error("Error creating Plaid link token:", error);
    throw new Error(`Failed to create link token: ${error.message}`);
  }
}

export async function exchangePublicToken(publicToken: string, userId: string): Promise<{
  itemId: string;
  accessToken: string;
  accounts: Array<{
    accountId: string;
    name: string;
    type: string;
    subtype: string | null;
    mask: string | null;
    balances: {
      current: number;
      available: number | null;
    };
  }>;
}> {
  if (!plaidClient || !plaidModule) {
    // Try to initialize if not already done
    const initialized = await initializePlaid();
    if (!initialized || !plaidClient || !plaidModule) {
      throw new Error("Plaid is not configured. Please install the plaid package and set PLAID_CLIENT_ID and PLAID_SECRET environment variables.");
    }
  }

  try {
    // Exchange public token for access token
    const exchangeResponse = await plaidClient.itemPublicTokenExchange({
      public_token: publicToken,
    });

    const accessToken = exchangeResponse.data.access_token;
    const itemId = exchangeResponse.data.item_id;

    // Get accounts
    const accountsResponse = await plaidClient.accountsGet({
      access_token: accessToken,
    });

    const accounts = accountsResponse.data.accounts.map((acc: any) => ({
      accountId: acc.account_id,
      name: acc.name,
      type: acc.type,
      subtype: acc.subtype,
      mask: acc.mask,
      balances: {
        current: acc.balances.current || 0,
        available: acc.balances.available || null,
      },
    }));

    return {
      itemId,
      accessToken,
      accounts,
    };
  } catch (error: any) {
    console.error("Error exchanging Plaid public token:", error);
    throw new Error(`Failed to exchange public token: ${error.message}`);
  }
}

export async function syncTransactions(
  accessToken: string,
  accountId: string,
  userId: string
): Promise<number> {
  if (!plaidClient || !plaidModule) {
    // Try to initialize if not already done
    const initialized = await initializePlaid();
    if (!initialized || !plaidClient || !plaidModule) {
      throw new Error("Plaid is not configured");
    }
  }

  try {
    // Get transactions from the last 30 days
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30);

    const transactionsResponse = await plaidClient.transactionsGet({
      access_token: accessToken,
      start_date: startDate.toISOString().split("T")[0],
      end_date: endDate.toISOString().split("T")[0],
      account_ids: [accountId],
    });

    const transactions = transactionsResponse.data.transactions;
    const categories = await storage.getCategories(userId);
    const categoryMap = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));

    // Get or find the account
    const accounts = await storage.getAccounts(userId);
    let account = accounts.find((a: any) => a.plaidAccountId === accountId);

    if (!account) {
      // Account should have been created during link, but just in case
      const plaidAccount = transactionsResponse.data.accounts.find((a: any) => a.account_id === accountId);
      if (!plaidAccount) {
        throw new Error("Account not found");
      }

      account = await storage.createAccount({
        userId,
        institutionName: "Plaid",
        accountName: plaidAccount.name,
        accountType: plaidAccount.type as any,
        accountSubtype: plaidAccount.subtype || null,
        mask: plaidAccount.mask || null,
        currentBalance: String(plaidAccount.balances.current || 0),
        availableBalance: plaidAccount.balances.available ? String(plaidAccount.balances.available) : null,
        plaidAccountId: accountId,
        isManual: false,
      });
    }

    // Create transactions
    const transactionsToCreate = transactions.map((tx: any) => {
      const amount = Math.abs(tx.amount);
      const isIncome = tx.amount < 0; // Plaid uses negative for income

      // Auto-categorize
      let categoryId: string | null = null;
      if (tx.category && tx.category.length > 0) {
        const categoryName = tx.category[tx.category.length - 1].toLowerCase();
        categoryId = categoryMap.get(categoryName) || null;
      }

      return {
        userId,
        accountId: account!.id,
        date: new Date(tx.date),
        description: tx.name || tx.merchant_name || "Unknown",
        originalDescription: tx.original_description || tx.name,
        amount: String(amount),
        isIncome,
        categoryId,
        plaidTransactionId: tx.transaction_id,
        merchantName: tx.merchant_name || null,
        pending: tx.pending,
      };
    });

    // Filter out duplicates by checking plaidTransactionId
    const existingTransactions = await storage.getTransactions(userId, {});
    const existingPlaidIds = new Set(
      existingTransactions.transactions
        .filter((t: any) => t.plaidTransactionId)
        .map((t: any) => t.plaidTransactionId!)
    );

    const newTransactions = transactionsToCreate.filter((t: any) => {
      return !t.plaidTransactionId || !existingPlaidIds.has(t.plaidTransactionId);
    });

    if (newTransactions.length > 0) {
      await storage.createTransactions(newTransactions);
    }

    // Update account balance
    const plaidAccount = transactionsResponse.data.accounts.find((a: any) => a.account_id === accountId);
    if (plaidAccount) {
      await storage.updateAccount(account!.id, {
        currentBalance: String(plaidAccount.balances.current || 0),
        availableBalance: plaidAccount.balances.available ? String(plaidAccount.balances.available) : null,
        lastSynced: new Date(),
      });
    }

    return newTransactions.length;
  } catch (error: any) {
    console.error("Error syncing Plaid transactions:", error);
    throw new Error(`Failed to sync transactions: ${error.message}`);
  }
}

