-- edu_study schema, version 4 (21-10-26): spaced repetition (review cards).
--
-- One row per account x module x quiz question key (source.question, e.g. ch03-b05-q2): how well the
-- learner knows it and when it is next due. SM-2-lite fields: ease (>= 1.3), interval in days, reps in a
-- row, lapses, due_at. The question TEXT is not stored: the book's own quizData is the source of truth,
-- the key points into it.
--
-- ⛔ Idempotent: CREATE TABLE / INDEX IF NOT EXISTS; the runner also records version 4 and never re-runs it.
-- ⛔ Additive only — a NEW table; no existing table or row changes; no server-wide object (one table of
--    the edu_study database). admin.py migrate takes a pg_dump first.
CREATE TABLE IF NOT EXISTS review_cards (
    account_id       BIGINT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    module_id        TEXT NOT NULL,
    question_key     TEXT NOT NULL CHECK (char_length(question_key) BETWEEN 3 AND 64),
    ease             REAL NOT NULL DEFAULT 2.5 CHECK (ease >= 1.3),
    interval_days    REAL NOT NULL DEFAULT 0 CHECK (interval_days >= 0),
    reps             INTEGER NOT NULL DEFAULT 0 CHECK (reps >= 0),
    lapses           INTEGER NOT NULL DEFAULT 0 CHECK (lapses >= 0),
    due_at           TIMESTAMPTZ NOT NULL,
    last_reviewed_at TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (account_id, module_id, question_key)
);
CREATE INDEX IF NOT EXISTS review_cards_due ON review_cards (account_id, module_id, due_at);
