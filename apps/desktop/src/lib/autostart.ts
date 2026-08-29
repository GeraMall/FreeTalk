function isTauriDesktop() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function autostartSupported() {
  return isTauriDesktop();
}

export async function getAutostartEnabled() {
  if (!isTauriDesktop()) return false;
  const { isEnabled } = await import('@tauri-apps/plugin-autostart');
  return isEnabled();
}

export async function setAutostartEnabled(enabled: boolean) {
  if (!isTauriDesktop()) return;
  const plugin = await import('@tauri-apps/plugin-autostart');
  if (enabled) await plugin.enable();
  else await plugin.disable();
}
