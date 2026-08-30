import { invoke } from '@tauri-apps/api/core';
import { join, videoDir } from '@tauri-apps/api/path';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { BaseDirectory, create, mkdir, type FileHandle } from '@tauri-apps/plugin-fs';

const DEFAULT_DIRECTORY_NAME = 'FreeTalk';

export interface RecordingDestination {
  directory: string;
  path: string;
  file: FileHandle;
}

export async function defaultRecordingDirectory() {
  return join(await videoDir(), DEFAULT_DIRECTORY_NAME);
}

export async function chooseRecordingDirectory(current = '') {
  const selected = await openDialog({
    directory: true,
    multiple: false,
    defaultPath: current || (await defaultRecordingDirectory()),
    title: 'Выберите папку для записей FreeTalk',
  });
  return typeof selected === 'string' ? selected : undefined;
}

export async function createRecordingDestination(
  configuredDirectory: string,
  askEveryTime: boolean,
  extension: 'webm' | 'mp4' = 'webm',
): Promise<RecordingDestination> {
  let directory = configuredDirectory;
  if (askEveryTime) {
    const selected = await chooseRecordingDirectory(directory);
    if (!selected) throw new DOMException('Выбор папки отменён.', 'AbortError');
    directory = selected;
  }

  const fileName = recordingFileName(new Date(), extension);
  if (!directory) {
    await mkdir(DEFAULT_DIRECTORY_NAME, { baseDir: BaseDirectory.Video, recursive: true });
    return {
      directory: await defaultRecordingDirectory(),
      path: await join(await defaultRecordingDirectory(), fileName),
      file: await create(`${DEFAULT_DIRECTORY_NAME}/${fileName}`, {
        baseDir: BaseDirectory.Video,
      }),
    };
  }

  try {
    await mkdir(directory, { recursive: true });
    const path = await join(directory, fileName);
    return { directory, path, file: await create(path) };
  } catch (error) {
    // A directory selected in a previous app session must be authorized by the
    // native picker again before the filesystem plugin can write to it.
    const selected = await chooseRecordingDirectory(directory);
    if (!selected) throw error;
    await mkdir(selected, { recursive: true });
    const path = await join(selected, fileName);
    return { directory: selected, path, file: await create(path) };
  }
}

export async function openRecordingDirectory(configuredDirectory = '') {
  const directory = configuredDirectory || (await defaultRecordingDirectory());
  await invoke('open_recordings_directory', { path: directory });
}

export async function recordingStorageAvailable(configuredDirectory = '') {
  const directory = configuredDirectory || (await defaultRecordingDirectory());
  return invoke<number>('recording_storage_available', { path: directory });
}

export function recordingFileName(date: Date, extension: 'webm' | 'mp4' = 'webm') {
  const stamp = date
    .toISOString()
    .replace('T', '_')
    .replace(/:/g, '-')
    .replace(/\.\d{3}Z$/, '');
  return `FreeTalk_${stamp}.${extension}`;
}
