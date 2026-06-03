CREATE TABLE IF NOT EXISTS category_targets (
    category_id  UUID PRIMARY KEY REFERENCES categories(id) ON DELETE CASCADE,
    type         VARCHAR(20)  NOT NULL CHECK (type IN ('monthly', 'refill', 'savings')),
    amount       BIGINT       NOT NULL CHECK (amount >= 0),
    deadline     DATE,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
