# Assign Input Calculator

**Date:** 2026-06-11

## Overview

Add inline calculator support to the `BudgetCell` assign input so users can type math expressions (`10+5`, `100/4`, `50*2-10`) and have them evaluated to a number on Enter or blur — matching YNAB behavior.

## Scope

Single change to the `commit` function inside `BudgetCell` in `frontend/src/components/Budget.tsx`. No new components, no API changes.

## Approach

Sanitize input to `[0-9+\-*/.() ]`, then evaluate via `new Function('return ' + sanitized)()`. If the result is a finite number, use it. Otherwise fall back to `parseFloat` on the stripped string. If both fail, discard (no save).

## Behavior

- **Trigger:** Enter key or blur (clicking/tabbing away)
- **Supported operators:** `+`, `-`, `*`, `/`
- **Operator precedence:** Respected (standard JS evaluation — `2+3*4` = 14)
- **Parentheses:** Supported (`(100-20)/4` = 20)
- **Chained ops:** Supported (`10+5+3` = 18)
- **Plain number:** Works as before (`150` → 150)
- **Invalid input:** Silently discards — no save, cell reverts to previous value
- **Division by zero:** Discards (Infinity is not finite)
- **Empty input:** Discards

## Edge Cases Not Handled

- Percentage shortcuts (`50%` of available) — out of scope
- Currency symbol stripping beyond current behavior — out of scope

## Files Changed

- `frontend/src/components/Budget.tsx` — `commit` function in `BudgetCell` (~line 55)
