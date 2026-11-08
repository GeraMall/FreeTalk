import type { RoomChatAttachment } from '@freetalk/protocol';
import { currentSocketUrl } from './server-endpoints';

function base() {
  const url = new URL(
    currentSocketUrl(import.meta.env.VITE_SIGNALING_URL || 'ws://127.0.0.1:8787/ws').url,
  );
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  return url.origin;
}
export async function uploadRoomChatFile(file: File, token: string, signal?: AbortSignal) {
  if (file.size > 10 * 1024 * 1024) throw new Error('Файл должен быть не больше 10 МБ');
  const response = await fetch(`${base()}/room-chat/files`, {
    method: 'POST',
    body: file,
    redirect: 'error',
    credentials: 'omit',
    signal,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': file.type || 'application/octet-stream',
      'x-file-name': encodeURIComponent(file.name),
    },
  });
  const result = (await response.json()) as { attachment?: RoomChatAttachment; message?: string };
  if (!response.ok || !result.attachment)
    throw new Error(result.message || 'Не удалось загрузить файл');
  return result.attachment;
}
export async function loadRoomChatFile(id: string, token: string, signal?: AbortSignal) {
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error('Некорректный файл');
  const response = await fetch(`${base()}/room-chat/files/${id}`, {
    headers: { authorization: `Bearer ${token}` },
    redirect: 'error',
    credentials: 'omit',
    cache: 'no-store',
    signal,
  });
  if (!response.ok) throw new Error('Файл больше недоступен');
  return response.blob();
}
