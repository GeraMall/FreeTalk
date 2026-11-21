import type { UpdateStatus } from './updater';

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
    __FREETALK_CALL_PLACEHOLDER__?: boolean;
    trlkaLinuxDesktop?: {
      version: () => Promise<string>;
      updates: {
        check: () => Promise<UpdateStatus>;
        prepare: () => Promise<Extract<UpdateStatus, { kind: 'available' }>>;
        apply: () => Promise<void>;
        restart: () => Promise<void>;
        onProgress: (onProgress: (status: UpdateStatus) => void) => () => void;
      };
      session: {
        read: () => Promise<string | null>;
        save: (token: string) => Promise<void>;
        clear: () => Promise<void>;
      };
      notifications: {
        show: (preview: { chatId: string; senderName: string; body: string }) => Promise<boolean>;
        onOpen: (onOpen: (chatId: string) => void) => () => void;
      };
      invites: {
        pending: () => Promise<string | null>;
        onOpen: (onOpen: () => void) => () => void;
      };
    };
  }
}

export function usesCustomWindowChrome() {
  return Boolean(window.__TAURI_INTERNALS__) && /Windows/i.test(navigator.userAgent);
}

export function usesMacDesktop() {
  return (
    typeof window !== 'undefined' &&
    Boolean(window.__TAURI_INTERNALS__) &&
    /Macintosh|Mac OS X/i.test(navigator.userAgent)
  );
}
