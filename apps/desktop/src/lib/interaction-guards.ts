export function installInteractionGuards(target: Document = document) {
  const usePointerFocus = () => {
    target.documentElement.dataset.focusInput = 'pointer';
  };
  const useKeyboardFocus = (event: KeyboardEvent) => {
    if (event.key === 'Tab') target.documentElement.dataset.focusInput = 'keyboard';
    else if (event.key === 'Escape') target.documentElement.dataset.focusInput = 'pointer';
  };
  const blockNativeContextMenu = (event: MouseEvent) => {
    const element = event.target instanceof Element ? event.target : null;
    if (element?.closest("input, textarea, [contenteditable='true']")) return;
    event.preventDefault();
  };

  target.addEventListener('contextmenu', blockNativeContextMenu, { capture: true });

  target.addEventListener('pointerdown', usePointerFocus, { capture: true });
  target.addEventListener('keydown', useKeyboardFocus, { capture: true });
  return () => {
    target.removeEventListener('pointerdown', usePointerFocus, { capture: true });
    target.removeEventListener('keydown', useKeyboardFocus, { capture: true });
    delete target.documentElement.dataset.focusInput;
    target.removeEventListener('contextmenu', blockNativeContextMenu, { capture: true });
  };
}
