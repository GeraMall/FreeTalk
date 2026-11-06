import { useEffect, useRef, useState } from 'react';
import { EMPTY_CONVERSATION_CALL_TIMEOUT_MS } from './conversation-call-lifecycle';

export function useSoloCallTimeout({
  roomId,
  joined,
  joining,
  selfId,
  participantIds,
  connected,
  onTimeout,
}: {
  roomId?: string;
  joined: boolean;
  joining: boolean;
  selfId: string;
  participantIds: string[];
  connected: boolean;
  onTimeout(): void;
}) {
  const [alone, setAlone] = useState<{ roomId: string; since: number }>();
  const hasOther = participantIds.some((id) => id !== selfId);
  const latest = useRef({ joined, hasOther, onTimeout });
  latest.current = { joined, hasOther, onTimeout };
  useEffect(() => {
    if (!roomId || !joined || joining || hasOther) {
      setAlone(undefined);
      return;
    }
    setAlone((previous) =>
      previous?.roomId === roomId ? previous : { roomId, since: Date.now() },
    );
  }, [roomId, joined, joining, hasOther]);
  useEffect(() => {
    if (!roomId || !alone || alone.roomId !== roomId || !connected) return;
    const timer = window.setTimeout(
      () => {
        if (latest.current.joined && !latest.current.hasOther) latest.current.onTimeout();
      },
      Math.max(0, EMPTY_CONVERSATION_CALL_TIMEOUT_MS - (Date.now() - alone.since)),
    );
    return () => window.clearTimeout(timer);
  }, [roomId, alone, connected]);
}
