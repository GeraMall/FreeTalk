// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { installInteractionGuards } from './interaction-guards';

describe('interaction guards', () => {
  it('keeps the native context menu in chats and text fields only', () => {
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
    expect(messageMenu.defaultPrevented).toBe(false);

    cleanup();
    const restored = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    surface.dispatchEvent(restored);
    expect(restored.defaultPrevented).toBe(false);
    surface.remove();
    input.remove();
    chat.remove();
  });
});
