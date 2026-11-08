import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { requireApi } from './common.mjs';

const { build } = requireApi('esbuild');
const pkg = JSON.parse(await readFile('apps/api/package.json', 'utf8'));
// Bundle workspace TS, keep the same installed third-party API dependencies.
// No tsx/dev-server runtime is included in the measured application.
const external = Object.keys(pkg.dependencies).filter((name) => !name.startsWith('@freetalk/'));
for (const entry of ['server', 'migrate']) {
  await build({
    entryPoints: [`apps/api/src/${entry}.ts`],
    outfile: `apps/api/dist/capacity-${entry}.mjs`,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    external,
    banner: {
      js: "import { createRequire as __capacityCreateRequire } from 'node:module'; var require = __capacityCreateRequire(import.meta.url);",
    },
  });
  execFileSync(process.execPath, ['--check', `apps/api/dist/capacity-${entry}.mjs`]);
}
