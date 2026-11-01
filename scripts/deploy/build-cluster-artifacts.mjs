import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(join(root, 'apps/signaling/package.json'));
const { build } = require('esbuild');
const output = resolve(root, process.argv[2] ?? 'outputs/cluster');
const stage = join(output, 'node');
await mkdir(stage, { recursive: true });
for (const [source, target] of [
  ['server', 'server'],
  ['gateway', 'gateway'],
  ['cluster-admin', 'cluster-admin'],
]) {
  await build({
    entryPoints: [join(root, `apps/signaling/src/${source}.ts`)],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
    outfile: join(stage, `${target}.mjs`),
  });
}
for (const name of [
  'trlka-voice.service',
  'trlka-room-gateway.service',
  'cluster.env.example',
  'haproxy.cfg.example',
  'install-node.sh',
  'Caddyfile.routes.snippet',
  'api.env.example',
])
  await copyFile(join(root, 'deploy/cluster', name), join(stage, name));
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
await writeFile(join(stage, 'revision.txt'), `${revision}\n`);
const archive = join(output, 'trlka-cluster-node.tar.gz');
execFileSync('tar', ['-czf', archive, '-C', stage, '.']);
const sha256 = createHash('sha256')
  .update(await readFile(archive))
  .digest('hex');
await writeFile(`${archive}.sha256`, `${sha256}  trlka-cluster-node.tar.gz\n`);
console.log(JSON.stringify({ archive, sha256, revision }));
