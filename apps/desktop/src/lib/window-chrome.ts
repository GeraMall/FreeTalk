declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
    __FREETALK_CALL_PLACEHOLDER__?: boolean;
  }
}

export function usesCustomWindowChrome() {
  return Boolean(window.__TAURI_INTERNALS__) && /Windows/i.test(navigator.userAgent);
}
