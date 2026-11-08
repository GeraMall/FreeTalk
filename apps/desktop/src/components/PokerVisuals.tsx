import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { MicOff, HeadphoneOff, Spade, Bot } from 'lucide-react';
import { CachedMediaImage } from './CachedMedia';
import { t } from '../lib/app-language';
import type { TableParticipant } from './activity-table-ui';

const suits: Record<string, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };
export function PokerTableMarker({
  label,
  description,
  dealer = false,
}: {
  label: string;
  description: string;
  dealer?: boolean;
}) {
  const [point, setPoint] = useState<{ left: number; top: number }>();
  const root = useRef<HTMLSpanElement>(null),
    id = useId();
  useEffect(() => {
    if (!point) return;
    const close = () => setPoint(undefined);
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) close();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', key);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', key);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [point]);
  return (
    <span className="pkr-marker" ref={root}>
      <button
        type="button"
        className={
          dealer
            ? 'pkr-dealer'
            : `pkr-blind ${label === 'BB' ? 'pkr-blind-big' : 'pkr-blind-small'}`
        }
        aria-label={description}
        title={description}
        aria-expanded={Boolean(point)}
        aria-describedby={point ? id : undefined}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setPoint(
            point
              ? undefined
              : {
                  left: Math.max(8, Math.min(window.innerWidth - 198, rect.left - 65)),
                  top: Math.max(8, Math.min(window.innerHeight - 72, rect.bottom + 8)),
                },
          );
        }}
      >
        {label}
      </button>
      {point &&
        createPortal(
          <span id={id} role="tooltip" className="pkr-marker-tip" style={point}>
            {description}
          </span>,
          document.body,
        )}
    </span>
  );
}
const suitPaths: Record<string, string> = {
  h: 'M12 21C10 18 2 13 2 7.5A5.5 5.5 0 0 1 12 4.3 5.5 5.5 0 0 1 22 7.5C22 13 14 18 12 21Z',
  d: 'M12 1 22 12 12 23 2 12Z',
  s: 'M12 1C9 5 2 9 2 14a5 5 0 0 0 8.3 3.8L8.5 23h7l-1.8-5.2A5 5 0 0 0 22 14C22 9 15 5 12 1Z',
  c: 'M10 16C6 21 1 18 1 14a5 5 0 0 1 6-5A5.5 5.5 0 1 1 17 9a5 5 0 0 1 6 5c0 4-5 7-9 2l2 7H8Z',
};
function CardSuit({ suit }: { suit: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="pkr-suit">
      <path d={suitPaths[suit]} />
    </svg>
  );
}
export function PokerCard({
  value,
  highlight = false,
  delay = 0,
  animate = false,
  fromDeck,
}: {
  value?: string;
  highlight?: boolean;
  delay?: number;
  animate?: boolean;
  fromDeck?: number;
}) {
  // Only a newly mounted card can enter. Betting snapshots must not restart opacity/flight.
  const [entry] = useState(() => ({ animate, delay }));
  return (
    <span
      className={`pkr-card ${value ? `pkr-suit-${value[1]}` : 'pkr-card-back'} ${highlight ? 'pkr-card-best' : ''} ${entry.animate ? 'pkr-card-arrive' : ''} ${fromDeck !== undefined ? 'pkr-from-deck' : ''}`}
      style={
        { '--card-delay': `${entry.delay}ms`, '--board-index': fromDeck ?? 0 } as CSSProperties
      }
      aria-label={
        value ? `${value[0] === 'T' ? '10' : value[0]} ${suits[value[1]!]}` : t('Закрытая карта')
      }
    >
      {value ? (
        <>
          <b>
            {value[0] === 'T' ? '10' : value[0]}
            <small>
              <CardSuit suit={value[1]!} />
            </small>
          </b>
          <span aria-hidden="true">
            <CardSuit suit={value[1]!} />
          </span>
          <i aria-hidden="true">
            {value[0] === 'T' ? '10' : value[0]}
            <small>
              <CardSuit suit={value[1]!} />
            </small>
          </i>
        </>
      ) : (
        <>
          <Spade />
          <small>TRLKA</small>
        </>
      )}
    </span>
  );
}
export function PokerChips({ amount, compact = false }: { amount: number; compact?: boolean }) {
  let rest = amount;
  const piles = [500, 100, 25, 5, 1].flatMap((value, i) => {
    const count = Math.floor(rest / value);
    rest %= value;
    return count ? [{ value, count, color: i }] : [];
  });
  return (
    <span
      className={`pkr-chips ${compact ? 'pkr-chips-compact' : ''}`}
      aria-label={`${amount} ${t('фишек')}`}
    >
      {piles.slice(0, compact ? 2 : 4).map((p) => (
        <span
          className={`pkr-chip-pile pkr-chip-color-${p.color}`}
          key={p.value}
          style={{ height: `${8 + Math.min(p.count, 6) * 3}px` }}
        >
          {Array.from({ length: Math.min(p.count, 6) }, (_, i) => (
            <i key={i} style={{ bottom: `${i * 3}px` }}>
              <b>{p.value}</b>
            </i>
          ))}
        </span>
      ))}
    </span>
  );
}
export function PokerAvatar({
  person,
  seconds,
  moving,
  self,
}: {
  person?: TableParticipant;
  seconds?: number;
  moving: boolean;
  self: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video || !person?.cameraStream) return;
    video.srcObject = person.cameraStream;
    void video.play().catch(() => {});
    return () => {
      video.srcObject = null;
    };
  }, [person?.cameraStream]);
  const speaking = person?.speaking && !person.muted && !person.deafened;
  return (
    <div className={`pkr-avatar ${speaking ? 'pkr-speaking' : ''} ${moving ? 'pkr-acting' : ''}`}>
      {person?.bot ? (
        <Bot size={25} />
      ) : person?.cameraStream ? (
        <video ref={ref} autoPlay playsInline muted className={self ? 'pkr-self-video' : ''} />
      ) : person?.avatar ? (
        <CachedMediaImage src={person.avatar} alt="" />
      ) : (
        <span>{person?.name.slice(0, 2) ?? '?'}</span>
      )}
      {moving && (
        <svg className="pkr-time-ring" viewBox="0 0 72 72" aria-hidden="true">
          <circle cx="36" cy="36" r="33" />
          <circle
            cx="36"
            cy="36"
            r="33"
            style={{ strokeDashoffset: 207.35 * (1 - (seconds ?? 30) / 30) }}
          />
        </svg>
      )}
      <span
        className={`pkr-voice ${person?.muted || person?.deafened ? 'pkr-muted' : ''}`}
        aria-label={t(
          person?.deafened
            ? 'Звук выключен'
            : person?.muted
              ? 'Микрофон выключен'
              : speaking
                ? 'Говорит'
                : 'Слушает',
        )}
      >
        {person?.deafened ? (
          <HeadphoneOff size={12} />
        ) : person?.muted ? (
          <MicOff size={12} />
        ) : (
          <>
            <i />
            <i />
            <i />
          </>
        )}
      </span>
    </div>
  );
}
