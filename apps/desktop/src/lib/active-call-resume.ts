const ACTIVE_CALL_STORAGE_KEY = 'trlka.browser.active-call.v1';
const ACTIVE_CALL_MAX_AGE_MS = 24 * 60 * 60 * 1_000;

export interface BrowserActiveCall {
  roomId: string;
  chatId?: string;
  accountId: string;
  savedAt: number;
}

function isBrowserApp() {
  return typeof window !== 'undefined' && !('__TAURI_INTERNALS__' in window);
}

function isValidActiveCall(value: unknown): value is BrowserActiveCall {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<BrowserActiveCall>;
  return (
    typeof candidate.roomId === 'string' &&
    /^[A-Z0-9]{12}$/.test(candidate.roomId) &&
    typeof candidate.accountId === 'string' &&
    candidate.accountId.length > 0 &&
    typeof candidate.savedAt === 'number' &&
    Number.isFinite(candidate.savedAt) &&
    (candidate.chatId === undefined || typeof candidate.chatId === 'string')
  );
}

export function saveBrowserActiveCall(call: BrowserActiveCall) {
  if (!isBrowserApp()) return;
  localStorage.setItem(ACTIVE_CALL_STORAGE_KEY, JSON.stringify(call));
}

export function readBrowserActiveCall(
  accountId: string,
  now = Date.now(),
): BrowserActiveCall | undefined {
  if (!isBrowserApp()) return undefined;
  const raw = localStorage.getItem(ACTIVE_CALL_STORAGE_KEY);
  if (!raw) return undefined;
  try {
    const call: unknown = JSON.parse(raw);
    if (
      !isValidActiveCall(call) ||
      call.accountId !== accountId ||
      now - call.savedAt > ACTIVE_CALL_MAX_AGE_MS ||
      call.savedAt > now + 60_000
    ) {
      clearBrowserActiveCall();
      return undefined;
    }
    return call;
  } catch {
    clearBrowserActiveCall();
    return undefined;
  }
}

export function clearBrowserActiveCall() {
  if (!isBrowserApp()) return;
  localStorage.removeItem(ACTIVE_CALL_STORAGE_KEY);
}

