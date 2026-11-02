-- edu_study schema, version 7 (22-10-26): exam + recall suite, phase 3 — timed mock exam
-- (plan exam-recall-suite_22-10-26 §5; numbered 007 because 006 is the ease-floor fix).
--
-- exam_runs   one timed exam run per row. The SERVER is the clock: deadline_at is set at start and
--             answers at/after it are refused (409). question_keys = the chosen book question keys in
--             order; grading = what grading needs per key (chapter, area, correct, option count),
--             snapshotted at start so a re-imported book cannot change a running exam; blueprint =
--             the run's settings (mode, minutes, areas, scale); result = the graded outcome.
-- exam_runs_one_open   at most ONE open run (finished_at IS NULL) per account x book -> a second
--             "Start" resumes the open run instead of creating another.
--
-- ⛔ Idempotent: CREATE TABLE / CREATE INDEX IF NOT EXISTS; the runner also records version 7.
-- ⛔ Additive only — one NEW table; no existing row or column changes; tables of edu_study only.
--    admin.py migrate takes a pg_dump first. Rollback: migrations/rollback/007_exam_runs.down.sql.
CREATE TABLE IF NOT EXISTS exam_runs (
    id              TEXT PRIMARY KEY CHECK (char_length(id) BETWEEN 8 AND 64),
    account_id      BIGINT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    module_id       TEXT NOT NULL,
    started_at      TIMESTAMPTZ NOT NULL,
    deadline_at     TIMESTAMPTZ NOT NULL CHECK (deadline_at > started_at),
    question_keys   JSONB NOT NULL,
    grading         JSONB NOT NULL,
    answers         JSONB NOT NULL DEFAULT '{}'::jsonb,
    flags           JSONB NOT NULL DEFAULT '[]'::jsonb,
    blueprint       JSONB NOT NULL,
    finished_at     TIMESTAMPTZ,
    finished_by     TEXT CHECK (finished_by IN ('submit', 'deadline', 'restart')),
    raw_right       INTEGER CHECK (raw_right >= 0),
    total           INTEGER CHECK (total >= 0),
    scaled_estimate INTEGER,
    result          JSONB,
    CHECK ((finished_at IS NULL) = (finished_by IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS exam_runs_one_open ON exam_runs (account_id, module_id) WHERE finished_at IS NULL;
CREATE INDEX IF NOT EXISTS exam_runs_recent ON exam_runs (account_id, module_id, started_at);
