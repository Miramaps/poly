# Poly Trader — Trading Strategy

This document details the **Bulletproof Trading Strategy** used by the bot for Polymarket Bitcoin Up/Down 15-minute markets.

---

## Overview

The strategy exploits the **binary outcome** nature of these markets:

- Each market has two tokens: **UP** and **DOWN**
- At resolution, ONE token pays out **$1.00**, the other pays **$0.00**
- Combined, buying 1 UP + 1 DOWN always pays $1.00

The key insight: **If you can acquire both sides for less than $1.00 total, you lock in guaranteed profit.**

---

## Strategy Phases

### Phase 1: Entry Detection

```
┌─────────────────────────────────────────────────────────────┐
│  ENTRY CONDITION: Wait for price < entryThreshold (0.35)   │
└─────────────────────────────────────────────────────────────┘
```

The bot monitors live orderbook data and waits for either side to drop below the **entry threshold**:

| Setting          | Default | Description                            |
|------------------|---------|----------------------------------------|
| `entryThreshold` | `0.35`  | Buy when ask price drops below 35¢    |
| `shares`         | `10`    | Base number of shares per trade        |

**Why 35¢?**  
At this level, the opposite side is typically around 65¢, giving a combined cost near $1.00. As the cheap side drops further, hedging becomes profitable.

---

### Phase 2: Dollar-Cost Averaging (DCA)

```
┌─────────────────────────────────────────────────────────────┐
│  DCA: Buy more at predefined price levels as price drops   │
└─────────────────────────────────────────────────────────────┘
```

Once an initial entry is made, the bot continues buying at lower price levels:

| Setting         | Default                  | Description                           |
|-----------------|--------------------------|---------------------------------------|
| `dcaEnabled`    | `true`                   | Enable DCA buying                     |
| `dcaLevels`     | `[0.30, 0.25, 0.20, 0.15]` | Price levels to buy more            |
| `dcaMultiplier` | `1.5`                    | Multiply shares at each level         |

**Example DCA Execution:**

| Price Level | Shares Bought | Running Total |
|-------------|---------------|---------------|
| $0.35       | 10            | 10 shares     |
| $0.30       | 15 (×1.5)     | 25 shares     |
| $0.25       | 22 (×1.5)     | 47 shares     |
| $0.20       | 33 (×1.5)     | 80 shares     |
| $0.15       | 50 (×1.5)     | 130 shares    |

This **lowers the average cost** as price drops, improving hedge profitability.

---

### Phase 3: Hedge Detection

```
┌─────────────────────────────────────────────────────────────┐
│  HEDGE CONDITION: avgCost + oppositeAsk ≤ sumTarget (0.99) │
└─────────────────────────────────────────────────────────────┘
```

The bot continuously calculates:

```
Average Cost = Total Cost / Total Shares
Sum = Average Cost + Opposite Side Ask Price
```

When **Sum ≤ sumTarget (0.99)**, the hedge condition is met.

| Setting     | Default | Description                                    |
|-------------|---------|------------------------------------------------|
| `sumTarget` | `0.99`  | Maximum combined cost to trigger hedge         |

**Example Hedge Calculation:**

```
Position: 50 shares @ avg $0.28
Opposite Ask: $0.70

Sum = $0.28 + $0.70 = $0.98 ≤ $0.99 ✅ HEDGE!

Total Cost = 50 × $0.28 + 50 × $0.70 = $14 + $35 = $49
Guaranteed Payout = 50 × $1.00 = $50
Locked Profit = $50 - $49 = $1.00 (2.04%)
```

---

### Phase 4: Hedge Execution

When the hedge condition is met:

1. **Buy opposite side** with the same number of shares
2. **Lock in guaranteed profit** regardless of market outcome
3. **Mark cycle complete**

```
┌─────────────────────────────────────────────────────────────┐
│  Leg 1: 50 UP @ $0.28  │  Leg 2: 50 DOWN @ $0.70           │
│  Total Cost: $49.00    │  Payout: $50.00 (either wins)     │
│  GUARANTEED PROFIT: $1.00 per cycle                        │
└─────────────────────────────────────────────────────────────┘
```

---

### Phase 5: Breakeven Exit (Fallback)

If the hedge condition is never met, the bot has a safety mechanism:

| Setting           | Default | Description                              |
|-------------------|---------|------------------------------------------|
| `breakevenEnabled`| `true`  | Wait for price to recover before selling |

**Logic:**
- If holding leg 1 only and **current bid ≥ average cost**, sell at breakeven
- This prevents unnecessary losses when the opposite side stays expensive

```
Scenario: Bought 50 UP @ $0.28, opposite DOWN stays at $0.80
Sum = $0.28 + $0.80 = $1.08 > $0.99 (no hedge)

If UP recovers to $0.30+ (above avg cost), sell and exit flat.
```

---

## Execution Simulation

The paper trading mode simulates realistic execution:

| Parameter      | Value       | Description                              |
|----------------|-------------|------------------------------------------|
| Latency        | 80-200ms    | Simulated network delay                  |
| Slippage       | 0.5-2%      | Price moves against you during execution |

This provides **realistic profitability testing** before live trading.

---

## Cycle Lifecycle

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                            CYCLE STATE MACHINE                               │
└──────────────────────────────────────────────────────────────────────────────┘

  ┌─────────┐      Entry < 0.35       ┌──────────┐
  │ PENDING │ ───────────────────────▶ │ LEG1_DONE │
  └─────────┘                          └──────────┘
       │                                    │
       │ (Market ends)                      │ DCA continues...
       ▼                                    │
  ┌────────────┐                            ▼
  │ INCOMPLETE │◀─── Market ends ─── ┌──────────┐
  └────────────┘                      │ LEG1_DONE │
                                      └──────────┘
                                           │
                     ┌─────────────────────┼─────────────────────┐
                     │                     │                     │
                     ▼                     ▼                     ▼
              Sum ≤ 0.99?           Bid ≥ Avg?            Market ends?
                     │                     │                     │
                     ▼                     ▼                     ▼
              ┌──────────┐          ┌──────────┐          ┌────────────┐
              │ COMPLETE │          │ COMPLETE │          │ INCOMPLETE │
              │ (hedged) │          │(breakeven)│          │  (forced)  │
              └──────────┘          └──────────┘          └────────────┘
```

---

## Key Formulas

### Average Cost
```
avgCost = leg1TotalCost / leg1TotalShares
```

### Hedge Condition
```
hedgeMet = (avgCost + oppositeAsk) ≤ sumTarget
```

### Locked Profit (when hedged)
```
lockedProfit = (shares × $1.00) - (leg1Cost + leg2Cost)
lockedPct = ((1.00 - (totalCost / shares)) × 100)%
```

### Breakeven Check
```
canExitBreakeven = (currentBid ≥ avgCost) && (exitValue - totalCost ≥ 0)
```

---

## Configuration Reference

```typescript
{
  // Entry
  entryThreshold: 0.35,        // Buy when price < 35¢
  shares: 10,                  // Base shares per buy
  
  // DCA
  dcaEnabled: true,
  dcaLevels: [0.30, 0.25, 0.20, 0.15],
  dcaMultiplier: 1.5,          // 1.5× shares at each level
  
  // Hedge
  sumTarget: 0.99,             // Lock profit when sum ≤ 99¢
  
  // Exit
  breakevenEnabled: true,      // Wait for price recovery
  maxHoldMinutes: 0,           // 0 = hold forever
  
  // Execution
  feeBps: 0,                   // Fee basis points
  initialBankroll: 1000,       // Starting capital
}
```

---

## Risk Analysis

### Protected Scenarios

| Scenario | Outcome |
|----------|---------|
| Bought cheap side, price drops further | DCA lowers avg cost, improves hedge math |
| Bought cheap side, opposite drops too | Hedge becomes available faster |
| Bought side wins at resolution | Full $1 payout per share |
| Bought side loses but hedged | Opposite side pays $1 |

### Risk Scenarios

| Scenario | Mitigation |
|----------|------------|
| Opposite side never drops enough to hedge | Breakeven exit when price recovers |
| Market ends with unhedged position | Bot tracks P&L for incomplete cycles |
| Extreme volatility / flash crashes | DCA spreads risk across price levels |

---

## Summary

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         BULLETPROOF STRATEGY SUMMARY                        │
├─────────────────────────────────────────────────────────────────────────────┤
│  1. WAIT for one side to drop below 35¢                                    │
│  2. BUY that side, DCA down if price keeps falling                         │
│  3. HEDGE when avgCost + oppositeAsk ≤ 99¢ (guaranteed profit)             │
│  4. IF no hedge possible, wait for BREAKEVEN exit                          │
│  5. REPEAT for next market cycle                                            │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Core Principle:** Never sell at a loss. Either hedge for profit or wait for breakeven.


