// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TableOf } from '@freetalk/protocol';
import { ActivityProperty } from './ActivityProperty';
import { PropertyDeed } from './PropertyCards';
import { PropertyDice } from './PropertyDice';
import { PropertyLobby } from './PropertyLobby';
vi.mock('../lib/app-language', () => ({ t: (v: string) => v }));
vi.mock('../lib/monopoly-sounds', () => ({
  MonopolySounds: class {
    enabled = true;
    play = vi.fn();
    stop = vi.fn();
    stopDice = vi.fn();
  },
}));
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function table(): TableOf<'monopoly'> {
  return {
    id: 'city',
    kind: 'monopoly',
    propertyRules: 2,
    edition: 3,
    hostId: 'a',
    phase: 'playing',
    seats: ['a', 'b', null, null, null, null],
    preset: 'standard',
    log: [],
    turn: 0,
    positions: [0, 0],
    money: [1500, 1500],
    jail: [0, 0],
    owners: Array(40).fill(-1),
    houses: Array(40).fill(0),
    mortgaged: [],
    bankrupt: [],
    step: 'roll',
    dice: [1, 2],
    doubles: 0,
    extraRoll: false,
    debtTo: -1,
  };
}
describe('monopoly table controls', () => {
  it('clears a rejected throw spinner when the server resends the unchanged table', () => {
    const initial = table(),
      send = vi.fn();
    const page = render(
      <ActivityProperty table={initial} selfId="a" participants={[]} send={send} />,
    );
    fireEvent.click(page.getByRole('button', { name: 'Бросить кубики' }));
    expect(page.getByRole('button', { name: 'Бросаем…' }).hasAttribute('disabled')).toBe(true);
    page.rerender(
      <ActivityProperty table={{ ...initial }} selfId="a" participants={[]} send={send} />,
    );
    expect(page.getByRole('button', { name: 'Бросить кубики' }).hasAttribute('disabled')).toBe(
      false,
    );
  });
  it('sends one automatic shared shake before a button throw', () => {
    const send = vi.fn();
    const page = render(
      <ActivityProperty table={table()} selfId="a" participants={[]} send={send} />,
    );
    fireEvent.click(page.getByRole('button', { name: 'Бросить кубики' }));
    expect(send.mock.calls.map(([action]) => action.kind)).toEqual([
      'tablet-pointer',
      'tablet-pointer',
      'property',
    ]);
    expect(send.mock.calls[0]![0].dice).toMatchObject({ phase: 'hold', automatic: true, seq: 1 });
    expect(send.mock.calls[1]![0].dice).toMatchObject({
      phase: 'release',
      automatic: true,
      seq: 2,
    });
    expect(send.mock.calls[0]![0].dice.id).toBe(send.mock.calls[1]![0].dice.id);
    fireEvent.click(page.getByRole('button', { name: 'Бросаем…' }));
    expect(send).toHaveBeenCalledTimes(3);
  });
  it('shows all title deeds and routes property management without changing the camera stream', () => {
    const v = table(),
      send = vi.fn();
    v.owners[1] = v.owners[3] = 0;
    const screen = render(
      <PropertyDeed
        table={v}
        selfId="a"
        participants={[]}
        send={send}
        index={1}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('250 ¤')).toBeTruthy();
    expect(screen.getByText('33 ¤')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Построить дом' }));
    expect(send).toHaveBeenCalledWith({ kind: 'property', action: 'build', index: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Заложить' }));
    expect(send).toHaveBeenCalledWith({ kind: 'property', action: 'mortgage', index: 1 });
  });
  it('opens a street for spectators and offers winner restart and a local return to games', () => {
    const v = table(),
      send = vi.fn(),
      exit = vi.fn();
    const screen = render(
      <ActivityProperty table={v} selfId="watcher" participants={[]} send={send} />,
    );
    fireEvent.click(screen.container.querySelectorAll('.mono-cell')[3]!);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('450 ¤')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Заложить' })).toBeNull();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    screen.rerender(
      <ActivityProperty
        table={{ ...v, phase: 'finished', winner: 'a' }}
        selfId="a"
        participants={[{ id: 'a', name: 'Герман', avatar: '/a.png' }]}
        send={send}
        onExit={exit}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Новая партия' }));
    expect(send).toHaveBeenCalledExactlyOnceWith({ kind: 'table-reset' });
    fireEvent.click(screen.getByRole('button', { name: 'К играм' }));
    expect(exit).toHaveBeenCalledOnce();
  });
  it('lets the host remove a training bot from its seat in the compact lobby', () => {
    const v = { ...table(), phase: 'lobby' as const, bots: [{ id: 'b', name: 'Бот Орион' }] },
      send = vi.fn();
    const screen = render(<PropertyLobby table={v} selfId="a" participants={[]} send={send} />);
    fireEvent.click(screen.getByRole('button', { name: 'Убрать Бот Орион' }));
    expect(send).toHaveBeenCalledWith({ kind: 'table-bot', remove: true, seat: 1 });
  });
  it('does not submit a cancelled dice gesture, duplicates or a blocked throw', () => {
    vi.stubGlobal('PointerEvent', MouseEvent);
    const send = vi.fn(),
      shake = vi.fn(),
      screen = render(
        <PropertyDice
          dice={[2, 5]}
          sequence={0}
          rolling={false}
          canRoll
          onRoll={send}
          onShake={shake}
        />,
      );
    const tray = screen.getByRole('button');
    tray.setPointerCapture = vi.fn();
    fireEvent.pointerDown(tray, { button: 0, clientX: 50, clientY: 50 });
    fireEvent.pointerMove(tray, { clientX: 70, clientY: 70 });
    fireEvent.pointerCancel(tray);
    expect(send).not.toHaveBeenCalled();
    expect(shake).toHaveBeenCalledOnce();
    fireEvent.pointerDown(tray, { button: 0 });
    fireEvent.pointerUp(tray);
    fireEvent.pointerUp(tray);
    expect(send).toHaveBeenCalledOnce();
    fireEvent.click(tray, { detail: 0 });
    expect(send).toHaveBeenCalledTimes(2);
    screen.rerender(
      <PropertyDice
        dice={[2, 5]}
        sequence={1}
        rolling
        canRoll={false}
        onRoll={send}
        onShake={shake}
      />,
    );
    fireEvent.pointerDown(tray, { button: 0 });
    fireEvent.pointerUp(tray);
    fireEvent.click(tray, { detail: 0 });
    expect(send).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });
});
