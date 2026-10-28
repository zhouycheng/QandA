-- Run explicitly against an existing 1.0.0 database after taking a backup.
BEGIN;
ALTER TABLE practice_session ADD COLUMN IF NOT EXISTS configuration_snapshot text;
ALTER TABLE practice_session ADD COLUMN IF NOT EXISTS writer_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE practice_session ADD COLUMN IF NOT EXISTS writer_device_id uuid;
ALTER TABLE practice_session ADD COLUMN IF NOT EXISTS writer_token uuid;
ALTER TABLE practice_session ADD COLUMN IF NOT EXISTS pending_writer_device_id uuid;
ALTER TABLE practice_session ADD COLUMN IF NOT EXISTS acknowledged_sequence bigint NOT NULL DEFAULT 0 CHECK(acknowledged_sequence>=0);
DROP INDEX IF EXISTS practice_active_bank_unique;
CREATE INDEX IF NOT EXISTS practice_active_bank_idx ON practice_session(user_id,bank_id) WHERE status='IN_PROGRESS';
COMMIT;
