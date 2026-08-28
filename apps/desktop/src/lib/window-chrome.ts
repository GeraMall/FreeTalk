declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export function usesCustomWindowChrome() {
  return Boolean(window.__TAURI_INTERNALS__) && /Windows/i.test(navigator.userAgent);
}
