import { describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
vi.mock('../src/db.js', () => ({ db: { query: vi.fn() }, transaction: vi.fn() }));
import { pushEvent } from '../src/android-push.js';

describe('Android push payload', () => {
  it('bounds Unicode previews and excludes credentials and unnecessary fields', () => {
    const event = JSON.parse(
      pushEvent({
        message_id: 'message',
        chat_id: 'chat',
        sender_id: 'sender',
        kind: 'text',
        body: '😀'.repeat(500),
        display_name: 'Friend',
        expires_at: new Date('2030-01-02T00:00:00Z'),
        created_at: new Date('2030-01-01T00:00:00Z'),
      }),
    );
    expect(Array.from(event.message.body)).toHaveLength(160);
    expect(event.type).toBe('message-created');
    expect(event.message.expires_at).toBe('2030-01-02T00:00:00.000Z');
    expect(event.message).not.toHaveProperty('token');
    expect(Buffer.byteLength(JSON.stringify(event))).toBeLessThan(3500);
  });
  it('enqueues transactionally and uses durable deduplication', async () => {
    const sql = await readFile(
      new URL('../migrations/010_android_push.sql', import.meta.url),
      'utf8',
    );
    expect(sql).toContain('AFTER INSERT ON messages');
    expect(sql).toContain('PRIMARY KEY(message_id,session_id)');
    expect(sql).toContain('session.revoked_at IS NULL');
    expect(sql).toContain('session.user_id IS DISTINCT FROM NEW.sender_id');
    expect(sql).toContain('ON DELETE CASCADE');
  });
});
