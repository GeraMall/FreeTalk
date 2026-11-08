import { useEffect, useRef, useState } from 'react';
import type { DiceGesture, TableOf } from '@freetalk/protocol';
import type { TableUiProps } from '../components/activity-table-ui';
import { subscribeActivityPointers } from './activity-pointers';
export function useSharedDice(
  table: TableOf<'monopoly'>,
  selfId: string | undefined,
  send: TableUiProps<TableOf<'monopoly'>>['send'],
) {
  const [remote, setRemote] = useState<
    DiceGesture & { participantId: string; receivedAt: number }
  >();
  const current = useRef(table);
  current.current = table;
  useEffect(() => {
    setRemote(undefined);
    const stop = subscribeActivityPointers((p) => {
      const v = current.current;
      if (
        !p.dice ||
        p.participantId === selfId ||
        p.surface !== `${v.id}:property` ||
        v.seats[v.turn] !== p.participantId ||
        v.phase !== 'playing' ||
        Date.now() < (v.lastMove?.until ?? 0)
      )
        return;
      setRemote((old) => {
        if (p.dice!.phase === 'cancel') return old?.id === p.dice!.id ? undefined : old;
        if (old?.id === p.dice!.id && old.seq >= p.dice!.seq) return old;
        return { ...p.dice!, participantId: p.participantId, receivedAt: Date.now() };
      });
    });
    const timer = setInterval(
      () => setRemote((old) => (old && Date.now() - old.receivedAt > 1000 ? undefined : old)),
      150,
    );
    return () => {
      stop();
      clearInterval(timer);
    };
  }, [table.id, selfId]);
  useEffect(() => {
    setRemote(undefined);
  }, [table.lastMove?.sequence, table.turn, table.phase]);
  return {
    remote,
    onGesture: (dice: DiceGesture) =>
      send({
        kind: 'tablet-pointer',
        surface: `${table.id}:property`,
        x: dice.poses[0].x,
        y: dice.poses[0].y,
        visible: false,
        dice,
      }),
  };
}
