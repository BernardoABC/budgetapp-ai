-- 012_budget_currency.sql — record the currency each planned amount was entered in.

ALTER TABLE budgets
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'CRC';
