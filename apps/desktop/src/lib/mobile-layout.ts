import { useEffect, useState } from 'react';

const MOBILE_QUERY = '(max-width: 760px)';

export function mobileLayoutMatches() {
  if (typeof window === 'undefined') return false;
  const android = /Android/i.test(window.navigator.userAgent);
  return android || window.matchMedia?.(MOBILE_QUERY).matches === true;
}

export function useMobileLayout() {
  const [mobile, setMobile] = useState(mobileLayoutMatches);

  useEffect(() => {
    const media = window.matchMedia?.(MOBILE_QUERY);
    const update = () => setMobile(mobileLayoutMatches());
    media?.addEventListener?.('change', update);
    window.addEventListener('resize', update);
    return () => {
      media?.removeEventListener?.('change', update);
      window.removeEventListener('resize', update);
    };
  }, []);

  return mobile;
}
