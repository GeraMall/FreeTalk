CREATE TABLE call_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id uuid NOT NULL REFERENCES call_sessions(id) ON DELETE CASCADE,
  room_id varchar(32) NOT NULL,
  inviter_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invitee_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chat_id uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  status varchar(16) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','accepted','declined','missed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 seconds',
  responded_at timestamptz,
  CHECK (inviter_id <> invitee_id)
);

CREATE UNIQUE INDEX call_invitations_pending_room_invitee_idx
  ON call_invitations(room_id, invitee_id) WHERE status='pending';
CREATE INDEX call_invitations_expiry_idx
  ON call_invitations(expires_at) WHERE status='pending';
