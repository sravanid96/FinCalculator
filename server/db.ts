import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

/**
 * Local dev: prefer LOCAL_DATABASE_URL, else DATABASE_URL.
 * Production / Render: prefer DATABASE_URL so a copied .env with LOCAL_DATABASE_URL
 * does not point the live app at localhost.
 */
const isCloudDeploy =
  process.env.NODE_ENV === "production" || process.env.RENDER === "true";

export const databaseConnectionUrl = (
  isCloudDeploy
    ? process.env.DATABASE_URL?.trim() || process.env.LOCAL_DATABASE_URL?.trim()
    : process.env.LOCAL_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim()
) ?? "";

if (!databaseConnectionUrl) {
  throw new Error(
    "Set LOCAL_DATABASE_URL for local Postgres, or DATABASE_URL for cloud.\n" +
    "On Render use DATABASE_URL (Neon). Do not set LOCAL_DATABASE_URL unless you intend it."
  );
}

const isLocalTcp =
  /(^|@)localhost(\/|:|$)/i.test(databaseConnectionUrl) ||
  /(^|@)127\.0\.0\.1(\/|:|$)/i.test(databaseConnectionUrl);

/** Neon / remote hosts: enable TLS (Neon URLs usually include sslmode=require; this covers edge cases). */
const poolConfig: pg.PoolConfig = {
  connectionString: databaseConnectionUrl,
  ...(!isLocalTcp && !/sslmode=disable/i.test(databaseConnectionUrl)
    ? { ssl: { rejectUnauthorized: false } }
    : {}),
};

export const pool = new Pool(poolConfig);
export const db = drizzle(pool, { schema });
