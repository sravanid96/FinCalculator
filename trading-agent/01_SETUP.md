# 01 — Setup (Alpaca Paper + Python)

Goal: a working paper-trading environment in ~30 minutes. Fake money, real
prices, $0 cost, no minimum. Same code works for live later — you just flip a
flag (don't).

---

## Step 1 — Create a free Alpaca paper account

1. Go to <https://alpaca.markets/> and sign up (paper-only accounts are open to
   anyone globally, just an email).
2. In the dashboard, switch to **Paper Trading**.
3. Generate **paper API keys** (`API Key ID` + `Secret Key`). Copy them now — the
   secret is shown once.
4. Note the paper base URL: `https://paper-api.alpaca.markets`.
5. Your paper account starts at $100k by default. **Reset it to $100** in the
   dashboard so your simulation matches your real intended capital. This matters
   — position sizing and the PDT-dodging logic only mean something at $100.

> Paper accounts get IEX market data free. Good enough for end-of-day swing
> trading. You are NOT day trading, so data latency is irrelevant.

---

## Step 2 — Python environment

Requires Python 3.10+.

```bash
cd trading-agent
python3 -m venv .venv
source .venv/bin/activate          # macOS/Linux
pip install -r requirements.txt
```

---

## Step 3 — Store secrets in a .env file (never commit it)

Create `trading-agent/.env`:

```bash
APCA_API_KEY_ID=your_paper_key_id
APCA_API_SECRET_KEY=your_paper_secret_key
APCA_API_BASE_URL=https://paper-api.alpaca.markets

# LLM provider (pick one; OpenAI shown)
OPENAI_API_KEY=your_llm_key
LLM_MODEL=gpt-4.1            # or claude-*, gemini-*, or a local ollama model
```

Add a `.gitignore` so secrets and logs never leave your machine:

```
.env
.venv/
logs/*.csv
__pycache__/
```

> Per your own rule: keep this private. `.env` and logs stay local, never pushed
> anywhere.

---

## Step 4 — Smoke test the connection

```bash
python trader.py --check
```

Expected: it prints your paper account equity (~$100) and "connection OK". If it
errors on auth, re-check the keys are the **paper** keys, not live.

---

## Step 5 — Choose your LLM

The agent prompts in `02_AGENT_PROMPTS.md` are model-agnostic. Options:

| Option | Cost | Notes |
|--------|------|-------|
| Cloud (GPT-4.x / Claude / Gemini) | per-token | Best reasoning. A daily run is a few cents. |
| Local (Ollama: llama3.x, qwen) | free | Private, weaker reasoning, fine for learning. |

For a learning project, local is free and private. For best decision quality,
use a frontier cloud model — the cost of one daily run is trivial.

---

## Step 6 — Decide automation level (start manual)

- **Phase 1 (weeks 1–4): MANUAL.** You run the loop, read the agent's output,
  and click the paper order yourself. You learn what it's doing and catch
  garbage. Do NOT skip this.
- **Phase 2: SEMI-AUTO.** Script proposes orders, you approve each one.
- **Phase 3: AUTO (paper only).** Cron/scheduler runs the loop daily; risk gate
  enforces limits. Still paper money.
- **Phase 4: LIVE.** Only after 3–6 profitable paper months. Re-read the
  README's math before you do this.

---

## What you'll have after setup

- A funded $100 paper account.
- A Python env that can read market data and place paper orders.
- Secrets stored locally, ignored by git.
- The prompts ready to drive the agent (next file).

Next: `02_AGENT_PROMPTS.md`.
