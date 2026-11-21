/* global document, fetch, AbortSignal, atob, TextDecoder */
async function updateLinuxDownloads() {
  const section = document.getElementById('linux-downloads');
  if (!section) return;

  try {
    const response = await fetch('/downloads/linux/latest.json', {
      signal: AbortSignal.timeout?.(4000),
    });
    if (!response.ok) return;
    const { payload } = await response.json();
    if (typeof payload !== 'string' || payload.length > 90_000) return;
    const bytes = Uint8Array.from(atob(payload), (byte) => byte.charCodeAt(0));
    const release = JSON.parse(new TextDecoder().decode(bytes));
    const { version } = release;
    if (release.schema !== 1 || !/^\d{1,6}\.\d{1,6}\.\d{1,6}(?:-beta\.\d{1,6})?$/.test(version)) {
      return;
    }

    const root = 'https://github.com/GeraMall/FreeTalk/releases/download/';
    const formats = { deb: 'amd64.deb', appimage: 'x86_64.AppImage' };
    const links = Object.entries(formats).map(([format, suffix]) => ({
      element: section.querySelector(`[data-linux-format="${format}"]`),
      url: `${root}linux-v${version}/Trlka_${version}_${suffix}`,
      published: release.platforms?.[format]?.url,
    }));
    if (links.some(({ element, url, published }) => !element || url !== published)) return;

    for (const { element, url } of links) element.href = url;
    section.querySelector('[data-linux-version]').textContent = version.split('-').at(-1);
  } catch {
    // Keep the verified release links in the page if the release feed is unavailable.
  }
}

void updateLinuxDownloads();
