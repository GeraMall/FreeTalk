// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TableOf } from '@freetalk/protocol';
import { ActivityPoker } from './ActivityPoker';
import { PokerAvatar } from './PokerVisuals';
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
