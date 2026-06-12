# PRD 07: Reports & Analytics

## Overview

Reports are a fully interactive page. All charts are hand-rolled SVG with hover effects. The app has two report surfaces: the **Reports page** (spending analysis) and the **Cash Flow page** (income, savings, and flexibility-bucket breakdown).

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

Age of Money is removed; see Cash Flow page below for savings-related analytics.

## UI Layout

```
┌──────────────────────────────────────────────────────────┐
│  Reports                           [From ▼] → [To ▼]   │
│                                                          │
│  [Spending Over Time] [Breakdown] [Income/Exp]          │
│  [Net Worth]                                            │
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

## Cash Flow Page

A dedicated top-level page (`CashFlow.tsx`) separate from the Reports page.

### Charts and Panels
- **Income vs. spending bars** — grouped bars per month (income green, spending red)
- **Savings line / rate** — overlaid on the bar chart; hover shows savings rate percentage
- **Current-month summary** — income, spending, savings, savings rate for the selected month
- **Flexibility-bucket breakdown** — per-month bars showing fixed / flexible / non-monthly spending
- **Top spending categories** — for the selected month

### API Endpoint

`GET /api/reports/savings?from=YYYY-MM&to=YYYY-MM`

Returns a monthly savings-rate series (income, spending, savings per month, all CRC).

```json
{
  "months": [
    {
      "month": "2026-06",
      "income": 175000000,
      "spending": 142000000,
      "savings": 33000000,
      "savings_rate": 0.189
    }
  ]
}
```

## Reports API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/reports/spending | Spending breakdown by category group |
| GET | /api/reports/income-expense | Income vs expense per month |
| GET | /api/reports/savings | Savings rate series (see Cash Flow page above) |
| GET | /api/reports/net-worth | Net worth over time |

## Implementation Notes

- All charts are pure SVG — no Recharts or other charting dependency
- Charts are responsive via `viewBox` + `width: 100%`
- Hover state is managed with local `useState` in each chart component
- The date-range picker (month inputs) is wired to state but does not yet filter data — filtering will be added when backend data is live
