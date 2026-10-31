export interface NativeScreenSource {
  id: string;
  title: string;
  kind: 'screen' | 'window';
}

interface PickerRequest {
  sources: NativeScreenSource[];
  complete: (source: NativeScreenSource | null) => void;
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
export function selectNativeScreen(sources: NativeScreenSource[]) {
  pending?.complete(null);
  return new Promise<NativeScreenSource>((resolve, reject) => {
    pending = {
      sources,
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
