CREATE TABLE IF NOT EXISTS category_groups (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(255) NOT NULL UNIQUE,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    hidden      BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS categories (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id    UUID NOT NULL REFERENCES category_groups(id) ON DELETE CASCADE,
    name        VARCHAR(255) NOT NULL,
    hidden      BOOLEAN NOT NULL DEFAULT false,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (group_id, name)
);

CREATE TABLE IF NOT EXISTS accounts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(255) NOT NULL,
    type        VARCHAR(50)  NOT NULL CHECK (type IN ('checking','savings','credit_card','cash','other')),
    currency    VARCHAR(3)   NOT NULL DEFAULT 'CRC',
    balance     BIGINT       NOT NULL DEFAULT 0,
    on_budget   BOOLEAN      NOT NULL DEFAULT true,
    closed      BOOLEAN      NOT NULL DEFAULT false,
    note        TEXT,
    sort_order  INTEGER      NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS imports (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id        UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    filename          VARCHAR(500) NOT NULL,
    imported_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    transaction_count INTEGER      NOT NULL,
    status            VARCHAR(50)  NOT NULL DEFAULT 'completed'
);

CREATE TABLE IF NOT EXISTS transactions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id    UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    category_id   UUID REFERENCES categories(id) ON DELETE SET NULL,
    date          DATE NOT NULL,
    amount        BIGINT NOT NULL,
    currency      VARCHAR(3) NOT NULL DEFAULT 'CRC',
    payee         VARCHAR(500),
    memo          TEXT,
    check_number  VARCHAR(50),
    exchange_rate NUMERIC(12,4),
    cleared       BOOLEAN NOT NULL DEFAULT false,
    import_id     UUID REFERENCES imports(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_account_date ON transactions (account_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_category     ON transactions (category_id);
CREATE INDEX IF NOT EXISTS idx_transactions_payee        ON transactions (payee);
CREATE INDEX IF NOT EXISTS idx_transactions_import       ON transactions (import_id);

CREATE TABLE IF NOT EXISTS payee_rules (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payee_pattern  VARCHAR(500) NOT NULL UNIQUE,
    category_id    UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    match_count    INTEGER NOT NULL DEFAULT 1,
    last_used_at   TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS exchange_rates (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date        DATE NOT NULL UNIQUE,
    usd_to_crc  NUMERIC(12,4) NOT NULL,
    source      VARCHAR(100)  NOT NULL,
    created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS budgets (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id  UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    month        DATE NOT NULL,
    assigned     BIGINT NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (category_id, month)
);
