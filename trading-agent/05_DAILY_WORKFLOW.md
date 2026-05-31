# 05 — Daily Workflow (the operating loop)

Swing trading = once-a-day, after the close. ~15–30 min/day at first, less once
it's stable. The loop is the same whether you run it manually or via a scheduler.

---

## The daily loop (run after US market close, ~4:30pm ET)

```
1. PORTFOLIO REVIEW
   - Pull account equity, open positions, cash, current drawdown from peak.
   - Update peak equity if new high.
   - Check circuit breakers (−10% DD, −3% day, 3-loss streak). If tripped →
     skip to step 6 (manage only, no new entries).

2. MANAGE OPEN POSITIONS  [Position Manager prompt, #8]
   - For each open position, feed updated price + original thesis.
   - Apply: HOLD / EXIT_NOW / TIGHTEN_STOP / TAKE_PARTIAL.
   - Submit any exit / stop-adjust orders to Alpaca paper.

3. SCAN WATCHLIST
   - For each name in logs/watchlist.txt, pull OHLCV + indicators + news.
   - Pre-filter in code: drop names failing Strategy hard filters (earnings in
     window, SPY regime, liquidity). Cheap filter before spending LLM calls.

4. ANALYZE CANDIDATES  [Technical → Fundamental → Sentiment prompts, #1–3]
   - Run the 3 analysts on each surviving candidate → collect JSON.
   - Only candidates with >=2 bullish analysts proceed to debate.

5. DEBATE → DECIDE  [Bull/Bear #4 → Research Mgr #5 → Trader #6 → Risk Mgr #7]
   - Run bull vs bear, research manager judges conviction.
   - If PROCEED_LONG + HIGH conviction → Trader sizes it → Risk Mgr (LLM) checks.
   - Pass the proposal through the DETERMINISTIC risk_gate() in code.
   - If approved: submit a BRACKET order (entry limit + stop-loss + take-profit)
     to Alpaca paper for next session. Code wins over LLM on any conflict.

6. JOURNAL  [see 06_TRADE_JOURNAL.md]
   - Log every decision, including NO_TRADE and every rejection + reason.
   - Append to logs/journal.csv.

7. STOP. Walk away. Do not watch intraday. The orders work for you.
```

A day with zero new trades is a normal, successful day.

---

## Weekly review (every weekend, ~30 min)

- Read the week's journal. Were rules followed on EVERY trade? (Be honest.)
- Tag rule violations. Process discipline > P&L this early.
- Re-check the watchlist: remove names with upcoming earnings, add fresh setups.
- Note the market regime (SPY vs 200-SMA) for next week's aggressiveness.

---

## Monthly review (the real scoreboard)

Compute from the journal (see `06_TRADE_JOURNAL.md` for formulas):
- Number of trades, win rate, avg win, avg loss, **expectancy per trade**.
- Profit factor (gross wins / gross losses). Max drawdown.
- Return vs buy-and-hold SPY for the month.
- **Rule-violation count (target: 0).**

Decision gate:
- Expectancy positive AND rules respected → continue, maybe widen watchlist.
- Expectancy negative → do NOT add real money. Diagnose: bad setups? regime?
  over-trading? LLM hallucinating? Fix one variable at a time.

---

## Phased rollout (do not skip phases)

| Phase | Duration | What | Money |
|-------|----------|------|-------|
| 1 | Weeks 1–4 | Run loop manually, place paper orders yourself | Paper |
| 2 | Weeks 5–8 | Script proposes, you approve each order | Paper |
| 3 | Months 3–6 | Scheduler runs loop daily, risk gate enforces | Paper |
| 4 | After 3–6 profitable paper months | Consider live | Real $100 |

Promotion to the next phase requires: **positive expectancy + zero rule
violations** in the current phase. No exceptions, no "I have a good feeling".

---

## How to actually run it

Manual / semi-auto:
```bash
source .venv/bin/activate
python trader.py --run            # runs the full daily loop, prints proposals
python trader.py --run --submit   # also submits approved orders to paper
```

Automated (phase 3, macOS cron example — runs 4:35pm ET weekdays):
```cron
35 16 * * 1-5  cd /path/to/trading-agent && ./.venv/bin/python trader.py --run --submit >> logs/cron.log 2>&1
```
