-- edu_study schema, version 6 (22-10-26): ease floor fix (plan exam-recall-suite_22-10-26, found in P1).
--
-- The bug (live since 21-10, version 4): review_cards.ease is REAL with CHECK (ease >= 1.3), and
-- store.srs_next floors ease at exactly 1.3. Stored as REAL that value is 1.29999995; PostgreSQL compares
-- REAL with the numeric literal 1.3 as double precision, so 1.29999995 >= 1.3 is FALSE ->
-- CheckViolation "review_cards_ease_check" -> HTTP 500 on a card's 6th "again" (2.5 - 5 x 0.2 = 1.5,
-- then 1.3). The card is never rescheduled and the Leech tag (lapses >= 6) cannot be reached.
--
-- The fix: the same check, with room for float rounding: ease >= 1.29. The code keeps flooring at 1.3,
-- so the real floor does not change; only the REAL rounding of 1.3 now passes.
-- The constraint name is PostgreSQL's default for 004's column check (seen in the P1 error message).
--
-- ⛔ Idempotent: DROP CONSTRAINT IF EXISTS, then ADD; a manual second run ends in the same state. The
--    runner also records version 6 and never re-runs it.
-- ⛔ No data change: every row valid under ">= 1.3" is valid under ">= 1.29", so the ADD (which checks
--    existing rows) cannot fail. One table of the edu_study database; no server-wide object.
--    admin.py migrate takes a pg_dump first. Rollback: migrations/rollback/006_ease_floor.down.sql.
-- ⚠ Renumbering: the plan's exam_runs migration (P3) becomes 007_exam_runs.sql.
ALTER TABLE review_cards DROP CONSTRAINT IF EXISTS review_cards_ease_check;
ALTER TABLE review_cards ADD CONSTRAINT review_cards_ease_check CHECK (ease >= 1.29);
