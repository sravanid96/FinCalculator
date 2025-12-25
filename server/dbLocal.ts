import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

let localPool: pg.Pool | null = null;
let localDb: ReturnType<typeof drizzle> | null = null;

// Export schema so routes can use the exact same schema reference
export const localSchema = schema;

export function getLocalDb() {
  if (localDb) {
    return localDb;
  }

  const localDbUrl = process.env.LOCAL_DATABASE_URL;
  if (!localDbUrl) {
    throw new Error(
      "LOCAL_DATABASE_URL must be set to use local PostgreSQL database.\n" +
      "Create a .env file with: LOCAL_DATABASE_URL=postgresql://user:password@localhost:5432/fincal"
    );
  }

  localPool = new Pool({ connectionString: localDbUrl });
  localDb = drizzle(localPool, { schema });
  
  return localDb;
}

export function closeLocalDb() {
  if (localPool) {
    localPool.end();
    localPool = null;
    localDb = null;
  }
}

