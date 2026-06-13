-- 013_income_categories.sql
ALTER TABLE category_groups ADD COLUMN IF NOT EXISTS is_income BOOLEAN NOT NULL DEFAULT false;

-- Seed the Income group (sort_order -1 puts it above all expense groups)
INSERT INTO category_groups (name, sort_order, is_income)
VALUES ('Income', -1, true)
ON CONFLICT (name) DO UPDATE SET is_income = true, sort_order = -1;

-- Seed default income categories
INSERT INTO categories (group_id, name, sort_order)
SELECT id, 'Paychecks', 0 FROM category_groups WHERE name = 'Income'
ON CONFLICT (group_id, name) DO NOTHING;

INSERT INTO categories (group_id, name, sort_order)
SELECT id, 'Interest', 1 FROM category_groups WHERE name = 'Income'
ON CONFLICT (group_id, name) DO NOTHING;

INSERT INTO categories (group_id, name, sort_order)
SELECT id, 'Other Income', 2 FROM category_groups WHERE name = 'Income'
ON CONFLICT (group_id, name) DO NOTHING;
