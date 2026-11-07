import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/browser';
import { invoke } from '@tauri-apps/api/core';
import { dataUrlToBlob } from './profile';

const API_URL = (import.meta.env.VITE_API_URL || 'http://127.0.0.1:8790').replace(/\/$/, '');

export function protectedGifAssetId(sourceUrl: string) {
  try {
    const source = new URL(sourceUrl),
      base = new URL(`${API_URL}/`);
    if (
      source.origin !== base.origin ||
      (source.search && source.search !== '?variant=thumbnail') ||
      source.hash ||
      source.username ||
      source.password
    )
      return undefined;
    const prefix = `${base.pathname}v1/gifs/assets/`;
    if (!source.pathname.startsWith(prefix)) return undefined;
    const id = source.pathname.slice(prefix.length);
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
      ? id
      : undefined;
  } catch {
    return undefined;
  }
}

export function accountRealtimeUrl() {
  const url = new URL(`${API_URL}/v1/chats/realtime`);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

export interface AccountUser {
  id: string;
  email: string;
  username: string;
  displayName: string;
  emailVerified: boolean;
  canAccessStore?: boolean;
  avatarUrl: string | null;
  coverUrl?: string | null;
  bio?: string | null;
  registeredAt: string;
}

/** Reserved frontend contract for phone binding once the account API supports it. */
export interface AccountPhoneBinding {
  phoneNumber: string | null;
  verified: boolean;
}

export interface AccountSession {
  id: string;
  current: boolean;
  userAgent: string;
  createdAt: string;
  lastActiveAt: string;
  expiresAt: string;
}

export interface BrowserPushSubscription {
  endpoint: string;
  expirationTime?: number | null;
  keys: { p256dh: string; auth: string };
}

interface SessionPayload {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
}

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const BROWSER_REFRESH_TOKEN_KEY = 'trlka.browser.refresh-token';
let refreshInFlight: Promise<void> | undefined;
let restoreInFlight: Promise<AccountUser | null> | undefined;

function isTauri() {
  return '__TAURI_INTERNALS__' in window;
}

async function storeRefreshToken(token?: string) {
  if (isTauri()) {
    if (token) await invoke('secure_session_set', { refreshToken: token });
    else await invoke('secure_session_clear');
  } else {
    try {
      if (token) {
        window.localStorage.setItem(BROWSER_REFRESH_TOKEN_KEY, token);
        window.sessionStorage.removeItem(BROWSER_REFRESH_TOKEN_KEY);
      } else {
        window.localStorage.removeItem(BROWSER_REFRESH_TOKEN_KEY);
        window.sessionStorage.removeItem(BROWSER_REFRESH_TOKEN_KEY);
      }
    } catch {
      // Private browsing modes can deny storage. The active access token still works
      // until this page is reloaded.
    }
  }
}

async function readRefreshToken() {
  if (isTauri()) return await invoke<string | null>('secure_session_get');
  try {
    const persisted = window.localStorage.getItem(BROWSER_REFRESH_TOKEN_KEY);
    if (persisted) return persisted;
    const legacy = window.sessionStorage.getItem(BROWSER_REFRESH_TOKEN_KEY);
    if (legacy) {
      window.localStorage.setItem(BROWSER_REFRESH_TOKEN_KEY, legacy);
      window.sessionStorage.removeItem(BROWSER_REFRESH_TOKEN_KEY);
    }
    return legacy;
  } catch {
    return null;
  }
}

async function decode<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok)
    throw new ApiError(
      typeof payload.code === 'string' ? payload.code : 'REQUEST_FAILED',
      typeof payload.message === 'string' ? payload.message : 'Ошибка сервера',
      response.status,
      payload,
    );
  return payload as T;
}

export interface FileDownloadProgress {
  received: number;
  total?: number;
  bytesPerSecond: number;
}
export class AccountClient {
  private readonly fileDownloads = new Map<
    string,
    {
      promise: Promise<Blob>;
      listeners: Set<(progress: FileDownloadProgress) => void>;
      progress?: FileDownloadProgress;
    }
  >();
  private accessToken?: string;
  private accessExpiresAt = 0;
  private readonly chatHistoryRequests = new Map<string, Promise<unknown>>();
  user?: AccountUser;

  get authenticated() {
    return Boolean(this.user && this.accessToken);
  }

  get signalingToken() {
    return this.accessToken;
  }

  async realtimeAccessToken() {
    if (!this.accessToken) throw new ApiError('UNAUTHORIZED', 'Требуется вход', 401);
    if (Date.now() >= this.accessExpiresAt - 30_000) {
      const refreshToken = await readRefreshToken();
      if (!refreshToken) throw new ApiError('UNAUTHORIZED', 'Требуется повторный вход', 401);
      refreshInFlight ??= this.refresh(refreshToken).finally(() => {
        refreshInFlight = undefined;
      });
      await refreshInFlight;
    }
    return this.accessToken!;
  }

  async restore() {
    restoreInFlight ??= this.restoreStoredSession().finally(() => {
      restoreInFlight = undefined;
    });
    return restoreInFlight;
  }

  private async restoreStoredSession() {
    const refreshToken = await readRefreshToken();
    if (!refreshToken) return null;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    try {
      await this.refresh(refreshToken, controller.signal);
      const result = await this.request<{ user: AccountUser }>('/v1/me', {
        signal: controller.signal,
      });
      this.user = result.user;
      return this.user;
    } catch (error) {
      // An outage is not a logout. Only an explicit rejection of the session
      // invalidates its persisted refresh token (including a newly rotated one).
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        await this.clear();
        return null;
      }
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async webPushPublicKey() {
    return this.request<{ publicKey: string }>('/v1/me/web-push-key');
  }

  async registerWebPushSubscription(subscription: BrowserPushSubscription) {
    return this.request<{ ok: true }>('/v1/me/web-push-subscription', {
      method: 'POST',
      body: JSON.stringify(subscription),
    });
  }

  async register(input: {
    email: string;
    username: string;
    displayName: string;
    password: string;
    birthDate: string;
    acceptedTerms: true;
    acceptedPrivacy: true;
    legalVersion?: string;
    captchaToken?: string;
  }) {
    return this.publicRequest<{ user: AccountUser; verificationRequired: true }>(
      '/v1/auth/register',
      {
        method: 'POST',
        body: JSON.stringify({ ...input, displayName: input.displayName.trim() || input.username }),
      },
    );
  }

  async resendVerification(email: string) {
    return this.publicRequest<{ message: string }>('/v1/auth/resend-verification', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  }

  async verifyEmail(email: string, code: string) {
    const result = await this.publicRequest<{
      verified: true;
      user: AccountUser;
      session: SessionPayload;
    }>('/v1/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ email, code }),
    });
    await this.acceptSession(result.session);
    this.user = result.user;
    return result.user;
  }

  async login(login: string, password: string, captchaToken?: string) {
    const result = await this.publicRequest<{ user: AccountUser; session: SessionPayload }>(
      '/v1/auth/login',
      { method: 'POST', body: JSON.stringify({ login, password, captchaToken }) },
    );
    await this.acceptSession(result.session);
    this.user = result.user;
    return result.user;
  }

  startQrLogin(signal: AbortSignal) {
    return this.publicRequest<{ challenge: string; pollToken: string; expiresIn: number }>(
      '/v1/auth/qr/start',
      { method: 'POST', signal, body: '{}' },
    );
  }

  async redeemQrLogin(pollToken: string, signal: AbortSignal) {
    const result = await this.publicRequest<
      | { status: 'pending' | 'expired' }
      | { status: 'approved'; user: AccountUser; session: SessionPayload }
    >('/v1/auth/qr/redeem', { method: 'POST', signal, body: JSON.stringify({ pollToken }) });
    if (result.status !== 'approved') return result;
    signal.throwIfAborted();
    await this.acceptSession(result.session);
    this.user = result.user;
    return { status: 'approved', user: result.user } as const;
  }

  approveQrLogin(challenge: string) {
    return this.request<{ approved: true }>('/v1/auth/qr/approve', {
      method: 'POST',
      body: JSON.stringify({ challenge }),
    });
  }

  listPasskeys() {
    return this.request<{ keys: { id: string; createdAt: string }[] }>('/v1/me/passkeys');
  }

  deletePasskey(id: string) {
    return this.request<{ deleted: true }>(`/v1/me/passkeys/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  startPasskeyRegistration(password: string) {
    return this.request<{ state: string; options: PublicKeyCredentialCreationOptionsJSON }>(
      '/v1/me/passkeys/start',
      { method: 'POST', body: JSON.stringify({ password }) },
    );
  }

  finishPasskeyRegistration(state: string, response: RegistrationResponseJSON) {
    return this.request<{ created: true }>('/v1/me/passkeys/finish', {
      method: 'POST',
      body: JSON.stringify({ state, response }),
    });
  }

  startPasskeyLogin(desktopChallenge?: string) {
    return this.publicRequest<{ state: string; options: PublicKeyCredentialRequestOptionsJSON }>(
      '/v1/auth/passkey/start',
      { method: 'POST', body: JSON.stringify({ desktopChallenge }) },
    );
  }

  async finishPasskeyLogin(state: string, response: AuthenticationResponseJSON) {
    const result = await this.publicRequest<
      { approved: true } | { user: AccountUser; session: SessionPayload }
    >('/v1/auth/passkey/finish', { method: 'POST', body: JSON.stringify({ state, response }) });
    if ('approved' in result) return;
    await this.acceptSession(result.session);
    this.user = result.user;
    return result.user;
  }

  async mobileBetaLogin(login: string, password: string, key?: string) {
    const result = await this.publicRequest<{ user: AccountUser; session: SessionPayload }>(
      '/v1/mobile-beta/login',
      { method: 'POST', body: JSON.stringify({ login, password, key: key || undefined }) },
    );
    await this.acceptSession(result.session);
    this.user = result.user;
    return result.user;
  }

  async logout() {
    try {
      if (this.accessToken) await this.request('/v1/auth/logout', { method: 'POST' });
    } finally {
      await this.clear();
    }
  }

  async forgotPassword(email: string) {
    const result = await this.publicRequest<{ message: string }>('/v1/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email, codeFormat: 'numeric' }),
    });
    return result;
  }

  async resetPassword(token: string, password: string, email: string) {
    return this.publicRequest<{ changed: true }>('/v1/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, password, email: email.trim().toLowerCase() }),
    });
  }

  async updateProfile(input: { displayName?: string; username?: string; bio?: string | null }) {
    const result = await this.request<{ user: AccountUser }>('/v1/me', {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
    this.user = result.user;
    return result.user;
  }

  async uploadAvatar(dataUrl: string) {
    const blob = dataUrlToBlob(dataUrl);
    const form = new FormData();
    form.append('avatar', blob, `avatar.${blob.type.split('/')[1] || 'webp'}`);
    return this.request<{ avatarUrl: string }>('/v1/me/avatar', { method: 'POST', body: form });
  }

  async getMe() {
    const result = await this.request<{ user: AccountUser }>('/v1/me');
    this.user = result.user;
    return result.user;
  }

  async deleteAvatar() {
    return this.request('/v1/me/avatar', { method: 'DELETE' });
  }

  async uploadCover(dataUrl: string) {
    const blob = dataUrlToBlob(dataUrl);
    const form = new FormData();
    form.append('cover', blob, `cover.${blob.type.split('/')[1] || 'webp'}`);
    return this.request<{ coverUrl: string }>('/v1/me/cover', { method: 'POST', body: form });
  }

  async deleteCover() {
    return this.request('/v1/me/cover', { method: 'DELETE' });
  }

  async updateGroupAvatar(
    chatId: string,
    dataUrl: string | undefined,
    positionX: number,
    positionY: number,
    scale: number,
  ) {
    const path = `/v1/chats/${chatId}/avatar`;
    if (!dataUrl)
      return this.request<{
        avatarUrl: string;
        avatarPositionX: number;
        avatarPositionY: number;
        avatarScale: number;
      }>(path, {
        method: 'PATCH',
        body: JSON.stringify({ positionX, positionY, scale }),
      });
    const blob = dataUrlToBlob(dataUrl);
    const form = new FormData();
    form.append('avatar', blob, `group-avatar.${blob.type.split('/')[1] || 'webp'}`);
    return this.request<{
      avatarUrl: string;
      avatarPositionX: number;
      avatarPositionY: number;
      avatarScale: number;
    }>(`${path}?positionX=${positionX}&positionY=${positionY}&scale=${scale}`, {
      method: 'POST',
      body: form,
    });
  }

  async updateGroupTitle(chatId: string, title: string) {
    return this.request<{ title: string }>(`/v1/chats/${chatId}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    });
  }

  async uploadChatImage<T>(
    chatId: string,
    dataUrl: string,
    caption = '',
    thumbnailDataUrl?: string,
    replyToMessageId?: string,
  ) {
    const blob = dataUrlToBlob(dataUrl);
    const form = new FormData();
    form.append('image', blob, `chat-image.${blob.type.split('/')[1] || 'webp'}`);
    if (thumbnailDataUrl) {
      const thumbnail = dataUrlToBlob(thumbnailDataUrl);
      form.append(
        'thumbnail',
        thumbnail,
        `chat-thumbnail.${thumbnail.type.split('/')[1] || 'webp'}`,
      );
    }
    const query = new URLSearchParams();
    if (caption.trim()) query.set('caption', caption.trim());
    if (replyToMessageId) query.set('replyToMessageId', replyToMessageId);
    const serializedQuery = query.toString();
    const suffix = serializedQuery ? `?${serializedQuery}` : '';
    return this.request<{ message: T }>(`/v1/chats/${chatId}/images${suffix}`, {
      method: 'POST',
      body: form,
    });
  }

  async chatImageBlob(messageId: string, variant: 'full' | 'thumbnail' = 'full') {
    const query = variant === 'thumbnail' ? '?variant=thumbnail' : '';
    const response = await this.authenticatedFetch(`/v1/messages/${messageId}/image${query}`);
    if (!response.ok) return decode<never>(response);
    return response.blob();
  }

  async uploadChatFile<T>(chatId: string, file: File, caption = '', replyToMessageId?: string) {
    const form = new FormData();
    form.append('file', file, file.name);
    const query = new URLSearchParams();
    if (caption.trim()) query.set('caption', caption.trim());
    if (replyToMessageId) query.set('replyToMessageId', replyToMessageId);
    const serializedQuery = query.toString();
    const suffix = serializedQuery ? `?${serializedQuery}` : '';
    return this.request<{ message: T }>(`/v1/chats/${chatId}/files${suffix}`, {
      method: 'POST',
      body: form,
    });
  }

  async linkPreviewImage(key: string) {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid preview image');
    const response = await this.authenticatedFetch(`/v1/link-preview/image/${key}`);
    if (!response.ok) throw new Error('Preview image unavailable');
    return response.blob();
  }

  async chatFileBlob(messageId: string, onProgress?: (progress: FileDownloadProgress) => void) {
    const key = `${this.user?.id ?? 'session'}:${messageId}`;
    const existing = this.fileDownloads.get(key);
    if (existing) {
      if (onProgress) {
        existing.listeners.add(onProgress);
        if (existing.progress) onProgress(existing.progress);
      }
      try {
        return await existing.promise;
      } finally {
        if (onProgress) existing.listeners.delete(onProgress);
      }
    }
    const listeners = new Set<(progress: FileDownloadProgress) => void>();
    if (onProgress) listeners.add(onProgress);
    const transfer = {
      listeners,
      progress: undefined as FileDownloadProgress | undefined,
      promise: Promise.resolve(new Blob()),
    };
    this.fileDownloads.set(key, transfer);
    transfer.promise = (async () => {
      const response = await this.authenticatedFetch(`/v1/messages/${messageId}/file`);
      if (!response.ok) return decode<never>(response);
      const total = Number(response.headers.get('content-length')) || undefined;
      const started = performance.now();
      let received = 0;
      let reported = -Infinity;
      const publish = (force = false) => {
        const now = performance.now();
        if (!force && now - reported < 100) return;
        reported = now;
        transfer.progress = {
          received,
          total,
          bytesPerSecond: (received * 1000) / Math.max(1, now - started),
        };
        for (const listener of listeners) listener(transfer.progress);
      };
      publish(true);
      if (!response.body) {
        const blob = await response.blob();
        received = blob.size;
        publish(true);
        return blob;
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array<ArrayBuffer>[] = [];
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(new Uint8Array(value));
          received += value.byteLength;
          publish();
        }
      } finally {
        reader.releaseLock();
      }
      publish(true);
      return new Blob(chunks, {
        type: response.headers.get('content-type') ?? 'application/octet-stream',
      });
    })().finally(() => {
      if (this.fileDownloads.get(key) === transfer) this.fileDownloads.delete(key);
      listeners.clear();
    });
    return transfer.promise;
  }

  async chatHistory<T>(chatId: string): Promise<T> {
    const path = `/v1/chats/${chatId}/messages`;
    const userId = this.user?.id;
    if (!userId) return this.request<T>(path);
    const key = `${userId}:${chatId}`;
    const pending = this.chatHistoryRequests.get(key);
    if (pending) return pending as Promise<T>;
    const request = (async () => {
      let response = await this.authenticatedFetch(path);
      if (response.status === 429) {
        const retryAfter = Number(response.headers.get('retry-after')) || 10;
        const delay = Math.min(60, Math.max(1, retryAfter)) * 1000;
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
        if (this.user?.id === userId) response = await this.authenticatedFetch(path);
      }
      return decode<T>(response);
    })().finally(() => {
      if (this.chatHistoryRequests.get(key) === request) this.chatHistoryRequests.delete(key);
    });
    this.chatHistoryRequests.set(key, request);
    return request;
  }

  async gifBlob(assetId: string, variant: 'full' | 'thumbnail' = 'full') {
    if (!/^[0-9a-f-]{36}$/i.test(assetId)) throw new Error('Некорректный GIF');
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await this.authenticatedFetch(
        `/v1/gifs/assets/${assetId}${variant === 'thumbnail' ? '?variant=thumbnail' : ''}`,
      );
      if (response.status === 429 && attempt < 2) {
        await new Promise((resolve) =>
          setTimeout(
            resolve,
            Math.min(5, Math.max(1, Number(response.headers.get('retry-after')) || 2)) * 1000,
          ),
        );
        continue;
      }
      if (!response.ok) return decode<never>(response);
      return response.blob();
    }
    throw new Error('GIF временно недоступен');
  }

  async deleteAccount(password: string) {
    await this.request('/v1/me', {
      method: 'DELETE',
      body: JSON.stringify({ password, confirmation: 'УДАЛИТЬ' }),
    });
    await this.clear();
  }

  async changePassword(currentPassword: string, newPassword: string) {
    return this.request<{ changed: true }>('/v1/me/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  }

  async request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
    return decode<T>(await this.authenticatedFetch(path, init, retry));
  }

  private async authenticatedFetch(
    path: string,
    init: RequestInit = {},
    retry = true,
  ): Promise<Response> {
    if (!this.accessToken) throw new ApiError('UNAUTHORIZED', 'Требуется вход', 401);
    const response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        ...(path === '/v1/chats' ? { 'x-trlka-chat-collections': '1' } : {}),
        ...(typeof init.body === 'string' ? { 'content-type': 'application/json' } : {}),
        ...init.headers,
        authorization: `Bearer ${this.accessToken}`,
      },
    });
    if (response.status === 401 && retry) {
      const refreshToken = await readRefreshToken();
      if (refreshToken) {
        refreshInFlight ??= this.refresh(refreshToken).finally(() => {
          refreshInFlight = undefined;
        });
        await refreshInFlight;
        return this.authenticatedFetch(path, init, false);
      }
    }
    return response;
  }

  private async publicRequest<T>(path: string, init: RequestInit = {}) {
    return decode<T>(
      await fetch(`${API_URL}${path}`, {
        ...init,
        headers: { 'content-type': 'application/json', ...init.headers },
      }),
    );
  }

  private async refresh(refreshToken: string, signal?: AbortSignal) {
    const result = await this.publicRequest<{ session: SessionPayload }>('/v1/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
      signal,
    });
    await this.acceptSession(result.session);
  }

  private async acceptSession(session: SessionPayload) {
    this.accessToken = session.accessToken;
    this.accessExpiresAt = new Date(session.accessExpiresAt).getTime();
    await storeRefreshToken(session.refreshToken);
  }

  private async clear() {
    this.accessToken = undefined;
    this.accessExpiresAt = 0;
    this.user = undefined;
    await storeRefreshToken(undefined);
  }
}

export const accountClient = new AccountClient();
