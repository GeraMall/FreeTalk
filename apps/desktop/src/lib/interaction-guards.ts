export function installInteractionGuards(target: Document = document) {
  const blockNativeContextMenu = (event: MouseEvent) => {
    event.preventDefault();
  };

  target.addEventListener('contextmenu', blockNativeContextMenu, { capture: true });

  return () => {
    target.removeEventListener('contextmenu', blockNativeContextMenu, { capture: true });
  };
}
