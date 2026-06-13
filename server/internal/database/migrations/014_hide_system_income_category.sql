-- 014_hide_system_income_category.sql
-- The old system "Income" category (renamed from "Inflow: Ready to Assign") is
-- superseded by the income group categories added in migration 013. Hide it so
-- it no longer appears as a selectable option in transaction dropdowns.
UPDATE categories
SET hidden = true
WHERE is_system = true AND name = 'Income';
