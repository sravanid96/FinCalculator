import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

/**
 * Local-first: when LOCAL_DATABASE_URL is set, the app and `npm run db:push` use that Postgres.
 * Otherwise falls back to DATABASE_URL (e.g. Neon for deploy / mobile).
 * Keep this in sync with drizzle.config.ts.
 */
export const databaseConnectionUrl =
  (process.env.LOCAL_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim()) ?? "";

if (!databaseConnectionUrl) {
  throw new Error(
    "Set LOCAL_DATABASE_URL for local Postgres, or DATABASE_URL for cloud.\n" +
    "Example: LOCAL_DATABASE_URL=postgresql://user:password@localhost:5432/fincal"
  );
}

export const pool = new Pool({ connectionString: databaseConnectionUrl });
export const db = drizzle(pool, { schema });
