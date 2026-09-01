export function installInteractionGuards(target: Document = document) {
  const blockNativeContextMenu = (event: MouseEvent) => {
    const element = event.target instanceof Element ? event.target : null;
    if (
      element?.closest(
        "input, textarea, [contenteditable='true'], .message-scroll-container, .room-chat-messages",
      )
    )
      return;
    event.preventDefault();
  };

  target.addEventListener('contextmenu', blockNativeContextMenu, { capture: true });

  return () => {
    target.removeEventListener('contextmenu', blockNativeContextMenu, { capture: true });
  };
}
