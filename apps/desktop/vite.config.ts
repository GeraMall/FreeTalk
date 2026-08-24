import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const packageJson = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string };
const buildCommit = (() => {
  if (process.env.FREETALK_BUILD_COMMIT) return process.env.FREETALK_BUILD_COMMIT;
  try {
    return execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
  } catch {
    return 'unknown';
  }
})();

export default defineConfig({
  plugins: [react()],
  define: {
    __FREETALK_APP_VERSION__: JSON.stringify(packageJson.version),
    __FREETALK_BUILD_COMMIT__: JSON.stringify(buildCommit),
  },
  clearScreen: false,
  server: { strictPort: true, host: '127.0.0.1', port: 1420 },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: { target: ['es2021', 'chrome105', 'safari13'], sourcemap: true },
});
