import { useEffect, useState } from 'react';
import {
  getActiveAccountMediaScope,
  loadAccountMedia,
  peekAccountMedia,
} from './account-media-cache';

export function useCachedMediaUrl(sourceUrl?: string | null) {
  const accountId = getActiveAccountMediaScope();
  const [displayUrl, setDisplayUrl] = useState(() => peekAccountMedia(sourceUrl, accountId));

  useEffect(() => {
    if (!sourceUrl) {
      setDisplayUrl(undefined);
      return;
    }
    const ready = peekAccountMedia(sourceUrl, accountId);
    if (ready) {
      setDisplayUrl(ready);
      return;
    }
    if (!accountId || !/^https?:\/\//i.test(sourceUrl)) {
      setDisplayUrl(sourceUrl);
      return;
    }
    let cancelled = false;
    void loadAccountMedia(sourceUrl, accountId)
      .then((cachedUrl) => {
        if (!cancelled) setDisplayUrl(cachedUrl);
      })
      .catch(() => {
        if (!cancelled) setDisplayUrl(sourceUrl);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId, sourceUrl]);

  if (sourceUrl && !/^https?:\/\//i.test(sourceUrl)) return sourceUrl;
  return displayUrl;
}
