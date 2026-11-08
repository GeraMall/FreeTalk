import { useEffect, useState } from 'react';
import { CHAT_INTERACTION_EVENT, type TypingEvent } from '../lib/chat-interactions';
import { t } from '../lib/app-language';
import './chat-interactions.css';
export function TypingIndicator({ scope, selfId }: { scope?: string; selfId?: string }) {
  const [people, setPeople] = useState<TypingEvent[]>([]),
    [at, setAt] = useState(0),
    [leaving, setLeaving] = useState(false);
  useEffect(() => {
    setPeople([]);
    setAt(0);
    if (!scope) return;
    const update = (event: Event) => {
      const item = (event as CustomEvent<TypingEvent>).detail;
      if (item.type !== 'chat-typing' || item.chatId !== scope || item.userId === selfId) return;
      setPeople((old) =>
        [
          ...old.filter((p) => p.userId !== item.userId),
          ...(item.expiresAt > Date.now() ? [item] : []),
        ].sort((a, b) => a.userId.localeCompare(b.userId)),
      );
    };
    window.addEventListener(CHAT_INTERACTION_EVENT, update);
    const expiry = setInterval(
      () =>
        setPeople((old) =>
          old.some((p) => p.expiresAt <= Date.now())
            ? old.filter((p) => p.expiresAt > Date.now())
            : old,
        ),
      250,
    );
    return () => {
      window.removeEventListener(CHAT_INTERACTION_EVENT, update);
      clearInterval(expiry);
    };
  }, [scope, selfId]);
  const [display, setDisplay] = useState<TypingEvent[]>([]);
  useEffect(() => {
    if (people.length) {
      setDisplay(people);
      setLeaving(false);
      return;
    }
    setLeaving(true);
    const id = setTimeout(() => setDisplay([]), 220);
    return () => clearTimeout(id);
  }, [people]);
  useEffect(() => {
    if (people.length < 3) return;
    const id = setInterval(() => setAt((n) => n + 1), 2600);
    return () => clearInterval(id);
  }, [people.length]);
  const currentDisplay = display.filter((p) => p.chatId === scope);
  const selected =
    currentDisplay.length <= 2
      ? currentDisplay
      : currentDisplay
          .slice(at % currentDisplay.length)
          .concat(currentDisplay)
          .slice(0, 2);
  return (
    <div
      className={`chat-typing-slot${currentDisplay.length ? ' is-visible' : ''}${leaving ? ' leaving' : ''}`}
      aria-live="polite"
      aria-atomic="true"
    >
      {currentDisplay.length > 0 && (
        <span className="chat-typing-text" key={selected.map((p) => p.userId).join(',')}>
          <span className="chat-typing-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>
            {selected.length === 1
              ? t('{name} печатает…', { name: selected[0]!.name })
              : t('{names} печатают…', { names: selected.map((p) => p.name).join(', ') })}
            {currentDisplay.length > 2 ? ` +${currentDisplay.length - 2}` : ''}
          </span>
        </span>
      )}
    </div>
  );
}
