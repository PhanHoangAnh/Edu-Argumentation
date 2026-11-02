-- ROLLBACK of migration 005_review_more.sql (edu_study v5 -> v4). MANUAL ONLY — never run by a deploy.
--
-- ⚠ This file lives in migrations/rollback/ and is named *.down.sql on purpose: db.migration_files()
--   globs migrations/*.sql (not recursive) and only runs names matching NNN_name.sql, so the runner
--   can never pick this up as a migration.
-- ⛔ DESTRUCTIVE: drops the flags, prefs and answer history written since v5, and the stored bodies of
--   AI-written review cards. Take a pg_dump first (on nn, as the 21-10 precedent):
--     pg_dump -Fc edu_study > ~/foxai-snapshots/edu_study-$(date +%Y%m%d-%H%M).dump
--   After this, AI-written cards (question_key 'ai-...') stay in review_cards without a body; delete them
--   too if the v4 app is restored:   DELETE FROM review_cards WHERE question_key LIKE 'ai-%';
-- Run in ONE transaction:  psql edu_study -v ON_ERROR_STOP=1 -1 -f 005_review_more.down.sql
DROP TABLE IF EXISTS answer_log;
DROP TABLE IF EXISTS study_prefs;
DROP TABLE IF EXISTS question_flags;
ALTER TABLE review_cards DROP COLUMN IF EXISTS body;
DELETE FROM schema_migrations WHERE version = 5;
