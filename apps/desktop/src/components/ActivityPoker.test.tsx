// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TableOf } from '@freetalk/protocol';
import { ActivityPoker } from './ActivityPoker';
import { PokerAvatar, PokerCard } from './PokerVisuals';
vi.mock('../lib/app-language', () => ({ t: (value: string) => value }));
afterEach(cleanup);
const seats = ['a', 'b', 'c', 'd'];
const table = (): TableOf<'poker'> => ({
  id: 'poker',
  kind: 'poker',
  hostId: 'a',
  phase: 'playing',
  seats,
  preset: 'standard',
  log: [],
  dealer: 3,
  turn: 0,
  stage: 'preflop',
  board: [],
  pot: 30,
  bet: 20,
  minRaise: 20,
  stacks: [1000, 990, 980, 1000],
  bets: [0, 10, 20, 0],
  contributions: [0, 10, 20, 0],
  folded: [],
  allIn: [],
  acted: [],
  hands: [],
  payouts: [0, 0, 0, 0],
  handNumber: 1,
});
describe('poker raise controls', () => {
  it('keeps the turn ring and betting controls while showing actions only inside the avatar', () => {
    vi.spyOn(Date, 'now').mockReturnValue(10000);
    const state = {
      ...table(),
      turnDeadline: 40000,
      lastAction: { seat: 1, kind: 'check' as const, amount: 0, at: 10000, sequence: 1 },
    };
    const screen = render(
      <ActivityPoker table={state} selfId="a" participants={[]} send={vi.fn()} />,
    );
    expect(screen.container.querySelector('.pkr-time-ring')).toBeTruthy();
    expect(screen.container.querySelector('.pkr-seat-clock')).toBeNull();
    expect(screen.container.querySelector('.pkr-action-bubble')).toBeNull();
    expect(screen.container.querySelector('.pkr-avatar .pkr-feedback-layer')?.textContent).toBe(
      'Чек',
    );
    expect(screen.getByRole('button', { name: 'Пас' })).toBeTruthy();
    screen.rerender(
      <ActivityPoker
        table={{ ...state, lastAction: { ...state.lastAction, at: 7000 } }}
        selfId="a"
        participants={[]}
        send={vi.fn()}
      />,
    );
    expect(screen.container.querySelector('.pkr-feedback-layer')).toBeNull();
    vi.restoreAllMocks();
  });
  it('lets each avatar finish its fade when the next player acts instead of abruptly removing it', () => {
    vi.spyOn(Date, 'now').mockReturnValue(10000);
    const state = {
      ...table(),
      lastAction: { seat: 1, kind: 'check' as const, amount: 0, at: 10000, sequence: 1 },
    };
    const screen = render(
      <ActivityPoker table={state} selfId="a" participants={[]} send={vi.fn()} />,
    );
    const first = screen.container.querySelector('.pkr-feedback-layer');
    screen.rerender(
      <ActivityPoker
        table={{
          ...state,
          lastAction: { ...state.lastAction, seat: 2, kind: 'fold', sequence: 2 },
        }}
        selfId="a"
        participants={[]}
        send={vi.fn()}
      />,
    );
    expect(screen.container.querySelectorAll('.pkr-feedback-layer')).toHaveLength(2);
    expect(screen.container.querySelector('.pkr-feedback-layer')).toBe(first);
    vi.restoreAllMocks();
  });
  it('seeks a late action fade and keeps its animation clock across ordinary rerenders', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1500),
      feedback = { kind: 'check', label: 'Чек', key: '1', at: 1000 };
    const screen = render(<PokerAvatar feedback={feedback} moving={false} self={false} />);
    const layer = screen.container.querySelector<HTMLElement>('.pkr-feedback-layer')!;
    expect(layer.style.animationDelay).toBe('-500ms');
    clock.mockReturnValue(1700);
    screen.rerender(<PokerAvatar feedback={{ ...feedback }} moving={false} self={false} />);
    expect(screen.container.querySelector('.pkr-feedback-layer')).toBe(layer);
    expect(layer.style.animationDelay).toBe('-500ms');
    vi.restoreAllMocks();
  });
  it('uses the same vector suit in both mirrored corners and the middle, including tens', () => {
    const screen = render(<PokerCard value="Th" />);
    const paths = [...screen.container.querySelectorAll('path')].map((p) => p.getAttribute('d'));
    expect(paths).toHaveLength(3);
    expect(new Set(paths).size).toBe(1);
    expect(screen.container.querySelector('b')!.textContent).toBe('10');
    expect(screen.container.querySelector('i')!.textContent).toBe('10');
  });
  it('renders all eight players and retains an independent sound switch', () => {
    localStorage.removeItem('trlka.poker.sounds');
    const state = table();
    state.seats = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const screen = render(
      <ActivityPoker
        table={state}
        selfId="a"
        participants={state.seats.map((id) => ({ id: id!, name: id! }))}
        send={vi.fn()}
      />,
    );
    expect(screen.container.querySelectorAll('[data-seat]')).toHaveLength(8);
    fireEvent.click(screen.getByRole('button', { name: 'Выключить звуки покера' }));
    expect(screen.getByRole('button', { name: 'Включить звуки покера' })).toBeTruthy();
    expect(localStorage.getItem('trlka.poker.sounds')).toBe('off');
    localStorage.removeItem('trlka.poker.sounds');
  });
  it('reuses an active camera without playing audio or stopping the call track', () => {
    const stop = vi.fn(),
      stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const screen = render(
      <PokerAvatar
        person={{ id: 'a', name: 'Алексей', cameraStream: stream, muted: true }}
        moving={false}
        self={false}
      />,
    );
    const video = screen.container.querySelector('video')!;
    expect(video.srcObject).toBe(stream);
    expect(video.muted).toBe(true);
    expect(screen.getByLabelText('Микрофон выключен')).toBeTruthy();
    screen.unmount();
    expect(video.srcObject).toBeNull();
    expect(stop).not.toHaveBeenCalled();
    play.mockRestore();
  });
  it('keeps the combination reference and table statistics accessible to spectators without sending actions', () => {
    const send = vi.fn(),
      state = table();
    state.pokerRules = 2;
    state.stats = state.seats.map(() => ({ hands: 4, wins: 1, won: 80, lost: 40 }));
    const screen = render(
      <ActivityPoker table={state} selfId="watcher" participants={[]} send={send} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Комбинации' }));
    expect(screen.getByRole('complementary', { name: 'Комбинации покера' })).toBeTruthy();
    expect(screen.getByText('Флеш-рояль')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Статистика стола' }));
    expect(screen.getAllByText('25%')).toHaveLength(4);
    expect(send).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('complementary')).toBeNull();
  });
  it('offers an exact rebuy only between hands and shows the three-rebuy limit', () => {
    const send = vi.fn(),
      state = table();
    state.pokerRules = 2;
    state.stage = 'showdown';
    state.stacks[0] = 0;
    state.rebuys = [2, 0, 0, 0];
    const screen = render(<ActivityPoker table={state} selfId="a" participants={[]} send={send} />);
    fireEvent.click(screen.getByRole('button', { name: /Докупиться/ }));
    expect(send).toHaveBeenCalledExactlyOnceWith({ kind: 'poker-rebuy' });
    screen.rerender(
      <ActivityPoker
        table={{ ...state, rebuys: [3, 0, 0, 0] }}
        selfId="a"
        participants={[]}
        send={send}
      />,
    );
    expect(
      (screen.getByRole('button', { name: 'Лимит докупок' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
  it('allows clearing and typing the amount without clamping each keystroke', () => {
    const send = vi.fn();
    const screen = render(
      <ActivityPoker table={table()} selfId="a" participants={[]} send={send} />,
    );
    const input = screen.getByRole('spinbutton') as HTMLInputElement;
    for (const value of ['', '1', '10', '100']) {
      fireEvent.change(input, { target: { value } });
      expect(input.value).toBe(value);
    }
    fireEvent.click(screen.getByRole('button', { name: 'Повысить до 100' }));
    expect(send).toHaveBeenCalledExactlyOnceWith({
      kind: 'poker-bet',
      action: 'raise',
      amount: 100,
    });
  });
  it('enables a legally reopened raise and prevents invalid or fractional amounts', () => {
    const send = vi.fn(),
      state = table();
    Object.assign(state, { bet: 10, minRaise: 20, acted: [0], actedBets: [0, null, null, null] });
    const screen = render(<ActivityPoker table={state} selfId="a" participants={[]} send={send} />);
    const button = screen.getByRole('button', { name: 'Повысить до 30' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '30.5' } });
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(send).not.toHaveBeenCalled();
  });
});
