-- 010_spending_plan.sql — transform to spending-plan model.

ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS rollover    BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS flexibility VARCHAR(20) NOT NULL DEFAULT 'flexible'
    CHECK (flexibility IN ('fixed','flexible','non_monthly'));

CREATE TABLE IF NOT EXISTS monthly_plans (
  month           DATE PRIMARY KEY,           -- always first of month
  expected_income BIGINT NOT NULL DEFAULT 0,  -- CRC centimos
  flex_budget     BIGINT NOT NULL DEFAULT 0,  -- CRC centimos
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DELETE FROM budgets;                   -- clean slate (user-approved data wipe)
DROP TABLE IF EXISTS category_targets;

UPDATE categories SET name = 'Income'
WHERE is_system = true AND name = 'Inflow: Ready to Assign';
