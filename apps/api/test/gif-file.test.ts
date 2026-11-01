import { describe, expect, it } from 'vitest';
import { inspectGif, MAX_GIF_BYTES } from '../src/gif-file.js';

export function animatedGif(frames = 2) {
  const header = Buffer.from('47494638396101000100800000000000ffffff', 'hex');
  const frame = Buffer.from('21f904000a0000002c0000000001000100000202440100', 'hex');
  return Buffer.concat([
    header,
    ...Array.from({ length: frames }, () => frame),
    Buffer.from([0x3b]),
  ]);
}
describe('uploaded GIF validation', () => {
  it('preserves a valid animated GIF and reads its dimensions without decoding', () => {
    const bytes = animatedGif();
    const original = Buffer.from(bytes);
    expect(inspectGif(bytes)).toEqual({ width: 1, height: 1, frames: 2 });
    expect(bytes).toEqual(original);
  });
  it('rejects renamed images, still images and truncated blocks', () => {
    expect(() => inspectGif(Buffer.from('<svg onload=alert(1)>'))).toThrow(
      'Выберите анимированный',
    );
    expect(() => inspectGif(animatedGif(1))).toThrow('один кадр');
    expect(() => inspectGif(animatedGif().subarray(0, -1))).toThrow('повреждён');
  });
  it('bounds file size, dimensions and work spent walking frames', () => {
    expect(() => inspectGif(Buffer.alloc(MAX_GIF_BYTES + 1))).toThrow('30 МБ');
    const huge = animatedGif();
    huge.writeUInt16LE(4097, 6);
    expect(() => inspectGif(huge)).toThrow('4096');
    expect(() => inspectGif(animatedGif(1201))).toThrow('слишком много кадров');
  });
});
