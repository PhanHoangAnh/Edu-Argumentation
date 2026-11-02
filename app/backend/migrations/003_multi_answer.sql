-- edu_study schema, version 3 (21-10-26): choose-N (multi-answer) quiz questions.
--
-- A wrong answer to a choose-N question keeps its two INTEGER columns filled (the first position the
-- learner picked / the first right position) so every existing reader of wrong_answers is unchanged,
-- and adds the full sets as nullable JSONB lists (sorted option positions). Single-answer rows leave
-- both NULL.
--
-- ⛔ Idempotent: ADD COLUMN IF NOT EXISTS; the runner also records version 3 and never re-runs it.
-- ⛔ Additive only — no existing row or column changes, progress/attempts/accounts are untouched, no
--    server-wide object (one table of the edu_study database). admin.py migrate takes a pg_dump first.
ALTER TABLE wrong_answers ADD COLUMN IF NOT EXISTS chosen_set  JSONB;
ALTER TABLE wrong_answers ADD COLUMN IF NOT EXISTS correct_set JSONB;
