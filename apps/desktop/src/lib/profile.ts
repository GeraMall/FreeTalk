export const PROFILE_CHANGE_LIMIT = 3;
export const PROFILE_CHANGE_WINDOW_MS = 5 * 60 * 60 * 1000;
export const MAX_AVATAR_DATA_URL_LENGTH = 18_000;

export function dataUrlToBlob(dataUrl: string) {
  const match = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(dataUrl);
  if (!match) throw new Error('Не удалось прочитать выбранное изображение.');
  const mimeType = match[1] || 'application/octet-stream';
  const payload = match[3];
  try {
    const bytes = match[2]
      ? Uint8Array.from(atob(payload), (character) => character.charCodeAt(0))
      : new TextEncoder().encode(decodeURIComponent(payload));
    return new Blob([bytes], { type: mimeType });
  } catch {
    throw new Error('Не удалось прочитать выбранное изображение.');
  }
}

export function activeProfileChanges(history: number[], now = Date.now()) {
  return history.filter((time) => Number.isFinite(time) && now - time < PROFILE_CHANGE_WINDOW_MS);
}

export function remainingProfileChanges(history: number[], now = Date.now()) {
  return Math.max(0, PROFILE_CHANGE_LIMIT - activeProfileChanges(history, now).length);
}

export function nextProfileChangeHistory(history: number[], now = Date.now()) {
  const active = activeProfileChanges(history, now);
  if (active.length >= PROFILE_CHANGE_LIMIT) return undefined;
  return [...active, now];
}

export async function prepareAvatar(file: File) {
  if (!file.type.startsWith('image/')) throw new Error('Выберите изображение JPEG, PNG или WebP.');
  if (file.size > 5 * 1024 * 1024) throw new Error('Файл аватара должен быть меньше 5 МБ.');
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Не удалось обработать изображение.');
    const scale = Math.max(canvas.width / bitmap.width, canvas.height / bitmap.height);
    const width = bitmap.width * scale;
    const height = bitmap.height * scale;
    context.drawImage(
      bitmap,
      (canvas.width - width) / 2,
      (canvas.height - height) / 2,
      width,
      height,
    );
    for (const quality of [0.82, 0.72, 0.62, 0.5]) {
      const value = canvas.toDataURL('image/webp', quality);
      if (value.length <= MAX_AVATAR_DATA_URL_LENGTH) return value;
    }
    throw new Error('Изображение получилось слишком большим. Выберите более простую фотографию.');
  } finally {
    bitmap.close();
  }
}

export async function prepareCover(file: File) {
  if (!file.type.startsWith('image/')) throw new Error('Выберите изображение JPEG, PNG или WebP.');
  if (file.size > 8 * 1024 * 1024) throw new Error('Файл обложки должен быть меньше 8 МБ.');
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 400;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Не удалось обработать изображение.');
    const scale = Math.max(canvas.width / bitmap.width, canvas.height / bitmap.height);
    const width = bitmap.width * scale;
    const height = bitmap.height * scale;
    context.drawImage(
      bitmap,
      (canvas.width - width) / 2,
      (canvas.height - height) / 2,
      width,
      height,
    );
    for (const quality of [0.8, 0.68, 0.56, 0.44]) {
      const value = canvas.toDataURL('image/webp', quality);
      if (value.length <= 900_000) return value;
    }
    throw new Error('Обложка получилась слишком большой. Выберите другое изображение.');
  } finally {
    bitmap.close();
  }
}
