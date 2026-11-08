import type { TableOf } from '@freetalk/protocol';
import { loadSettings } from './settings';

export type PokerSound =
  | 'shuffle'
  | 'deal'
  | 'flip'
  | 'check'
  | 'chips'
  | 'fold'
  | 'all-in'
  | 'collect'
  | 'win'
  | 'turn'
  | 'warning';
export type PokerSoundEvent = { key: string; sound: PokerSound; at: number };
const heard = new Set<string>();
const preferenceKey = 'trlka.poker.sounds';

export function pokerSoundsEnabled() {
  try {
    return localStorage.getItem(preferenceKey) !== 'off';
  } catch {
    return true;
  }
}
export function savePokerSoundsEnabled(enabled: boolean) {
  try {
    localStorage.setItem(preferenceKey, enabled ? 'on' : 'off');
  } catch {
    /* Memory-only in restricted browsers. */
  }
}
export function pokerDealSeats(table: TableOf<'poker'>) {
  const first = table.smallBlind ?? (table.dealer + 1) % table.seats.length;
  return Array.from(
    { length: table.seats.length },
    (_, i) => (first + i) % table.seats.length,
  ).filter((seat) => table.seats[seat] && !table.folded.includes(seat));
}
export function pokerDealDelay(table: TableOf<'poker'>, seat: number, card: number) {
  const seats = pokerDealSeats(table);
  return (
    780 +
    (card * seats.length + Math.max(0, seats.indexOf(seat))) *
      Math.min(105, 1200 / Math.max(1, seats.length * 2))
  );
}

/** Tracks accepted snapshots, never button clicks. Opening an old table is silent. */
export class PokerSoundTracker {
  private previous?: TableOf<'poker'>;
  private turn = '';
  private warned = '';
  update(table: TableOf<'poker'>, selfId: string | undefined, now: number): PokerSoundEvent[] {
    const old = this.previous?.id === table.id ? this.previous : undefined;
    const hand = `${table.id}:${table.handNumber}`;
    const events: PokerSoundEvent[] = [];
    const add = (suffix: string, sound: PokerSound, at = now) =>
      events.push({ key: `${hand}:${suffix}`, sound, at });
    const freshDeal =
      table.stage !== 'showdown' &&
      table.handStartedAt !== undefined &&
      now < table.handStartedAt + 2600;
    if ((!old || old.handNumber !== table.handNumber) && freshDeal) {
      const start = table.handStartedAt!;
      if (now - start < 400) add('shuffle', 'shuffle', start);
      for (const seat of pokerDealSeats(table))
        for (let card = 0; card < 2; card++) {
          const at = start + pokerDealDelay(table, seat, card);
          if (at >= now - 100) add(`deal:${seat}:${card}`, 'deal', at);
        }
    }
    if (old && old.handNumber === table.handNumber) {
      const action = table.lastAction;
      if (action && action.sequence !== old.lastAction?.sequence && now - action.at < 1500) {
        const sound =
          action.kind === 'check'
            ? 'check'
            : action.kind === 'fold' || action.kind === 'timeout'
              ? 'fold'
              : table.allIn.includes(action.seat) && !old.allIn.includes(action.seat)
                ? 'all-in'
                : 'chips';
        add(`action:${action.sequence}`, sound);
      }
      if (table.board.length > old.board.length)
        for (let i = old.board.length; i < table.board.length; i++)
          add(`board:${i}`, 'flip', now + (i - old.board.length) * 100);
      if (table.stage === 'showdown' && old.stage !== 'showdown') {
        const seat = table.seats.indexOf(selfId ?? '');
        add('collect', 'collect');
        if (seat >= 0 && table.payouts[seat]! > table.contributions[seat]!)
          add('win', 'win', now + 280);
      }
    }
    const turn = `${hand}:${table.turn}:${table.turnDeadline ?? ''}`;
    const ownTurn =
      table.stage !== 'showdown' &&
      table.seats[table.turn] === selfId &&
      now >= (table.turnAt ?? 0);
    if (turn !== this.turn) {
      if (old && ownTurn) add(`turn:${turn}`, 'turn');
      // Keep the pending deal turn unacknowledged until its animation finishes.
      if (!freshDeal) this.turn = turn;
    }
    if (
      ownTurn &&
      table.turnDeadline &&
      table.turnDeadline - now <= 5000 &&
      table.turnDeadline > now &&
      this.warned !== turn
    ) {
      if (old) add(`warning:${turn}`, 'warning');
      this.warned = turn;
    }
    this.previous = table;
    return events;
  }
}

/** Bounded local playback; no audio sent to the room and no new call tracks. */
export class PokerSounds {
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private active = new Set<HTMLAudioElement>();
  enabled = true;
  schedule(event: PokerSoundEvent) {
    if (heard.has(event.key)) return;
    heard.add(event.key);
    if (heard.size > 512) heard.delete(heard.values().next().value!);
    if (!this.enabled) return;
    const delay = Math.max(0, event.at - Date.now());
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (this.enabled) void this.play(event.sound);
    }, delay);
    this.timers.add(timer);
  }
  stop() {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    for (const audio of this.active) {
      audio.pause();
      audio.src = '';
    }
    this.active.clear();
  }
  private async play(sound: PokerSound) {
    const settings = loadSettings();
    if (!this.enabled || settings.outputVolume <= 0) return;
    if (this.active.size >= 6) return;
    const audio = new Audio(`/sounds/poker/${sound}.wav`);
    audio.preload = 'auto';
    audio.volume = Math.min(1, Math.max(0, settings.outputVolume)) * 0.65;
    this.active.add(audio);
    const release = () => {
      this.active.delete(audio);
    };
    audio.onended = release;
    audio.onerror = release;
    if (settings.outputDeviceId && 'setSinkId' in audio)
      await (audio as HTMLAudioElement & { setSinkId(id: string): Promise<void> })
        .setSinkId(settings.outputDeviceId)
        .catch(() => undefined);
    if (!this.enabled || !this.active.has(audio)) {
      release();
      return;
    }
    await audio.play().catch(release);
  }
}
