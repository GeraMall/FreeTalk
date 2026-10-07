import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';
import { portraitAlpha } from './portrait-mask';

const worker = globalThis as unknown as {
  onmessage: (event: MessageEvent) => void;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};
let segmenter: ImageSegmenter | undefined;
const input = new OffscreenCanvas(1, 1);
const inputContext = input.getContext('2d');
worker.onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') {
      const files = await FilesetResolver.forVisionTasks(data.assetRoot);
      const options = {
        baseOptions: { modelAssetPath: `${data.assetRoot}/selfie_multiclass.tflite` },
        runningMode: 'VIDEO' as const,
        outputCategoryMask: false,
        outputConfidenceMasks: true,
      };
      try {
        if (data.delegate === 'CPU') throw new Error('CPU requested');
        segmenter = await ImageSegmenter.createFromOptions(files, {
          ...options,
          canvas: new OffscreenCanvas(256, 256),
          baseOptions: { ...options.baseOptions, delegate: 'GPU' },
        });
      } catch {
        segmenter = await ImageSegmenter.createFromOptions(files, options);
      }
      worker.postMessage({ type: 'ready' });
    } else if (data.type === 'frame') {
      const frame: ImageBitmap = data.frame;
      try {
        if (!segmenter) throw new Error('Portrait model is not ready');
        if (!inputContext) throw new Error('Portrait input canvas is unavailable');
        // The model is 256x256. Avoid reading six full-HD float masks back from
        // the GPU; 512px preserves an antialiased outline at a bounded cost.
        const scale = Math.min(1, 512 / Math.max(frame.width, frame.height));
        const width = Math.max(1, Math.round(frame.width * scale));
        const height = Math.max(1, Math.round(frame.height * scale));
        if (input.width !== width || input.height !== height) {
          input.width = width;
          input.height = height;
        }
        inputContext.drawImage(frame, 0, 0, width, height);
        segmenter.segmentForVideo(input, data.timestamp, (result) => {
          const masks = result.confidenceMasks;
          if (!masks?.length) throw new Error('Portrait mask is missing');
          const alpha = portraitAlpha(masks.map((mask) => mask.getAsFloat32Array()));
          worker.postMessage(
            { type: 'mask', width: masks[0]!.width, height: masks[0]!.height, alpha },
            [alpha.buffer],
          );
        });
      } finally {
        frame.close();
      }
    }
  } catch (error) {
    worker.postMessage({ type: 'error', message: String(error) });
  }
};
