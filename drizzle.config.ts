import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

// Load .env file
config();

// DATABASE_URL takes priority (for CLI override and Render deploys), then LOCAL_DATABASE_URL for local dev
const databaseUrl = process.env.DATABASE_URL?.trim() || process.env.LOCAL_DATABASE_URL?.trim() || "";

if (!databaseUrl) {
  throw new Error(
    "Set DATABASE_URL for cloud (Render/Neon), or LOCAL_DATABASE_URL for local Postgres."
  );
}

if (!databaseUrl) {
  throw new Error(
    "Set DATABASE_URL for cloud (Render/Neon), or LOCAL_DATABASE_URL for local Postgres.\n" +
    "On Render, `npm run db:push` (e.g. pre-deploy) uses DATABASE_URL from the dashboard."
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
