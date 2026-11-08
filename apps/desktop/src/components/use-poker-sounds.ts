import { useEffect, useState } from 'react';
import type { TableOf } from '@freetalk/protocol';
import {
  PokerSounds,
  PokerSoundTracker,
  pokerSoundsEnabled,
  savePokerSoundsEnabled,
} from '../lib/poker-sounds';

export function usePokerSounds(
  table: TableOf<'poker'>,
  selfId: string | undefined,
  now: number,
  deafened: boolean,
) {
  const [enabled, setEnabled] = useState(pokerSoundsEnabled);
  const [player] = useState(() => new PokerSounds());
  const [tracker] = useState(() => new PokerSoundTracker());
  useEffect(() => {
    player.enabled = enabled && !deafened;
    if (!player.enabled) player.stop();
    for (const event of tracker.update(table, selfId, now)) player.schedule(event);
  }, [table, selfId, now, enabled, deafened, player, tracker]);
  useEffect(() => () => player.stop(), [player]);
  return {
    enabled,
    toggle: () => {
      savePokerSoundsEnabled(!enabled);
      setEnabled(!enabled);
    },
  };
}
