# High-Conviction Swing-Trading Agent

An agentic, paper-first workflow for an AI swing-trading system. Built to run on
**Alpaca paper trading** (fake money, real prices, free, no minimum) until it
proves it can make money. Only then does real capital come anywhere near it.

> **Deploying to Robinhood Agentic Trading?** Read `07_ROBINHOOD_AGENTIC.md`
> first. Robinhood's agentic product (official, MCP-based) has **NO paper
> trading** — the agentic account is real money from trade #1 — and the
> deterministic Python risk gate in `trader.py` is **bypassed** because the MCP
> agent places orders directly. You MUST practice on Alpaca paper first, then run
> Robinhood in **manual-approval mode** using `prompts/MASTER_SYSTEM_PROMPT.md`.

> This is a personal research/learning project. It is NOT financial advice, and
> the agent is NOT permitted to trade live money without explicit human approval.
> Keep this repo private.

---

## Read this before you get excited

**Your stated goal:** turn **$100 into $1,000 by end of year** (~7 months), "low
risk," "slow and steady," "without losing the original $100."

**The math says that goal is internally contradictory:**

| Goal | Required monthly return | Reality check |
|------|------------------------|---------------|
| $100 → $1,000 in 7 months | **~39% / month, every month, no losses** | Renaissance Medallion (best fund ever) does ~39% **per YEAR** |
| "Low risk / slow & steady" | ~1–5% / month for *good* traders | $100 → ~$110–$140 in 7 months |

You cannot have "39%/month" and "low risk / never lose the $100" at the same
time. High return REQUIRES tolerating drawdowns. The target is kept in this repo
(see `GOALS` below) so you stay honest about the gap, not because it's realistic.

**What's actually achievable and worth doing:** prove the agent has *positive
expectancy* on paper over 3–6 months. If it can't grow fake money consistently,
it has no business touching your $100. That is the real mission this year.

### Three things that are just true
1. **$100 in US stocks is barely tradeable.** PDT rule locks margin accounts
   under $25k to 3 day-trades / 5 days. We swing-trade (hold days–weeks) to dodge
   it, and use fractional shares.
2. **LLMs have NO predictive edge on price.** They hallucinate and train on stale
   data. The agent's value is *discipline and process*, not fortune-telling.
3. **A hard-coded risk layer the LLM cannot override is mandatory.** The LLM
   proposes; deterministic code disposes.

---

## GOALS (what success means here)

- **Primary (this year):** Positive expectancy on paper. Win rate × avg win >
  loss rate × avg loss, net of costs, over ≥ 50 trades.
- **Secondary:** Beat buy-and-hold SPY over the same window on paper.
- **Stretch / aspirational:** The $100 → $1,000 dream. Treated as a north star,
  not a plan. Real money only enters after 3–6 profitable paper months.
- **Non-negotiable:** Capital preservation. Max account drawdown 10%. Max risk
  1% per trade. If the system can't respect this, it's broken.

---

## Architecture (multi-agent, ReAct-style)

```
                 ┌─────────────────────────────────────────┐
                 │            ORCHESTRATOR (loop)            │
                 │   runs daily after close, holds state     │
                 └───────────────────┬───────────────────────┘
                                     │
   ┌──────────────┬──────────────────┼───────────────────┬──────────────┐
   ▼              ▼                  ▼                   ▼              ▼
Technical     Fundamental        Sentiment/News       Bull vs Bear   Risk
Analyst       Analyst            Analyst              Debate         Manager
   └──────────────┴──────────────────┴───────────────────┘              │
                                     │                                   │
                                     ▼                                   │
                              TRADER (decision)  ──────────────────────► │
                                                                         ▼
                                                          DETERMINISTIC RISK GATE
                                                          (code, not LLM)
                                                                         │
                                                                         ▼
                                                          Alpaca paper order + Journal
```

The LLM agents reason and argue. A **deterministic Python risk gate** validates
every order (position size, stop, exposure, drawdown) and can reject anything.
The LLM can never bypass it.

---

## Files in this workflow

| File | What it is |
|------|-----------|
| `README.md` | You are here. Overview + honest framing. |
| `01_SETUP.md` | Step-by-step environment + Alpaca paper account setup. |
| `02_AGENT_PROMPTS.md` | **The core deliverable.** All system/role prompts. |
| `03_STRATEGY.md` | The swing-trading strategy rules (entries/exits). |
| `04_RISK_RULES.md` | The hard risk layer the agent cannot override. |
| `05_DAILY_WORKFLOW.md` | The exact step-by-step operating loop. |
| `06_TRADE_JOURNAL.md` | Journal + monthly evaluation template. |
| `07_ROBINHOOD_AGENTIC.md` | **Robinhood path:** MCP setup, no-paper warnings, manual risk gate. |
| `requirements.txt` | Python dependencies. |
| `trader.py` | Minimal starter scaffold (Alpaca path only). |
| `prompts/` | Individual prompt files + `MASTER_SYSTEM_PROMPT.md` for the MCP agent. |
| `logs/` | Trade journal CSV + run logs land here. |

---

## Quickstart

1. Read `01_SETUP.md` and create a **free Alpaca paper account**.
2. Read `02_AGENT_PROMPTS.md` — these are the prompts that drive everything.
3. Read `04_RISK_RULES.md` — internalize the hard limits.
4. Run the loop per `05_DAILY_WORKFLOW.md` (manual first, automate later).
5. Journal every trade (`06_TRADE_JOURNAL.md`). Review monthly.
6. **Do not even think about live money until you have 3–6 profitable paper
   months with the risk rules respected.**
