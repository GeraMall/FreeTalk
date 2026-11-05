import { SERVICE_BOT_ID, SERVICE_CHAT_ID } from '@freetalk/config';
import { t } from './app-language';
import { accountClient } from './api-client';
import mascot from '../assets/freetalk-mascot.png';
import type { ChatItem } from '../components/ChatsPage';
export { SERVICE_CHAT_ID };
export const SERVICE_CHAT_UPDATED = 'trlka:service-chat-updated';
export interface ServiceMessage {
  id: string;
  author: 'bot' | 'user';
  kind: string;
  body: string;
  created_at: string;
}
export function serviceChat(userId: string): ChatItem {
  return {
    id: SERVICE_CHAT_ID,
    type: 'direct',
    title: 'TRLKA',
    members: [
      { id: userId, username: '', displayName: '' },
      { id: SERVICE_BOT_ID, username: 'trlka', displayName: 'TRLKA', avatarUrl: mascot },
    ],
    lastMessage: t('Уведомления и помощь'),
    retentionHours: null,
  };
}
interface PendingEvent {
  eventId: string;
  roomId: string;
  userId: string;
  createdAt: number;
}
const KEY = 'trlka:pending-service-events';
function read(): PendingEvent[] {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(value)
      ? value
          .filter(
            (e) =>
              typeof e?.eventId === 'string' &&
              typeof e.roomId === 'string' &&
              typeof e.userId === 'string' &&
              typeof e.createdAt === 'number' &&
              Date.now() - e.createdAt < 24 * 60 * 60_000,
          )
          .slice(-20)
      : [];
  } catch {
    return [];
  }
}
function write(events: PendingEvent[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(events));
  } catch {
    /* Delivery can still be attempted in this session. */
  }
}
let pending = read();
let running = false;
export function queueCallTimeoutNotice(userId: string, roomId: string) {
  pending = [
    ...pending,
    { userId, roomId, eventId: crypto.randomUUID(), createdAt: Date.now() },
  ].slice(-20);
  write(pending);
  void flushServiceEvents();
}
export async function flushServiceEvents() {
  if (running || !accountClient.user?.id) return;
  running = true;
  try {
    for (const event of [...pending]) {
      if (event.userId !== accountClient.user?.id) continue;
      try {
        await accountClient.request('/v1/service-chat/call-timeout', {
          method: 'POST',
          body: JSON.stringify(event),
        });
        pending = pending.filter((e) => e.eventId !== event.eventId);
        write(pending);
        window.dispatchEvent(new Event(SERVICE_CHAT_UPDATED));
      } catch (error) {
        const status = (error as { status?: number }).status;
        if (status === 404 || status === 400 || status === 403) {
          pending = pending.filter((e) => e.eventId !== event.eventId);
          write(pending);
        } else break;
      }
    }
  } finally {
    running = false;
  }
}
export function startServiceDelivery() {
  void flushServiceEvents();
  const timer = setInterval(() => void flushServiceEvents(), 30_000);
  window.addEventListener('online', flushServiceEvents);
  return () => {
    clearInterval(timer);
    window.removeEventListener('online', flushServiceEvents);
  };
}

// Translate only known service-owned templates; user text and identifiers stay untouched.
export function localizedServiceBody(message: Pick<ServiceMessage, 'author' | 'body'>): string {
  if (message.author !== 'bot') return message.body;
  const accepted =
    /^Обращение №([a-f0-9]{8}) принято и поставлено в очередь отправки команде TRLKA\. Спасибо за подробности\.$/u.exec(
      message.body,
    );
  if (accepted)
    return t(
      'Обращение №{id} принято и поставлено в очередь отправки команде TRLKA. Спасибо за подробности.',
      { id: accepted[1] },
    );
  return message.body
    .split('\n')
    .map((line) => t(line))
    .join('\n');
}
