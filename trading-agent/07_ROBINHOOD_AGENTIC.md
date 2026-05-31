# 07 — Running on Robinhood Agentic Trading (MCP)

This file adapts the workflow for **Robinhood Agentic Trading** (official product,
launched May 27, 2026). Read it fully before connecting anything — it changes the
safety model in ways that matter for your $100.

---

## READ THIS FIRST — what's different (and dangerous) vs the Alpaca plan

| | Alpaca (original plan) | Robinhood Agentic |
|---|---|---|
| Money | **Paper (fake)** until proven | **REAL money from trade #1** — no paper/sandbox exists |
| Risk gate | **Deterministic Python code** the LLM can't bypass | **NOT in the execution path.** LLM places orders directly via MCP |
| Approval | You control it | Optional — agent CAN trade with no per-trade confirmation |
| Account isolation | n/a | Dedicated agentic account, limited to funds you deposit |

**Three hard truths:**
1. **No paper trading on Robinhood.** The "agentic account" is real money, just
   ring-fenced from your main portfolio. There is no risk-free practice mode.
2. **The `trader.py` risk gate does NOT protect you here.** Robinhood's MCP lets
   the connected LLM place orders itself. Your Python guardrail is bypassed.
   Enforcement now lives in (a) the system prompt and (b) YOUR manual approval.
3. **Autonomous mode = an LLM hallucination becomes a real filled order** with no
   human in between. Do not enable it early. Maybe not ever.

---

## The mandatory two-step approach

### Step 1 — Prove it on Alpaca paper FIRST (do not skip)
Use the prompts + strategy + risk rules in this repo on **Alpaca paper** (free,
fake money) for 3–6 months. Get positive expectancy over 50+ trades. Same logic,
zero financial risk. See `01_SETUP.md` and `05_DAILY_WORKFLOW.md`.

### Step 2 — Only then connect the PROVEN prompt to Robinhood, in MANUAL mode
- Fund the dedicated agentic account with your $100 (this is your hard loss cap).
- Run the agent in **manual-approval mode**: every order requires your tap.
- YOU are now the deterministic risk gate. Use the checklist below on every
  proposed order. If it fails any check, reject it. No exceptions.
- Never switch to autonomous/no-confirmation mode until the agent has earned it
  over many months of approved trades. Honestly? For $100, just stay manual.

---

## Connecting via MCP

Robinhood exposes an MCP server. You connect an MCP-capable agent (Claude
Code/Desktop, ChatGPT, Cursor, Codex CLI, etc.) to it.

1. In the Robinhood app: create an **Agentic Trading account** and fund it
   (deposit your $100 here — this is the only money the agent can touch).
2. Connect your agent platform to the Robinhood Trading MCP. The server URL is:

   ```
   https://agent.robinhood.com/mcp/trading
   ```

   Examples (per Robinhood's docs):
   - **Claude Code:** `claude mcp add robinhood-trading --transport http https://agent.robinhood.com/mcp/trading` then `/mcp` → authenticate.
   - **ChatGPT:** Settings → Connectors → Add custom connector → paste the MCP link.
   - **Cursor:** Settings → MCP servers → Streamable HTTP → paste the MCP link.
   - **Codex CLI:** `/mcp` → select `robinhood-trading` → authenticate.
3. Authenticate. The agent now has tools to read your agentic account
   (portfolio, buying power) and place orders in it.
4. **Set approval to manual.** Confirm the agent asks before every order.
5. Paste `prompts/MASTER_SYSTEM_PROMPT.md` as the agent's instructions/system
   prompt. That single prompt encodes the strategy, the hard risk rules, the
   daily loop, and the requirement to ASK before trading.

> Keep credentials and the MCP connection private (your rule). Disconnect the
> agent with the in-app kill switch whenever you're not actively running it.

---

## The data-layer gap (important — the MCP is NOT a data feed)

The Robinhood MCP exposes only: `search`, `get_equity_quotes` (real-time quote +
last close), `get_equity_tradability`, `get_portfolio`, `get_equity_orders`,
`review_equity_order`, `place_equity_order`, `cancel_equity_order`.

There is **no historical-bar tool**, so the agent CANNOT compute SMA50/200/20,
RSI(14), ATR, or 20-day average volume — the strategy's core inputs. If you ask
it to "scan for setups" with MCP data alone, the correct behavior is NO TRADE
(and a good agent will refuse rather than hallucinate indicators).

Fix: run `indicators.py` (the data layer) after the close. It fetches daily
history (yfinance, no key), computes all indicators, evaluates Setup A/B, and
prints a JSON block. You PASTE that block into the agent so it decides over real
numbers. Robinhood stays as execution-only.

```
cd trading-agent && source .venv/bin/activate
python indicators.py            # prints a table + a JSON block to paste
```

Then in the agent:
> "Here is today's REAL indicator data: <paste JSON>. Run the daily routine over
> it. Use get_equity_quotes only to confirm the live price before any proposal.
> Propose ONE setup in full format with the risk self-check, or say NO TRADE.
> Do not place any order." (analysis-only while you learn).

Account note: `get_portfolio` requires an `account_number`. Provide your
**agentic** account number and verify the returned equity is ~$100 (the agentic
account), NOT your main portfolio. If it's not ~$100, STOP — wrong account.

## OBSERVER MODE (do this for weeks/months before any real money)

`observer.py` is your no-risk forward test. It replaces "trust the agent" with
"prove the strategy on real prices first." Once daily after the close it:
  - pulls real indicators (via indicators.py),
  - forms deterministic Setup A/B ideas sized to 1% risk with a 2R target,
  - logs them to `logs/journal.csv` as PAPER_BUY (status OPEN),
  - resolves prior OPEN ideas against real later prices (WIN / LOSS / TIME_STOP),
  - prints a scorecard + a GRADUATION GATE.

Run it manually:
```
cd trading-agent && ./run_observer.sh
```

Or schedule it (macOS, weekdays 4:35pm ET — adjust path):
```cron
35 16 * * 1-5  /full/path/to/trading-agent/run_observer.sh >> /full/path/to/trading-agent/logs/cron.log 2>&1
```
Add with `crontab -e`. (Your Mac must be awake at that time.)

### The graduation gate — when "real decisions" are allowed
DO NOT risk real money until `observer.py` shows ALL of these on CLOSED trades:
  - sample >= 40 closed trades
  - expectancy >= +0.10 R per trade
  - profit factor >= 1.30
  - max drawdown >= -10 R (i.e. it respected risk)
  - positive in >= 2 of the last 3 months

This is what "confident" means here — NOT an 80% win rate. A healthy swing system
wins ~45-55% of the time. Anything advertising 80% wins is almost certainly not
using stops and is one bad trade from zero. The gate is about EXPECTANCY over a
sample, not win rate.

### Using the agent alongside the observer (optional, richer reasoning)
The observer is purely mechanical. If you also want the LLM's qualitative read,
paste the JSON from `indicators.py` into the agent in ANALYSIS-ONLY mode and log
its "would-have" calls too. But the journal from `observer.py` is the objective
source of truth for the graduation decision.

## Your manual risk-gate checklist (run on EVERY proposed order)

Because the code gate is gone, you enforce these by hand. Reject the order if it
fails ANY line:

```
[ ] Is this a SWING setup (hold 3–20 days), not a day trade?      (PDT: <=3 day trades/5d)
[ ] Stop-loss specified AND below entry?
[ ] Take-profit specified AND >= 2x the risk distance? (reward:risk >= 2)
[ ] Dollar risk (entry-stop)*qty <= 1% of account ($1 on $100)?
[ ] This is <= 3rd open position?
[ ] Not same sector as an existing position?
[ ] No earnings / binary event inside the hold window?
[ ] Account NOT down >=10% from its peak? (if it is: NO new trades)
[ ] Not already down 3% today? (if it is: stop for the day)
[ ] Data the agent cited is current (today/yesterday), not hallucinated?
```

If you can't verify a line, treat it as a fail. When in doubt, reject.

---

## PDT reminder on Robinhood

Agentic Trading is equities. The Pattern Day Trader rule still applies: under
$25k, max 3 day trades per rolling 5 business days in a margin account. Your
$100 account must **swing trade only** (hold overnight+). The master prompt
enforces this. If the agent tries to scalp intraday, reject it.

---

## Day 1 with a REAL $100 — the operating reality

The dollar moves at this size are tiny. That is the most important thing to
understand, because it's what makes the $100->$1,000 goal impossible and tells
you what this phase is really for: learning discipline with real emotions while
the downside is capped at $100. It is tuition, not income.

What a $100 account actually trades like:
  - 1% risk = $1 risk per trade.
  - Stop ~4% below entry -> position size ~ $1 / 0.04 = ~$25 (fractional shares).
  - Max 3 positions, 35% cap each -> ~$75 deployed, ~$25 cash.
  - A winning swing (2:1) makes ~ +$2. A loser ~ -$1.
  - Good-case expectancy (45% win rate, 2:1) ~ +$0.35/trade; ~10 trades/month
    ~ +$3-4/month (~3-4%). You will spend more time than that is worth. Expected.

Honest year-end projection from $100 (7 months, Jun–Dec):
  - 3%/mo (good)        -> ~$123
  - 5%/mo (exceptional) -> ~$141
  - 39%/mo (the goal)   -> $1,000  (best fund in history, delivered monthly; fantasy)
  - a realistic losing run -> $70–90 (also very possible)
The good outcome is ~$120–140. $1,000 is not on the table at any honest risk.

Day-1 settings the moment it's funded:
  1. Manual approval ON. Every order needs your tap. Autonomous mode OFF.
  2. Deposit exactly $100 into the agentic account — nothing more. Hard loss cap.
  3. Paste MASTER_SYSTEM_PROMPT.md as the agent's instructions; re-affirm each session.
  4. Run the manual risk-gate checklist on EVERY proposal. Verify the prices the
     agent cites are real and current, not hallucinated, before approving.
  5. Pre-committed kill conditions (decide now, in cold blood):
       - down to $90 (-10% from peak): halt ALL new entries, manage only.
       - down to $85: disconnect the agent and stop. No "one more trade".
  6. Tax: every sale is a reportable short-term gain/loss. Negligible $ at $100,
     but build the record-keeping habit now (log every fill in logs/journal.csv).
  7. Journal every approved trade and every rejection (06_TRADE_JOURNAL.md). The
     scoreboard is expectancy, not the balance.

## What "success" looks like here (unchanged, and be honest)

- The dedicated account isolates damage to $100. Good. That's the real guardrail.
- The $100 → $1,000 goal is still fantasy math (see README). Real money makes it
  worse, not better, because now losing streaks are real losses.
- Win condition for the year: the agent, in manual mode, proposes trades that
  pass your checklist and show positive expectancy. If it can't, disconnect it
  and keep the $100. There is no shame in that — it's the correct outcome.
