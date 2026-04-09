/**
 * API `source` query: "cloud" = Neon/DATABASE_URL (Render), "local" = LOCAL_DATABASE_URL mirror.
 * Production builds default to cloud so deploys don't call getLocalDb() and 500.
 * Override: VITE_FINANCE_DATA_SOURCE=local when testing a production build against local Postgres.
 */
export type FinanceDataSource = "local" | "cloud";

const env = import.meta.env.VITE_FINANCE_DATA_SOURCE as string | undefined;
export const FINANCE_API_SOURCE: FinanceDataSource =
  env === "local" || env === "cloud"
    ? env
    : import.meta.env.PROD
      ? "cloud"
      : "local";
