import { readFile } from 'node:fs/promises';

const sessionFile = process.argv[2];
const apiUrl = process.argv[3] ?? 'http://127.0.0.1:8790';
if (!sessionFile) process.exit(2);
const session = JSON.parse(await readFile(sessionFile, 'utf8'));
const response = await fetch(`${apiUrl}/v1/admin/overview`, {
  headers: { authorization: `Bearer ${session.accessToken}` },
});
const body = await response.json();
console.log(
  JSON.stringify({
    status: response.status,
    generatedAt: body.generatedAt ?? null,
    online: body.online ?? null,
    rooms: body.rooms
      ? {
          active_rooms: body.rooms.active_rooms,
          active_calls: body.rooms.active_calls,
          average_room_size: body.rooms.average_room_size,
        }
      : null,
    network: body.network
      ? {
          total: body.network.total,
          direct: body.network.direct,
          turn: body.network.turn,
          directPercent: body.network.directPercent,
        }
      : null,
    health: body.health ?? null,
  }),
);
await fetch(`${apiUrl}/v1/auth/logout`, {
  method: 'POST',
  headers: { authorization: `Bearer ${session.accessToken}` },
});
if (!response.ok) process.exit(1);
