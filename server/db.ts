import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

// For mobile/desktop access, you MUST use a cloud PostgreSQL database
// Local PostgreSQL only works for single-machine development
if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. For mobile/desktop access, use a cloud PostgreSQL database.\n" +
    "Options: Neon (neon.tech), Supabase (supabase.com), Railway (railway.app), or similar.\n" +
    "Create a .env file with: DATABASE_URL=your_cloud_postgresql_connection_string"
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });
