import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const packageJson = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as {
  version: string;
};

export default defineConfig({
  cacheDir: 'node_modules/.vite-freetalk-admin',
  plugins: [react()],
  define: { __FREETALK_ADMIN_VERSION__: JSON.stringify(packageJson.version) },
  clearScreen: false,
  server: { strictPort: true, host: '127.0.0.1', port: 1430 },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: { target: ['es2021', 'chrome105', 'safari13'], sourcemap: true },
});
