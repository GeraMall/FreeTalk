import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';

const migrationsDirectory = fileURLToPath(new URL('../migrations/', import.meta.url));
await db.query(
  `CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`,
);
const migrations = (await readdir(migrationsDirectory))
  .filter((name) => /^\d+_[a-z0-9_]+\.sql$/.test(name))
  .sort();
for (const filename of migrations) {
  const name = filename.replace(/\.sql$/, '');
  const applied = await db.query('SELECT 1 FROM schema_migrations WHERE name=$1', [name]);
  if (applied.rowCount) continue;
  await db.query(await readFile(`${migrationsDirectory}/${filename}`, 'utf8'));
  await db.query('INSERT INTO schema_migrations(name) VALUES($1)', [name]);
  console.info(`Applied ${filename}`);
}
await db.end();
