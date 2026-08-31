import { db } from './db.js';

const email = process.argv[2]?.trim().toLowerCase();
if (!email || !email.includes('@')) {
  console.error('Usage: pnpm --filter @freetalk/api admin:grant user@example.com');
  process.exitCode = 2;
} else {
  const result = await db.query<{ id: string; email: string }>(
    `UPDATE users SET role='admin',updated_at=now()
     WHERE lower(email)=lower($1) AND deleted_at IS NULL
     RETURNING id,email`,
    [email],
  );
  if (!result.rowCount) {
    console.error('User not found. Create and verify the account first.');
    process.exitCode = 1;
  } else {
    console.log(`Admin role granted to ${result.rows[0]!.email}.`);
  }
  await db.end();
}
