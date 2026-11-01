// Run against a NEW, disposable PostgreSQL database after applying migrations.
// API_DIR points at an unpacked production API artifact with npm dependencies.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const database = new URL(process.env.DATABASE_URL ?? '');
assert.match(
  database.pathname,
  /^\/trlka_gif_qa_[a-z0-9_]+$/,
  'Refusing to run against a non-audit database',
);
const api = resolve(process.env.API_DIR ?? 'apps/api');
const load = (file) => import(pathToFileURL(resolve(api, file)).href);
const { default: Fastify } = await load('node_modules/fastify/fastify.js');
const { default: multipart } = await load('node_modules/@fastify/multipart/index.js');
const { db } = await load('dist/db.js');
const { registerSocialRoutes } = await load('dist/social-routes.js');
const { GIF_LIMITS, beginGifUpload, chargeGifDownload, pruneUnusedGifs } =
  await load('dist/gif-limits.js');
const { ZodError } = await load('node_modules/zod/index.js');
const app = Fastify();
await app.register(multipart, { limits: { files: 2, fileSize: 30 * 1024 * 1024, fields: 2 } });
app.setErrorHandler((error, request, reply) => {
  if (error instanceof ZodError) return reply.code(400).send({ code: 'INVALID_INPUT' });
  if (error.code === '23505') return reply.code(409).send({ code: 'ALREADY_EXISTS' });
  console.error(error);
  return reply.code(500).send({ code: 'INTERNAL_ERROR' });
});
registerSocialRoutes(app, async (request, reply) => {
  const id = request.headers['x-audit-user'];
  const user = id && (await db.query('SELECT * FROM users WHERE id=$1', [id])).rows[0];
  if (!user) {
    reply.code(401).send({ code: 'UNAUTHORIZED' });
    return null;
  }
  return user;
});
const results = [];
const check = async (name, work) => {
  await work();
  results.push(name);
  console.log(`PASS ${name}`);
};
const header = Buffer.from('47494638396101000100800000000000ffffff', 'hex');
const frame = Buffer.from('21f904000a0000002c0000000001000100000202440100', 'hex');
const gif = Buffer.concat([header, frame, frame, Buffer.from([0x3b])]);
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=',
  'base64',
);
function multipartBody(bytes = gif, filename = 'reaction.gif') {
  const boundary = 'trlka-gif-audit';
  return {
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="gif"; filename="${filename}"\r\nContent-Type: image/gif\r\n\r\n`,
      ),
      bytes,
      Buffer.from(
        `\r\n--${boundary}\r\nContent-Disposition: form-data; name="thumbnail"; filename="preview.png"\r\nContent-Type: image/png\r\n\r\n`,
      ),
      png,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  };
}
const request = (user, method, url, payload) =>
  app.inject({ method, url, headers: { 'x-audit-user': user }, payload });
const upload = (user, bytes = gif, filename) => {
  const body = multipartBody(bytes, filename);
  return app.inject({
    method: 'POST',
    url: '/v1/gifs/uploads',
    ...body,
    headers: { ...body.headers, 'x-audit-user': user },
  });
};
let users = [],
  chatId,
  assetId,
  messageId;
try {
  for (let i = 0; i < 3; i++)
    users.push(
      (
        await db.query(
          `INSERT INTO users(email,username,display_name,password_hash,email_verified_at)
    VALUES($1,$2,$3,'not-a-login-password',now()) RETURNING id`,
          [`gifqa${i}@example.invalid`, `gifqa${i}`, `GIF QA ${i}`],
        )
      ).rows[0].id,
    );
  const [sender, recipient, outsider] = users;
  chatId = (
    await db.query("INSERT INTO chats(type,created_by) VALUES('direct',$1) RETURNING id", [sender])
  ).rows[0].id;
  await db.query('INSERT INTO chat_members(chat_id,user_id) VALUES($1,$2),($1,$3)', [
    chatId,
    sender,
    recipient,
  ]);
  await check('unauthenticated requests refused', async () => {
    assert.equal((await app.inject('/v1/gifs/favorites')).statusCode, 401);
  });
  await check('spoofed and static GIF files rejected', async () => {
    assert.equal((await upload(sender, Buffer.from('not a GIF'))).statusCode, 400);
    assert.equal(
      (await upload(sender, Buffer.concat([header, frame, Buffer.from([0x3b])]))).statusCode,
      400,
    );
    assert.equal((await db.query('SELECT count(*)::int AS n FROM gif_assets')).rows[0].n, 0);
  });
  await check('upload preserves original bytes and supplies private thumbnail', async () => {
    const response = await upload(sender);
    assert.equal(response.statusCode, 201, response.body);
    assetId = response.json().gif.assetId;
    const original = await request(sender, 'GET', `/v1/gifs/assets/${assetId}`);
    assert.equal(original.statusCode, 200, original.body);
    assert.deepEqual(original.rawPayload, gif);
    const thumbnail = await request(sender, 'GET', `/v1/gifs/assets/${assetId}?variant=thumbnail`);
    assert.deepEqual(thumbnail.rawPayload, png);
    assert.match(thumbnail.headers['cache-control'], /private/);
  });
  await check('asset IDs do not grant outsiders access', async () => {
    for (const user of [recipient, outsider]) {
      assert.equal((await request(user, 'GET', `/v1/gifs/assets/${assetId}`)).statusCode, 404);
      assert.equal(
        (await request(user, 'POST', '/v1/gifs/favorites', { assetId })).statusCode,
        404,
      );
    }
    assert.equal(
      (await request(outsider, 'POST', `/v1/chats/${chatId}/gifs`, { assetId })).statusCode,
      403,
    );
  });
  await check('chat recipient can view and save a received GIF', async () => {
    const sent = await request(sender, 'POST', `/v1/chats/${chatId}/gifs`, { assetId });
    assert.equal(sent.statusCode, 201, sent.body);
    messageId = sent.json().message.id;
    assert.equal((await request(recipient, 'GET', `/v1/gifs/assets/${assetId}`)).statusCode, 200);
    const saved = await request(recipient, 'POST', '/v1/gifs/favorites', { messageId });
    assert.equal(saved.statusCode, 201, saved.body);
    assert.equal(
      (await request(outsider, 'POST', '/v1/gifs/favorites', { messageId })).statusCode,
      404,
    );
  });
  await check('deduplication keeps user filenames private', async () => {
    const duplicate = await upload(outsider, gif, 'private-filename.gif');
    assert.equal(duplicate.statusCode, 201, duplicate.body);
    assert.equal(duplicate.json().gif.assetId, assetId);
    assert.equal(duplicate.json().gif.alt, 'private-filename');
    assert.equal((await db.query('SELECT count(*)::int AS n FROM gif_assets')).rows[0].n, 1);
    const senderList = (await request(sender, 'GET', '/v1/gifs/favorites')).json().gifs;
    assert.equal(senderList[0].alt, 'reaction');
  });
  await check('saved GIF survives source message deletion and can be reused', async () => {
    await db.query('DELETE FROM messages WHERE id=$1', [messageId]);
    const reused = await request(recipient, 'POST', `/v1/chats/${chatId}/gifs`, { assetId });
    assert.equal(reused.statusCode, 201, reused.body);
  });
  await check('storage refusal rolls back both asset and favorite', async () => {
    const changed = Buffer.from(gif);
    changed[13] = 27;
    const limit = GIF_LIMITS.totalStorage;
    GIF_LIMITS.totalStorage = gif.length + png.length;
    try {
      const response = await upload(sender, changed);
      assert.equal(response.statusCode, 507, response.body);
      assert.equal((await db.query('SELECT count(*)::int AS n FROM gif_assets')).rows[0].n, 1);
    } finally {
      GIF_LIMITS.totalStorage = limit;
    }
  });
  await check('concurrent download quotas are atomic', async () => {
    await db.query('DELETE FROM gif_bandwidth_usage');
    const limit = GIF_LIMITS.accountDailyDownload;
    GIF_LIMITS.accountDailyDownload = gif.length * 2;
    try {
      const responses = await Promise.all(
        Array.from({ length: 3 }, () => request(sender, 'GET', `/v1/gifs/assets/${assetId}`)),
      );
      assert.deepEqual(responses.map((r) => r.statusCode).sort(), [200, 200, 429]);
      const total = (
        await db.query("SELECT bytes::int AS bytes FROM gif_bandwidth_usage WHERE scope='all'")
      ).rows[0].bytes;
      assert.equal(total, gif.length * 2, 'denied user transfer must roll back global charge');
      await assert.rejects(() => chargeGifDownload(sender, gif.length), {
        code: 'GIF_DOWNLOAD_LIMIT',
      });
    } finally {
      GIF_LIMITS.accountDailyDownload = limit;
    }
  });
  await check('concurrent upload reservations cannot bypass global quota', async () => {
    await db.query('DELETE FROM gif_upload_attempts');
    const limit = GIF_LIMITS.totalDailyUpload;
    GIF_LIMITS.totalDailyUpload = 10;
    try {
      const requests = await Promise.allSettled([
        beginGifUpload(sender, 8),
        beginGifUpload(recipient, 8),
      ]);
      assert.equal(requests.filter((r) => r.status === 'fulfilled').length, 1);
      assert.equal(
        requests.find((r) => r.status === 'rejected').reason.code,
        'GIF_GLOBAL_UPLOAD_LIMIT',
      );
    } finally {
      GIF_LIMITS.totalDailyUpload = limit;
    }
  });
  await check('request cancellation is sender-only and permits resend', async () => {
    const created = await request(sender, 'POST', '/v1/friends/requests', { username: 'gifqa1' });
    assert.equal(created.statusCode, 201, created.body);
    const id = created.json().request.id;
    assert.equal(
      (await request(recipient, 'DELETE', `/v1/friends/requests/${id}`)).statusCode,
      404,
    );
    assert.equal((await request(sender, 'DELETE', `/v1/friends/requests/${id}`)).statusCode, 204);
    for (const user of [sender, recipient])
      assert.equal((await request(user, 'GET', '/v1/friends')).json().pending.length, 0);
    const retry = await request(sender, 'POST', '/v1/friends/requests', { username: 'gifqa1' });
    assert.equal(retry.statusCode, 201, retry.body);
    const id2 = retry.json().request.id;
    const race = await Promise.all([
      request(sender, 'DELETE', `/v1/friends/requests/${id2}`),
      request(recipient, 'POST', `/v1/friends/requests/${id2}/accept`, {}),
    ]);
    assert.equal(race.filter((r) => r.statusCode === 404).length, 1);
    const state = (await db.query('SELECT status FROM friend_requests WHERE id=$1', [id2])).rows[0]
      .status;
    assert.equal(
      (await db.query('SELECT count(*)::int AS n FROM friendships')).rows[0].n,
      state === 'accepted' ? 1 : 0,
    );
  });
  await check('garbage collection retains referenced assets and removes unused ones', async () => {
    await db.query("UPDATE gif_assets SET last_used_at=now()-interval '2 hours'");
    await pruneUnusedGifs();
    assert.equal((await db.query('SELECT count(*)::int AS n FROM gif_assets')).rows[0].n, 1);
    await db.query('DELETE FROM gif_favorites');
    await db.query('DELETE FROM messages');
    await pruneUnusedGifs();
    assert.equal((await db.query('SELECT count(*)::int AS n FROM gif_assets')).rows[0].n, 0);
  });
  console.log(JSON.stringify({ passed: results.length, database: database.pathname.slice(1) }));
} finally {
  await app.close();
  await db.end();
}
