import type { Update } from '@tauri-apps/plugin-updater';

export type UpdateStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'current'; version: string }
  | { kind: 'available'; version: string; notes?: string; downloaded?: boolean }
  | { kind: 'downloading'; version: string; progress: number }
  | { kind: 'error'; message: string }
  | { kind: 'unavailable' };

let pendingUpdate: Update | null = null;
let checking: Promise<UpdateStatus> | undefined;
let installing: Promise<boolean> | undefined;
let preparedUpdate: Update | null = null;
let downloadStatus: UpdateStatus | undefined;
const progressListeners = new Set<(status: UpdateStatus) => void>();

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
  if (installing && downloadStatus) return downloadStatus;
  checking ??= performUpdateCheck().finally(() => {
    checking = undefined;
  });
  return checking;
}

async function performUpdateCheck(): Promise<UpdateStatus> {
  try {
    const [{ check }, version] = await Promise.all([
      import('@tauri-apps/plugin-updater'),
      currentVersion(),
    ]);
    if (preparedUpdate)
      return {
        kind: 'available',
        version: preparedUpdate.version,
        notes: preparedUpdate.body,
        downloaded: true,
      };
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
  canInstall: () => boolean = () => true,
): Promise<boolean> {
  progressListeners.add(onProgress);
  try {
    if (installing) {
      if (downloadStatus) onProgress(downloadStatus);
      return await installing;
    }
    if (checking) await checking;
    installing ??= downloadPendingUpdate(canInstall).finally(() => {
      installing = undefined;
    });
    return await installing;
  } finally {
    progressListeners.delete(onProgress);
  }
}

async function downloadPendingUpdate(canInstall: () => boolean): Promise<boolean> {
  if (!pendingUpdate) throw new Error('Сначала проверьте наличие обновлений.');
  const update = pendingUpdate;
  const version = update.version;
  let downloaded = 0;
  let total = 0;
  let published = -1;
  let publishedAt = -Infinity;
  const publish = (value: number, finished = false) => {
    const progress = Math.max(published, Math.min(100, Math.round(value)));
    const now = performance.now();
    if (progress === published || (!finished && published >= 0 && now - publishedAt < 80)) return;
    published = progress;
    publishedAt = now;
    downloadStatus = { kind: 'downloading', version, progress };
    for (const listener of progressListeners) listener(downloadStatus);
  };
  if (preparedUpdate !== update) {
    publish(0);
    await update.download((event) => {
      if (event.event === 'Started') total = event.data.contentLength ?? 0;
      if (event.event === 'Progress') downloaded += event.data.chunkLength;
      const finished = event.event === 'Finished';
      publish(finished ? 100 : total > 0 ? (downloaded / total) * 100 : 0, finished);
    });
    publish(100, true);
    preparedUpdate = update;
  }
  // A call may have started while the installer was downloading. Downloading
  // and applying are separate so neither Windows nor macOS can interrupt it.
  if (!canInstall()) {
    downloadStatus = { kind: 'available', version, notes: update.body, downloaded: true };
    for (const listener of progressListeners) listener(downloadStatus);
    return false;
  }
  await update.install();
  preparedUpdate = null;
  if (navigator.userAgent.includes('Mac')) {
    const { relaunch } = await import('@tauri-apps/plugin-process');
    await relaunch();
  }
  return true;
}
