import { invoke } from '@tauri-apps/api/core';
import { emitTo, listen } from '@tauri-apps/api/event';
import { useEffect, useState } from 'react';
import { ChatNotificationStack, type ChatNotificationPreview } from './ChatNotificationStack';
import { chatNotificationOverlayEvents } from '../lib/chat-notification-overlay';

export function NotificationOverlay() {
  const [previews, setPreviews] = useState<ChatNotificationPreview[]>([]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<ChatNotificationPreview>(chatNotificationOverlayEvents.notification, (event) =>
      setPreviews((current) => [...current, event.payload].slice(-3)),
    ).then((dispose) => {
      if (disposed) dispose();
      else unlisten = dispose;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (previews.length > 0) return;
    void invoke('notification_overlay_hide');
  }, [previews.length]);

  const dismiss = (sequence: number) =>
    setPreviews((current) => current.filter((preview) => preview.sequence !== sequence));

  return (
    <main className="notification-overlay-shell">
      <ChatNotificationStack
        previews={previews}
        onDismiss={dismiss}
        onDismissAll={() => setPreviews([])}
        onOpen={(preview) => {
          void emitTo('main', chatNotificationOverlayEvents.open, { chatId: preview.chatId });
          setPreviews([]);
          void invoke('notification_overlay_open_main');
        }}
      />
    </main>
  );
}
