import { db, transaction } from './db.js';
import { env } from './env.js';
import { publishChatEvent } from './social-routes.js';

// Require two successful snapshots separated by a grace period. An unavailable
// signaling service must never be interpreted as an empty room list.
export class MissingCallTracker {
  private missing = new Map<string, number>();

  observe(candidates: string[], active: Set<string>, now: number) {
    const ended: string[] = [];
    const known = new Set(candidates);
    for (const id of this.missing.keys()) {
      if (!known.has(id) || active.has(id)) this.missing.delete(id);
    }
    for (const id of candidates) {
      if (active.has(id)) continue;
      const since = this.missing.get(id);
      if (since === undefined) this.missing.set(id, now);
      else if (now - since >= 60_000) ended.push(id);
    }
    return ended;
  }

  reset() {
    this.missing.clear();
  }
}

export function startCallReconciliation(
  logError: (error: unknown) => void,
  enabled: () => boolean = () => true,
) {
  const tracker = new MissingCallTracker();
  let running = false;
  const reconcile = async () => {
    if (running || !enabled()) return;
    running = true;
    try {
      const response = await fetch(
        `${process.env.SIGNALING_INTERNAL_URL || 'http://127.0.0.1:8787'}/internal/active-rooms`,
        {
          headers: { 'x-freetalk-internal-secret': env.INTERNAL_SIGNALING_SECRET },
          signal: AbortSignal.timeout(5_000),
        },
      );
      if (!response.ok) throw new Error(`Signaling snapshot failed: ${response.status}`);
      const snapshot = (await response.json()) as { roomIds?: unknown };
      if (
        !Array.isArray(snapshot.roomIds) ||
        !snapshot.roomIds.every((id) => typeof id === 'string')
      )
        throw new Error('Invalid signaling snapshot');
      const candidates = await db.query<{ room_id: string }>(
        `SELECT DISTINCT room_id FROM call_sessions WHERE ended_at IS NULL
         AND started_at < now()-interval '2 minutes'`,
      );
      const expired = tracker.observe(
        candidates.rows.map((row) => row.room_id),
        new Set(snapshot.roomIds),
        Date.now(),
      );
      if (!expired.length) return;
      const messages = await transaction(async (client) => {
        // Lock sessions so concurrent event writes cannot reopen this session.
        const sessions = await client.query<{ id: string; room_id: string; ended_at: Date }>(
          `UPDATE call_sessions s SET ended_at=GREATEST(s.started_at, COALESCE(
             (SELECT max(COALESCE(p.left_at,p.joined_at)) FROM call_participants p WHERE p.call_id=s.id),s.started_at))
           WHERE s.ended_at IS NULL AND s.room_id=ANY($1::text[])
           RETURNING s.id,s.room_id,s.ended_at`,
          [expired],
        );
        const changed = [];
        for (const session of sessions.rows) {
          await client.query(
            `UPDATE call_participants SET left_at=$2 WHERE call_id=$1 AND left_at IS NULL`,
            [session.id, session.ended_at],
          );
          const result = await client.query<{
            id: string;
            chat_id: string;
            metadata: Record<string, unknown>;
          }>(
            `UPDATE messages SET metadata=metadata || jsonb_build_object('ended',true,'endedAt',$2::timestamptz)
             WHERE kind='call' AND metadata->>'roomId'=$1 AND NOT (metadata ? 'movedToChatId')
             RETURNING id,chat_id,metadata`,
            [session.room_id, session.ended_at],
          );
          changed.push(...result.rows);
        }
        return changed;
      });
      for (const message of messages)
        await publishChatEvent(message.chat_id, {
          type: 'message-updated',
          chatId: message.chat_id,
          messageId: message.id,
          metadata: message.metadata,
        });
    } catch (error) {
      tracker.reset();
      logError(error);
    } finally {
      running = false;
    }
  };
  void reconcile();
  const timer = setInterval(() => void reconcile(), 30_000);
  timer.unref();
  return () => clearInterval(timer);
}
