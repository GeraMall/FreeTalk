export const PROFILE_CHANGE_LIMIT = 5;
export const PROFILE_CHANGE_WINDOW_MS = 5 * 60 * 60 * 1000;
export const MAX_PROFILE_IMAGE_INPUT_BYTES = 25 * 1024 * 1024;
export const MAX_AVATAR_DATA_URL_LENGTH = 1_300_000;
export const MAX_COVER_DATA_URL_LENGTH = 3_300_000;
export const MAX_CHAT_IMAGE_DATA_URL_LENGTH = 3_900_000;
export const MAX_CHAT_WALLPAPER_DATA_URL_LENGTH = 1_800_000;

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_DECODED_PIXELS = 100_000_000;

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

function validateImage(file: File, label: string) {
  if (!ALLOWED_IMAGE_TYPES.has(file.type))
    throw new Error('Выберите изображение JPEG, PNG или WebP.');
  if (file.size > MAX_PROFILE_IMAGE_INPUT_BYTES)
    throw new Error(`${label} должен быть не больше 25 МБ.`);
}

function drawCoverCrop(
  context: CanvasRenderingContext2D,
  bitmap: ImageBitmap,
  width: number,
  height: number,
) {
  const scale = Math.max(width / bitmap.width, height / bitmap.height);
  const renderedWidth = bitmap.width * scale;
  const renderedHeight = bitmap.height * scale;
  context.drawImage(
    bitmap,
    (width - renderedWidth) / 2,
    (height - renderedHeight) / 2,
    renderedWidth,
    renderedHeight,
  );
}

function encodeCanvas(
  canvas: HTMLCanvasElement,
  maxLength: number,
  errorMessage: string,
  qualities = [0.88, 0.8, 0.7, 0.6, 0.5],
) {
  for (const type of ['image/webp', 'image/jpeg']) {
    for (const quality of qualities) {
      const value = canvas.toDataURL(type, quality);
      if (!value.startsWith(`data:${type}`)) break;
      if (value.length <= maxLength) return value;
    }
  }
  throw new Error(errorMessage);
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('Не удалось прочитать фотографию.'));
    reader.onerror = () => reject(new Error('Не удалось прочитать фотографию.'));
    reader.readAsDataURL(file);
  });
}

async function prepareImage(
  file: File,
  options: {
    label: string;
    width: number;
    height: number;
    maxDataUrlLength: number;
    tooLargeMessage: string;
  },
) {
  validateImage(file, options.label);
  const bitmap = await createImageBitmap(file);
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > MAX_DECODED_PIXELS)
      throw new Error('Разрешение изображения слишком большое.');
    const canvas = document.createElement('canvas');
    canvas.width = options.width;
    canvas.height = options.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Не удалось обработать изображение.');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    drawCoverCrop(context, bitmap, canvas.width, canvas.height);
    return encodeCanvas(canvas, options.maxDataUrlLength, options.tooLargeMessage);
  } finally {
    bitmap.close();
  }
}

export function prepareAvatar(file: File) {
  return prepareImage(file, {
    label: 'Файл аватара',
    width: 768,
    height: 768,
    maxDataUrlLength: MAX_AVATAR_DATA_URL_LENGTH,
    tooLargeMessage: 'Не удалось уменьшить аватар до 1 МБ. Выберите другое изображение.',
  });
}

export async function prepareGroupAvatar(file: File) {
  validateImage(file, 'Файл аватара группы');
  const bitmap = await createImageBitmap(file);
  try {
    if (
      bitmap.width < 64 ||
      bitmap.height < 64 ||
      bitmap.width * bitmap.height > MAX_DECODED_PIXELS
    )
      throw new Error('Изображение должно быть не меньше 64×64 пикселей.');
    const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(64, Math.round(bitmap.width * scale));
    canvas.height = Math.max(64, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Не удалось обработать изображение.');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return encodeCanvas(
      canvas,
      MAX_AVATAR_DATA_URL_LENGTH,
      'Не удалось уменьшить аватар группы до 1 МБ. Выберите другое изображение.',
    );
  } finally {
    bitmap.close();
  }
}

export function prepareCover(file: File) {
  return prepareImage(file, {
    label: 'Файл обложки',
    width: 1800,
    height: 700,
    maxDataUrlLength: MAX_COVER_DATA_URL_LENGTH,
    tooLargeMessage: 'Не удалось уменьшить обложку до 2–3 МБ. Выберите другое изображение.',
  });
}

export function prepareChatWallpaper(file: File) {
  return prepareImage(file, {
    label: 'Файл обоев',
    width: 1920,
    height: 1080,
    maxDataUrlLength: MAX_CHAT_WALLPAPER_DATA_URL_LENGTH,
    tooLargeMessage: 'Не удалось уменьшить обои. Выберите другое изображение.',
  });
}

export async function prepareChatImage(file: File) {
  validateImage(file, 'Фотография');
  const bitmap = await createImageBitmap(file);
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > MAX_DECODED_PIXELS)
      throw new Error('Разрешение изображения слишком большое.');
    const original = await readFileAsDataUrl(file);
    if (original.length <= MAX_CHAT_IMAGE_DATA_URL_LENGTH) return original;

    const scale = Math.min(1, 2560 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Не удалось обработать фотографию.');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return encodeCanvas(
      canvas,
      MAX_CHAT_IMAGE_DATA_URL_LENGTH,
      'Не удалось уменьшить фотографию до 3 МБ. Выберите другое изображение.',
      [0.94, 0.9, 0.86, 0.8, 0.72, 0.64],
    );
  } finally {
    bitmap.close();
  }
}
