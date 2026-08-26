import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const requiredTables = [
  'users',
  'sessions',
  'email_verifications',
  'password_resets',
  'friend_requests',
  'friendships',
  'blocks',
  'chats',
  'chat_members',
  'chat_invites',
  'messages',
  'history_votes',
  'call_sessions',
  'call_participants',
  'guest_sessions',
  'guest_usage_daily',
  'terms_acceptance',
  'security_events',
];

describe('PostgreSQL migration', () => {
  it('declares every required durable table and critical constraints', async () => {
    const path = fileURLToPath(new URL('../migrations/001_initial.sql', import.meta.url));
    const sql = (await readFile(path, 'utf8')).toLowerCase();
    for (const table of requiredTables) expect(sql).toContain(`create table ${table}`);
    expect(sql).toContain('on delete cascade');
    expect(sql).toContain('token_hash bytea not null unique');
    expect(sql).toContain('messages_chat_expiry_idx');
    expect(sql).toContain('friend_requests_pending_pair_idx');
  });

  it('enforces the current username format for existing databases', async () => {
    const path = fileURLToPath(new URL('../migrations/002_username_format.sql', import.meta.url));
    const sql = (await readFile(path, 'utf8')).toLowerCase();
    expect(sql).toContain('^[a-z0-9_]{5,24}$');
    expect(sql).toContain('not valid');
  });

  it('adds configurable chat retention and supports non-expiring messages', async () => {
    const path = fileURLToPath(new URL('../migrations/003_chat_retention.sql', import.meta.url));
    const sql = (await readFile(path, 'utf8')).toLowerCase();
    expect(sql).toContain('add column retention_hours');
    expect(sql).toContain('retention_hours in (24, 168, 720)');
    expect(sql).toContain('alter column expires_at drop not null');
    expect(sql).toContain("created_at + interval '30 days'");
    expect(sql).toContain('messages_chat_created_idx');
  });

  it('adds nullable profile bio and bounded cover storage', async () => {
    const path = fileURLToPath(new URL('../migrations/004_profile_details.sql', import.meta.url));
    const sql = (await readFile(path, 'utf8')).toLowerCase();
    expect(sql).toContain('add column bio varchar(200)');
    expect(sql).toContain('add column cover_mime');
    expect(sql).toContain('add column cover_data');
    expect(sql).toContain('2097152');
  });

  it('uses one explicit PostgreSQL type for repeated room-id parameters', async () => {
    const path = fileURLToPath(new URL('../src/server.ts', import.meta.url));
    const source = await readFile(path, 'utf8');
    expect(source).toContain('VALUES($1::text,$2,(SELECT chat_id FROM messages');
    expect(source).toContain("metadata->>'roomId'=$1::text");
  });
});
