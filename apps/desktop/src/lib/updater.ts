import type { Update } from '@tauri-apps/plugin-updater';

export type UpdateStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'current'; version: string }
  | { kind: 'available'; version: string; notes?: string }
  | { kind: 'downloading'; version: string; progress: number }
  | { kind: 'error'; message: string }
  | { kind: 'unavailable' };

let pendingUpdate: Update | null = null;

function isTauri() {
  return '__TAURI_INTERNALS__' in window;
}

export async function currentVersion() {
  if (!isTauri()) return 'web';
  const { getVersion } = await import('@tauri-apps/api/app');
  return getVersion();
}

export async function checkForUpdate(): Promise<UpdateStatus> {
  if (!isTauri()) return { kind: 'unavailable' };
  try {
    const [{ check }, version] = await Promise.all([
      import('@tauri-apps/plugin-updater'),
      currentVersion(),
    ]);
    if (pendingUpdate) await pendingUpdate.close();
    pendingUpdate = await check({ timeout: 12_000 });
    if (!pendingUpdate) return { kind: 'current', version };
    return {
      kind: 'available',
      version: pendingUpdate.version,
      notes: pendingUpdate.body,
    };
  } catch {
    return {
      kind: 'error',
      message:
        'Сервер обновлений пока недоступен. Текущая сборка продолжит работать без изменений.',
    };
  }
}

export async function installPendingUpdate(
  onProgress: (status: UpdateStatus) => void,
): Promise<void> {
  if (!pendingUpdate) throw new Error('Сначала проверьте наличие обновлений.');
  const version = pendingUpdate.version;
  let downloaded = 0;
  let total = 0;
  await pendingUpdate.downloadAndInstall((event) => {
    if (event.event === 'Started') total = event.data.contentLength ?? 0;
    if (event.event === 'Progress') downloaded += event.data.chunkLength;
    onProgress({
      kind: 'downloading',
      version,
      progress: total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : 0,
    });
  });
  if (navigator.userAgent.includes('Mac')) {
    const { relaunch } = await import('@tauri-apps/plugin-process');
    await relaunch();
  }
}
