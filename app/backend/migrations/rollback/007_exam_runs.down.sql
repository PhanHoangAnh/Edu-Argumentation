-- ROLLBACK of migration 007_exam_runs.sql (edu_study v7 -> v6). MANUAL ONLY — never run by a deploy.
--
-- ⚠ This file lives in migrations/rollback/ and is named *.down.sql on purpose: db.migration_files()
--   globs migrations/*.sql (not recursive) and only runs names matching NNN_name.sql, so the runner
--   can never pick this up as a migration.
-- ⛔ DESTRUCTIVE: drops every exam run (open and finished) and its stored result. Exam answers already
--   copied to answer_log (run_kind 'exam') stay — they are ordinary v5 rows. Take a pg_dump first:
--     pg_dump -Fc edu_study > ~/foxai-snapshots/edu_study-$(date +%Y%m%d-%H%M).dump
-- Run in ONE transaction:  psql edu_study -v ON_ERROR_STOP=1 -1 -f 007_exam_runs.down.sql
DROP TABLE IF EXISTS exam_runs;
DELETE FROM schema_migrations WHERE version = 7;
