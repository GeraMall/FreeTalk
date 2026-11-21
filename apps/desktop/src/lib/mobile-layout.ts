import { useEffect, useState } from 'react';

const MOBILE_QUERY = '(max-width: 760px)';

export function mobileLayoutMatches(viewportOnly = false) {
  if (typeof window === 'undefined') return false;
  const android = !viewportOnly && /Android/i.test(window.navigator.userAgent);
  return android || window.matchMedia?.(MOBILE_QUERY).matches === true;
}

export function useMobileLayout(viewportOnly = false) {
  const [mobile, setMobile] = useState(() => mobileLayoutMatches(viewportOnly));

  useEffect(() => {
    const media = window.matchMedia?.(MOBILE_QUERY);
    const update = () => setMobile(mobileLayoutMatches(viewportOnly));
    media?.addEventListener?.('change', update);
    window.addEventListener('resize', update);
    return () => {
      media?.removeEventListener?.('change', update);
      window.removeEventListener('resize', update);
    };
  }, [viewportOnly]);

  return mobile;
}
