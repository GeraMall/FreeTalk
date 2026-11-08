// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { installInteractionGuards } from './interaction-guards';

describe('interaction guards', () => {
  it('keeps the native context menu only in editable fields, including room chats', () => {
    const cleanup = installInteractionGuards(document);
    const surface = document.createElement('div');
    const input = document.createElement('input');
    const chat = document.createElement('div');
    const message = document.createElement('p');
    chat.className = 'message-scroll-container';
    chat.append(message);
    document.body.append(surface, input, chat);
    const blocked = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });

    surface.dispatchEvent(blocked);
    expect(blocked.defaultPrevented).toBe(true);

    const inputMenu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    input.dispatchEvent(inputMenu);
    expect(inputMenu.defaultPrevented).toBe(false);

    const messageMenu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    message.dispatchEvent(messageMenu);
    expect(messageMenu.defaultPrevented).toBe(true);

    cleanup();
    const restored = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    surface.dispatchEvent(restored);
    expect(restored.defaultPrevented).toBe(false);
    surface.remove();
    input.remove();
    chat.remove();
  });

  it('switches focus styling between pointer clicks and Tab navigation', () => {
    const cleanup = installInteractionGuards(document);
    const root = document.documentElement;
    try {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
      expect(root.dataset.focusInput).toBe('keyboard');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(root.dataset.focusInput).toBe('pointer');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
      expect(root.dataset.focusInput).toBe('keyboard');

      document.dispatchEvent(new Event('pointerdown'));
      expect(root.dataset.focusInput).toBe('pointer');

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' }));
      expect(root.dataset.focusInput).toBe('pointer');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true }));
      expect(root.dataset.focusInput).toBe('keyboard');
    } finally {
      cleanup();
    }
    expect(root.dataset.focusInput).toBeUndefined();
  });
});
