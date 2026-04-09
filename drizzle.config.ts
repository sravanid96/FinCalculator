import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

// Load .env file
config();

// Match server/db.ts: production / Render must use DATABASE_URL (Neon), not a leftover LOCAL_DATABASE_URL in .env.
const isCloudDeploy =
  process.env.NODE_ENV === "production" || process.env.RENDER === "true";

const databaseUrl = (
  isCloudDeploy
    ? process.env.DATABASE_URL?.trim() || process.env.LOCAL_DATABASE_URL?.trim()
    : process.env.LOCAL_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim()
) ?? "";

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
