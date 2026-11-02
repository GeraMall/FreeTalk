// Run only against a disposable PostgreSQL database, never the production DB.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
const directory = resolve(process.argv[2] || '.');
const databaseName = new URL(process.env.DATABASE_URL).pathname.slice(1);
assert.match(databaseName, /^trlka_service_test_[a-f0-9]+$/);
Object.assign(process.env, {
  NODE_ENV: 'test',
  TOKEN_PEPPER: 'test-only-pepper-'.repeat(4),
  INTERNAL_SIGNALING_SECRET: 'test-only-secret-'.repeat(4),
  TURNSTILE_SECRET_KEY: 'test-only',
  IP_HASH_SALT: 'test-only-salt-'.repeat(2),
  SUPPORT_EMAIL: 'qa@example.invalid',
  EMAIL_DELIVERY_MODE: 'log',
});
const load = (name) => import(pathToFileURL(resolve(directory, 'dist', name)).href);
const { db } = await load('db.js');
assert.equal((await db.query('SELECT current_database() name')).rows[0].name, databaseName);
await db.query(`CREATE TABLE users(id uuid PRIMARY KEY,username text NOT NULL,deleted_at timestamptz);
CREATE TABLE call_sessions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),room_id text NOT NULL);
CREATE TABLE call_participants(call_id uuid,user_id uuid,anonymous_user_id uuid,joined_at timestamptz,left_at timestamptz);`);
await db.query(await readFile(resolve(directory, 'migrations/022_service_chat.sql'), 'utf8'));
const { registerServiceChat, startSupportDelivery } = await load('service-chat.js');
const Fastify = (
  await import(pathToFileURL(resolve(directory, 'node_modules/fastify/fastify.js')).href)
).default;
const a = '11111111-1111-4111-8111-111111111111',
  b = '22222222-2222-4222-8222-222222222222';
await db.query('INSERT INTO users VALUES($1,$2,NULL),($3,$4,NULL)', [a, 'alpha', b, 'beta']);
const app = Fastify();
registerServiceChat(app, async (req, reply) => {
  if (req.headers['x-actor'] === 'none') {
    reply.code(401).send();
    return null;
  }
  const id = req.headers['x-actor'] === 'b' ? b : a;
  return { id, username: id === a ? 'alpha' : 'beta' };
});
const send = (actor, body, id = randomUUID()) =>
  app.inject({
    method: 'POST',
    url: '/v1/service-chat/messages',
    headers: { 'x-actor': actor },
    payload: { requestId: id, body, version: 'integration-test' },
  });
const history = async (actor) =>
  (await app.inject({ url: '/v1/service-chat/messages', headers: { 'x-actor': actor } })).json()
    .messages;
const delivered = [];
let mailFails = false;
const drain = startSupportDelivery(app, async (report) => {
  if (mailFails) throw Error('Synthetic SMTP failure');
  delivered.push(report);
});
const passed = [];
try {
  assert.equal(
    (await app.inject({ url: '/v1/service-chat/messages', headers: { 'x-actor': 'none' } }))
      .statusCode,
    401,
  );
  await history('a');
  await history('b');
  assert.equal((await send('a', '/bug')).statusCode, 200);
  const firstId = randomUUID();
  assert.equal(
    (await send('a', 'Камера не включается после входа в комнату', firstId)).statusCode,
    200,
  );
  const own = await history('a'),
    other = await history('b');
  assert(own.some((m) => m.body.includes('Обращение №')));
  assert(!other.some((m) => m.body.includes('Камера')));
  const userMessage = own.findIndex((m) => m.body === 'Камера не включается после входа в комнату');
  assert(userMessage >= 0 && own[userMessage + 1].kind === 'accepted');
  passed.push('private history and chronological report confirmation');

  const concurrent = await Promise.all(
    Array.from({ length: 8 }, () => send('a', '/idea Предложение для улучшения приложения')),
  );
  assert.equal(concurrent.filter((r) => r.statusCode === 200).length, 1);
  assert.equal(concurrent.filter((r) => r.statusCode === 429).length, 7);
  for (let i = 0; i < 3; i++)
    assert.equal((await send('a', '/bug Отдельное сообщение об ошибке')).statusCode, 200);
  assert.equal(
    (await db.query('SELECT count(*)::int n FROM support_reports WHERE user_id=$1', [a])).rows[0].n,
    5,
  );
  assert.equal((await send('a', '/bug Шестое обращение сверх лимита')).statusCode, 429);
  passed.push('concurrent daily report quota and single idea per 24 hours');
  assert.equal(
    (await send('a', 'Камера не включается после входа в комнату', firstId)).statusCode,
    200,
  );
  assert.equal(
    (await db.query('SELECT count(*)::int n FROM support_reports WHERE id=$1', [firstId])).rows[0]
      .n,
    1,
  );
  passed.push('idempotent report retry');

  await db.query(
    `INSERT INTO support_reports(id,user_id,kind,body) SELECT gen_random_uuid(),$1,'bug','Synthetic quota fixture' FROM generate_series(1,95)`,
    [b],
  );
  assert.equal((await send('b', '/bug Проверка глобального лимита сообщений')).statusCode, 429);
  await db.query('DELETE FROM support_reports WHERE user_id=$1', [b]);
  assert.equal((await send('b', '/idea Ещё одно полезное предложение')).statusCode, 200);
  passed.push('global hourly quota');

  for (let i = 0; i < 8; i++) await drain();
  assert.equal(delivered.length, 6);
  assert.equal(
    (await db.query("SELECT count(*)::int n FROM support_reports WHERE status='delivered'")).rows[0]
      .n,
    6,
  );
  passed.push('durable queue delivery');
  await db.query(
    "UPDATE support_reports SET created_at=now()-interval '2 days',delivered_at=now()-interval '2 minutes'",
  );
  const retryId = randomUUID();
  await send('a', '/bug Повторная доставка после сбоя сервера', retryId);
  mailFails = true;
  await drain();
  let retry = (await db.query('SELECT status,attempts FROM support_reports WHERE id=$1', [retryId]))
    .rows[0];
  assert.deepEqual(retry, { status: 'pending', attempts: 1 });
  await db.query('UPDATE support_reports SET next_attempt_at=now() WHERE id=$1', [retryId]);
  mailFails = false;
  await drain();
  retry = (await db.query('SELECT status,attempts FROM support_reports WHERE id=$1', [retryId]))
    .rows[0];
  assert.deepEqual(retry, { status: 'delivered', attempts: 2 });
  passed.push('retry after SMTP failure');

  const sharedId = randomUUID(),
    soloId = randomUUID();
  await db.query('INSERT INTO call_sessions(id,room_id) VALUES($1,$2),($3,$4)', [
    soloId,
    'ABCDEFGHJKLM',
    sharedId,
    'BCDEFGHJKLMN',
  ]);
  await db.query(
    `INSERT INTO call_participants VALUES($1,$2,NULL,now()-interval '6 minutes',NULL),($3,$2,NULL,now()-interval '6 minutes',NULL),($3,$4,NULL,now()-interval '6 minutes',now())`,
    [soloId, a, sharedId, b],
  );
  const timeout = (actor, userId, roomId, eventId = randomUUID()) =>
    app.inject({
      method: 'POST',
      url: '/v1/service-chat/call-timeout',
      headers: { 'x-actor': actor },
      payload: { userId, roomId, eventId },
    });
  const eventId = randomUUID();
  assert.equal((await timeout('a', a, 'ABCDEFGHJKLM', eventId)).statusCode, 200);
  assert.equal((await timeout('a', a, 'ABCDEFGHJKLM', eventId)).statusCode, 200);
  assert.equal((await history('a')).filter((m) => m.kind === 'call-timeout').length, 1);
  assert.equal((await timeout('b', b, 'ABCDEFGHJKLM')).statusCode, 404);
  assert.equal((await timeout('b', a, 'ABCDEFGHJKLM')).statusCode, 403);
  assert.equal((await timeout('a', a, 'BCDEFGHJKLMN')).statusCode, 404);
  passed.push('timeout ownership, deduplication, and established-call protection');

  await db.query("UPDATE support_reports SET created_at=now()-interval '2 days'");
  const duplicateId = randomUUID();
  const duplicate = await Promise.all(
    Array.from({ length: 8 }, () =>
      send('a', '/bug Одно обращение при восьми повторах сети', duplicateId),
    ),
  );
  assert(duplicate.every((r) => r.statusCode === 200));
  assert.equal(
    (await db.query('SELECT count(*)::int n FROM support_reports WHERE id=$1', [duplicateId]))
      .rows[0].n,
    1,
  );
  await db.query('DELETE FROM service_chat_messages WHERE event_key=$1', [`input:${duplicateId}`]);
  assert.equal(
    (await send('a', '/bug Одно обращение при восьми повторах сети', duplicateId)).statusCode,
    200,
  );
  passed.push('concurrent retries and idempotence after history trimming');
  const before = (await db.query('SELECT count(*)::int n FROM support_reports')).rows[0].n;
  await send('a', '/subscription');
  await send('a', '/cancel');
  assert.equal((await db.query('SELECT count(*)::int n FROM support_reports')).rows[0].n, before);
  passed.push('subscription information without mail or payments');
  await db.query(
    "UPDATE support_reports SET created_at=now()-interval '25 hours' WHERE user_id=$1",
    [a],
  );
  assert.equal((await send('a', '/idea Новое предложение спустя 24 часа')).statusCode, 200);
  assert.equal((await send('a', '/idea Повторное предложение сразу после нового')).statusCode, 429);
  const searched = await app.inject({
    url: '/v1/service-chat/messages?search=камера',
    headers: { 'x-actor': 'a' },
  });
  assert(searched.json().messages.length > 0);
  assert(searched.json().messages.every((m) => m.body.toLowerCase().includes('камера')));
  passed.push('rolling idea quota reset and private substring search');
  console.log(JSON.stringify({ passed, emailsActuallySent: 0 }));
  if (process.argv.includes('--serve')) {
    await app.listen({ host: '127.0.0.1', port: 8794 });
    console.log('SERVICE_CHAT_TEST_READY');
  } else {
    await app.close();
    await db.end();
  }
} catch (error) {
  console.error(error);
  await app.close();
  await db.end();
  process.exitCode = 1;
}
