import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { requireApi, requireLab, maxUsers } from './common.mjs';

requireLab();
const { Client } = requireApi('pg');
const db = new Client({ connectionString: process.env.DATABASE_URL });
const hash = (value) =>
  createHash('sha256').update(process.env.TOKEN_PEPPER).update('\0').update(value).digest('hex');
const users = Array.from({ length: maxUsers }, (_, index) => {
  const token = randomBytes(32).toString('base64url');
  return {
    id: randomUUID(),
    index,
    token,
    hash: hash(token),
    refreshHash: hash(randomBytes(48).toString('hex')),
  };
});
const chats = Array.from({ length: maxUsers / 10 }, (_, index) => ({
  id: randomUUID(),
  owner: users[index * 10].id,
}));
for (const user of users) user.chatId = chats[Math.floor(user.index / 10)].id;
await db.connect();
try {
  if (
    (await db.query("SELECT count(*)::int n FROM users WHERE username::text LIKE 'capacity_%'"))
      .rows[0].n
  )
    throw Error('Test fixture already exists');
  await db.query('BEGIN');
  for (let offset = 0; offset < users.length; offset += 500) {
    const batch = JSON.stringify(users.slice(offset, offset + 500));
    await db.query(
      `INSERT INTO users(id,email,username,display_name,password_hash,email_verified_at,birth_date)
      SELECT (u->>'id')::uuid,'capacity_'||(u->>'index')||'@example.invalid',
        'capacity_'||(u->>'index'),'Capacity '||(u->>'index'),'disabled-test-password',now(),'1990-01-01'::date
      FROM jsonb_array_elements($1::jsonb) u`,
      [batch],
    );
    await db.query(
      `INSERT INTO sessions(user_id,access_token_hash,refresh_token_hash,access_expires_at,refresh_expires_at)
      SELECT (u->>'id')::uuid,decode(u->>'hash','hex'),decode(u->>'refreshHash','hex'),now()+interval '2 hours',now()+interval '1 day'
      FROM jsonb_array_elements($1::jsonb) u`,
      [batch],
    );
  }
  await db.query(
    `INSERT INTO chats(id,type,title,created_by)
    SELECT (c->>'id')::uuid,'group','Capacity group',(c->>'owner')::uuid
    FROM jsonb_array_elements($1::jsonb) c`,
    [JSON.stringify(chats)],
  );
  await db.query(
    `INSERT INTO chat_members(chat_id,user_id,role)
    SELECT (u->>'chatId')::uuid,(u->>'id')::uuid,CASE WHEN (u->>'index')::int % 10=0 THEN 'owner' ELSE 'member' END
    FROM jsonb_array_elements($1::jsonb) u`,
    [JSON.stringify(users)],
  );
  await db.query(
    `INSERT INTO messages(chat_id,sender_id,body,created_at)
    SELECT (c->>'id')::uuid,(c->>'owner')::uuid,'Synthetic history '||n,now()-n*interval '1 minute'
    FROM jsonb_array_elements($1::jsonb) c CROSS JOIN generate_series(1,20) n`,
    [JSON.stringify(chats)],
  );
  await db.query('COMMIT');
  await db.query('ANALYZE');
  await writeFile(
    `${process.env.CAPACITY_STATE}/clients.json`,
    JSON.stringify(users.map(({ id, index, token, chatId }) => ({ id, index, token, chatId }))),
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      seededUsers: users.length,
      groups: chats.length,
      historyMessages: chats.length * 20,
    }),
  );
} finally {
  await db.end();
}
