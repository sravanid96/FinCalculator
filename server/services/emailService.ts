import { Resend } from "resend";
import { STRATEGY_NAMES } from "@shared/optionsSchema";
import type { WeeklyMarketDigest } from "./weeklyMarketDigest";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtPct(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function fmtUsd(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(n);
}

export function buildWeeklyDigestHtml(
  digest: WeeklyMarketDigest,
  recipientName?: string | null,
): string {
  const appUrl = (process.env.APP_BASE_URL || process.env.VITE_API_BASE_URL || "").replace(
    /\/$/,
    "",
  );
  const optionsUrl = appUrl ? `${appUrl}/options` : "";

  const greeting = recipientName
    ? `Hi ${escapeHtml(recipientName)},`
    : "Hi there,";

  const marketRows = digest.market.indices
    .map((idx) => {
      if (!idx.quote) {
        return `<tr><td>${escapeHtml(idx.label)}</td><td colspan="2">Unavailable</td></tr>`;
      }
      const ch = idx.quote.changePercent;
      const color = ch >= 0 ? "#16a34a" : "#dc2626";
      return `<tr>
        <td style="padding:8px;border-bottom:1px solid #eee;">${escapeHtml(idx.label)}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;">${fmtUsd(idx.quote.price)}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;color:${color};">${fmtPct(ch)}</td>
      </tr>`;
    })
    .join("");

  const ideaCards =
    digest.highConvictionIdeas.length === 0
      ? `<p style="color:#666;">No high-conviction backtested ideas met filters this week. Check the app for the full Ideas list.</p>`
      : digest.highConvictionIdeas
          .map(({ idea, backtest, tradeabilityScore }) => {
            const strategy =
              STRATEGY_NAMES[idea.idea.strategy] || idea.idea.strategy;
            const edge = backtest?.historicalEdge ?? "—";
            const winRate = backtest ? `${backtest.winRate.toFixed(0)}%` : "—";
            const tradeScore =
              tradeabilityScore != null ? `${tradeabilityScore}/100` : "—";
            
            // Build leg descriptions
            const legDetails = idea.idea.legs
              .map((leg) => {
                const action = leg.action === "sell" ? "Sell" : "Buy";
                const type = leg.type === "call" ? "Call" : "Put";
                return `${action} $${leg.strike} ${type} @ ${fmtUsd(leg.price)}`;
              })
              .join("<br/>");
            
            const edgeColor = edge === "strong" ? "#16a34a" : edge === "positive" ? "#2563eb" : "#666";
            
            return `
            <div style="border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin-bottom:16px;background:#fafafa;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                <div>
                  <span style="font-size:18px;font-weight:700;">${escapeHtml(idea.symbol)}</span>
                  <span style="color:#666;margin-left:8px;">${fmtUsd(idea.price)}</span>
                  <span style="color:${idea.changePercent >= 0 ? '#16a34a' : '#dc2626'};margin-left:4px;">${fmtPct(idea.changePercent)}</span>
                </div>
                <span style="background:${edgeColor};color:white;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600;">${escapeHtml(edge.toUpperCase())}</span>
              </div>
              
              <div style="background:white;border:1px solid #e5e7eb;border-radius:6px;padding:12px;margin-bottom:12px;">
                <div style="font-weight:600;color:#2563eb;margin-bottom:8px;">${escapeHtml(strategy)}</div>
                <div style="font-size:13px;color:#333;line-height:1.6;">${legDetails}</div>
                <div style="margin-top:8px;font-size:13px;color:#666;">
                  Exp: <strong>${escapeHtml(idea.idea.expirationDate)}</strong> (${idea.idea.daysToExpiration} DTE)
                </div>
              </div>
              
              <table style="width:100%;font-size:13px;border-collapse:collapse;">
                <tr>
                  <td style="padding:4px 0;"><span style="color:#666;">Credit:</span> <strong style="color:#16a34a;">${fmtUsd(idea.idea.entryPrice)}</strong></td>
                  <td style="padding:4px 0;"><span style="color:#666;">Max Profit:</span> <strong>${fmtUsd(idea.idea.maxProfit)}</strong></td>
                </tr>
                <tr>
                  <td style="padding:4px 0;"><span style="color:#666;">Max Loss:</span> <strong style="color:#dc2626;">${fmtUsd(idea.idea.maxLoss)}</strong></td>
                  <td style="padding:4px 0;"><span style="color:#666;">POP:</span> <strong>${idea.idea.probabilityOfProfit.toFixed(0)}%</strong></td>
                </tr>
                <tr>
                  <td style="padding:4px 0;"><span style="color:#666;">Win Rate:</span> <strong>${winRate}</strong></td>
                  <td style="padding:4px 0;"><span style="color:#666;">Tradeability:</span> <strong>${tradeScore}</strong></td>
                </tr>
              </table>
            </div>`;
          })
          .join("");

  const methodology = digest.methodology
    .map((m) => `<li style="margin-bottom:4px;color:#555;">${escapeHtml(m)}</li>`)
    .join("");

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>FinCal Weekly Market Digest</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.5;color:#111;max-width:720px;margin:0 auto;padding:24px;">
  <h1 style="font-size:22px;margin-bottom:4px;">FinCal Weekly Market Digest</h1>
  <p style="color:#666;margin-top:0;">${greeting} Here is your weekly market snapshot and high-conviction options ideas.</p>
  <p style="font-size:13px;color:#888;">Generated ${escapeHtml(new Date(digest.generatedAt).toLocaleString("en-US", { dateStyle: "full", timeStyle: "short" }))}</p>

  <h2 style="font-size:16px;margin-top:28px;">Market snapshot</h2>
  <table style="width:100%;border-collapse:collapse;font-size:14px;">
    <thead>
      <tr style="background:#f8fafc;">
        <th style="text-align:left;padding:8px;">Index</th>
        <th style="text-align:left;padding:8px;">Price</th>
        <th style="text-align:left;padding:8px;">Change</th>
      </tr>
    </thead>
    <tbody>${marketRows}</tbody>
  </table>

  <h2 style="font-size:16px;margin-top:28px;">High-conviction trade setups (backtested)</h2>
  ${ideaCards}

  <h3 style="font-size:14px;margin-top:24px;color:#444;">Methodology</h3>
  <ul style="padding-left:20px;font-size:13px;">${methodology}</ul>

  ${
    optionsUrl
      ? `<p style="margin-top:24px;"><a href="${escapeHtml(optionsUrl)}" style="color:#2563eb;">Open FinCal Options →</a></p>`
      : ""
  }

  <hr style="margin-top:32px;border:none;border-top:1px solid #eee;" />
  <p style="font-size:12px;color:#888;">You receive this because you opted in to weekly market digests in FinCal Settings. This is not financial advice.</p>
</body>
</html>`;
}

export function buildWeeklyDigestSubject(digest: WeeklyMarketDigest): string {
  const date = new Date(digest.generatedAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const count = digest.highConvictionIdeas.length;
  return `FinCal Weekly Digest — ${date} (${count} high-conviction ideas)`;
}

export interface SendEmailResult {
  ok: boolean;
  id?: string;
  error?: string;
}

export async function sendWeeklyDigestEmail(
  to: string,
  digest: WeeklyMarketDigest,
  recipientName?: string | null,
): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.DIGEST_FROM_EMAIL?.trim();

  if (!apiKey || !from) {
    return {
      ok: false,
      error: "RESEND_API_KEY and DIGEST_FROM_EMAIL must be set to send email",
    };
  }

  const resend = new Resend(apiKey);
  const html = buildWeeklyDigestHtml(digest, recipientName);
  const subject = buildWeeklyDigestSubject(digest);

  try {
    const { data, error } = await resend.emails.send({
      from,
      to: [to],
      subject,
      html,
    });

    if (error) {
      return { ok: false, error: error.message };
    }

    return { ok: true, id: data?.id };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
