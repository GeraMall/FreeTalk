import { getCurrentWindow } from '@tauri-apps/api/window';

export type FullscreenMode = 'element' | 'window' | 'none';

export async function toggleMediaFullscreen(element: HTMLElement): Promise<FullscreenMode> {
  const ownerDocument = element.ownerDocument;
  if (ownerDocument.fullscreenElement) {
    await ownerDocument.exitFullscreen();
    return 'none';
  }

  if (element.requestFullscreen) {
    try {
      await element.requestFullscreen();
      if (ownerDocument.fullscreenElement) return 'element';
    } catch {
      // WKWebView on macOS exposes the method on some versions but can reject it.
    }
  }

  const appWindow = getCurrentWindow();
  const active = await appWindow.isFullscreen();
  await appWindow.setFullscreen(!active);
  return active ? 'none' : 'window';
}

export async function leaveWindowFullscreen(active: boolean) {
  if (!active) return;
  try {
    await getCurrentWindow().setFullscreen(false);
  } catch {
    // The application window may already be closing.
  }
}
