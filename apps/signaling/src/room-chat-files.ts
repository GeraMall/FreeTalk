import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RoomChatAttachment } from '@freetalk/protocol';

const MAX_FILE = 10 * 1024 * 1024,
  MAX_ROOM = 32 * 1024 * 1024,
  MAX_TOTAL = 128 * 1024 * 1024;
type Access = { roomId: string; clientId: string };
type Stored = { roomId: string; owner: string; metadata: RoomChatAttachment; body: Buffer };
/** Ephemeral bounded storage, outside the WebSocket control channel. */
export class RoomChatFiles {
  private files = new Map<string, Stored>();
  private pendingBytes = 0;
  private pendingRooms = new Map<string, number>();
  private lastUploads = new Map<string, number>();
  constructor(
    private access: (token: string) => Access | undefined,
    private exists: (roomId: string) => boolean,
  ) {}
  prune() {
    for (const [id, file] of this.files) if (!this.exists(file.roomId)) this.files.delete(id);
    if (this.lastUploads.size > 1000) this.lastUploads.clear();
  }
  attachment(id: string, roomId: string, clientId: string) {
    const file = this.files.get(id);
    return file?.roomId === roomId && file.owner === clientId ? file.metadata : undefined;
  }
  async handle(request: IncomingMessage, response: ServerResponse, allowedOrigin: string) {
    const path = request.url?.split('?')[0] ?? '';
    if (!/^\/room-chat\/files(?:\/[a-f0-9-]{36})?$/.test(path)) return false;
    response.setHeader('cache-control', 'no-store');
    response.setHeader('x-content-type-options', 'nosniff');
    if (allowedOrigin === '*' || request.headers.origin === allowedOrigin) {
      response.setHeader('access-control-allow-origin', allowedOrigin);
      response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
      response.setHeader(
        'access-control-allow-headers',
        'authorization, content-type, x-file-name',
      );
    }
    const fail = (code: number, message: string) => {
      response.writeHead(code, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ message }));
    };
    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return true;
    }
    const token = request.headers.authorization?.replace(/^Bearer /, '') ?? '';
    const actor = this.access(token);
    if (!actor) {
      fail(401, 'Войдите в комнату заново');
      return true;
    }
    this.prune();
    if (request.method === 'GET') {
      const file = this.files.get(path.split('/').at(-1)!);
      if (!file || file.roomId !== actor.roomId) {
        fail(404, 'Файл больше недоступен');
        return true;
      }
      response.writeHead(200, {
        'content-type': file.metadata.mime,
        'content-length': file.body.length,
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.metadata.name)}`,
      });
      response.end(file.body);
      return true;
    }
    if (request.method !== 'POST' || path !== '/room-chat/files') {
      fail(405, 'Метод недоступен');
      return true;
    }
    const key = `${actor.roomId}:${actor.clientId}`,
      now = Date.now();
    if (now - (this.lastUploads.get(key) ?? 0) < 2000) {
      fail(429, 'Подождите перед следующей отправкой');
      request.resume();
      return true;
    }
    const roomBytes = [...this.files.values()]
      .filter((file) => file.roomId === actor.roomId)
      .reduce((sum, file) => sum + file.body.length, 0);
    const roomCount = [...this.files.values()].filter(
      (file) => file.roomId === actor.roomId,
    ).length;
    const total = [...this.files.values()].reduce((sum, file) => sum + file.body.length, 0);
    if (
      roomCount >= 200 ||
      this.files.size >= 2000 ||
      roomBytes + (this.pendingRooms.get(actor.roomId) ?? 0) + MAX_FILE > MAX_ROOM ||
      total + this.pendingBytes + MAX_FILE > MAX_TOTAL
    ) {
      fail(413, 'Недостаточно места для файлов этой комнаты');
      request.resume();
      return true;
    }
    this.lastUploads.set(key, now);
    this.pendingBytes += MAX_FILE;
    this.pendingRooms.set(actor.roomId, (this.pendingRooms.get(actor.roomId) ?? 0) + MAX_FILE);
    request.setTimeout(30_000, () => request.destroy());
    try {
      let size = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        size += chunk.length;
        if (size > MAX_FILE) {
          fail(413, 'Файл должен быть не больше 10 МБ');
          request.resume();
          return true;
        }
        chunks.push(Buffer.from(chunk));
      }
      if (!size) {
        fail(400, 'Пустой файл');
        return true;
      }
      if (!this.access(token)) {
        fail(401, 'Комната закрыта');
        return true;
      }
      let name: string;
      try {
        name = decodeURIComponent(String(request.headers['x-file-name'] ?? 'Файл'));
      } catch {
        name = 'Файл';
      }
      name =
        [...name]
          .map((character) =>
            character.charCodeAt(0) < 32 ||
            character.charCodeAt(0) === 127 ||
            '/\\'.includes(character)
              ? '_'
              : character,
          )
          .join('')
          .slice(0, 180) || 'Файл';
      const mime = String(request.headers['content-type'] ?? 'application/octet-stream').split(
        ';',
      )[0]!;
      const image = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(mime);
      const metadata: RoomChatAttachment = {
        id: randomUUID(),
        name,
        size,
        image,
        mime: image ? mime : 'application/octet-stream',
      };
      this.files.set(metadata.id, {
        roomId: actor.roomId,
        owner: actor.clientId,
        metadata,
        body: Buffer.concat(chunks),
      });
      response.writeHead(201, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ attachment: metadata }));
    } catch {
      if (!response.writableEnded) fail(400, 'Не удалось загрузить файл');
    } finally {
      this.pendingBytes -= MAX_FILE;
      const remaining = (this.pendingRooms.get(actor.roomId) ?? MAX_FILE) - MAX_FILE;
      if (remaining) this.pendingRooms.set(actor.roomId, remaining);
      else this.pendingRooms.delete(actor.roomId);
    }
    return true;
  }
}
