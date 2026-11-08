import type { ActivityTable, Participant, RoomActivityAction } from '@freetalk/protocol';
import { t } from '../lib/app-language';
export type TableParticipant = Pick<Participant, 'id' | 'name' | 'avatar'> &
  Partial<Pick<Participant, 'muted' | 'deafened'>> & {
    speaking?: boolean;
    bot?: boolean;
    cameraStream?: MediaStream;
  };
export type TableUiProps<T extends ActivityTable = ActivityTable> = {
  table: T;
  selfId?: string;
  participants: TableParticipant[];
  send: (action: RoomActivityAction) => void;
};
export const playerName = (
  id: string | null | undefined,
  participants: TableUiProps['participants'],
) => {
  if (!id) return t('Свободное место');
  const person = participants.find((p) => p.id === id);
  if (!person) return t('Отключился');
  return person.bot ? `${t('Бот')} ${t(person.name.replace(/^Бот /u, ''))}` : person.name;
};
export const tableNames = {
  chess: 'Шахматы',
  fleet: 'Морской бой',
  monopoly: 'Монополия',
  millionaire: 'Кто хочет стать миллионером?',
  poker: 'Покер',
};
export const clockModes = [
  ['bullet', '1 + 0', 'Пуля'],
  ['bullet2', '2 + 1', 'Пуля'],
  ['blitz3', '3 + 0', 'Блиц'],
  ['blitz', '3 + 2', 'Блиц'],
  ['blitz5', '5 + 0', 'Блиц'],
  ['blitz5i', '5 + 3', 'Блиц'],
  ['rapid10', '10 + 0', 'Рапид'],
  ['rapid', '10 + 5', 'Рапид'],
  ['classical', '15 + 10', 'Классика'],
  ['unlimited', '∞', 'Без времени'],
] as const;
