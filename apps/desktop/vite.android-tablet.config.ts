import { defineConfig, mergeConfig } from 'vite';
import { cpSync } from 'node:fs';
import base from './vite.config';

const apple = process.env.TRLKA_TABLET_PLATFORM === 'ios';
const outDir = apple ? '../apple/build/tablet' : '../android-native/app/src/main/assets/tablet';

export default mergeConfig(
  base,
  defineConfig({
    publicDir: false,
    plugins: [
      {
        name: 'tablet-game-sounds',
        closeBundle() {
          cpSync('public/sounds', `${outDir}/sounds`, {
            recursive: true,
          });
        },
      },
      ...(apple
        ? [
            {
              name: 'tablet-webkit-script',
              transformIndexHtml: {
                order: 'post' as const,
                handler: (html: string) =>
                  html
                    .replace('type="module" crossorigin', 'defer')
                    .replace('rel="stylesheet" crossorigin', 'rel="stylesheet"'),
              },
            },
          ]
        : []),
    ],
    build: {
      outDir,
      emptyOutDir: true,
      sourcemap: false,
      rollupOptions: {
        input: 'android-tablet.html',
        ...(apple && { output: { format: 'iife', inlineDynamicImports: true } }),
      },
    },
  }),
);
