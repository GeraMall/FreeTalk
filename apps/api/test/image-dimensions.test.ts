import { describe, expect, it } from 'vitest';
import { safeImageDimensions } from '../src/image-dimensions.js';

describe('bounded image dimension parser', () => {
  it('reads PNG dimensions', () => {
    const png = Buffer.alloc(24);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
    png.write('IHDR', 12, 'ascii');
    png.writeUInt32BE(640, 16);
    png.writeUInt32BE(480, 20);
    expect(safeImageDimensions(png)).toEqual({ width: 640, height: 480 });
  });

  it('reads JPEG start-of-frame dimensions without unbounded scanning', () => {
    const jpeg = Buffer.from([
      0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xe0, 0x02, 0x80, 0x03, 0x01, 0x11, 0x00,
      0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    ]);
    expect(safeImageDimensions(jpeg)).toEqual({ width: 640, height: 480 });
  });

  it('rejects unsupported and truncated data', () => {
    expect(safeImageDimensions(Buffer.from('icns-malformed'))).toEqual({});
    expect(safeImageDimensions(Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0xff]))).toEqual({});
  });
});
