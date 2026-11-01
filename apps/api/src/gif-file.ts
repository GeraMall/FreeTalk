export const MAX_GIF_BYTES = 30 * 1024 * 1024;

export class GifFileError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

// Walk GIF blocks without decompressing the image or trusting its filename/MIME.
export function inspectGif(bytes: Buffer) {
  if (bytes.length > MAX_GIF_BYTES)
    throw new GifFileError(
      'GIF_TOO_LARGE',
      'GIF превышает 30 МБ. Выберите более короткую или уменьшенную версию.',
      413,
    );
  if (bytes.length < 14 || !['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6)))
    throw new GifFileError('INVALID_GIF', 'Выберите анимированный файл GIF.');
  const width = bytes.readUInt16LE(6),
    height = bytes.readUInt16LE(8);
  if (!width || !height || width > 4096 || height > 4096)
    throw new GifFileError('INVALID_GIF', 'Разрешение GIF должно быть не больше 4096 × 4096.');
  let offset = 13 + (bytes[10]! & 0x80 ? 3 * (1 << ((bytes[10]! & 7) + 1)) : 0);
  let frames = 0,
    pixels = 0,
    complete = false;
  const invalid = () => {
    throw new GifFileError('INVALID_GIF', 'GIF повреждён или имеет неподдерживаемую структуру.');
  };
  const skipBlocks = () => {
    while (offset < bytes.length) {
      const length = bytes[offset++]!;
      if (!length) return;
      offset += length;
      if (offset > bytes.length) invalid();
    }
    invalid();
  };
  while (offset < bytes.length) {
    const block = bytes[offset++]!;
    if (block === 0x3b) {
      complete = true;
      break;
    }
    if (block === 0x21) {
      if (offset >= bytes.length) invalid();
      offset++;
      skipBlocks();
      continue;
    }
    if (block !== 0x2c || offset + 9 > bytes.length) invalid();
    const left = bytes.readUInt16LE(offset),
      top = bytes.readUInt16LE(offset + 2);
    const w = bytes.readUInt16LE(offset + 4),
      h = bytes.readUInt16LE(offset + 6);
    if (!w || !h || left + w > width || top + h > height) invalid();
    const packed = bytes[offset + 8]!;
    offset += 9 + (packed & 0x80 ? 3 * (1 << ((packed & 7) + 1)) : 0);
    if (offset >= bytes.length || bytes[offset]! < 2 || bytes[offset]! > 8) invalid();
    offset++;
    skipBlocks();
    frames++;
    pixels += w * h;
    if (frames > 1200 || pixels > 160_000_000)
      throw new GifFileError(
        'GIF_TOO_COMPLEX',
        'В GIF слишком много кадров или слишком большое разрешение. Уменьшите его.',
      );
  }
  if (!complete || !frames) invalid();
  if (frames < 2)
    throw new GifFileError(
      'GIF_NOT_ANIMATED',
      'В этом GIF только один кадр. Для обычной картинки используйте отправку фото.',
    );
  return { width, height, frames };
}
