/* global document, fetch, AbortSignal */
async function updateDesktopDownloads() {
  try {
    const response = await fetch('/downloads/desktop/latest.json', {
      cache: 'no-cache',
      redirect: 'error',
      signal: AbortSignal.timeout?.(4000),
    });
    if (!response.ok) return;
    const release = await response.json();
    const version = release?.version;
    if (
      typeof version !== 'string' ||
      !/^\d{1,6}\.\d{1,6}\.\d{1,6}(?:-beta\.\d{1,6})?$/.test(version)
    ) {
      return;
    }

    const root = 'https://github.com/GeraMall/FreeTalk/releases/download/';
    const directories = [`${root}desktop-v${version}/`, `${root}v${version}/`];
    const formats = [
      ['windows', 'windows-x86_64', 'x64-setup.exe', 'x64-setup.exe'],
      ['macos', 'darwin-aarch64', 'aarch64.app.tar.gz', 'aarch64.dmg'],
    ];

    for (const [format, platform, publishedSuffix, downloadSuffix] of formats) {
      const published = release.platforms?.[platform]?.url;
      const directory = directories.find(
        (candidate) => published === `${candidate}Trlka_${version}_${publishedSuffix}`,
      );
      if (!directory) continue;

      const url = `${directory}Trlka_${version}_${downloadSuffix}`;
      for (const link of document.querySelectorAll(`[data-desktop-format="${format}"]`)) {
        link.href = url;
      }
      for (const label of document.querySelectorAll(`[data-desktop-version="${format}"]`)) {
        label.textContent = version.split('-').at(-1);
      }
    }
  } catch {
    // Keep the published links already present in the page if the feed is unavailable.
  }
}

void updateDesktopDownloads();
