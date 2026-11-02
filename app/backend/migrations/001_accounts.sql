-- edu_study schema, version 1 (edu-replatform Phase 06a, ruling R25, 23-09-26).
--
-- ⛔ IDEMPOTENT BY CONSTRUCTION: every statement is IF NOT EXISTS, so re-running this file on a
--    database that already has it changes nothing. The runner (db.migrate) also records the
--    version in schema_migrations and skips an applied file; the IF NOT EXISTS is the second fence.
-- ⛔ No server-wide object here — no extension, no role, no setting. Everything lives in the
--    `public` schema of the edu_study database, which the edu_study role owns.

CREATE TABLE IF NOT EXISTS accounts (
    id                  BIGSERIAL PRIMARY KEY,
    username            TEXT NOT NULL UNIQUE CHECK (username ~ '^[A-Za-z0-9._-]{3,64}$'),
    display_name        TEXT NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 80),
    -- scrypt$<n>$<r>$<p>$<salt hex>$<digest hex> — CoreX's parameters (auth.py).
    password_hash       TEXT NOT NULL,
    is_owner            BOOLEAN NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    password_changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Exactly one owner, enforced by the database rather than by the code paths that create accounts.
CREATE UNIQUE INDEX IF NOT EXISTS accounts_single_owner ON accounts (is_owner) WHERE is_owner;

-- Only the SHA-256 of a session token is stored: a leaked table dump cannot be replayed as a cookie.
CREATE TABLE IF NOT EXISTS sessions (
    token_hash   TEXT PRIMARY KEY,
    account_id   BIGINT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at   TIMESTAMPTZ NOT NULL,
    purpose      TEXT NOT NULL DEFAULT 'browser' CHECK (purpose IN ('browser', 'gate'))
);
CREATE INDEX IF NOT EXISTS sessions_account ON sessions (account_id);
CREATE INDEX IF NOT EXISTS sessions_expires ON sessions (expires_at);

-- Completed blocks — the same semantics as a progress.json entry, one row per (account, book, block).
CREATE TABLE IF NOT EXISTS progress (
    account_id   BIGINT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    module_id    TEXT NOT NULL CHECK (module_id ~ '^[a-z0-9][a-z0-9-]{1,63}$'),
    block_id     TEXT NOT NULL CHECK (block_id ~ '^ch[0-9]{2}-b[0-9]{2}$'),
    completed_at TIMESTAMPTZ NOT NULL,
    score        INTEGER NOT NULL CHECK (score >= 0),
    total        INTEGER NOT NULL CHECK (total > 0),
    source       TEXT NOT NULL,
    imported     BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (account_id, module_id, block_id)
);

-- Every finished assessment's score (perfect or not). Right answers are NOT stored one by one.
CREATE TABLE IF NOT EXISTS attempts (
    id         BIGSERIAL PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    module_id  TEXT NOT NULL,
    block_id   TEXT NOT NULL,
    score      INTEGER NOT NULL,
    total      INTEGER NOT NULL,
    source     TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS attempts_account_time ON attempts (account_id, created_at DESC);

-- Wrong answers ONLY (ruling R25). Full question text + options, because AI questions are
-- ephemeral and exist nowhere else once the quiz screen is closed.
CREATE TABLE IF NOT EXISTS wrong_answers (
    id         BIGSERIAL PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    module_id  TEXT NOT NULL,
    block_id   TEXT,
    quiz_kind  TEXT NOT NULL CHECK (quiz_kind IN ('bank', 'ai', 'fresh', 'exercise')),
    question   TEXT NOT NULL,
    options    JSONB NOT NULL,
    chosen     INTEGER NOT NULL,
    correct    INTEGER NOT NULL,
    attempt    TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wrong_answers_account_module ON wrong_answers (account_id, module_id);
