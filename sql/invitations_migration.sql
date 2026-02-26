-- Rename pending_invitations to invitations and add lifecycle fields.
ALTER TABLE pending_invitations RENAME TO invitations;

ALTER TABLE invitations
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS activated_at timestamptz,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz;

CREATE INDEX IF NOT EXISTS invitations_user_status_idx ON invitations (user_id, status);
CREATE INDEX IF NOT EXISTS invitations_expires_idx ON invitations (expires_at);
