# Number-Dominant Typography — Design Spec

**Date:** 2026-06-12  
**Scope:** Whole app (Budget table, Dashboard, all shared components)  
**Goal:** Numbers visually dominate their labels — the Monarch Money pattern. Data is the primary visual anchor; labels are secondary scaffolding.

---

## Problem

The current app has an inverted hierarchy: category names and labels (13px) are *larger* than the numbers they describe (12.5px). This makes the UI feel text-heavy and slows down at-a-glance reading of financial figures.

## Design Principle

Every number/label pair follows this rule: **the number is larger than its label.** Labels shrink slightly; numbers grow. The gap between label size and number size creates the hierarchy.

---

## Typography Scale

### Budget Table (`Budget.tsx`)

| Element | Before | After |
|---|---|---|
| Column headers (`th`) | 10.5px | 9px |
| Header stat labels (`headerStatLabel`) | 10px | 9px |
| Header stat values (`headerStatValue`) | 16px | 21px |
| Group name (`groupCell` text) | 13px | 12px |
| Group total numbers (`groupNum`) | 12.5px / weight 600 | 16px / weight 700 |
| Category name (`catCell`, `catName`) | 13px | 12px |
| Row numbers (`numCell`) | 12.5px | 15px |
| Inline edit input (`cellInput`) | 12.5px | 14px |
| Bar percentage (`barPct`) | 11px | 10px |
| Rollover chip (`rolloverChip`) | 10.5px | 10px |
| Flex section title (`flexSectionTitle`) | 13px | 12px |
| Flex section sums (`flexSectionSums`) | 12.5px | 14px |
| Flex row name (`flexRowName`) | 13px | 12px |
| Flex accrued (`flexAccrued`) | 11px | 13px |

### Dashboard (`Dashboard.tsx`)

| Element | Before | After |
|---|---|---|
| Card label (`cardLabel`) | 11px | 9px |
| Card value hero (`cardValue`) | 28px | 30px |
| Card sub (`cardSub`) | 12px | 11px |
| Panel header title (`panelHeader`) | 13px | 12px |
| Panel meta (`panelMeta`) | 11.5px | 10px |
| Table header (`th`) | 10.5px | 9px |
| Transaction row (`td`) | 13px | 12px |
| Transaction amount (inline in `td`) | 13px | 14px |
| Category tag (`catTag`) | 11.5px | 10.5px |
| Bar label (`barLabel`) | 13px | 12px |
| Bar amount (`barAmt`) | 12px | 13px |
| Month label (`monthLabel`) | 13px | 11px |
| Month value (`monthVal`) | 13px | 14px |

---

## What Does NOT Change

- Font families: Plus Jakarta Sans (sans) and IBM Plex Mono (mono) stay as-is
- Font weights on labels and names (unchanged)
- Colors, spacing, border-radius, or any layout properties
- Dashboard hero card values were already large (28px → minor bump to 30px only)
- Any font size used for UI chrome (buttons, modals, error messages) — only data-display elements change

## Files in Scope

- `frontend/src/components/Budget.tsx` — style object at bottom of file (`st = { ... }`) plus any inline `fontSize` overrides in JSX
- `frontend/src/components/Dashboard.tsx` — style object at bottom of file (`st = { ... }`) plus any inline `fontSize` overrides in JSX

## Out of Scope

- `BudgetSummaryPane.tsx`, `BudgetModals.tsx` — not primary data-display surfaces; skip for now
- `theme.ts` — no font-size tokens defined there; no changes needed
- `index.css` — base body font-size untouched

---

## Success Criteria

1. In the budget table, row numbers are visibly larger than category names at a glance.
2. Header stat values (Planned / Spent / Left summary bar) are the dominant element in the top bar.
3. In the dashboard, transaction amounts are larger than transaction names.
4. No layout breaks — rows must not overflow their containers with the larger number sizes.
