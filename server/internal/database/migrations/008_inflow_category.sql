-- 008_inflow_category.sql

-- 1. Add is_system to category_groups
ALTER TABLE category_groups
    ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT false;

-- 2. Add is_system to categories
ALTER TABLE categories
    ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT false;

-- 3. Seed the Inflows system group + Inflow: Ready to Assign category,
--    then migrate all uncategorized positive transactions to it.
DO $$
DECLARE
    grp_id UUID;
    cat_id UUID;
BEGIN
    -- Insert system group (idempotent)
    INSERT INTO category_groups (name, sort_order, is_system)
    VALUES ('Inflows', 0, true)
    ON CONFLICT (name) DO UPDATE SET is_system = true
    RETURNING id INTO grp_id;

    -- Insert system category (idempotent)
    INSERT INTO categories (group_id, name, sort_order, is_system)
    VALUES (grp_id, 'Inflow: Ready to Assign', 0, true)
    ON CONFLICT (group_id, name) DO UPDATE SET is_system = true
    RETURNING id INTO cat_id;

    -- Migrate existing uncategorized inflows
    UPDATE transactions
    SET category_id = cat_id
    WHERE amount > 0 AND category_id IS NULL;
END;
$$;
