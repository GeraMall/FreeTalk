import { DEFAULT_VIDEO_PREFERENCES, type ScreenQuality } from './video-quality';
export interface NativeScreenSource {
  id: string;
  title: string;
  kind: 'screen' | 'window';
}

export interface NativeScreenSelection extends NativeScreenSource {
  includeAudio: boolean;
  quality: ScreenQuality;
}

interface PickerRequest {
  includeAudio: boolean;
  quality: ScreenQuality;
  sources: NativeScreenSource[];
  complete: (source: NativeScreenSelection | null) => void;
}
let pending: PickerRequest | null = null;
const listeners = new Set<() => void>();
export const screenPickerStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  snapshot: () => pending,
};
export function selectNativeScreen(
  sources: NativeScreenSource[],
  includeAudio = true,
  preferences: ScreenQuality = DEFAULT_VIDEO_PREFERENCES,
) {
  pending?.complete(null);
  return new Promise<NativeScreenSelection>((resolve, reject) => {
    pending = {
      sources,
      includeAudio,
      quality: {
        screenResolution: preferences.screenResolution,
        screenFrameRate: preferences.screenFrameRate,
        screenContentMode: preferences.screenContentMode,
      },
      complete(source) {
        pending = null;
        listeners.forEach((listener) => listener());
        if (source) resolve(source);
        else reject(new DOMException('Демонстрация отменена', 'NotAllowedError'));
      },
    };
    listeners.forEach((listener) => listener());
  });
}

export function cancelNativeScreenSelection() {
  pending?.complete(null);
}
