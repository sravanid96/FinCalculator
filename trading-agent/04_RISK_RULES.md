# 04 — Risk Rules (the hard layer)

This is the most important file in the repo. The single biggest reason small
accounts die is risk, not bad picks. These rules are enforced in **deterministic
code** (`risk_gate()` in `trader.py`). The LLM cannot override them. If the LLM
proposes something that breaks a rule, the code silently rejects it.

> "Without losing the original $100" is only possible if you NEVER let a trade or
> a streak blow up. That's what this layer is for. It's also why the $100→$1000
> stretch goal is fantasy: the same rules that protect the $100 cap the upside.

---

## The non-negotiables

| # | Rule | Value |
|---|------|-------|
| 1 | Max risk per trade | **1% of equity** ($1 on $100) |
| 2 | Max total open risk | **5% of equity** |
| 3 | Max open positions | **3** |
| 4 | Max single-name exposure | **35% of equity** |
| 5 | Min reward:risk | **2.0** |
| 6 | Every position has a stop | **mandatory at entry** |
| 7 | Account drawdown circuit breaker | **halt new entries at −10% from peak** |
| 8 | Daily loss limit | **stop trading for the day at −3% equity** |
| 9 | No averaging down | **ever** |
| 10 | No earnings/binary-event holds | **blocked** |
| 11 | Same-sector concentration | **max 1 position per sector** |
| 12 | Stale data | **data > 1 trading day old → NO_TRADE** |

---

## Position sizing (the math, always)

```
risk_per_share   = entry_price - stop_price        # must be > 0
max_dollar_risk  = equity * 0.01                    # rule 1
qty              = floor(max_dollar_risk / risk_per_share)   # fractional ok
cost             = qty * entry_price
```

Reject the trade if:
- `risk_per_share <= 0` (stop not below entry)
- `qty <= 0`
- `cost > equity * 0.35` (rule 4)
- `(target - entry) / (entry - stop) < 2.0` (rule 5)
- adding this trade pushes summed open risk over `equity * 0.05` (rule 2)

**Example on $100, buying a $50 stock, stop at $48:**
- risk/share = $2, max risk = $1 → qty = 0.5 shares (fractional).
- cost = $25 (under 35%). reward target needs to be ≥ $54 (2R). OK.
- Worst case loss if stopped: $1 = 1% of account. That's the whole point.

---

## The circuit breakers (capital preservation > everything)

- **−10% account drawdown** from the all-time-high equity → the gate blocks ALL
  new entries until equity recovers above −5%. Existing positions still managed
  by their stops. This is what stops a death spiral.
- **−3% in a single day** → no new trades that day. Sleep on it.
- **3 consecutive losing trades** → pause new entries for 2 trading days and
  review the journal. Something may be off (regime, bug, or you over-traded).

---

## Pseudocode for `risk_gate(proposal, portfolio)`

```python
def risk_gate(p, pf):
    if pf.drawdown_from_peak() <= -0.10:        return reject("drawdown breaker")
    if pf.daily_pnl_pct() <= -0.03:             return reject("daily loss limit")
    if len(pf.open_positions) >= 3:             return reject("max positions")
    if p.stop_loss >= p.limit_price:            return reject("bad stop")
    if p.take_profit <= p.limit_price:          return reject("bad target")

    risk_per_share = p.limit_price - p.stop_loss
    rr = (p.take_profit - p.limit_price) / risk_per_share
    if rr < 2.0:                                return reject("reward:risk < 2")

    risk_dollars = p.qty * risk_per_share
    if risk_dollars > pf.equity * 0.01:         return reject("risk > 1%")
    if pf.open_risk() + risk_dollars > pf.equity * 0.05: return reject(">5% open risk")
    if p.qty * p.limit_price > pf.equity * 0.35: return reject(">35% single name")
    if pf.has_sector(p.sector):                 return reject("sector concentration")
    if p.data_age_days > 1:                     return reject("stale data")
    return approve()
```

If `risk_gate` rejects, the order is NOT sent, the reason is logged to the
journal, and the day ends. No appeals.

---

## What this buys you

- A single trade can lose at most ~1% ($1). It takes a long, improbable losing
  streak to threaten the $100, and the drawdown breaker stops that streak.
- You will have boring days and losing weeks. That is correct. Boring is the
  product. Excitement is how small accounts die.
