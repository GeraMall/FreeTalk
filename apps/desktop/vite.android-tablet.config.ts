import { defineConfig, mergeConfig } from 'vite';
import { cpSync } from 'node:fs';
import base from './vite.config';

export default mergeConfig(
  base,
  defineConfig({
    publicDir: false,
    plugins: [
      {
        name: 'tablet-game-sounds',
        closeBundle() {
          cpSync('public/sounds', '../android-native/app/src/main/assets/tablet/sounds', {
            recursive: true,
          });
        },
      },
    ],
    build: {
      outDir: '../android-native/app/src/main/assets/tablet',
      emptyOutDir: true,
      sourcemap: false,
      rollupOptions: { input: 'android-tablet.html' },
    },
  }),
);
