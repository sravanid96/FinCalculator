/**
 * Manual trigger for weekly market digest (no HTTP).
 * Usage:
 *   CRON_SECRET=... RESEND_API_KEY=... DIGEST_FROM_EMAIL="FinCal <onboarding@resend.dev>" \
 *   DIGEST_NOTIFY_EMAILS=you@example.com \
 *   npx tsx script/run-weekly-digest.ts
 *
 * Add --dry-run to build digest without sending email.
 */
import "dotenv/config";
import { runWeeklyMarketDigest } from "../server/cronRoutes";

const dryRun = process.argv.includes("--dry-run");

runWeeklyMarketDigest({ dryRun })
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.failed > 0 ? 1 : 0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
