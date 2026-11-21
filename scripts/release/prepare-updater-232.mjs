import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';

const version = '0.4.0-beta.232';
const base = 'https://github.com/GeraMall/FreeTalk/releases/download/desktop-v' + version + '/';
const files = {
  'windows-x86_64': ['windows', `Trlka_${version}_x64-setup.exe`],
  'darwin-aarch64': ['macos', `Trlka_${version}_aarch64.app.tar.gz`],
};
const platforms = Object.fromEntries(
  Object.entries(files).map(([platform, [folder, name]]) => {
    const path = new URL(`${folder}/${name}`, import.meta.url);
    assert(statSync(path).size > 1_000_000);
    const signature = readFileSync(new URL(path.href + '.sig'), 'utf8').trim();
    assert(Buffer.from(signature, 'base64').toString('utf8').startsWith('untrusted comment:'));
    return [platform, { signature, url: base + name }];
  }),
);
const manifest = JSON.stringify({
  version,
  notes: 'TRLKA beta.232. Windows: снижена нагрузка локального превью 2K. macOS: улучшены настройка захвата и повторный запуск демонстрации.',
  pub_date: new Date().toISOString(),
  platforms,
}, null, 2) + '\n';
writeFileSync(new URL('latest.json', import.meta.url), manifest);
console.log(JSON.stringify({ version, platforms: Object.keys(platforms), sha256: createHash('sha256').update(manifest).digest('hex') }));
