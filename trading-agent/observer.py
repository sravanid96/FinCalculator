"""
observer.py — OBSERVER (paper-forward-test) MODE. No real money. No broker.

Run this once daily after the US market close. Each run:
  1. Pulls real daily history + indicators (via indicators.py / yfinance).
  2. Forms deterministic swing-trade IDEAS from Setup A / Setup B, sized to the
     1%-risk rule, with stop + 2R target — exactly the strategy's rules.
  3. Logs each new idea to logs/journal.csv as a PAPER trade (status OPEN).
  4. Updates previously-OPEN ideas against subsequent real prices and marks them
     WIN / LOSS / TIME_STOP, recording the result in R-multiples.
  5. Prints a running SCORECARD and the GRADUATION GATE status (whether the
     strategy has earned the right to risk real money).

This is your evidence trail. It "self-improves" only in the honest sense: it
accumulates objective results you (and the agent, if you paste the journal in)
can review. It will NOT chase an 80% win rate — that's not the goal. The goal is
positive expectancy over a real sample. See the gate below.

Usage:
    python observer.py                 # daily run: update + scan + log + scorecard
    python observer.py --scorecard     # just print stats, no new ideas
"""

from __future__ import annotations

import csv
import math
import sys
from datetime import datetime
from pathlib import Path

import pandas as pd

from indicators import fetch, analyze, get_watchlist, DEFAULT_WATCHLIST

LOGS = Path(__file__).parent / "logs"
LOGS.mkdir(exist_ok=True)
JOURNAL = LOGS / "journal.csv"

# --- Config (forward test) ---------------------------------------------------
EQUITY = 100.0           # fixed for clean R-based stats; results are size-agnostic
RISK_PCT = 0.01          # 1% risk per trade
ATR_STOP_MULT = 1.5      # stop = entry - 1.5*ATR  (deterministic proxy for swing low)
REWARD_RISK = 2.0        # target = entry + 2 * risk_per_share
MAX_OPEN = 3
SINGLE_NAME_CAP = 0.35   # max cost in one name
TIME_STOP_DAYS = 20      # trading days

# Correlation buckets, NOT strict GICS. Goal: stop stacking names that move
# together (e.g. don't hold 3 mega-cap tech at once). Max 1 OPEN position per
# bucket. Unknown tickers map to their own ticker (won't block) — add them here.
SECTOR_MAP = {
    # mega-cap tech complex (highly correlated; broad tech ETFs included)
    "AAPL": "MEGACAP_TECH", "MSFT": "MEGACAP_TECH", "GOOGL": "MEGACAP_TECH",
    "GOOG": "MEGACAP_TECH", "AMZN": "MEGACAP_TECH", "META": "MEGACAP_TECH",
    "QQQ": "MEGACAP_TECH", "XLK": "MEGACAP_TECH",
    # semiconductors / memory
    "NVDA": "SEMI", "AMD": "SEMI", "AVGO": "SEMI", "MU": "SEMI", "TSM": "SEMI",
    "QCOM": "SEMI", "INTC": "SEMI", "ARM": "SEMI", "SMCI": "SEMI", "ASML": "SEMI",
    # energy
    "XOM": "ENERGY", "CVX": "ENERGY", "COP": "ENERGY", "SLB": "ENERGY",
    "EOG": "ENERGY", "XLE": "ENERGY",
    # financials
    "JPM": "FINANCIALS", "BAC": "FINANCIALS", "GS": "FINANCIALS",
    "WFC": "FINANCIALS", "MS": "FINANCIALS", "C": "FINANCIALS", "XLF": "FINANCIALS",
    # industrials / robotics / automation ("physical AI" proxy)
    "TSLA": "AUTO_ROBOTICS", "ROK": "AUTO_ROBOTICS", "HON": "AUTO_ROBOTICS",
    "GE": "AUTO_ROBOTICS", "CAT": "AUTO_ROBOTICS",
    # healthcare / surgical robotics
    "ISRG": "HEALTH", "LLY": "HEALTH", "UNH": "HEALTH", "JNJ": "HEALTH", "XLV": "HEALTH",
    # broad index
    "SPY": "INDEX", "DIA": "INDEX", "IWM": "INDEX",
}


def sector(ticker: str) -> str:
    return SECTOR_MAP.get(ticker.upper(), f"UNKNOWN_{ticker.upper()}")

FIELDS = ["signal_date", "ticker", "setup", "decision", "entry", "stop",
          "target", "qty", "risk_dollars", "reward_risk", "status",
          "exit_date", "exit_price", "pnl_R", "notes"]


# --- Journal I/O -------------------------------------------------------------
def load_journal() -> list[dict]:
    if not JOURNAL.exists():
        return []
    with JOURNAL.open() as f:
        return list(csv.DictReader(f))


def save_journal(rows: list[dict]):
    with JOURNAL.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") for k in FIELDS})


# --- Outcome resolution for OPEN ideas ---------------------------------------
def resolve_open(row: dict, df: pd.DataFrame) -> dict:
    """Walk bars after signal_date; mark WIN/LOSS/TIME_STOP. Stop checked first."""
    if df is None or len(df) == 0:
        return row
    entry = float(row["entry"]); stop = float(row["stop"]); target = float(row["target"])
    sig = pd.to_datetime(row["signal_date"]).normalize()
    rps = entry - stop
    future = df[df.index.normalize() > sig]
    if future.empty:
        return row
    for i, (ts, bar) in enumerate(future.iterrows(), start=1):
        if bar["Low"] <= stop:                       # conservative: stop before target
            row.update(status="LOSS", exit_date=ts.strftime("%Y-%m-%d"),
                       exit_price=round(stop, 2), pnl_R=-1.0)
            return row
        if bar["High"] >= target:
            row.update(status="WIN", exit_date=ts.strftime("%Y-%m-%d"),
                       exit_price=round(target, 2), pnl_R=round(REWARD_RISK, 2))
            return row
        if i >= TIME_STOP_DAYS:
            px = float(bar["Close"])
            row.update(status="TIME_STOP", exit_date=ts.strftime("%Y-%m-%d"),
                       exit_price=round(px, 2), pnl_R=round((px - entry) / rps, 2))
            return row
    return row  # still OPEN


# --- Idea formation ----------------------------------------------------------
def form_idea(ind: dict, risk_off: bool) -> dict | None:
    if ind.get("data_quality") != "OK":
        return None
    setup = "A" if ind["setup_A_pullback"] else ("B" if ind["setup_B_breakout"] else None)
    if not setup:
        return None
    if risk_off and setup != "A":   # risk-off: A-grade only
        return None

    entry = ind["last_close"]
    rps = ATR_STOP_MULT * ind["atr14"]
    if rps <= 0:
        return None
    stop = round(entry - rps, 2)
    target = round(entry + REWARD_RISK * rps, 2)

    risk_budget = EQUITY * RISK_PCT
    qty = math.floor((risk_budget / rps) * 1000) / 1000
    if qty <= 0:
        return None
    if qty * entry > EQUITY * SINGLE_NAME_CAP:       # cap single-name cost
        qty = math.floor((EQUITY * SINGLE_NAME_CAP / entry) * 1000) / 1000
    if qty <= 0:
        return None
    if risk_off:
        qty = math.floor((qty / 2) * 1000) / 1000    # half size in risk-off

    return {
        "signal_date": ind["_as_of"],
        "ticker": ind["ticker"],
        "setup": setup,
        "decision": "PAPER_BUY",
        "entry": entry, "stop": stop, "target": target,
        "qty": qty,
        "risk_dollars": round(qty * rps, 2),
        "reward_risk": REWARD_RISK,
        "status": "OPEN",
        "exit_date": "", "exit_price": "", "pnl_R": "",
        "notes": f"regime={ind['regime']} rsi={ind['rsi14']}",
    }


# --- Scorecard + graduation gate ---------------------------------------------
def scorecard(rows: list[dict]):
    closed = [r for r in rows if r["status"] in ("WIN", "LOSS", "TIME_STOP")]
    open_ = [r for r in rows if r["status"] == "OPEN"]
    print(f"\n=== OBSERVER SCORECARD ===  (paper, no real money)")
    print(f"Ideas logged: {len(rows)} | open: {len(open_)} | closed: {len(closed)}")
    if not closed:
        print("No closed trades yet. Keep collecting. NOT READY for real money.")
        return

    rs = [float(r["pnl_R"]) for r in closed]
    wins = [r for r in rs if r > 0]
    losses = [r for r in rs if r <= 0]
    win_rate = len(wins) / len(rs)
    expectancy = sum(rs) / len(rs)
    gross_w = sum(wins)
    gross_l = abs(sum(losses)) or 1e-9
    profit_factor = gross_w / gross_l

    # max drawdown on cumulative R curve
    cum, peak, maxdd = 0.0, 0.0, 0.0
    for r in rs:
        cum += r
        peak = max(peak, cum)
        maxdd = min(maxdd, cum - peak)

    # monthly consistency (last 3 months with closed trades)
    by_month: dict[str, float] = {}
    for r in closed:
        m = (r["exit_date"] or r["signal_date"])[:7]
        by_month[m] = by_month.get(m, 0.0) + float(r["pnl_R"])
    last3 = list(by_month.items())[-3:]
    pos_months = sum(1 for _, v in last3 if v > 0)

    print(f"Win rate:       {win_rate:.0%}   (target is NOT high; ~45-55% is normal)")
    print(f"Expectancy:     {expectancy:+.2f} R / trade   (need >= +0.10)")
    print(f"Profit factor:  {profit_factor:.2f}            (need >= 1.30)")
    print(f"Max drawdown:   {maxdd:.2f} R")
    print(f"Monthly R:      {', '.join(f'{m}:{v:+.1f}' for m, v in last3) or 'n/a'}")

    gate = {
        "sample >= 40": len(closed) >= 40,
        "expectancy >= +0.10R": expectancy >= 0.10,
        "profit factor >= 1.30": profit_factor >= 1.30,
        "max DD <= 10R-ish (>= -10)": maxdd >= -10,  # ~ -10R on 1% risk ~ -10% acct
        "positive in >=2 of last 3 mo": pos_months >= 2,
    }
    print("\n--- GRADUATION GATE (all must pass before ANY real money) ---")
    for k, v in gate.items():
        print(f"  [{'PASS' if v else 'FAIL'}] {k}")
    if all(gate.values()):
        print(">>> GATE PASSED. The strategy has earned a real-money trial. "
              "Start TINY and manual.")
    else:
        print(">>> NOT READY. Keep observing. Do NOT risk real money yet.")


# --- Main --------------------------------------------------------------------
def main():
    args = sys.argv[1:]
    rows = load_journal()

    if "--scorecard" in args:
        scorecard(rows)
        return

    watch = get_watchlist(args) or DEFAULT_WATCHLIST
    open_tickers = [r["ticker"] for r in rows if r["status"] == "OPEN"]
    all_tickers = sorted(set(watch) | set(open_tickers))

    frames = fetch(all_tickers)
    as_of = datetime.today().strftime("%Y-%m-%d")

    # 1) update OPEN ideas
    for r in rows:
        if r["status"] == "OPEN":
            resolve_open(r, frames.get(r["ticker"]))

    # 2) market regime from SPY
    spy = analyze("SPY", frames.get("SPY"))
    risk_off = (spy.get("data_quality") == "OK" and spy["last_close"] < spy["sma200"])

    # 3) form new ideas (respect max open + 1-per-sector + no duplicate ticker)
    still_open = [r["ticker"] for r in rows if r["status"] == "OPEN"]
    taken_sectors = {sector(t) for t in still_open}
    new_ideas = []
    for t in watch:
        if len(still_open) + len(new_ideas) >= MAX_OPEN:
            break
        if t in still_open:
            continue
        sec = sector(t)
        if sec in taken_sectors:                      # sector concentration rule
            continue
        ind = analyze(t, frames.get(t))
        ind["_as_of"] = as_of
        idea = form_idea(ind, risk_off)
        if idea:
            idea["notes"] += f" sector={sec}"
            new_ideas.append(idea)
            taken_sectors.add(sec)
            print(f"NEW PAPER IDEA: {t} ({sec}) Setup {idea['setup']} "
                  f"entry {idea['entry']} stop {idea['stop']} target {idea['target']} "
                  f"qty {idea['qty']} risk ${idea['risk_dollars']}")

    if not new_ideas:
        print(f"{as_of}: no new qualifying setups."
              + (" (market risk-off)" if risk_off else ""))

    rows.extend(new_ideas)
    save_journal(rows)
    scorecard(rows)


if __name__ == "__main__":
    main()
