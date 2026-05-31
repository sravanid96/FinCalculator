# 06 — Trade Journal & Evaluation

You cannot improve what you don't measure, and you cannot trust an agent you
haven't audited. The journal is how you prove (or disprove) the edge. **Every**
decision gets logged — including NO_TRADE and every risk-gate rejection.

---

## CSV schema (`logs/journal.csv`)

```
date,ticker,decision,setup,entry,stop,target,qty,risk_dollars,reward_risk,
conviction,thesis,outcome,exit_date,exit_price,pnl_dollars,pnl_R,
rule_violations,notes
```

| Field | Meaning |
|-------|---------|
| `decision` | BUY / NO_TRADE / EXIT / REJECTED |
| `setup` | A (pullback) / B (breakout) / none |
| `risk_dollars` | dollars at risk (entry−stop)×qty |
| `reward_risk` | (target−entry)/(entry−stop) |
| `pnl_R` | result in R-multiples: pnl_dollars / risk_dollars |
| `rule_violations` | list any rule broken (target = none, always) |
| `notes` | what the agent argued; what you'd do differently |

Logging in R-multiples (not just dollars) is what lets you judge the system
independent of the tiny $100 size.

---

## Per-trade journal entry template (markdown, for the ones worth reviewing)

```
## YYYY-MM-DD — TICKER — Setup A/B

- Thesis (one line): 
- Regime: TRENDING_UP / RANGING / ...
- Analyst agreement: tech __ / fund __ / sentiment __ (conviction)
- Bull's best point: 
- Bear's best point: 
- Entry / Stop / Target: 
- Risk: $__ (__% of equity)  | Reward:Risk: __
- Risk gate: APPROVED / REJECTED (reason)
- Outcome: +/− $__  = __R   | held __ days
- What worked / what didn't: 
- Did I follow ALL rules? Y/N — if N, which:
```

---

## Monthly scorecard formulas

```
win_rate        = wins / total_trades
avg_win         = mean(pnl_R for winners)        # in R
avg_loss        = mean(pnl_R for losers)         # in R (negative)
expectancy_R    = win_rate*avg_win + (1-win_rate)*avg_loss   # EXPECTED R / trade
profit_factor   = gross_profit / gross_loss
max_drawdown    = largest peak-to-trough equity drop (%)
monthly_return  = (equity_end - equity_start) / equity_start
vs_spy          = monthly_return - SPY_return_same_month
```

**The one number that matters: `expectancy_R`.**
- Positive → the system makes money over time. Keep going.
- ~0 or negative → it doesn't. More trades won't fix it. Diagnose and fix.

---

## Reference: what good vs delusional looks like

| Metric | Healthy swing system | Red flag |
|--------|---------------------|----------|
| Win rate | 40–55% | "90% win rate" (probably no stops / averaging down) |
| Expectancy | +0.1 to +0.4 R/trade | negative, or "+5R" (overfit/bug) |
| Profit factor | 1.3–2.0 | < 1.0 (losing), or > 4 on few trades (luck) |
| Monthly return | 1–4% avg, some red months | "30%/mo every month" (fantasy) |
| Max drawdown | < 10% (by design) | > 20% (risk rules broken) |
| Rule violations | 0 | any |

---

## The honest year-end review

At year end, compare against the README goals:
1. Did expectancy stay positive over ≥ 50 paper trades? (the real goal)
2. Did you beat buy-and-hold SPY on paper?
3. Were the risk rules respected every single time?
4. The $100→$1000 stretch: almost certainly not — and that's the expected,
   correct outcome. If it DID 10x, be suspicious of a bug or one lucky lottery
   trade that violated sizing. Sustainable beats lucky.

If 1–3 are "yes," you've built something real and earned the right to risk the
actual $100. That is the win. Everything else is noise.
