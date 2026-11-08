// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RoomActivity, TableOf } from '@freetalk/protocol';
import { PokerBoard } from './PokerBoard';
import { pokerVisibleBoard, pokerRevealing } from '../lib/poker-board';
import { PokerRulesPicker } from './PokerRulesPicker';
import { TableBotControls } from './TableBotControls';
import { ActivitySwitchVote } from './ActivitySwitchVote';
import { CallActivity } from './CallActivity';
import { PokerLobby } from './PokerLobby';
import { ActivityPoker } from './ActivityPoker';
vi.mock('../lib/app-language', () => ({ t: (text: string) => text }));
vi.mock('../lib/settings', () => ({
  loadSettings: () => ({ messageNotificationSound: false, outputVolume: 0.5 }),
}));
afterEach(cleanup);
const table = (): TableOf<'poker'> => ({
  id: 'table',
  kind: 'poker',
  edition: 3,
  pokerRules: 2,
  hostId: 'a',
  phase: 'playing',
  seats: ['a', 'b'],
  preset: 'standard',
  log: [],
  dealer: 0,
  turn: 1,
  stage: 'flop',
  board: ['Jh', 'Th', '9h'],
  boardAt: 10000,
  boardFrom: 0,
  pot: 40,
  bet: 0,
  minRaise: 20,
  stacks: [980, 980],
  bets: [0, 0],
  contributions: [20, 20],
  folded: [],
  allIn: [],
  acted: [],
  hands: [{ ownerId: 'a', cards: ['Ah', 'Kh'] }],
  payouts: [0, 0],
  handNumber: 1,
  turnAt: 12040,
  turnDeadline: 42040,
});
describe('staged poker rendering and shared controls', () => {
  it('highlights and focuses the missing age confirmation without starting; starts only after server confirmation and enough seats', () => {
    const send = vi.fn(),
      v = { ...table(), phase: 'lobby' as const, seats: ['a', null] };
    const screen = render(<PokerLobby table={v} selfId="a" participants={[]} send={send} />);
    fireEvent.click(screen.getByRole('button', { name: 'Начать игру' }));
    const age = screen.getByRole('checkbox', { name: /Подтверждаю/ });
    expect(age.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(age);
    expect(screen.getByRole('alert').textContent).toContain('Подтвердите возраст');
    expect(send).not.toHaveBeenCalled();
    screen.rerender(
      <PokerLobby table={{ ...v, ageConfirmed: true }} selfId="a" participants={[]} send={send} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Начать игру' }));
    expect(send).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('минимум два');
    screen.rerender(
      <PokerLobby
        table={{ ...v, ageConfirmed: true, seats: ['a', 'b'] }}
        selfId="a"
        participants={[]}
        send={send}
      />,
    );
    expect(age.getAttribute('aria-invalid')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Начать игру' }));
    expect(send).toHaveBeenCalledExactlyOnceWith({ kind: 'table-start' });
  });
  it('uses the joined participant avatar in the header and preserves the end-session action', () => {
    const end = vi.fn();
    const screen = render(
      <CallActivity
        activity={{ open: true, revision: 1, region: 'RU', table: table(), viewers: ['a'] }}
        selfId="a"
        participants={[{ id: 'a', name: 'Алексей', avatar: 'https://trlka.com/avatar.jpg' }]}
        onEnd={end}
      />,
    );
    expect(screen.getByLabelText('Участники планшета').querySelector('img')?.alt).toBe('Алексей');
    fireEvent.click(screen.getByRole('button', { name: 'Завершить для всех' }));
    expect(end).toHaveBeenCalledOnce();
  });
  it('routes the mobile tablet audio controls to the existing call handlers and reflects their shared state', () => {
    const mute = vi.fn(),
      deafen = vi.fn(),
      activity = { open: true, revision: 1, region: 'RU' as const, table: table() };
    const screen = render(
      <CallActivity
        activity={activity}
        selfId="a"
        onMute={mute}
        onDeafen={deafen}
        muted={false}
        deafened={false}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Выключить микрофон' }));
    fireEvent.click(screen.getByRole('button', { name: 'Выключить звук' }));
    expect(mute).toHaveBeenCalledOnce();
    expect(deafen).toHaveBeenCalledOnce();
    screen.rerender(
      <CallActivity
        activity={activity}
        selfId="a"
        onMute={mute}
        onDeafen={deafen}
        muted
        deafened
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Включить микрофон' }).getAttribute('aria-pressed'),
    ).toBe('false');
    expect(screen.getByRole('button', { name: 'Включить звук' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
  });
  it('shows the server automatic-deal countdown without a manual next button', () => {
    const now = Date.now(),
      v = {
        ...table(),
        pokerFlow: 2 as const,
        stage: 'showdown' as const,
        boardAt: undefined,
        handEndedAt: now - 1000,
        nextHandAt: now + 5000,
      };
    const screen = render(<ActivityPoker table={v} selfId="a" participants={[]} send={vi.fn()} />);
    expect(screen.getByText('Следующая раздача через')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Следующая раздача' })).toBeNull();
  });
  it('pauses betting during a break and submits only the stable break vote ID', () => {
    const now = Date.now(),
      send = vi.fn(),
      pause = {
        id: 'break-id',
        startedAt: now,
        endsAt: now + 300000,
        nextLevel: 1,
        electorate: ['a', 'b'],
        yes: [] as string[],
      };
    const v = {
      ...table(),
      pokerFlow: 2 as const,
      stage: 'showdown' as const,
      boardAt: undefined,
      handEndedAt: now - 1000,
      pokerBreak: pause,
    };
    const screen = render(<ActivityPoker table={v} selfId="a" participants={[]} send={send} />);
    expect(screen.queryByRole('region', { name: 'Ваше действие' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Пропустить перерыв' }));
    expect(send).toHaveBeenCalledExactlyOnceWith({ kind: 'poker-break-vote', breakId: 'break-id' });
    screen.rerender(
      <ActivityPoker
        table={{ ...v, pokerBreak: { ...pause, yes: ['a'] } }}
        selfId="a"
        participants={[]}
        send={send}
      />,
    );
    expect(
      (screen.getByRole('button', { name: 'Ваш голос принят' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
  it('opens the flop one card at a time and never restarts the first card when betting state changes', () => {
    const v = table();
    expect(pokerVisibleBoard(v, 10149)).toHaveLength(0);
    expect(pokerVisibleBoard(v, 10150)).toHaveLength(1);
    expect(pokerVisibleBoard(v, 10670)).toHaveLength(2);
    expect(pokerVisibleBoard(v, 11190)).toHaveLength(3);
    expect(pokerRevealing(v, 12039)).toBe(true);
    expect(pokerRevealing(v, 12040)).toBe(false);
    const screen = render(<PokerBoard table={v} now={10150} best={[]} dealing={false} />);
    const first = screen.getByLabelText('J ♥');
    expect(first.classList.contains('pkr-card-arrive')).toBe(true);
    screen.rerender(
      <PokerBoard
        table={{ ...v, lastAction: { seat: 0, kind: 'raise', amount: 40, sequence: 3, at: 10200 } }}
        now={10300}
        best={[]}
        dealing={false}
      />,
    );
    expect(screen.getByLabelText('J ♥')).toBe(first);
    expect(first.classList.contains('pkr-card-arrive')).toBe(true);
    screen.rerender(<PokerBoard table={v} now={13000} best={[]} dealing={false} />);
    expect(screen.getByLabelText('J ♥')).toBe(first);
    expect(first.classList.contains('pkr-card-arrive')).toBe(true);
  });
  it('sends explicit tournament, ante and organizer confirmation settings', () => {
    const send = vi.fn(),
      v = table();
    v.phase = 'lobby';
    const screen = render(<PokerRulesPicker table={v} host send={send} />);
    fireEvent.click(screen.getByRole('button', { name: /Турнир с повышением/ }));
    expect(send).toHaveBeenLastCalledWith({
      kind: 'poker-config',
      mode: 'tournament',
      ante: false,
      ageConfirmed: undefined,
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /Подтверждаю/ }));
    expect(send).toHaveBeenLastCalledWith({
      kind: 'poker-config',
      mode: 'classic',
      ante: false,
      ageConfirmed: true,
    });
  });
  it('offers a bot as a practice opponent, but only the organizer can add it', () => {
    const send = vi.fn(),
      v = table();
    v.phase = 'lobby';
    v.seats = ['a', null];
    const screen = render(<TableBotControls table={v} selfId="a" send={send} />);
    fireEvent.click(screen.getByRole('button', { name: 'Добавить бота' }));
    expect(send).toHaveBeenCalledWith({ kind: 'table-bot', seat: 1 });
    screen.rerender(<TableBotControls table={v} selfId="b" send={send} />);
    expect(screen.queryByRole('button', { name: 'Добавить бота' })).toBeNull();
  });
  it('lets a non-host return to the catalog and propose another game without replacing poker locally', () => {
    const send = vi.fn(),
      v = table();
    const screen = render(
      <CallActivity
        activity={{ open: true, revision: 1, region: 'RU', table: v, canPlayPoker: true }}
        selfId="b"
        participants={[]}
        onAction={send}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'К играм' }));
    fireEvent.click(screen.getByRole('button', { name: /^Шахматы$/ }));
    expect(send).toHaveBeenLastCalledWith({ kind: 'game-propose', game: 'chess' });
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'table-open' }));
  });
  it('shows a dismissible vote with an immutable vote ID and keeps minors out of poker', () => {
    const send = vi.fn();
    const activity: RoomActivity = {
      open: true,
      revision: 1,
      region: 'RU',
      switchVote: {
        id: 'vote',
        requestedBy: 'a',
        game: 'chess',
        from: 'poker',
        electorate: ['a', 'b', 'c'],
        yes: ['a'],
        no: [],
        deadline: Date.now() + 20000,
        state: 'voting',
      },
    };
    const screen = render(
      <ActivitySwitchVote
        activity={activity}
        selfId="b"
        participants={[]}
        send={send}
        deafened={false}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Перейти' }));
    expect(send).toHaveBeenCalledWith({ kind: 'game-vote', id: 'vote', accept: true });
    fireEvent.click(screen.getByRole('button', { name: 'Скрыть голосование' }));
    expect(screen.queryByLabelText('Голосование за смену игры')).toBeNull();
    screen.unmount();
    const lock = render(
      <CallActivity
        activity={{
          open: true,
          revision: 1,
          region: 'RU',
          canPlayPoker: false,
          restrictedGame: 'poker',
        }}
        selfId="b"
        onAction={send}
      />,
    );
    expect(lock.getByText('Покер доступен только с 18 лет')).toBeTruthy();
    expect(lock.queryByLabelText('Общие карты')).toBeNull();
    fireEvent.click(lock.getByRole('button', { name: 'Обновить доступ' }));
    expect(send).toHaveBeenLastCalledWith({ kind: 'game-access' });
  });
});
