import { createServer, type Server } from 'node:http';
import { afterEach, expect, it } from 'vitest';
import { RoomChatFiles } from '../src/room-chat-files.js';

let server: Server | undefined;
afterEach(async () => {
  if (server)
    await new Promise<void>((resolve) => {
      server!.closeAllConnections();
      server!.close(() => resolve());
    });
});
it('limits files to current room members and deletes them with the room', async () => {
  const actors = new Map([
    ['host', { roomId: 'room-a', clientId: 'host' }],
    ['guest', { roomId: 'room-a', clientId: 'guest' }],
    ['stranger', { roomId: 'room-b', clientId: 'stranger' }],
  ]);
  let roomExists = true;
  const files = new RoomChatFiles(
    (token) => actors.get(token),
    () => roomExists,
  );
  server = createServer(async (request, response) => {
    if (!(await files.handle(request, response, '*'))) {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/room-chat/files`;
  expect((await fetch(base, { method: 'POST', body: 'private' })).status).toBe(401);
  const uploaded = await fetch(base, {
    method: 'POST',
    headers: { authorization: 'Bearer host', 'x-file-name': encodeURIComponent('тест.txt') },
    body: 'private',
  });
  expect(uploaded.status).toBe(201);
  const { attachment } = (await uploaded.json()) as { attachment: { id: string; name: string } };
  expect(attachment.name).toBe('тест.txt');
  expect(files.attachment(attachment.id, 'room-a', 'guest')).toBeUndefined();
  const download = await fetch(`${base}/${attachment.id}`, {
    headers: { authorization: 'Bearer guest' },
  });
  expect(await download.text()).toBe('private');
  expect(download.headers.get('cache-control')).toBe('no-store');
  expect(
    (await fetch(`${base}/${attachment.id}`, { headers: { authorization: 'Bearer stranger' } }))
      .status,
  ).toBe(404);
  actors.delete('guest');
  expect(
    (await fetch(`${base}/${attachment.id}`, { headers: { authorization: 'Bearer guest' } }))
      .status,
  ).toBe(401);
  expect(
    (
      await fetch(base, {
        method: 'POST',
        headers: { authorization: 'Bearer host' },
        body: 'repeat',
      })
    ).status,
  ).toBe(429);
  roomExists = false;
  files.prune();
  expect(
    (await fetch(`${base}/${attachment.id}`, { headers: { authorization: 'Bearer host' } })).status,
  ).toBe(404);
});
