export function messageVideo(input: string) {
  try {
    const senderOrigin = /^https?:$/.test(location.protocol)
      ? `&origin=${encodeURIComponent(location.origin)}`
      : '';
    const widgetReferrer = /^https?:$/.test(location.protocol)
      ? location.origin
      : 'https://io.freetalk.desktop';
    const url = new URL(input),
      host = url.hostname.toLowerCase();
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
      return undefined;
    let id = '';
    if (host === 'youtu.be') id = url.pathname.split('/')[1] ?? '';
    if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(host))
      id =
        url.pathname === '/watch'
          ? (url.searchParams.get('v') ?? '')
          : /^\/(shorts|embed|live)\//.test(url.pathname)
            ? (url.pathname.split('/')[2] ?? '')
            : '';
    if (/^[a-zA-Z0-9_-]{11}$/.test(id))
      return {
        provider: 'YouTube',
        thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
        embed: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&playsinline=1&enablejsapi=1&controls=0${senderOrigin}&widget_referrer=${encodeURIComponent(widgetReferrer)}`,
      };
    if (['rutube.ru', 'www.rutube.ru'].includes(host)) {
      id = /^\/(?:video|play\/embed)\/([a-f0-9]{32})(?:\/|$)/i.exec(url.pathname)?.[1] ?? '';
      if (id)
        return {
          provider: 'Rutube',
          embed: `https://rutube.ru/play/embed/${id.toLowerCase()}/?autoplay=1&getPlayOptions=duration,title`,
        };
    }
  } catch {
    /* plain text */
  }
  return undefined;
}
export function supportsRichLinkPreview(input: string) {
  try {
    return ['https:', 'http:'].includes(new URL(input).protocol);
  } catch {
    return false;
  }
}
