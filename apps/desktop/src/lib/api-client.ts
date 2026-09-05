import { invoke } from '@tauri-apps/api/core';
import { dataUrlToBlob } from './profile';

const API_URL = (import.meta.env.VITE_API_URL || 'http://127.0.0.1:8790').replace(/\/$/, '');

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
  avatarUrl: string | null;
  coverUrl?: string | null;
  bio?: string | null;
  registeredAt: string;
}

export interface AccountSession {
  id: string;
  current: boolean;
  userAgent: string;
  createdAt: string;
  lastActiveAt: string;
  expiresAt: string;
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

let browserRefreshToken: string | undefined;
let refreshInFlight: Promise<void> | undefined;

function isTauri() {
  return '__TAURI_INTERNALS__' in window;
}

async function storeRefreshToken(token?: string) {
  if (isTauri()) {
    if (token) await invoke('secure_session_set', { refreshToken: token });
    else await invoke('secure_session_clear');
  } else {
    browserRefreshToken = token;
  }
}

async function readRefreshToken() {
  return isTauri()
    ? await invoke<string | null>('secure_session_get')
    : (browserRefreshToken ?? null);
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

export class AccountClient {
  private accessToken?: string;
  private accessExpiresAt = 0;
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
    const refreshToken = await readRefreshToken();
    if (!refreshToken) return null;
    try {
      await this.refresh(refreshToken);
      const result = await this.request<{ user: AccountUser }>('/v1/me');
      this.user = result.user;
      return this.user;
    } catch {
      await this.clear();
      return null;
    }
  }

  async register(input: {
    email: string;
    username: string;
    displayName: string;
    password: string;
    acceptedTerms: true;
    acceptedPrivacy: true;
    captchaToken?: string;
  }) {
    return this.publicRequest<{ user: AccountUser; verificationRequired: true }>(
      '/v1/auth/register',
      { method: 'POST', body: JSON.stringify(input) },
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

  async logout() {
    try {
      if (this.accessToken) await this.request('/v1/auth/logout', { method: 'POST' });
    } finally {
      await this.clear();
    }
  }

  async forgotPassword(email: string) {
    return this.publicRequest<{ message: string }>('/v1/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  }

  async resetPassword(token: string, password: string) {
    return this.publicRequest<{ changed: true }>('/v1/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, password }),
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

  async uploadChatImage<T>(
    chatId: string,
    dataUrl: string,
    caption = '',
    thumbnailDataUrl?: string,
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
    const query = caption.trim() ? `?caption=${encodeURIComponent(caption.trim())}` : '';
    return this.request<{ message: T }>(`/v1/chats/${chatId}/images${query}`, {
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

  async guestJoinToken(anonymousUserId: string, roomId: string, captchaToken: string) {
    return this.publicRequest<{
      guestJoinToken: string;
      displayName: string;
      expiresInSeconds: number;
    }>('/v1/guest/join-token', {
      method: 'POST',
      body: JSON.stringify({ anonymousUserId, roomId, captchaToken }),
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

  private async refresh(refreshToken: string) {
    const result = await this.publicRequest<{ session: SessionPayload }>('/v1/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
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
