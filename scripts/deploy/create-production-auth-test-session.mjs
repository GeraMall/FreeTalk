import { chmod, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const apiRoot = process.env.FREETALK_API_ROOT;
if (!apiRoot) process.exit(2);
const { db, transaction } = await import(pathToFileURL(resolve(apiRoot, 'dist/db.js')).href);
const { issueSession } = await import(pathToFileURL(resolve(apiRoot, 'dist/auth-service.js')).href);

const selector = process.argv[2];
const outputPath = process.argv[3];
if (!selector || !outputPath) process.exit(2);

const result = await transaction(async (client) => {
  const user =
    selector === '--normal'
      ? await client.query(
          `SELECT id,username FROM users
           WHERE role='user' AND email_verified_at IS NOT NULL AND deleted_at IS NULL
           ORDER BY created_at DESC LIMIT 1`,
        )
      : await client.query(
          `SELECT id,username FROM users
           WHERE username=$1 AND email_verified_at IS NOT NULL AND deleted_at IS NULL
           LIMIT 1`,
          [selector],
        );
  if (!user.rowCount) throw new Error('Eligible verified user not found');
  const session = await issueSession(client, user.rows[0].id, {
    headers: { 'user-agent': 'FreeTalk production admin boundary test' },
    ip: '127.0.0.1',
  });
  return { ...session, username: user.rows[0].username };
});

await writeFile(outputPath, JSON.stringify(result), { mode: 0o600 });
await chmod(outputPath, 0o600);
await db.end();
