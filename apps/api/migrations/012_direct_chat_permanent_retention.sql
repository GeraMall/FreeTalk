-- Direct messages are permanent. Groups keep their configurable retention policy.
UPDATE messages message
SET expires_at = NULL
FROM chats chat
WHERE message.chat_id = chat.id
  AND chat.type = 'direct'
  AND (message.expires_at IS NULL OR message.expires_at > now());

UPDATE chats
SET retention_hours = NULL
WHERE type = 'direct';
