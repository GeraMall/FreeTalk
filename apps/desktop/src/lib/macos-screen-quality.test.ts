// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureMacScreenCapture, macScreenCaptureTarget } from './macos-screen-quality';
import { DEFAULT_VIDEO_PREFERENCES } from './video-quality';
import { connectionDiagnostics } from './connection-diagnostics';

const preferences = { ...DEFAULT_VIDEO_PREFERENCES, screenContentMode: 'text' as const };
function fakeTrack(capabilities: MediaTrackCapabilities = {}) {
  let settings = { width: 640, height: 414, frameRate: 30 };
  const applyConstraints = vi.fn(async (constraints: MediaTrackConstraints) => {
    const width =
      typeof constraints.width === 'number'
        ? constraints.width
        : (constraints.width as ConstrainULongRange).exact!;
    settings = { width, height: Math.floor((width * 414) / 640), frameRate: 30 };
  });
  return {
    getSettings: () => settings,
    getCapabilities: () => capabilities,
    applyConstraints,
  } as unknown as MediaStreamTrack;
}
describe('Mac source capture quality', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_1)',
    );
    connectionDiagnostics.startSession();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  it('corrects the reported 640×414 source before publishing, not just sender bitrate', async () => {
    const track = fakeTrack();
    await configureMacScreenCapture(track, preferences);
    expect(track.applyConstraints).toHaveBeenCalledWith({
      width: { exact: 1668 },
      frameRate: { ideal: 30, max: 30 },
    });
    expect(track.getSettings().width).toBe(1668);
    expect(connectionDiagnostics.snapshot().entries.at(-1)).toMatchObject({
      event: 'screen-capture:configured',
      details: { previousWidth: 640, width: 1668, requestedFps: 30 },
    });
  });
  it('fits a Retina screen within Full HD while preserving its native shape', () => {
    expect(
      macScreenCaptureTarget(preferences, {}, { width: { max: 2560 }, height: { max: 1600 } }),
    ).toEqual({ width: 1728, height: 1080, frameRate: 30 });
  });
  it('does not upscale a genuinely small selected window or force 30 FPS over a manual choice', () => {
    expect(
      macScreenCaptureTarget(
        { ...preferences, screenFrameRate: 60 },
        {},
        { width: { max: 480 }, height: { max: 310 } },
      ),
    ).toEqual({ width: 480, height: 310, frameRate: 60 });
  });
  it('falls back to a soft width request when the native track rejects exact constraints', async () => {
    const track = fakeTrack();
    vi.mocked(track.applyConstraints).mockRejectedValueOnce(
      new DOMException('unsupported', 'OverconstrainedError'),
    );
    await configureMacScreenCapture(track, preferences);
    expect(track.applyConstraints).toHaveBeenNthCalledWith(2, {
      width: 1668,
      frameRate: { ideal: 30, max: 30 },
    });
    expect(connectionDiagnostics.snapshot().entries.at(-1)?.details?.result).toBe('ideal-fallback');
  });
  it('does not block startup forever or stack native operations after a timeout', async () => {
    vi.useFakeTimers();
    const track = fakeTrack();
    vi.mocked(track.applyConstraints).mockImplementation(() => new Promise(() => {}));
    const configuring = configureMacScreenCapture(track, preferences);
    await vi.advanceTimersByTimeAsync(2501);
    await configuring;
    expect(track.applyConstraints).toHaveBeenCalledTimes(1);
    expect(connectionDiagnostics.snapshot().entries.at(-1)?.details?.errorName).toBe(
      'TimeoutError',
    );
  });
  it('leaves the working Windows capture path alone', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    );
    const track = fakeTrack();
    await configureMacScreenCapture(track, preferences);
    expect(track.applyConstraints).not.toHaveBeenCalled();
  });
});
