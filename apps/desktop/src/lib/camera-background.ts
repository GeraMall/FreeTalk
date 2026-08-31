import { SelfieSegmentation } from '@mediapipe/selfie_segmentation';

export type CameraBackgroundMode = 'none' | 'blur' | 'custom';

export interface CameraBackgroundSettings {
  mode: CameraBackgroundMode;
  dataUrl: string;
}

export interface CameraEffectCapture {
  stream: MediaStream;
  sourceTrack: MediaStreamTrack;
  dispose(): void;
}

const ASSET_ROOT = '/mediapipe/selfie-segmentation/';

export async function createCameraEffectCapture(
  sourceStream: MediaStream,
  settings: CameraBackgroundSettings,
): Promise<CameraEffectCapture> {
  const sourceTrack = sourceStream.getVideoTracks()[0];
  if (!sourceTrack) {
    stopStream(sourceStream);
    throw new Error('Камера не вернула видеопоток.');
  }
  if (settings.mode === 'none') {
    return {
      stream: sourceStream,
      sourceTrack,
      dispose: once(() => stopStream(sourceStream)),
    };
  }

  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = sourceStream;
  await video.play();
  await waitForVideo(video);

  const trackSettings = sourceTrack.getSettings();
  const sourceWidth = Math.max(320, video.videoWidth || trackSettings.width || 1280);
  const sourceHeight = Math.max(180, video.videoHeight || trackSettings.height || 720);
  const outputScale = Math.min(1, 1280 / sourceWidth, 720 / sourceHeight);
  const width = Math.round(sourceWidth * outputScale);
  const height = Math.round(sourceHeight * outputScale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  // The segmentation mask stores its confidence in transparency. An opaque
  // context turns the transparent background black-but-opaque and makes the
  // original camera frame cover the selected effect.
  const context = canvas.getContext('2d');
  if (!context) {
    stopStream(sourceStream);
    throw new Error('Не удалось подготовить обработку фона камеры.');
  }
  const maskCanvas = document.createElement('canvas');
  const maskScale = Math.min(1, 640 / width, 360 / height);
  maskCanvas.width = Math.max(160, Math.round(width * maskScale));
  maskCanvas.height = Math.max(90, Math.round(height * maskScale));
  const maskContext = maskCanvas.getContext('2d', { willReadFrequently: true });
  if (!maskContext) {
    stopStream(sourceStream);
    throw new Error('Не удалось подготовить маску фона камеры.');
  }

  const customBackground =
    settings.mode === 'custom' && settings.dataUrl
      ? await loadImage(settings.dataUrl).catch(() => undefined)
      : undefined;
  const segmenter = new SelfieSegmentation({
    locateFile: (file) => new URL(`${ASSET_ROOT}${file}`, window.location.href).href,
  });
  // Mirroring is presentation-only and is already applied by the camera UI.
  // Flipping here would bake a mirror into the transmitted track and the UI
  // would flip it a second time.
  segmenter.setOptions({ modelSelection: 1, selfieMode: false });
  let running = true;
  let processing = false;
  let animationFrame = 0;
  let maskReady = false;
  let lastRenderAt = 0;
  let lastSegmentationAt = 0;
  const renderInterval = 1_000 / 30;
  const segmentationInterval = 1_000 / 15;

  segmenter.onResults((results) => {
    updateSmoothedSegmentationMask(maskContext, maskCanvas, results.segmentationMask);
    maskReady = true;
  });
  await segmenter.initialize();

  const render = (now: number) => {
    if (!running) return;
    animationFrame = requestAnimationFrame(render);
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;

    if (now - lastRenderAt >= renderInterval) {
      lastRenderAt = now;
      if (maskReady) {
        compositeCameraFrame(
          context,
          canvas,
          { image: video, segmentationMask: maskCanvas },
          settings.mode,
          customBackground,
        );
      } else {
        drawEffectWithoutMask(context, canvas, video, settings.mode, customBackground);
      }
    }

    if (!processing && now - lastSegmentationAt >= segmentationInterval) {
      lastSegmentationAt = now;
      processing = true;
      void segmenter
        .send({ image: video })
        .catch(() => undefined)
        .finally(() => {
          processing = false;
        });
    }
  };
  animationFrame = requestAnimationFrame(render);

  const processedStream = canvas.captureStream(Math.min(30, trackSettings.frameRate || 30));
  const processedTrack = processedStream.getVideoTracks()[0];
  if (!processedTrack) {
    running = false;
    cancelAnimationFrame(animationFrame);
    await segmenter.close();
    stopStream(sourceStream);
    throw new Error('Не удалось создать видеодорожку с выбранным фоном.');
  }
  processedTrack.contentHint = 'motion';

  return {
    stream: processedStream,
    sourceTrack,
    dispose: once(() => {
      running = false;
      cancelAnimationFrame(animationFrame);
      stopStream(processedStream);
      stopStream(sourceStream);
      video.pause();
      video.srcObject = null;
      void segmenter.close();
    }),
  };
}

export async function imageFileToCameraBackground(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Выберите изображение JPG, PNG или WebP.');
  if (file.size > 15 * 1024 * 1024) throw new Error('Изображение должно быть меньше 15 МБ.');
  const source = await fileToDataUrl(file);
  const image = await loadImage(source);
  const maximum = 1920;
  const scale = Math.min(1, maximum / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) return source;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.88);
}

export function compositeCameraFrame(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  results: { image: CanvasImageSource; segmentationMask: CanvasImageSource },
  mode: CameraBackgroundMode,
  customBackground?: HTMLImageElement,
) {
  const { width, height } = canvas;
  context.save();
  context.clearRect(0, 0, width, height);
  context.filter = 'blur(1.35px)';
  context.drawImage(results.segmentationMask, 0, 0, width, height);
  context.globalCompositeOperation = 'source-in';
  context.filter = 'none';
  context.drawImage(results.image, 0, 0, width, height);
  context.globalCompositeOperation = 'destination-over';
  if (mode === 'custom' && customBackground) {
    drawImageCover(context, customBackground, width, height);
  } else {
    context.filter = 'blur(22px)';
    context.drawImage(results.image, -28, -28, width + 56, height + 56);
  }
  context.restore();
}

export function updateSmoothedSegmentationMask(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  mask: CanvasImageSource,
) {
  const { width, height } = canvas;
  context.clearRect(0, 0, width, height);
  context.drawImage(mask, 0, 0, width, height);
  const image = context.getImageData(0, 0, width, height);
  const pixels = image.data;
  const lowConfidence = 0.36;
  const highConfidence = 0.74;
  for (let index = 3; index < pixels.length; index += 4) {
    const confidence = pixels[index]! / 255;
    const normalized = Math.min(
      1,
      Math.max(0, (confidence - lowConfidence) / (highConfidence - lowConfidence)),
    );
    const smooth = normalized * normalized * (3 - 2 * normalized);
    pixels[index] = Math.round(smooth * 255);
  }
  context.putImageData(image, 0, 0);
}

function drawEffectWithoutMask(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  mode: CameraBackgroundMode,
  customBackground?: HTMLImageElement,
) {
  const { width, height } = canvas;
  context.save();
  context.clearRect(0, 0, width, height);
  if (mode === 'custom' && customBackground) {
    drawImageCover(context, customBackground, width, height);
  } else {
    context.filter = 'blur(22px)';
    context.drawImage(video, -28, -28, width + 56, height + 56);
  }
  context.restore();
}

function drawImageCover(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  width: number,
  height: number,
) {
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  context.drawImage(
    image,
    (width - drawWidth) / 2,
    (height - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
}

function waitForVideo(video: HTMLVideoElement) {
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    video.addEventListener('loadedmetadata', () => resolve(), { once: true });
    video.addEventListener('error', () => reject(new Error('Не удалось открыть камеру.')), {
      once: true,
    });
  });
}

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Не удалось открыть выбранное изображение.'));
    image.src = source;
  });
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Не удалось прочитать выбранное изображение.'));
    reader.readAsDataURL(file);
  });
}

function stopStream(stream: MediaStream) {
  stream.getTracks().forEach((track) => track.stop());
}

function once(action: () => void) {
  let called = false;
  return () => {
    if (called) return;
    called = true;
    action();
  };
}
