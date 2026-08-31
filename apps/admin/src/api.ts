import { invoke } from '@tauri-apps/api/core';

const API_URL = (import.meta.env.VITE_API_URL || 'http://127.0.0.1:8790').replace(/\/$/, '');

interface SessionPayload {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
}

export interface AdminUser {
  id: string;
  email: string;
  username: string;
  displayName: string;
}

class AdminApi {
  private accessToken?: string;
  private accessExpiresAt = 0;

  private async storeRefreshToken(token?: string) {
    if ('__TAURI_INTERNALS__' in window)
      await invoke(
        token ? 'admin_session_set' : 'admin_session_clear',
        token ? { refreshToken: token } : undefined,
      );
  }

  private async readRefreshToken() {
    if (!('__TAURI_INTERNALS__' in window)) return null;
    return invoke<string | null>('admin_session_get');
  }

  async login(login: string, password: string) {
    const result = await this.publicRequest<{ user: AdminUser; session: SessionPayload }>(
      '/v1/auth/login',
      { method: 'POST', body: JSON.stringify({ login, password }) },
    );
    await this.acceptSession(result.session);
    try {
      await this.request('/v1/admin/me');
      return result.user;
    } catch (error) {
      await this.clear();
      throw error;
    }
  }

  async restore() {
    const refreshToken = await this.readRefreshToken();
    if (!refreshToken) return null;
    try {
      await this.refresh(refreshToken);
      const result = await this.request<{ user: AdminUser }>('/v1/admin/me');
      return result.user;
    } catch {
      await this.clear();
      return null;
    }
  }

  async logout() {
    try {
      if (this.accessToken) await this.request('/v1/auth/logout', { method: 'POST' });
    } finally {
      await this.clear();
    }
  }

  async request<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
    if (!this.accessToken) throw new Error('Требуется вход администратора');
    if (Date.now() >= this.accessExpiresAt - 30_000) {
      const refreshToken = await this.readRefreshToken();
      if (!refreshToken) throw new Error('Сессия завершена');
      await this.refresh(refreshToken);
    }
    const response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.accessToken}`,
        ...init.headers,
      },
    });
    return this.decode<T>(response);
  }

  exportUrl(format: 'json' | 'csv') {
    return `${API_URL}/v1/admin/export?format=${format}`;
  }

  async downloadExport(format: 'json' | 'csv') {
    if (!this.accessToken) throw new Error('Требуется вход');
    const response = await fetch(this.exportUrl(format), {
      headers: { authorization: `Bearer ${this.accessToken}` },
    });
    if (!response.ok) await this.decode(response);
    const blob = await response.blob();
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = `freetalk-admin-summary.${format}`;
    anchor.click();
    URL.revokeObjectURL(href);
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
    await this.storeRefreshToken(session.refreshToken);
  }

  private async clear() {
    this.accessToken = undefined;
    this.accessExpiresAt = 0;
    await this.storeRefreshToken();
  }

  private async publicRequest<T>(path: string, init: RequestInit) {
    const response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...init.headers },
    });
    return this.decode<T>(response);
  }

  private async decode<T>(response: Response): Promise<T> {
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok)
      throw new Error(typeof payload.message === 'string' ? payload.message : 'Ошибка Admin API');
    return payload as T;
  }
}

export const adminApi = new AdminApi();
