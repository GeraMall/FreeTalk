import type { ServerMessage } from '@freetalk/protocol';
export type ActivityPointer = Extract<ServerMessage, { type: 'activity-pointer' }>;
const listeners = new Set<(pointer: ActivityPointer) => void>();
export function publishActivityPointer(pointer: ActivityPointer) {
  for (const listener of listeners) listener(pointer);
}
export function subscribeActivityPointers(listener: (pointer: ActivityPointer) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
