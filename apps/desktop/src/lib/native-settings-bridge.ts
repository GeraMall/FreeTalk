import { ApiError } from './api-client';
import type { NativeSettingsHost } from './native-settings-host';

export function createNativeSettingsBridge(): NativeSettingsHost {
  const client = crypto.randomUUID();
  let sequence = 0;
  const pending = new Map<
    number,
    { resolve(value: unknown): void; reject(error: Error): void; timer: number }
  >();
  window.receiveNativeSettings = (message) => {
    // A language change reloads the page. Ignore replies from its previous instance.
    if (message.client !== client) return;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error)
      request.reject(new ApiError(message.error.code, message.error.message, message.error.status));
    else request.resolve(message.result);
  };
  return {
    request<T>(action: string, payload: unknown = {}): Promise<T> {
      return new Promise((resolve, reject) => {
        if (!window.TRLKANativeSettings) {
          reject(new ApiError('NATIVE_UNAVAILABLE', 'Не удалось открыть настройки.', 503));
          return;
        }
        const id = ++sequence;
        const timer = window.setTimeout(
          () => {
            pending.delete(id);
            reject(
              new ApiError(
                'REQUEST_TIMEOUT',
                'Запрос занял слишком много времени. Повторите попытку.',
                408,
              ),
            );
          },
          action === 'directory.choose' ? 300_000 : 60_000,
        );
        pending.set(id, { resolve: (value) => resolve(value as T), reject, timer });
        try {
          window.TRLKANativeSettings.postMessage(JSON.stringify({ id, client, action, payload }));
        } catch (error) {
          clearTimeout(timer);
          pending.delete(id);
          reject(error);
        }
      });
    },
  };
}
