import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    assets: { type: 'string' },
    output: { type: 'string' },
    version: { type: 'string' },
    notes: { type: 'string', default: 'Встроенное обновление TRLKA для Linux.' },
    'fixture-key': { type: 'string' },
  },
});
assert(values.assets && values.output && values.version, 'Supply --assets, --output and --version');
assert(
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-beta\.(0|[1-9]\d*))?$/.test(values.version),
  'Invalid Linux release version',
);

const version = values.version;
const assets = resolve(values.assets);
const output = resolve(values.output);
const fixtureKey = values['fixture-key'] && resolve(values['fixture-key']);
if (!fixtureKey) assert(process.env.TAURI_SIGNING_PRIVATE_KEY, 'Linux release signing key missing');
const signer = resolve('apps/desktop/node_modules/@tauri-apps/cli/tauri.js');
const verifier = resolve('scripts/windows/verify-updater.mjs');
const origin = fixtureKey
  ? 'http://127.0.0.1:41230/'
  : `https://github.com/GeraMall/FreeTalk/releases/download/linux-v${version}/`;
await mkdir(output, { recursive: true });

function runNode(args, label) {
  const result = spawnSync(process.execPath, args, { stdio: ['ignore', 'ignore', 'inherit'] });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${label} failed`);
}

async function signFile(file, verify = !fixtureKey) {
  const keyArgs = fixtureKey ? ['--private-key-path', fixtureKey] : [];
  runNode([signer, 'signer', 'sign', '--app-version', version, ...keyArgs, file], basename(file));
  const signatureFile = `${file}.sig`;
  if (verify) runNode([verifier, file, signatureFile], `Verify ${basename(file)}`);
  return signatureFile;
}

async function describeFile(file) {
  const sha = createHash('sha256');
  for await (const chunk of createReadStream(file)) sha.update(chunk);
  return { sha256: sha.digest('hex'), size: (await stat(file)).size };
}

const formats = {
  deb: `Trlka_${version}_amd64.deb`,
  appimage: `Trlka_${version}_x86_64.AppImage`,
};
const platforms = {};
for (const [format, name] of Object.entries(formats)) {
  const target = join(assets, name);
  platforms[format] = { url: new URL(name, origin).href, ...(await describeFile(target)) };
  const signed = await signFile(target);
  const destination = join(output, `${name}.sig`);
  if (signed !== destination) await rename(signed, destination);
}

const manifest = { schema: 1, version, notes: values.notes, platforms };
const work = await mkdtemp(join(tmpdir(), 'trlka-linux-feed-'));
async function makeEnvelope(info, label) {
  const message = Buffer.from(`${JSON.stringify(info)}\n`);
  const messageFile = join(work, `${label}.json`);
  await writeFile(messageFile, message);
  const signatureFile = await signFile(messageFile);
  return {
    payload: message.toString('base64'),
    signature: (await readFile(signatureFile, 'utf8')).trim(),
  };
}

async function writeEnvelope(file, envelope) {
  await writeFile(join(output, file), `${JSON.stringify(envelope)}\n`);
}

try {
  const valid = await makeEnvelope(manifest, 'valid');
  if (!fixtureKey) {
    await writeEnvelope('latest.json', valid);
  } else {
    await writeEnvelope('valid.json', valid);
    const corrupted = Buffer.from(valid.signature, 'base64')
      .toString('utf8')
      .trimEnd()
      .split(/\r?\n/);
    const bytes = Buffer.from(corrupted[1], 'base64');
    assert.equal(bytes.length, 74);
    bytes[10] ^= 1;
    corrupted[1] = bytes.toString('base64');
    await writeEnvelope('bad-signature.json', {
      ...valid,
      signature: Buffer.from(`${corrupted.join('\n')}\n`).toString('base64'),
    });
    const incorrect = structuredClone(manifest);
    for (const target of Object.values(incorrect.platforms)) target.sha256 = '0'.repeat(64);
    await writeEnvelope('bad-hash.json', await makeEnvelope(incorrect, 'bad-hash'));
  }
} finally {
  await rm(work, { force: true, recursive: true });
}

console.log(JSON.stringify({ version, platforms }));
