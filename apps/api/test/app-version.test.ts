import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { API_VERSION } from '../src/app-version.js';

describe('API version', () => {
  it('comes from the package manifest used by deployments', async () => {
    const packagePath = fileURLToPath(new URL('../package.json', import.meta.url));
    const manifest = JSON.parse(await readFile(packagePath, 'utf8')) as { version: string };

    expect(API_VERSION).toBe(manifest.version);
  });
});
