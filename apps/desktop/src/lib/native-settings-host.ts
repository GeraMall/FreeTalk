export interface NativeSettingsHost {
  request<T>(action: string, payload?: unknown): Promise<T>;
  cameraFacing?: Record<string, 'user' | 'environment'>;
}

declare global {
  interface Window {
    TRLKASettingsHost?: NativeSettingsHost;
    TRLKANativeSettings?: { postMessage(message: string): void };
    receiveNativeSettings?(message: {
      id: number;
      client: string;
      result?: unknown;
      error?: { code: string; message: string; status: number };
    }): void;
    nativeSettingsBack?(): void;
  }
}

export function nativeSettingsHost() {
  return typeof window === 'undefined' ? undefined : window.TRLKASettingsHost;
}
