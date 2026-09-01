// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { installInteractionGuards } from './interaction-guards';

describe('interaction guards', () => {
  it('blocks the native context menu everywhere and can be removed cleanly', () => {
    const cleanup = installInteractionGuards(document);
    const surface = document.createElement('div');
    document.body.append(surface);
    const blocked = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });

    surface.dispatchEvent(blocked);
    expect(blocked.defaultPrevented).toBe(true);

    cleanup();
    const restored = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    surface.dispatchEvent(restored);
    expect(restored.defaultPrevented).toBe(false);
    surface.remove();
  });
});
