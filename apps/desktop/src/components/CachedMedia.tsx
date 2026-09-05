import type { ImgHTMLAttributes } from 'react';
import { useCachedMediaUrl } from '../lib/use-cached-media';

export function CachedMediaImage({ src, ...props }: ImgHTMLAttributes<HTMLImageElement>) {
  const displayUrl = useCachedMediaUrl(typeof src === 'string' ? src : undefined);
  if (!displayUrl) return null;
  return <img {...props} src={displayUrl} />;
}
