import { useEffect, useState, type RefObject } from 'react';
import { MousePointer2 } from 'lucide-react';
import type { Participant } from '@freetalk/protocol';
import { subscribeActivityPointers, type ActivityPointer } from '../lib/activity-pointers';
const colors = ['#9dbdf2', '#d8b17f', '#91d3bd', '#bdacf3', '#e29eaf', '#85cbd9', '#d5cf8f'];
export function ActivityPointers({
  root,
  surfaceId,
  selfId,
  participants,
  disabled,
}: {
  root: RefObject<HTMLElement | null>;
  surfaceId: string;
  selfId?: string;
  participants: Pick<Participant, 'id' | 'name'>[];
  disabled?: boolean;
}) {
  const [pointers, setPointers] = useState<Record<string, ActivityPointer & { at: number }>>({});
  useEffect(() => {
    setPointers({});
    if (disabled) return;
    const stop = subscribeActivityPointers((pointer) => {
      if (pointer.participantId === selfId || !pointer.surface.startsWith(surfaceId + ':')) return;
      setPointers((old) => {
        const next = { ...old };
        if (pointer.visible) next[pointer.participantId] = { ...pointer, at: Date.now() };
        else delete next[pointer.participantId];
        return next;
      });
    });
    const timer = setInterval(
      () =>
        setPointers((old) => {
          const entries = Object.entries(old).filter(([, p]) => Date.now() - p.at < 4000);
          return entries.length === Object.keys(old).length ? old : Object.fromEntries(entries);
        }),
      1000,
    );
    return () => {
      stop();
      clearInterval(timer);
    };
  }, [disabled, selfId, surfaceId]);
  if (disabled) return null;
  return (
    <div className="activity-cursors" aria-hidden="true">
      {Object.values(pointers).map((pointer) => {
        const part = participants.find((p) => p.id === pointer.participantId);
        if (!part || !root.current) return null;
        const anchorName = pointer.surface.split(':')[1];
        if (!['tablet', 'catalog', 'chess', 'quiz', 'property'].includes(anchorName ?? ''))
          return null;
        const anchor = root.current.querySelector<HTMLElement>(
          `[data-activity-surface="${anchorName}"]`,
        );
        if (!anchor) return null;
        const rect = anchor.getBoundingClientRect(),
          parent = root.current.getBoundingClientRect();
        const hash = [...pointer.participantId].reduce((a, c) => a + c.charCodeAt(0), 0),
          color = colors[hash % colors.length];
        return (
          <div
            key={part.id}
            className="activity-cursor"
            style={{
              left: rect.left - parent.left + pointer.x * rect.width,
              top: rect.top - parent.top + pointer.y * rect.height,
              color,
            }}
          >
            <MousePointer2 size={20} fill="currentColor" />
            <span style={{ background: color }}>{part.name}</span>
          </div>
        );
      })}
    </div>
  );
}
