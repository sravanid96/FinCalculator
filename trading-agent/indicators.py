"""
indicators.py — the DATA LAYER for the swing agent.

The Robinhood MCP only gives real-time quotes + order placement. It has NO
historical bars, so the agent cannot compute SMAs / RSI / ATR / volume averages
on its own. This script fetches daily history (via yfinance, no API key needed),
computes every indicator the strategy needs, evaluates Setup A / Setup B, and
prints:
  1) a human-readable table, and
  2) a JSON block you PASTE INTO THE AGENT so it reasons over REAL numbers
     instead of hallucinating them.

Usage:
    python indicators.py                      # uses logs/watchlist.txt (or defaults)
    python indicators.py AAPL MSFT SPY        # explicit tickers
    python indicators.py --json               # print only the JSON block

Workflow:
    1. Run this AFTER market close.
    2. Copy the JSON block.
    3. In the agent: "Here is today's real indicator data: <paste>. Run the daily
       routine over it. Propose ONE setup in full format or say NO TRADE. Do not
       place any order." (analysis-only while you're learning).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

LOGS = Path(__file__).parent / "logs"
DEFAULT_WATCHLIST = ["SPY", "QQQ", "AAPL", "MSFT", "NVDA",
                     "GOOGL", "AMZN", "META", "JPM", "XLF", "XLE", "XLK"]


def get_watchlist(args: list[str]) -> list[str]:
    tickers = [a.upper() for a in args if not a.startswith("--")]
    if tickers:
        return tickers
    wl = LOGS / "watchlist.txt"
    if wl.exists():
        return [l.strip().upper() for l in wl.read_text().splitlines() if l.strip()]
    return DEFAULT_WATCHLIST


def rsi(series: pd.Series, period: int = 14) -> float:
    delta = series.diff()
    gain = delta.clip(lower=0).rolling(period).mean()
    loss = (-delta.clip(upper=0)).rolling(period).mean()
    rs = gain / loss.replace(0, np.nan)
    out = 100 - (100 / (1 + rs))
    return float(out.iloc[-1])


def atr(df: pd.DataFrame, period: int = 14) -> float:
    high, low, close = df["High"], df["Low"], df["Close"]
    prev_close = close.shift(1)
    tr = pd.concat([high - low, (high - prev_close).abs(),
                    (low - prev_close).abs()], axis=1).max(axis=1)
    return float(tr.rolling(period).mean().iloc[-1])


def analyze(ticker: str, df: pd.DataFrame) -> dict:
    if df is None or len(df) < 210:
        return {"ticker": ticker, "data_quality": "MISSING",
                "note": "need >= 210 daily bars for SMA200"}

    close = df["Close"]
    last = float(close.iloc[-1])
    sma20 = float(close.rolling(20).mean().iloc[-1])
    sma50 = float(close.rolling(50).mean().iloc[-1])
    sma200 = float(close.rolling(200).mean().iloc[-1])
    rsi14 = rsi(close)
    atr14 = atr(df)
    vol20 = float(df["Volume"].rolling(20).mean().iloc[-1])
    last_vol = float(df["Volume"].iloc[-1])
    high_52w = float(close.tail(252).max())
    uptrend = last > sma50 > sma200

    # Setup A — trend pullback
    near_20sma = abs(last - sma20) / sma20 <= 0.03
    setup_a = bool(uptrend and near_20sma and (35 <= rsi14 <= 50))

    # Setup B — confirmed breakout near highs on volume
    near_highs = last >= 0.98 * high_52w
    vol_surge = last_vol >= 1.5 * vol20
    setup_b = bool(near_highs and vol_surge and last >= high_52w * 0.999)

    return {
        "ticker": ticker,
        "last_close": round(last, 2),
        "sma20": round(sma20, 2),
        "sma50": round(sma50, 2),
        "sma200": round(sma200, 2),
        "rsi14": round(rsi14, 1),
        "atr14": round(atr14, 2),
        "vol_last": int(last_vol),
        "vol_20d_avg": int(vol20),
        "high_52w": round(high_52w, 2),
        "regime": "TRENDING_UP" if uptrend else
                  ("TRENDING_DOWN" if last < sma50 < sma200 else "RANGING/CHOPPY"),
        "setup_A_pullback": setup_a,
        "setup_B_breakout": setup_b,
        "data_quality": "OK",
    }


def fetch(tickers: list[str]) -> dict[str, pd.DataFrame]:
    try:
        import yfinance as yf
    except ImportError:
        raise SystemExit("Run: pip install -r requirements.txt  (needs yfinance)")
    out: dict[str, pd.DataFrame] = {}
    data = yf.download(tickers, period="2y", interval="1d",
                       group_by="ticker", auto_adjust=True, progress=False)
    for t in tickers:
        try:
            df = data[t] if len(tickers) > 1 else data
            out[t] = df.dropna()
        except Exception:
            out[t] = None
    return out


def main():
    args = sys.argv[1:]
    json_only = "--json" in args
    tickers = get_watchlist(args)

    frames = fetch(tickers)
    results = [analyze(t, frames.get(t)) for t in tickers]

    spy = next((r for r in results if r["ticker"] == "SPY"), None)
    regime_note = ""
    if spy and spy.get("data_quality") == "OK":
        risk_off = spy["last_close"] < spy["sma200"]
        regime_note = ("MARKET RISK-OFF (SPY < 200SMA): A-grade setups only, half "
                       "size, or sit out." if risk_off else
                       "Market regime OK (SPY >= 200SMA).")

    payload = {"as_of": pd.Timestamp.today().strftime("%Y-%m-%d"),
               "market_regime_note": regime_note,
               "tickers": results}

    if not json_only:
        print(f"\nIndicator scan — {payload['as_of']}")
        print(regime_note or "")
        cols = ["ticker", "last_close", "sma20", "sma50", "sma200",
                "rsi14", "regime", "setup_A_pullback", "setup_B_breakout"]
        ok = [r for r in results if r.get("data_quality") == "OK"]
        if ok:
            print(pd.DataFrame(ok)[cols].to_string(index=False))
        bad = [r["ticker"] for r in results if r.get("data_quality") != "OK"]
        if bad:
            print(f"\nNo/insufficient data: {', '.join(bad)}")
        cands = [r["ticker"] for r in ok
                 if r["setup_A_pullback"] or r["setup_B_breakout"]]
        print(f"\nCandidates passing a setup filter: {cands or 'NONE'}")
        print("\n--- PASTE THE BLOCK BELOW INTO THE AGENT ---\n")

    print("```json")
    print(json.dumps(payload, indent=2))
    print("```")


if __name__ == "__main__":
    main()
