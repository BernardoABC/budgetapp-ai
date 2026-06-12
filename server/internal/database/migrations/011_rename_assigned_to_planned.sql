-- 011_rename_assigned_to_planned.sql — align the budgets column with the
-- spending-plan naming used by the API and UI ("planned", not "assigned").

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'budgets' AND column_name = 'assigned'
  ) THEN
    ALTER TABLE budgets RENAME COLUMN assigned TO planned;
  END IF;
END;
$$;
