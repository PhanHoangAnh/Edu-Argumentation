-- edu_study schema, version 2 (23-09-26): per-account Claude access (user ruling, 23-09-26).
--
-- claude_access decides which 9router combos an account's AI calls use (settings.model_for):
--   on  -> edu-tutor-claude (tutor) / edu-arg-claude (quiz, fresh quiz, grading)
--   off -> edu-tutor-normal         / edu-arg-normal
-- OFF by default, so every account created later starts on the normal combos. The owner toggles
-- it on the Account page (owner-only Accounts section) or with
--   python -m admin set-claude-access --username X --on|--off
--
-- ⛔ Idempotent: ADD COLUMN IF NOT EXISTS; the runner also records version 2 and never re-runs it,
--    so the seed below happens exactly once and a later owner toggle is never overwritten.
-- ⛔ No server-wide object — one column on one table of the edu_study database.

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS claude_access BOOLEAN NOT NULL DEFAULT FALSE;

-- The three accounts the user named, 23-09-26. A username absent from this database (e.g. the
-- isolated gate database) matches nothing and changes nothing.
UPDATE accounts SET claude_access = TRUE WHERE lower(username) IN ('ha1dtd', 'chipl', 'hoangf');
