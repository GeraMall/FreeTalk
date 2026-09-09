import { useEffect, useState } from 'react';
import { PhoneCall } from 'lucide-react';
import { accountClient } from '../lib/api-client';
import { CachedMediaImage } from './CachedMedia';

export interface ChatCallContext {
  roomId: string;
  chatId: string | null;
  title: string;
  startedAt: string;
  participants: Array<{ userId: string; displayName: string; avatarUrl: string | null }>;
}

export function ChatCallWaiting({
  chatId,
  currentUserId,
  joinedChatId,
  joinedRoomId,
  revision,
  onJoin,
}: {
  chatId: string;
  currentUserId?: string;
  joinedChatId?: string;
  joinedRoomId?: string;
  revision: unknown;
  onJoin(roomId: string): void;
}) {
  const [snapshot, setSnapshot] = useState<{ chatId: string; call?: ChatCallContext }>();
  const call = snapshot?.chatId === chatId ? snapshot.call : undefined;
  useEffect(() => {
    if (joinedChatId === chatId) {
      setSnapshot({ chatId });
      return;
    }
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const result = await accountClient.request<{ call: ChatCallContext | null }>(
          `/v1/chats/${chatId}/active-call`,
        );
        if (!disposed) setSnapshot({ chatId, call: result.call ?? undefined });
      } catch {
        if (!disposed) setSnapshot({ chatId });
      }
      if (!disposed) timer = setTimeout(() => void refresh(), 5000);
    };
    void refresh();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [chatId, joinedChatId, revision]);
  if (
    joinedChatId === chatId ||
    !call ||
    call.roomId === joinedRoomId ||
    (Boolean(currentUserId) &&
      call.participants.length > 0 &&
      call.participants.every((participant) => participant.userId === currentUserId))
  )
    return null;
  return (
    <section className="chat-call-waiting" aria-label="Звонок в чате">
      <div className="chat-call-waiting-cards">
        {call.participants.map((person) => (
          <div
            className="chat-call-waiting-avatar"
            key={person.userId}
            aria-label={`${person.displayName} находится в звонке`}
          >
            {person.avatarUrl ? (
              <CachedMediaImage src={person.avatarUrl} alt="" />
            ) : (
              <span className="waiting-initial">{person.displayName.slice(0, 1)}</span>
            )}
          </div>
        ))}
      </div>
      <div className="chat-call-waiting-copy">
        <strong>
          {call.participants.length === 1 ? call.participants[0]?.displayName : call.title}
        </strong>
        <p>{call.participants.length === 1 ? 'ждёт вас в звонке' : 'В чате идёт звонок'}</p>
      </div>
      <button className="primary" onClick={() => onJoin(call.roomId)}>
        <PhoneCall size={17} /> Присоединиться
      </button>
    </section>
  );
}
