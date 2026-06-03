# PRD 07: Reports & Analytics

## Overview

Reports are a fully interactive page (no backend required in v1 — computed from `AppData` in the frontend). Five report types are selectable via card tabs. All charts are hand-rolled SVG with hover effects.

## Report Types

### 1. Spending Over Time
Multi-line SVG chart showing monthly spending by category group.

- **X-axis**: months (Nov–Apr or selected range)
- **Y-axis**: CRC/USD amount
- **Lines**: One per category group, each in its `GROUP_COLORS` color
- **Hover**: Hover a line to isolate it (others dim to 18% opacity); gradient fill appears under the hovered line; data-point circles enlarge

### 2. Spending Breakdown
Interactive donut chart showing each group's share of total spending.

- **Hover a slice**: Isolates it (others dim), shows `XX%` and group name in the center
- **Default center**: "Total" label + formatted grand total
- **Legend**: List of groups with color swatch, percentage, and total amount
- **Data source**: Summed across all `monthlySpending` rows

### 3. Income vs Expense
Grouped bar chart with side-by-side income (green) and expense (red) bars per month.

- **Hover a month**: Both bars highlight at full opacity; net amount appears as a tooltip above
- **Other months**: Fade to 40% opacity on hover

### 4. Net Worth
Area-line chart of `assets − debt` over time.

- **Color**: `#5b9dff` (blue)
- **Gradient fill**: 25% → 0% opacity area under the line
- **Hover**: Enlarges data point, shows formatted value tooltip

### 5. Age of Money
Area-line chart of days (integer) over time.

- **Color**: `#3ddc97` (mint)
- **Y-axis labels**: suffix "d" (days)
- **Hover**: Shows `{N}d` tooltip

## UI Layout

```
┌──────────────────────────────────────────────────────────┐
│  Reports                           [From ▼] → [To ▼]   │
│                                                          │
│  [Spending Over Time] [Breakdown] [Income/Exp]          │
│  [Net Worth]          [Age of Money]                    │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Chart (SVG, full width)                         │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Monthly Summary table (Trend + Breakdown only)  │   │
│  └──────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────┘
```

## Monthly Summary Table

Shown below the chart for Spending Over Time and Spending Breakdown reports.

| Month | Housing | Food & Dining | Transport | … | Total |
|-------|---------|--------------|-----------|---|-------|
| Nov 25 | ₡522,000 | ₡145,000 | ₡118,000 | … | ₡964,000 |

- Column headers include the group color swatch
- Hover row highlights with subtle background
- Zero values shown as `—`

## Data Sources (Frontend)

All report data lives in `src/data.ts`:

| Field | Used by |
|-------|---------|
| `monthlySpending` | Spending Over Time, Breakdown, Monthly Summary |
| `incomeExpense` | Income vs Expense |
| `netWorthHistory` | Net Worth |
| `ageOfMoney` | Age of Money |

## API Endpoints (Backend — Phase 4)

When the backend is implemented, these endpoints will replace static data:

### GET /api/reports/spending-trend
**Params:** `from_date`, `to_date`
```json
{
  "months": [
    { "month": "2026-04", "housing": 513300, "food": 201500, "transport": 106000, ... }
  ]
}
```

### GET /api/reports/income-vs-expense
**Params:** `from_date`, `to_date`
```json
{
  "months": [
    { "month": "2026-04", "income": 1200000, "expense": 1037300 }
  ]
}
```

### GET /api/reports/net-worth
**Params:** `months` (default: 12)
```json
{
  "months": [
    { "month": "Apr 26", "assets": 5100300, "debt": 184500 }
  ]
}
```

### GET /api/reports/age-of-money
**Params:** `months` (default: 12)
```json
{
  "months": [
    { "month": "Apr 26", "days": 38 }
  ]
}
```

## Implementation Notes

- All charts are pure SVG — no Recharts or other charting dependency
- Charts are responsive via `viewBox` + `width: 100%`
- Hover state is managed with local `useState` in each chart component
- The date-range picker (month inputs) is wired to state but does not yet filter data — filtering will be added when backend data is live
