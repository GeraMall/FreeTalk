import { db } from './db.js';

export async function accountLoginLimited(userId: string): Promise<boolean> {
  const result = await db.query<{ count: string }>(
    `SELECT count(*) FROM security_events WHERE user_id=$1
     AND event_type IN ('login.failed','mobile_beta.login_failed')
     AND created_at>now()-interval '15 minutes'`,
    [userId],
  );
  return Number(result.rows[0]?.count ?? 0) >= 20;
}
