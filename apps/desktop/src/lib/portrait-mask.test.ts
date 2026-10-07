import { describe, expect, it } from 'vitest';
import { portraitAlpha } from './portrait-mask';

describe('multiclass portrait mask', () => {
  it('keeps only people, not confidently recognized furniture', () => {
    const classes = Array.from({ length: 6 }, () => new Float32Array(6));
    classes.forEach((mask, category) => {
      mask[category] = 1;
    });
    const rgba = portraitAlpha(classes);
    expect(Array.from({ length: 6 }, (_, i) => rgba[i * 4 + 3])).toEqual([
      0, 255, 255, 255, 255, 0,
    ]);
  });
  it('combines hair and skin uncertainty without making a hole at their boundary', () => {
    const classes = [0, 0.45, 0, 0.5, 0, 0.05].map((p) => new Float32Array([p]));
    expect(portraitAlpha(classes)[3]).toBe(255);
  });
});
