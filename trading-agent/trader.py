"""
trader.py — minimal scaffold for the swing-trading agent.

This is a STARTER, not a finished bot. It wires together:
  - Alpaca paper connection + portfolio state
  - The deterministic risk gate (the part that actually protects capital)
  - Stubs where the LLM agent prompts (see 02_AGENT_PROMPTS.md) plug in

It is intentionally conservative and paper-only. Read 04_RISK_RULES.md before
touching anything. The LLM proposes; risk_gate disposes.

Usage:
    python trader.py --check            # verify Alpaca paper connection
    python trader.py --run              # run daily loop, print proposals (no orders)
    python trader.py --run --submit     # also submit approved bracket orders (paper)
"""

from __future__ import annotations

import argparse
import csv
import math
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

LOGS = Path(__file__).parent / "logs"
LOGS.mkdir(exist_ok=True)
JOURNAL = LOGS / "journal.csv"

# ---- Risk constants (mirror 04_RISK_RULES.md) -------------------------------
MAX_RISK_PER_TRADE = 0.01     # 1% of equity
MAX_TOTAL_OPEN_RISK = 0.05    # 5% of equity
MAX_OPEN_POSITIONS = 3
MAX_SINGLE_NAME = 0.35        # 35% of equity in one name
MIN_REWARD_RISK = 2.0
DRAWDOWN_HALT = -0.10         # halt new entries at -10% from peak
DAILY_LOSS_LIMIT = -0.03      # no new trades after -3% on the day


# ---- Data models ------------------------------------------------------------
@dataclass
class Proposal:
    """An order proposal produced by the Trader agent (see prompt #6)."""
    ticker: str
    action: str                # "BUY" | "NO_TRADE"
    qty: float
    limit_price: float
    stop_loss: float
    take_profit: float
    sector: str = "UNKNOWN"
    data_age_days: int = 0
    thesis: str = ""


@dataclass
class Portfolio:
    equity: float
    peak_equity: float
    day_start_equity: float
    open_positions: list = field(default_factory=list)   # list of dicts
    open_risk_dollars: float = 0.0

    def drawdown_from_peak(self) -> float:
        if self.peak_equity <= 0:
            return 0.0
        return (self.equity - self.peak_equity) / self.peak_equity

    def daily_pnl_pct(self) -> float:
        if self.day_start_equity <= 0:
            return 0.0
        return (self.equity - self.day_start_equity) / self.day_start_equity

    def has_sector(self, sector: str) -> bool:
        return any(p.get("sector") == sector for p in self.open_positions)


@dataclass
class GateResult:
    approved: bool
    reason: str = "ok"


# ---- The deterministic risk gate (THE important part) -----------------------
def risk_gate(p: Proposal, pf: Portfolio) -> GateResult:
    """Code-enforced risk rules. The LLM cannot override this. Code wins."""
    if p.action != "BUY":
        return GateResult(False, "not a buy")
    if pf.drawdown_from_peak() <= DRAWDOWN_HALT:
        return GateResult(False, "drawdown circuit breaker (-10%)")
    if pf.daily_pnl_pct() <= DAILY_LOSS_LIMIT:
        return GateResult(False, "daily loss limit (-3%)")
    if len(pf.open_positions) >= MAX_OPEN_POSITIONS:
        return GateResult(False, "max open positions (3)")
    if p.stop_loss >= p.limit_price:
        return GateResult(False, "stop must be below entry")
    if p.take_profit <= p.limit_price:
        return GateResult(False, "target must be above entry")
    if p.data_age_days > 1:
        return GateResult(False, "stale data (>1 trading day)")

    risk_per_share = p.limit_price - p.stop_loss
    if risk_per_share <= 0 or p.qty <= 0:
        return GateResult(False, "invalid size/stop")

    reward_risk = (p.take_profit - p.limit_price) / risk_per_share
    if reward_risk < MIN_REWARD_RISK:
        return GateResult(False, f"reward:risk {reward_risk:.2f} < {MIN_REWARD_RISK}")

    risk_dollars = p.qty * risk_per_share
    if risk_dollars > pf.equity * MAX_RISK_PER_TRADE + 1e-9:
        return GateResult(False, f"risk ${risk_dollars:.2f} > 1% of equity")
    if pf.open_risk_dollars + risk_dollars > pf.equity * MAX_TOTAL_OPEN_RISK + 1e-9:
        return GateResult(False, "total open risk > 5%")
    if p.qty * p.limit_price > pf.equity * MAX_SINGLE_NAME + 1e-9:
        return GateResult(False, "single-name exposure > 35%")
    if pf.has_sector(p.sector):
        return GateResult(False, f"sector concentration ({p.sector})")

    return GateResult(True, "ok")


def size_position(equity: float, entry: float, stop: float) -> float:
    """1%-risk position sizing. Fractional shares allowed on Alpaca."""
    risk_per_share = entry - stop
    if risk_per_share <= 0:
        return 0.0
    max_dollar_risk = equity * MAX_RISK_PER_TRADE
    qty = max_dollar_risk / risk_per_share
    return math.floor(qty * 1000) / 1000  # round down to 0.001 shares


# ---- Alpaca connection ------------------------------------------------------
def get_trading_client():
    try:
        from alpaca.trading.client import TradingClient
    except ImportError:
        raise SystemExit("Run: pip install -r requirements.txt")

    key = os.getenv("APCA_API_KEY_ID")
    secret = os.getenv("APCA_API_SECRET_KEY")
    if not key or not secret:
        raise SystemExit("Missing APCA_API_KEY_ID / APCA_API_SECRET_KEY in .env")
    # paper=True is critical — never flip without reading the README math.
    return TradingClient(key, secret, paper=True)


def load_portfolio(client) -> Portfolio:
    acct = client.get_account()
    equity = float(acct.equity)
    # NOTE: persist peak/day_start across runs in a real build (e.g. logs/state.json)
    return Portfolio(
        equity=equity,
        peak_equity=equity,
        day_start_equity=equity,
        open_positions=[],
        open_risk_dollars=0.0,
    )


def submit_bracket(client, p: Proposal):
    from alpaca.trading.requests import LimitOrderRequest, TakeProfitRequest, StopLossRequest
    from alpaca.trading.enums import OrderSide, TimeInForce, OrderClass

    req = LimitOrderRequest(
        symbol=p.ticker,
        qty=p.qty,
        side=OrderSide.BUY,
        time_in_force=TimeInForce.DAY,
        limit_price=round(p.limit_price, 2),
        order_class=OrderClass.BRACKET,
        take_profit=TakeProfitRequest(limit_price=round(p.take_profit, 2)),
        stop_loss=StopLossRequest(stop_price=round(p.stop_loss, 2)),
    )
    return client.submit_order(req)


# ---- Journaling -------------------------------------------------------------
def journal(row: dict):
    new = not JOURNAL.exists()
    with JOURNAL.open("a", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(row.keys()))
        if new:
            w.writeheader()
        w.writerow(row)


# ---- LLM agent hook (STUB — wire your prompts here) -------------------------
def run_agents_for_candidate(ticker: str, market_data: dict, equity: float) -> Proposal:
    """
    STUB. Replace with real calls to your LLM using the prompts in
    02_AGENT_PROMPTS.md (technical -> fundamental -> sentiment -> debate ->
    research manager -> trader). Each must return strict JSON; parse into a
    Proposal. Until wired, this returns NO_TRADE so nothing fires by accident.
    """
    return Proposal(ticker=ticker, action="NO_TRADE", qty=0,
                    limit_price=0, stop_loss=0, take_profit=0,
                    thesis="agents not wired yet")


def get_watchlist() -> list[str]:
    wl = LOGS / "watchlist.txt"
    if not wl.exists():
        return ["SPY", "QQQ", "AAPL", "MSFT"]  # placeholder defaults
    return [l.strip() for l in wl.read_text().splitlines() if l.strip()]


# ---- Main loop --------------------------------------------------------------
def daily_loop(submit: bool):
    client = get_trading_client()
    pf = load_portfolio(client)
    print(f"Equity ${pf.equity:.2f} | drawdown {pf.drawdown_from_peak():.1%}")

    if pf.drawdown_from_peak() <= DRAWDOWN_HALT:
        print("HALT: drawdown circuit breaker active. Managing only, no new entries.")
        return

    for ticker in get_watchlist():
        market_data = {}  # TODO: fetch OHLCV/indicators/news via Alpaca + a data source
        prop = run_agents_for_candidate(ticker, market_data, pf.equity)

        if prop.action != "BUY":
            print(f"{ticker}: NO_TRADE — {prop.thesis}")
            continue

        gate = risk_gate(prop, pf)
        ts = datetime.now(timezone.utc).isoformat()
        if not gate.approved:
            print(f"{ticker}: REJECTED by risk gate — {gate.reason}")
            journal({"date": ts, "ticker": ticker, "decision": "REJECTED",
                     "reason": gate.reason, "thesis": prop.thesis})
            continue

        rps = prop.limit_price - prop.stop_loss
        print(f"{ticker}: APPROVED qty={prop.qty} entry={prop.limit_price} "
              f"stop={prop.stop_loss} target={prop.take_profit} "
              f"risk=${prop.qty * rps:.2f}")
        journal({"date": ts, "ticker": ticker, "decision": "BUY",
                 "entry": prop.limit_price, "stop": prop.stop_loss,
                 "target": prop.take_profit, "qty": prop.qty,
                 "risk_dollars": round(prop.qty * rps, 2), "thesis": prop.thesis})

        if submit:
            order = submit_bracket(client, prop)
            print(f"   submitted paper bracket order id={order.id}")
        else:
            print("   (dry run — use --submit to send to paper)")


def check():
    client = get_trading_client()
    acct = client.get_account()
    print("connection OK")
    print(f"account status: {acct.status} | equity: ${float(acct.equity):.2f} "
          f"| cash: ${float(acct.cash):.2f}")
    if float(acct.equity) > 1000:
        print("TIP: reset your paper account to $100 in the Alpaca dashboard to "
              "match your real intended capital (see 01_SETUP.md).")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="verify Alpaca connection")
    ap.add_argument("--run", action="store_true", help="run the daily loop")
    ap.add_argument("--submit", action="store_true", help="submit approved orders (paper)")
    args = ap.parse_args()

    if args.check:
        check()
    elif args.run:
        daily_loop(submit=args.submit)
    else:
        ap.print_help()
