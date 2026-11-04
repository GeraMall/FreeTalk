ALTER TABLE message_reactions DROP CONSTRAINT message_reactions_pkey;
ALTER TABLE message_reactions ADD PRIMARY KEY (message_id, user_id, emoji);
