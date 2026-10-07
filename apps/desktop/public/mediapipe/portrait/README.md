# Portrait segmentation assets

Bundled locally so camera processing does not upload frames or depend on a CDN.

- Runtime: `@mediapipe/tasks-vision` **0.10.32**, `wasm/` files copied unchanged.
- Model: Google MediaPipe Selfie Multiclass 256x256, float32, version **1**.
- Source: https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/1/selfie_multiclass_256x256.tflite
- Model card: https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Multiclass%20Segmentation.pdf

The six output classes are background, hair, body skin, face skin, clothes,
and other objects. Only classes 1–4 contribute to the person mask.
Both SIMD and non-SIMD runtime binaries are retained for compatibility.
