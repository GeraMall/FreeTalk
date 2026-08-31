import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const apiRoot = process.env.FREETALK_API_ROOT;
if (!apiRoot || process.argv.length < 3) process.exit(2);
const { db } = await import(pathToFileURL(resolve(apiRoot, 'dist/db.js')).href);

let revoked = 0;
for (const file of process.argv.slice(2)) {
  const session = JSON.parse(await readFile(file, 'utf8'));
  if (typeof session.sessionId !== 'string') continue;
  const result = await db.query(
    `UPDATE sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE id=$1`,
    [session.sessionId],
  );
  revoked += result.rowCount ?? 0;
}
console.log(`Revoked test sessions: ${revoked}`);
await db.end();
