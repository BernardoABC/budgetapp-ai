-- 009_category_currency.sql

-- Add currency column to categories table with default value 'CRC'
ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS currency VARCHAR(3) NOT NULL DEFAULT 'CRC';
