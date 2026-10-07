import { afterEach, describe, expect, it, vi } from 'vitest';
import { compositeCameraFrame, createCameraEffectCapture } from './camera-background';

afterEach(() => vi.unstubAllGlobals());

describe('camera background contour', () => {
  it('clips the captured frame to its mask before drawing the replacement behind it', () => {
    const operations: string[] = [];
    const context = {
      globalCompositeOperation: 'source-over',
      filter: 'none',
      save: vi.fn(),
      restore: vi.fn(),
      clearRect: vi.fn(),
      drawImage() {
        operations.push(this.globalCompositeOperation);
      },
    };
    compositeCameraFrame(
      context as unknown as CanvasRenderingContext2D,
      { width: 640, height: 360 } as HTMLCanvasElement,
      { image: {} as CanvasImageSource, segmentationMask: {} as CanvasImageSource },
      'custom',
      { naturalWidth: 1280, naturalHeight: 720 } as HTMLImageElement,
    );
    expect(operations).toEqual(['source-over', 'source-in', 'destination-over']);
  });
});

describe('camera background worker lifecycle', () => {
  function setup(fail = false) {
    const sourceTrack = { stop: vi.fn(), getSettings: () => ({ width: 640, height: 360 }) };
    const outputTrack = { stop: vi.fn(), contentHint: '' };
    const stream = { getVideoTracks: () => [sourceTrack], getTracks: () => [sourceTrack] };
    const output = { getVideoTracks: () => [outputTrack], getTracks: () => [outputTrack] };
    const video = {
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
      readyState: 4,
      videoWidth: 640,
      videoHeight: 360,
      srcObject: null,
    };
    const context = {
      save: vi.fn(),
      restore: vi.fn(),
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      putImageData: vi.fn(),
    };
    const worker = {
      onmessage: undefined as undefined | ((event: { data: unknown }) => void),
      onerror: undefined as undefined | (() => void),
      terminate: vi.fn(),
      postMessage: vi.fn((message) => {
        if (message.type === 'init')
          queueMicrotask(() => {
            worker.onmessage?.({
              data: fail ? { type: 'error', message: 'model unavailable' } : { type: 'ready' },
            });
          });
      }),
    };
    let render: FrameRequestCallback = () => {};
    vi.stubGlobal(
      'Worker',
      vi.fn(function () {
        return worker;
      }),
    );
    vi.stubGlobal('document', {
      createElement: (tag: string) =>
        tag === 'video'
          ? video
          : {
              width: 0,
              height: 0,
              getContext: () => context,
              captureStream: () => output,
            },
    });
    vi.stubGlobal('window', { setTimeout, clearTimeout, location: { href: 'http://localhost/' } });
    vi.stubGlobal('HTMLMediaElement', { HAVE_METADATA: 1, HAVE_CURRENT_DATA: 2 });
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback) => {
        render = callback;
        return 1;
      }),
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockImplementation(() => Promise.resolve({ close: vi.fn() })),
    );
    vi.stubGlobal(
      'ImageData',
      vi.fn(function () {
        return {};
      }),
    );
    return {
      stream: stream as unknown as MediaStream,
      worker,
      sourceTrack,
      outputTrack,
      video,
      render: (now: number) => render(now),
    };
  }

  it('never submits another camera snapshot before its matching mask arrives', async () => {
    const { stream, worker, sourceTrack, outputTrack, render } = setup();
    const capture = await createCameraEffectCapture(stream, { mode: 'blur', dataUrl: '' });
    render(100);
    await Promise.resolve();
    render(200);
    expect(
      worker.postMessage.mock.calls.filter(([message]) => message.type === 'frame'),
    ).toHaveLength(1);
    worker.onmessage?.({
      data: { type: 'mask', width: 2, height: 2, alpha: new Uint8ClampedArray(16) },
    });
    render(300);
    await Promise.resolve();
    expect(
      worker.postMessage.mock.calls.filter(([message]) => message.type === 'frame'),
    ).toHaveLength(2);
    capture.dispose();
    capture.dispose();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(sourceTrack.stop).toHaveBeenCalledTimes(1);
    expect(outputTrack.stop).toHaveBeenCalledTimes(1);
  });

  it('releases camera and worker if model initialization fails', async () => {
    const { stream, worker, sourceTrack, video } = setup(true);
    await expect(createCameraEffectCapture(stream, { mode: 'blur', dataUrl: '' })).rejects.toThrow(
      'model unavailable',
    );
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(sourceTrack.stop).toHaveBeenCalledOnce();
    expect(video.srcObject).toBeNull();
  });
});
