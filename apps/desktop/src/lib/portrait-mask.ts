/** Multiclass model: background, hair, body skin, face skin, clothes, objects. */
export function portraitAlpha(classes: readonly Float32Array[]): Uint8ClampedArray {
  if (classes.length !== 6) throw new Error('Unexpected portrait model output');
  const pixels = new Uint8ClampedArray(classes[0]!.length * 4);
  for (let i = 0; i < classes[0]!.length; i++) {
    const person = classes[1]![i]! + classes[2]![i]! + classes[3]![i]! + classes[4]![i]!;
    // Objects are NOT foreground. Inverting background confidence retains the
    // furniture behind the user, even with a perfect multiclass prediction.
    const t = Math.max(0, Math.min(1, (person - 0.45) / 0.4));
    pixels[i * 4] = pixels[i * 4 + 1] = pixels[i * 4 + 2] = 255;
    pixels[i * 4 + 3] = Math.round(t * t * (3 - 2 * t) * 255);
  }
  return pixels;
}
