import { db } from './db.js';

export async function presenceAudience(userId: string) {
  const result = await db.query<{ user_id: string }>(
    `SELECT $1::uuid AS user_id
     UNION SELECT CASE WHEN user_low_id=$1 THEN user_high_id ELSE user_low_id END
       FROM friendships WHERE user_low_id=$1 OR user_high_id=$1
     UNION SELECT members.user_id FROM chat_members self
       JOIN chat_members members ON members.chat_id=self.chat_id AND members.left_at IS NULL
       WHERE self.user_id=$1 AND self.left_at IS NULL
     UNION SELECT other.user_id FROM call_participants mine
       JOIN call_participants other ON other.call_id=mine.call_id AND other.left_at IS NULL
       JOIN call_sessions session ON session.id=mine.call_id AND session.ended_at IS NULL
       WHERE mine.user_id=$1 AND mine.left_at IS NULL AND other.user_id IS NOT NULL`,
    [userId],
  );
  return result.rows.map((row) => row.user_id);
}
