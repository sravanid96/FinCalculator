# 03 — Strategy (Swing, Slow & Steady)

One strategy. Mastered. Not ten strategies done badly. This is a **trend-pullback
+ confirmed-breakout** swing system on liquid US large-caps and ETFs, hold
horizon **3–20 trading days**.

> Why this and not "the agent figures it out": a fixed, rule-based edge you can
> measure beats an open-ended "AI picks stocks" that you can never debug or
> trust. The agent's job is to apply these rules with discipline, not improvise.

---

## Universe (what the agent is allowed to trade)

- **Only:** US large-cap stocks (market cap > $10B) and major ETFs
  (SPY, QQQ, sector ETFs).
- **Liquidity:** avg daily volume > 1M shares. Fractional shares via Alpaca so
  $100 can buy a slice of expensive names.
- **Banned:** penny stocks, micro-caps, recent IPOs (< 6 months), leveraged ETFs
  (TQQQ etc.), anything with earnings inside the hold window, meme/hype names.

A short curated watchlist (15–30 names) beats scanning the whole market. Put it
in `logs/watchlist.txt`.

---

## Setup A — Trend Pullback (primary, highest conviction)

Buy strength on a dip, in an established uptrend.

**Conditions (ALL must be true):**
1. Price > 50-day SMA > 200-day SMA (confirmed uptrend).
2. Price has pulled back to the 20-day SMA or a prior support level.
3. RSI(14) between 35–50 (oversold *within* an uptrend, not crashing).
4. Pullback on declining volume (not a high-volume breakdown).
5. A reversal candle / first green day off support.

**Entry:** limit at/just above the reversal candle high.
**Stop:** below the pullback swing low (or 1.5× ATR below entry — use the wider
discipline-respecting one, but stop distance defines size).
**Target:** prior swing high, OR 2× the risk distance — whichever is reached
first. Reward:risk must be ≥ 2.0 or no trade.

---

## Setup B — Confirmed Breakout (secondary)

1. Price consolidated in a tight range for ≥ 10 days near 52-week highs.
2. Breakout above resistance on volume ≥ 1.5× the 20-day avg volume.
3. Close (not just intraday) above the level.

**Entry:** on the breakout close or a small retest.
**Stop:** below the breakout level / consolidation low.
**Target:** measured move (range height) or 2R minimum.

---

## Hard filters (kill the trade if any is true)

- Earnings or known binary event within the hold window.
- Market regime risk-off: SPY below its 200-day SMA → **only A-grade setups, half
  size**, or sit out entirely.
- Reward:risk < 2.0.
- Required position would exceed 35% of equity in one name.
- Any analyst reports `data_quality != OK`.

---

## Exit rules (decided BEFORE entry, no improvising)

| Trigger | Action |
|---------|--------|
| Stop hit | Exit, full. No hesitation, no "give it room". |
| Target hit | Take 50–100% off. Optionally trail the rest. |
| +1R reached | Move stop to breakeven. |
| Thesis invalidated (per analyst `invalidation`) | Exit now. |
| 20 trading days, no progress | Time-stop exit. |

---

## Position & portfolio rules

- Max **3** open positions at once.
- Max **1%** equity risk per trade.
- Max **5%** total open risk across all positions.
- No two positions in the same sector at once (concentration).
- No adding to losers. Ever.

---

## Cadence

- **Swing, end-of-day.** The agent runs once daily after market close, decides,
  and places limit/bracket orders for the next session. No intraday screen-
  staring. This also keeps you under the PDT day-trade limit by design.

---

## Expected reality (so you don't fool yourself)

With a real edge (win rate ~45–55%, avg win 2× avg loss), a *good* swing system
makes roughly **1–4% per month** on average with losing months mixed in. On
$100 that's ~$1–$4/month. That is the honest shape of "slow and steady." If a
backtest or paper run shows 30%+/month with no drawdowns, assume a bug or
overfitting — not genius.
