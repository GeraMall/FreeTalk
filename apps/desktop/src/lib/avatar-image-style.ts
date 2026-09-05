import type { CSSProperties } from 'react';

export function avatarImageStyle(positionX = 50, positionY = 50, scale = 100): CSSProperties {
  const normalizedScale = Math.max(100, Math.min(250, scale));
  const maxPan = (normalizedScale - 100) / 2;
  const translateX = ((positionX - 50) / 50) * maxPan;
  const translateY = ((positionY - 50) / 50) * maxPan;
  return {
    objectPosition: `${positionX}% ${positionY}%`,
    transform: `translate(${translateX}%, ${translateY}%) scale(${normalizedScale / 100})`,
  };
}
