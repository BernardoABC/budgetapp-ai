# PRD 10: UI Design & Frontend Architecture

## Overview

The frontend is a React SPA built with Vite and TypeScript. The design is a refined dark application with a layered navy-charcoal theme, Monarch-style spending-plan workflows, and six fully interactive pages.

## Design Philosophy

- **Dark by default** — deep navy-charcoal surfaces, not flat black; radial gradient background adds depth
- **Data-dense but readable** — IBM Plex Mono for all monetary values, Plus Jakarta Sans for UI text
- **Mint/emerald accent** — glowing active states, progress bars, and semantic highlights
- **No external UI libraries** — all styling via inline React style objects sourced from a single token file (`src/theme.ts`)

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | React 19 (Vite + TypeScript) |
| Build | Vite 8 |
| Styling | Inline style objects (no CSS framework) |
| Charts | Hand-rolled SVG (no third-party chart library) |
| Routing | State-based navigation (no React Router) |
| State | `useState` / `useMemo` (no external state library) |
| Fonts | Plus Jakarta Sans + IBM Plex Mono (Google Fonts) |

## Design Tokens (`src/theme.ts`)

All colors, fonts, radii, and shadows are exported from a single `T` object:

```ts
// Surfaces (layered, not flat)
bg:        '#080b11'
bgGrad:    radial-gradient(1200px 600px at 80% -10%, ...)
surface:   '#0f141d'
surface2:  '#141a25'

// Text ramp
text:      '#eaeff6'   // primary
textMid:   '#a8b2c1'   // secondary
textDim:   '#6c7787'   // muted
textFaint: '#4b5462'   // very muted

// Semantic colors
pos:  '#3ddc97'  // positive / inflow / success
neg:  '#ff6f7d'  // negative / overspent / error
warn: '#f6c45a'  // warning / near-limit

// Accent (themeable via CSS variable --accent)
accent: 'var(--accent)'  // default: mint #3ddc97
```

### Accent Themes (runtime-switchable via Tweaks panel)

| Key | Color |
|-----|-------|
| mint | `#3ddc97` (default) |
| indigo | `#7c8cff` |
| cyan | `#34d6e8` |
| amber | `#f6b04a` |
| rose | `#fb7199` |

### Data-Viz Palette (`GROUP_COLORS`)

Each category group has a fixed color used in charts and progress bars:

| Group | Color |
|-------|-------|
| Housing | `#5b9dff` |
| Food & Dining | `#3ddc97` |
| Transport | `#f6c45a` |
| Entertainment | `#c084fc` |
| Health | `#ff7a85` |
| Savings | `#38d6e8` |

## Application Layout

```
┌──────────────────────────────────────────────────────────┐
│  budgetapp          [₡ CRC | $ USD]           [Import ↑]│  ← Header (blur backdrop)
├────────────┬─────────────────────────────────────────────┤
│            │                                             │
│  Dashboard │                                             │
│  Budget    │           MAIN CONTENT                      │
│  Cash Flow │         (page-anim fadeUp)                  │
│  Reports   │                                             │
│  ─────────│                                             │
│  BUDGET    │                                             │
│  BAC Check │                                             │
│  Davivie.  │                                             │
│  Efectivo  │                                             │
│  ─────────│                                             │
│  TRACKING  │                                             │
│  Inversión │                                             │
│  SINPE     │                                             │
│  ─────────│                                             │
│  + Add Acct│                                             │
├────────────┴─────────────────────────────────────────────┤
│  ● ₡510.75 / $1   BCCR · updated Apr 14                 │  ← Sidebar footer
└──────────────────────────────────────────────────────────┘
                                     ⚙  [Tweaks FAB]
```

## Pages

Navigation is state-based (no React Router). Current page stored in `localStorage`.

| Page key | Component | Description |
|----------|-----------|-------------|
| `dashboard` | `Dashboard` | Stat cards, budgeted-vs-actual bars, this-month panel, recent transactions |
| `budget` | `Budget` | Monthly spending plan with inline editing and Category/Flex modes |
| `cashflow` | `CashFlow` | Income vs spending, savings rate, flexibility buckets |
| `accounts` | `Accounts` | Per-account transaction register with inline editing |
| `import` | `ImportWizard` | 3-step CSV import with auto-categorization |
| `reports` | `Reports` | 4 interactive report types |

## Pages: Detailed Specs

### Dashboard
- **3 stat cards**: Net Worth (with sparkline), Spent This Month, Savings Rate (with left-to-budget sub-label, red when over-planned)
- **Budgeted vs Actual by Category**: Color-coded progress bars per group; glow fill turns amber >88%, red when over budget
- **This Month panel**: Expected income, Left to budget (red when negative), Savings rate; "Review plan →" CTA
- **Recent Transactions**: Last 7 transactions with date, payee, category color tag, amount

### Budget (Spending Plan)
- **Month navigator**: ‹ / › arrows cycle through available months
- **Plan header**: Expected income (inline-editable with calculator), Planned total, Left to budget (red when over-planned), Planned savings
- **Mode toggle**: Category / Flex, persisted via `PUT /api/settings/budget-mode`
- **Toolbar**: Copy from last month, Reset to zero
- **Edit mode**: Rename/reorder/hide/delete categories and groups inline
- **Category mode rows**:
  - Budgeted: click-to-edit with pencil icon on hover (calculator expressions supported)
  - Actual: auto-computed from transactions (red when spending)
  - Remaining: Budgeted + Activity for the month (red when negative)
  - **Progress bar**: thin bar showing spend% under category name; amber >85%, red when over
  - Rollover pill (↻ accumulated balance) on rollover-enabled categories
- **Flex mode sections**: Fixed (per-category editable, summed header) · Flexible (single flex budget number vs combined flexible spending; categories listed read-only) · Non-monthly (per-category editable with accumulating ↻ balance)
- **Category Inspector** (slide-in drawer): Budgeted/Actual/Remaining stats, Rollover toggle, Flexibility selector (fixed / flexible / non-monthly), hide/delete actions
- **Undo**: Ctrl-Z reverts plan edits (budgeted amounts, expected income, flex budget, category ops)

### Accounts
- **Account header**: Name, type badge (Budget Account / Tracking Account), working balance
- **Upcoming scheduled transactions**: Amber-dot panel with Enter / Skip per item
- **Stats strip**: Transaction count, total outflow, total inflow
- **Filter bar**: Payee search input, category dropdown, date-range pickers, Clear button
- **Transaction table**:
  - Click row to open inline edit
  - Sortable columns (all)
  - Cleared status: glowing green dot (cleared) / hollow ring (uncleared); click to toggle
  - Split transactions show "⑂ Split · N" chip with tooltip
  - Category chips with group color
- **Reconcile modal**: Compares cleared balance to actual; creates adjustment transaction if needed
- **Payee Rules manager**: View, add, and delete payee → category auto-assign rules
- **Split modal**: Divide a transaction across multiple categories

### Import Wizard (3 steps)
1. **Upload**: Drag-and-drop or browse CSV/XLS; select target account
2. **Review**: Parsed transactions; "auto" badge on auto-categorized rows; dropdowns for uncategorized
3. **Confirm**: Summary stats (count, outflows, inflows, net); date range; uncategorized warning

### Cash Flow
- **4 stat cards**: Income, Spending, Savings, Savings rate — current month
- **Income vs Spending**: 12-month SVG line chart (income, spending, dashed savings line)
- **By flexibility**: Fixed / Flexible / Non-monthly progress bars (actual vs planned, red when over)

### Reports (4 views, tab-style card selector)

| Report | Chart type |
|--------|-----------|
| Spending Over Time | Multi-line SVG chart by category group |
| Spending Breakdown | Interactive donut chart (hover isolates slices) |
| Income vs Expense | Grouped bar chart; net tooltip on hover |
| Net Worth | Area-line chart (assets − debt) |

All charts are hand-rolled SVG with hover highlights and data-point tooltips. A Monthly Summary table appears below Spending reports.

## Tweaks Panel (Runtime Settings)

A FAB button (⚙, bottom-right) opens a floating panel:

| Setting | Options |
|---------|---------|
| Accent | 5 color swatches; applies CSS variables instantly |
| Default Currency | CRC / USD; persisted to localStorage |
| Row Density | Compact / Comfortable |

## Currency Formatting

A single `fmt(amount)` function is created in `App.tsx` and passed as a prop to all pages:

```ts
// CRC: ₡450,000  or  -₡2,000
// USD: $882.04   or  -$3.92
fmt = (amount) => fmt(amount, currency, exchangeRate)
```

## Plan Engine (`src/engine.ts`)

Pure TypeScript — recomputes the displayed month optimistically while edits are in flight:

- **`computePlan({groups, expectedIncome, rate, localPlanned, nameById})`** — Month-scoped plan state. Applies local planned overrides on top of the server snapshot, converts USD categories at the current rate, and returns `{ cats, plannedTotalCRC, expectedIncome, leftToBudget }`. Rollover balances (rollover categories and all non-monthly categories) shift by the delta of local edits.
- **`resetAllPlanned(state)`** — Returns a planned-override map zeroing every category.

## Source File Map

```
src/
├── theme.ts              # T tokens, GROUP_COLORS, ACCENTS, applyAccent()
├── api.ts                # Typed API client (plan, settings, reports, accounts, …)
├── engine.ts             # Spending-plan computation engine
├── App.tsx               # Root: nav state, fmt(), TweaksPanel, Layout
├── hooks/
│   └── useUndoStack.ts   # Ctrl-Z undo stack for plan edits
└── components/
    ├── Layout.tsx         # Sidebar + Header
    ├── Dashboard.tsx
    ├── Budget.tsx         # Spending Plan page (Category + Flex modes)
    ├── BudgetModals.tsx   # CategoryInspector (rollover/flexibility editor)
    ├── BudgetSummaryPane.tsx
    ├── CashFlow.tsx
    ├── Accounts.tsx
    ├── AccountsModals.tsx # ReconcileModal + RulesManager + SplitModal
    ├── Import.tsx
    └── Reports.tsx
```

## Animations

```css
@keyframes fadeUp  { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; } }
@keyframes slideIn { from { transform: translateX(24px); opacity: 0; } to { transform: none; opacity: 1; } }
```

- Page transitions: `fadeUp` 0.32s
- Category Inspector drawer: `slideIn` 0.22s
