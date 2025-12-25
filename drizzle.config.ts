import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

// Load .env file
config();

// Support both LOCAL_DATABASE_URL (for local dev) and DATABASE_URL (for cloud)
const databaseUrl = process.env.LOCAL_DATABASE_URL || process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "Either DATABASE_URL or LOCAL_DATABASE_URL must be set.\n" +
    "For local development: LOCAL_DATABASE_URL=postgresql://user:password@localhost:5432/fincal\n" +
    "For cloud database: DATABASE_URL=your_cloud_postgresql_connection_string"
  );
}

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
});
