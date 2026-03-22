import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { ScrollArea } from "@/components/ui/scroll-area";

function SectionTitle({ children }: { children: ReactNode }) {
  return <h4 className="mt-4 font-semibold text-foreground first:mt-0">{children}</h4>;
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

export function TradingDecisionFramework() {
  return (
    <ScrollArea className="h-[calc(100vh-12rem)] pr-4 md:h-[calc(100vh-10rem)]">
      <div className="space-y-6 pb-8">
        <Card>
          <CardHeader>
            <CardTitle>Trading decision framework</CardTitle>
            <CardDescription>
              Use fundamental context, technical structure, options mechanics, and macro (VIX) together.
              Compare valuation and quality within a sector or peer group—not with arbitrary universal
              cutoffs.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <p>
              <strong className="text-foreground">Confluence:</strong> weight signals across pillars;
              prefer trades where thesis aligns on more than one dimension. In high uncertainty,
              size down and favor defined risk.
            </p>
          </CardContent>
        </Card>

        <Accordion type="multiple" className="w-full rounded-md border px-2">
          <AccordionItem value="fundamental">
            <AccordionTrigger className="text-left">Fundamental analysis</AccordionTrigger>
            <AccordionContent className="space-y-2 pb-4 text-sm text-muted-foreground">
              <SectionTitle>Valuation ratios</SectionTitle>
              <p>
                P/E, forward P/E, P/B, P/S, PEG, EV/EBITDA, EV/Sales — cheap vs expensive relative to
                earnings, assets, growth, and peers. Always compare within sector/industry.
              </p>

              <SectionTitle>Earnings quality</SectionTitle>
              <BulletList
                items={[
                  "EPS growth (YoY, QoQ); acceleration or deceleration drives major moves.",
                  "Earnings surprise vs consensus; revenue growth.",
                  "Gross, operating, and net margins trend.",
                  "FCF yield — cash generation vs price.",
                ]}
              />

              <SectionTitle>Balance sheet health</SectionTitle>
              <BulletList
                items={[
                  "Debt/Equity, current ratio, quick ratio.",
                  "Cash runway (for burners), interest coverage.",
                  "Highly leveraged names are more sensitive to rising rates.",
                ]}
              />

              <SectionTitle>Moat and competitive position</SectionTitle>
              <BulletList
                items={[
                  "ROE, ROIC; market share trends.",
                  "Pricing power (margin stability under cost pressure).",
                ]}
              />

              <SectionTitle>Insider and institutional activity</SectionTitle>
              <BulletList
                items={[
                  "Insider buying/selling (context matters).",
                  "Institutional ownership changes.",
                  "Short interest as % of float.",
                ]}
              />

              <SectionTitle>Catalyst calendar</SectionTitle>
              <BulletList
                items={[
                  "Earnings dates, dividend ex-dates.",
                  "FDA/regulatory, analyst changes, product launches.",
                ]}
              />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="technical">
            <AccordionTrigger className="text-left">Technical analysis</AccordionTrigger>
            <AccordionContent className="space-y-2 pb-4 text-sm text-muted-foreground">
              <SectionTitle>Trend</SectionTitle>
              <BulletList
                items={[
                  "SMA 20/50/200 and EMA — price vs moving averages defines direction and strength.",
                  "MACD (12/26/9) — crossovers and histogram divergence for trend shifts.",
                  "ADX — trend strength regardless of direction (&gt;25 often treated as strong trend).",
                ]}
              />

              <SectionTitle>Momentum</SectionTitle>
              <BulletList
                items={[
                  "RSI (14) — overbought &gt;70, oversold &lt;30; watch divergence at extremes.",
                  "Stochastic — %K/%D crosses in OB/OS zones.",
                  "ROC and generic momentum oscillators.",
                ]}
              />

              <SectionTitle>Volume</SectionTitle>
              <BulletList
                items={[
                  "OBV — confirms trend or warns via divergence.",
                  "VWAP — intraday institutional reference; above/below for bias.",
                  "Volume spikes on breakouts — confirms or rejects.",
                  "Accumulation/Distribution line.",
                ]}
              />

              <SectionTitle>Price structure</SectionTitle>
              <BulletList
                items={[
                  "Support and resistance (horizontal and dynamic).",
                  "Fibonacci retracements (38.2%, 50%, 61.8%) for pullback entries.",
                  "Pivot points (daily/weekly) for intraday S/R.",
                ]}
              />

              <SectionTitle>Chart patterns</SectionTitle>
              <BulletList
                items={[
                  "Continuation: flags, pennants, cup-and-handle, ascending/descending triangles.",
                  "Reversal: head-and-shoulders, double tops/bottoms, rounding bottoms.",
                ]}
              />

              <SectionTitle>Candlesticks and bands</SectionTitle>
              <BulletList
                items={[
                  "Engulfing, doji, hammer/shooting star, morning/evening star — confirm at key levels.",
                  "Bollinger Bands — squeeze vs expansion; mean reversion vs breakout context.",
                ]}
              />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="options">
            <AccordionTrigger className="text-left">Options-specific concepts</AccordionTrigger>
            <AccordionContent className="space-y-2 pb-4 text-sm text-muted-foreground">
              <SectionTitle>The Greeks</SectionTitle>
              <BulletList
                items={[
                  "Delta — directional exposure ($ option move per $1 underlying).",
                  "Theta — daily decay; core for premium selling.",
                  "Vega — IV sensitivity; critical for timing vol.",
                  "Gamma — pace of delta change; highest near expiry and ATM.",
                ]}
              />

              <SectionTitle>Implied volatility</SectionTitle>
              <BulletList
                items={[
                  "IV Rank (IVR) — IV vs 52-week range; high IVR (&gt;50) often favors selling premium; low favors buying (all else equal).",
                  "IV Percentile — percentile-based alternative to rank.",
                  "IV crush post-earnings — long premium into earnings is often negative expectancy unless move exceeds implied move.",
                ]}
              />

              <SectionTitle>Strategies by market condition (rules of thumb)</SectionTitle>
              <ul className="mt-2 list-disc space-y-2 pl-5">
                <li>Bullish + low IV — long calls, bull call spreads, short puts (risk-aware).</li>
                <li>Bearish + low IV — long puts, bear put spreads.</li>
                <li>Neutral + high IV — iron condor, short strangle/straddle.</li>
                <li>Bullish + high IV — covered call, CSP, bear call spread (premium collection).</li>
                <li>High uncertainty — long straddle/strangle, debit spreads (defined risk).</li>
              </ul>

              <SectionTitle>Strike selection and DTE</SectionTitle>
              <BulletList
                items={[
                  "~0.30 delta short options common baseline; ~0.16 more conservative; ~0.50 ATM for directional bias.",
                  "~45 DTE often cited as a sweet spot for premium strategies (decay vs gamma—adjust to your plan).",
                ]}
              />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="vix">
            <AccordionTrigger className="text-left">VIX correlation</AccordionTrigger>
            <AccordionContent className="space-y-2 pb-4 text-sm text-muted-foreground">
              <p>
                VIX is 30-day implied vol on S&amp;P 500 options—the common &quot;fear gauge.&quot; It
                tends to move with equity IV broadly.
              </p>
              <SectionTitle>Regimes (interpretation, not guarantees)</SectionTitle>
              <BulletList
                items={[
                  "VIX &lt; 15 — calmer; momentum and breakouts more common; long premium is cheap but needs movement.",
                  "VIX 15–25 — &quot;normal&quot;; balanced use of directional vs premium strategies.",
                  "VIX 25–35 — elevated; choppy; smaller size; mean-reversion and premium after spikes—discipline required.",
                  "VIX &gt; 35 — extreme fear; potential long-term entries for investors; selling premium can pay but timing and risk control matter.",
                ]}
              />
              <SectionTitle>Divergence ideas</SectionTitle>
              <BulletList
                items={[
                  "Indices new highs + VIX rising — possible hidden fear / distribution.",
                  "Market down + VIX flat — panic not yet full; trend may extend.",
                  "Market down + VIX spike — capitulation watchlist; look for reversal signals separately.",
                ]}
              />
              <p>
                When VIX spikes, index and stock IV often rise—premium selling can get more attractive
                on a credit basis; when VIX is crushed, long premium is cheaper—pair with clear
                catalyst or structure.
              </p>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="risk">
            <AccordionTrigger className="text-left">Risk management rules</AccordionTrigger>
            <AccordionContent className="space-y-2 pb-4 text-sm text-muted-foreground">
              <BulletList
                items={[
                  "Position sizing — commonly 1–2% account risk per trade; Kelly only if you understand the inputs.",
                  "Portfolio heat — cap total risk across open positions (e.g. 10–15% aggregate exposure to loss).",
                  "Stops — hard price stop; ATR-based volatility stop; time stop if thesis doesn’t play out in X sessions.",
                  "Risk/reward — many directional plans target minimum 1:2; theta strategies often plan partial profit (e.g. 25–50% of max).",
                  "Correlation — avoid one-factor concentration (e.g. all high-growth tech into a macro headwind).",
                ]}
              />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="universal">
            <AccordionTrigger className="text-left">Universal strategies (any market)</AccordionTrigger>
            <AccordionContent className="space-y-2 pb-4 text-sm text-muted-foreground">
              <BulletList
                items={[
                  "Trend + filters — trade with 50/200 SMA regime; pullbacks to VWAP or 20 EMA; RSI reset toward mid-range can filter chop.",
                  "Breakout + volume — break of key S/R with 1.5–2× average volume; prefer retest entries when available.",
                  "Mean reversion — RSI extremes at major S/R with divergence; scale in, size smaller.",
                  "Premium selling on high IV — index iron condors/strangles when IVR elevated; ~45 DTE; take profit systematically (e.g. 50%).",
                  "Earnings — iron condor/straddle sales pre-earnings for IV crush (risk: gap); size small.",
                  "Wheel — CSP on names you’d own; if assigned, covered calls; know tax and assignment risk.",
                ]}
              />
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    </ScrollArea>
  );
}
