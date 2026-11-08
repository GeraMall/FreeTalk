import { connectionDiagnostics } from './connection-diagnostics';
import { screenResolutionSize, type VideoPreferences } from './video-quality';
import { usesMacDesktop } from './window-chrome';

const positive = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 32768
    ? value
    : undefined;

export function captureCapabilities(track: MediaStreamTrack): MediaTrackCapabilities {
  try {
    return track.getCapabilities?.() ?? {};
  } catch {
    return {};
  }
}

export function macScreenCaptureTarget(
  preferences: VideoPreferences,
  settings: MediaTrackSettings,
  capabilities: MediaTrackCapabilities,
) {
  const bounds = screenResolutionSize(preferences.screenResolution);
  const sourceWidth = positive(capabilities.width?.max);
  const sourceHeight = positive(capabilities.height?.max);
  const fixedRatio =
    capabilities.aspectRatio?.min === capabilities.aspectRatio?.max
      ? positive(capabilities.aspectRatio?.max)
      : undefined;
  const ratio =
    fixedRatio ??
    (sourceWidth && sourceHeight ? sourceWidth / sourceHeight : undefined) ??
    positive(settings.aspectRatio) ??
    (settings.width && settings.height ? settings.width / settings.height : 16 / 9);
  const width = Math.max(
    2,
    Math.floor(
      Math.min(
        bounds.width,
        sourceWidth ?? Infinity,
        bounds.height * ratio,
        sourceHeight ? sourceHeight * ratio : Infinity,
      ) / 2,
    ) * 2,
  );
  return {
    width,
    height: Math.max(2, Math.floor(width / ratio)),
    frameRate: preferences.screenFrameRate,
  };
}

function applyWithDeadline(track: MediaStreamTrack, constraints: MediaTrackConstraints) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new DOMException('Capture constraints timed out', 'TimeoutError')),
      2500,
    );
    Promise.resolve()
      .then(() => track.applyConstraints(constraints))
      .then(
        () => {
          clearTimeout(timer);
          resolve();
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error);
        },
      );
  });
}

/** Configure the selected source, never the chooser, before it reaches the encoder. */
export async function configureMacScreenCapture(
  track: MediaStreamTrack,
  preferences: VideoPreferences,
) {
  if (!usesMacDesktop() || typeof track.applyConstraints !== 'function') return;
  const before = track.getSettings();
  const capabilities = captureCapabilities(track);
  const target = macScreenCaptureTarget(preferences, before, capabilities);
  const details = {
    requestedWidth: target.width,
    requestedHeight: target.height,
    requestedFps: target.frameRate,
    previousWidth: before.width ?? 0,
    previousHeight: before.height ?? 0,
    sourceMaxWidth: capabilities.width?.max ?? 0,
    sourceMaxHeight: capabilities.height?.max ?? 0,
  };
  let result = 'exact';
  try {
    // A width-only constraint preserves the selected screen/window's intrinsic aspect ratio.
    // Exact is allowed on an existing track, not on getDisplayMedia's chooser options.
    await applyWithDeadline(track, {
      width: { exact: target.width },
      frameRate: { ideal: target.frameRate, max: target.frameRate },
    });
  } catch (error) {
    const errorName =
      error instanceof Error || error instanceof DOMException ? error.name : 'unknown';
    connectionDiagnostics.record('screen-capture:constraint-error', undefined, {
      ...details,
      errorName,
    });
    // Never queue another native operation behind one that may be stuck in WebKit.
    if (errorName === 'TimeoutError') return;
    try {
      await applyWithDeadline(track, {
        width: target.width,
        frameRate: { ideal: target.frameRate, max: target.frameRate },
      });
      result = 'ideal-fallback';
    } catch (fallback) {
      connectionDiagnostics.record('screen-capture:constraint-fallback-error', undefined, {
        ...details,
        errorName:
          fallback instanceof Error || fallback instanceof DOMException ? fallback.name : 'unknown',
      });
      return;
    }
  }
  const settings = track.getSettings();
  connectionDiagnostics.record('screen-capture:configured', undefined, {
    ...details,
    result,
    width: settings.width ?? 0,
    height: settings.height ?? 0,
    frameRate: settings.frameRate ?? 0,
  });
}
