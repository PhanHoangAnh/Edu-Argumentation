-- ROLLBACK of migration 006_ease_floor.sql (edu_study v6 -> v5). MANUAL ONLY — never run by a deploy.
--
-- ⚠ This file lives in migrations/rollback/ and is named *.down.sql on purpose: db.migration_files()
--   globs migrations/*.sql (not recursive) and only runs names matching NNN_name.sql.
-- ⚠ Puts back the v4/v5 check (ease >= 1.3) and with it the 21-10 bug: the 6th "again" of a card
--   answers HTTP 500 again. NOT VALID on purpose: cards already at the floor hold REAL 1.29999995,
--   which fails ">= 1.3", so a validating ADD would abort the rollback. NOT VALID keeps those rows and
--   checks only new writes (exactly the v5 behaviour).
-- Take a pg_dump first (on nn):  pg_dump -Fc edu_study > ~/foxai-snapshots/edu_study-$(date +%Y%m%d-%H%M).dump
-- Run in ONE transaction:  psql edu_study -v ON_ERROR_STOP=1 -1 -f 006_ease_floor.down.sql
ALTER TABLE review_cards DROP CONSTRAINT IF EXISTS review_cards_ease_check;
ALTER TABLE review_cards ADD CONSTRAINT review_cards_ease_check CHECK (ease >= 1.3) NOT VALID;
DELETE FROM schema_migrations WHERE version = 6;
