-- edu_study schema, version 5 (22-10-26): exam + recall suite, phase 1 (plan exam-recall-suite_22-10-26).
--
-- 1. review_cards.body      the question itself (question, options, correct, explanations) for an
--                           AI-written question, which exists nowhere else once the quiz screen closes.
--                           NULL for a book question (the book's quizData stays the source of truth).
-- 2. question_flags         a learner's flagged questions, one row per account x module x question key.
--                           Flag on = upsert, flag off = delete -> a retried call changes nothing.
-- 3. study_prefs            per account x module: new cards per day (0-200, default 20) and the run
--                           size (10-50 in steps of 5, default 20).
-- 4. answer_log             every answered question, append-only. The client sends one uuid per answer
--                           (client_id), UNIQUE per account -> a retried POST is logged once.
--
-- ⛔ Idempotent: ADD COLUMN / CREATE TABLE / CREATE INDEX all IF NOT EXISTS; the runner also records
--    version 5 and never re-runs it.
-- ⛔ Additive only — one nullable column on review_cards and three NEW tables; no existing row or
--    column changes; no server-wide object (tables of the edu_study database only).
--    admin.py migrate takes a pg_dump first. Rollback: migrations/rollback/005_review_more.down.sql.
ALTER TABLE review_cards ADD COLUMN IF NOT EXISTS body JSONB;

CREATE TABLE IF NOT EXISTS question_flags (
    account_id   BIGINT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    module_id    TEXT NOT NULL,
    question_key TEXT NOT NULL CHECK (char_length(question_key) BETWEEN 3 AND 64),
    body         JSONB,
    flagged_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (account_id, module_id, question_key)
);

CREATE TABLE IF NOT EXISTS study_prefs (
    account_id   BIGINT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    module_id    TEXT NOT NULL,
    new_per_day  INTEGER NOT NULL DEFAULT 20 CHECK (new_per_day BETWEEN 0 AND 200),
    session_size INTEGER NOT NULL DEFAULT 20 CHECK (session_size BETWEEN 10 AND 50 AND session_size % 5 = 0),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (account_id, module_id)
);

CREATE TABLE IF NOT EXISTS answer_log (
    id           BIGSERIAL PRIMARY KEY,
    account_id   BIGINT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    module_id    TEXT NOT NULL,
    question_key TEXT NOT NULL CHECK (char_length(question_key) BETWEEN 3 AND 64),
    chapter      INTEGER CHECK (chapter BETWEEN 0 AND 999),
    domain       TEXT CHECK (char_length(domain) <= 64),
    run_kind     TEXT NOT NULL CHECK (run_kind IN ('quiz', 'practice', 'review', 'exam', 'retry')),
    run_id       TEXT CHECK (char_length(run_id) <= 64),
    correct      BOOLEAN NOT NULL,
    confidence   TEXT CHECK (confidence IN ('sure', 'unsure', 'guess')),
    chosen       JSONB,
    client_id    UUID NOT NULL,
    answered_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (account_id, client_id)
);
CREATE INDEX IF NOT EXISTS answer_log_recent ON answer_log (account_id, module_id, answered_at);
