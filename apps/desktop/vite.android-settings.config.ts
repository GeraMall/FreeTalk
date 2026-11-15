import { defineConfig, mergeConfig } from 'vite';
import { cpSync } from 'node:fs';
import base from './vite.config';

const outDir = '../android-native/app/src/main/assets/settings';
export default mergeConfig(
  base,
  defineConfig({
    publicDir: false,
    plugins: [
      {
        name: 'settings-camera-and-sound-assets',
        closeBundle() {
          for (const folder of ['sounds', 'mediapipe']) {
            cpSync(`public/${folder}`, `${outDir}/${folder}`, { recursive: true });
          }
        },
      },
    ],
    build: {
      outDir,
      emptyOutDir: true,
      sourcemap: false,
      rollupOptions: { input: 'android-settings.html' },
    },
  }),
);
