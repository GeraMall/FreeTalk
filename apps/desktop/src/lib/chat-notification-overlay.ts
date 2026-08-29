import type { UnlistenFn } from '@tauri-apps/api/event';
import type { ChatNotificationPreview } from '../components/ChatNotificationStack';

const NOTIFICATION_EVENT = 'freetalk://chat-notification';
const OPEN_EVENT = 'freetalk://chat-notification-open';

function isTauriDesktop() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function appIsInForeground() {
  if (!isTauriDesktop()) return true;
  return document.visibilityState === 'visible' && document.hasFocus();
}

export async function showChatNotificationOverlay(preview: ChatNotificationPreview) {
  if (!isTauriDesktop() || appIsInForeground()) return false;
  try {
    const [{ invoke }, { emitTo }] = await Promise.all([
      import('@tauri-apps/api/core'),
      import('@tauri-apps/api/event'),
    ]);
    await invoke('notification_overlay_show');
    await emitTo('notifications', NOTIFICATION_EVENT, preview);
    return true;
  } catch {
    return false;
  }
}

export async function listenForNotificationOpen(onOpen: (chatId: string) => void) {
  if (!isTauriDesktop()) return (() => undefined) satisfies UnlistenFn;
  const { listen } = await import('@tauri-apps/api/event');
  return listen<{ chatId: string }>(OPEN_EVENT, (event) => onOpen(event.payload.chatId));
}

export const chatNotificationOverlayEvents = {
  notification: NOTIFICATION_EVENT,
  open: OPEN_EVENT,
};
