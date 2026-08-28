import type { PresenceStatus } from '@freetalk/protocol';

export type PresenceMode = 'auto' | 'away' | 'dnd' | 'invisible';

const STORAGE_KEY = 'freetalk.presence-mode';
export const PRESENCE_MODE_EVENT = 'freetalk:presence-mode-changed';

export function getPresenceMode(): PresenceMode {
  const value = localStorage.getItem(STORAGE_KEY);
  return value === 'away' || value === 'dnd' || value === 'invisible' ? value : 'auto';
}

export function setPresenceMode(mode: PresenceMode) {
  localStorage.setItem(STORAGE_KEY, mode);
  window.dispatchEvent(new CustomEvent<PresenceMode>(PRESENCE_MODE_EVENT, { detail: mode }));
}

export function resolvePresence(mode: PresenceMode, inactive: boolean): PresenceStatus {
  if (mode === 'invisible') return 'offline';
  if (mode === 'dnd') return 'dnd';
  if (mode === 'away') return 'away';
  return inactive ? 'away' : 'online';
}

export function presenceModeLabel(mode: PresenceMode) {
  if (mode === 'away') return 'Нет на месте';
  if (mode === 'dnd') return 'Не беспокоить';
  if (mode === 'invisible') return 'Невидимый';
  return 'В сети';
}
