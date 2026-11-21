import type { UnlistenFn } from '@tauri-apps/api/event';
import type { ChatNotificationPreview } from '../components/ChatNotificationStack';

const NOTIFICATION_EVENT = 'freetalk://chat-notification';
const OPEN_EVENT = 'freetalk://chat-notification-open';

function isTauriDesktop() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function appIsInForeground() {
  if (typeof window === 'undefined') return true;
  if (!isTauriDesktop() && !window.trlkaLinuxDesktop) return true;
  return document.visibilityState === 'visible' && document.hasFocus();
}

export async function showChatNotificationOverlay(preview: ChatNotificationPreview) {
  if (appIsInForeground()) return false;
  try {
    if (window.trlkaLinuxDesktop) {
      const { chatId, senderName, body } = preview;
      return await window.trlkaLinuxDesktop.notifications.show({ chatId, senderName, body });
    }
    if (!isTauriDesktop()) return false;
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
  if (typeof window === 'undefined') return (() => undefined) satisfies UnlistenFn;
  if (window.trlkaLinuxDesktop) return window.trlkaLinuxDesktop.notifications.onOpen(onOpen);
  if (!isTauriDesktop()) return (() => undefined) satisfies UnlistenFn;
  const { listen } = await import('@tauri-apps/api/event');
  return listen<{ chatId: string }>(OPEN_EVENT, (event) => onOpen(event.payload.chatId));
}

export const chatNotificationOverlayEvents = {
  notification: NOTIFICATION_EVENT,
  open: OPEN_EVENT,
};
