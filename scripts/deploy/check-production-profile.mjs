import { readFile } from 'node:fs/promises';

const tokenFile = process.argv[2];
const apiBase = (process.argv[3] ?? 'https://freetalk.191-44-38-60.sslip.io/api').replace(
  /\/$/,
  '',
);
const requestedTargetId = process.argv[4];
const expectedRelationship = process.argv[5] ?? 'self';
if (!tokenFile) process.exit(2);

const session = JSON.parse(await readFile(tokenFile, 'utf8'));
if (typeof session.accessToken !== 'string') process.exit(2);
const headers = { authorization: `Bearer ${session.accessToken}` };
const meResponse = await fetch(`${apiBase}/v1/me`, { headers });
if (!meResponse.ok) throw new Error(`Self lookup failed: ${meResponse.status}`);
const { user } = await meResponse.json();
const targetId = requestedTargetId ?? user.id;
const profileResponse = await fetch(`${apiBase}/v1/users/${targetId}/profile`, { headers });
if (!profileResponse.ok) throw new Error(`Own profile failed: ${profileResponse.status}`);
const { profile } = await profileResponse.json();
if (profile.id !== targetId || profile.relationship !== expectedRelationship)
  throw new Error('Profile relationship is inconsistent');
if (!Array.isArray(profile.mutualFriends) || !Array.isArray(profile.commonChats))
  throw new Error('Own profile social lists are missing');
if (new Set(profile.commonChats.map((chat) => chat.id)).size !== profile.commonChats.length)
  throw new Error('Own profile contains duplicate chat ids');

console.log(
  JSON.stringify({
    ok: true,
    relationship: profile.relationship,
    friends: profile.mutualFriendsCount,
    chats: profile.commonChatsCount,
  }),
);
