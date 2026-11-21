import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';

const version = '0.4.0-beta.232';
const setup = `windows/Trlka_${version}_x64-setup.exe`;
const portable = `windows/Trlka_${version}_portable_x64.exe`;
const macUpdater = `macos/Trlka_${version}_aarch64.app.tar.gz`;
const dmg = `macos/Trlka_${version}_aarch64.dmg`;

for (const file of [setup, portable]) {
  const bytes = readFileSync(file);
  assert.equal(bytes.toString('ascii', 0, 2), 'MZ');
  const pe = bytes.readUInt32LE(0x3c);
  assert.equal(bytes.readUInt32LE(pe), 0x4550);
  if (file === portable) assert.equal(bytes.readUInt16LE(pe + 4), 0x8664);
  assert(bytes.includes(Buffer.from(`${version}\0`, 'utf16le')), `Incorrect version: ${file}`);
}
assert.equal(readFileSync(dmg).subarray(-512, -508).toString('ascii'), 'koly');

const metadata = [setup, setup + '.sig', portable, macUpdater, macUpdater + '.sig', dmg, 'latest.json'].map((file) => {
  const bytes = readFileSync(file);
  return { name: basename(file), size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
});
const sums = metadata.map(({ name, sha256 }) => `${sha256}  ${name}`).join('\n') + '\n';
writeFileSync('SHA256SUMS.txt', sums);
metadata.push({ name: 'SHA256SUMS.txt', size: Buffer.byteLength(sums), sha256: createHash('sha256').update(sums).digest('hex') });
writeFileSync('verified-metadata.json', JSON.stringify(metadata, null, 2) + '\n');
console.log(JSON.stringify(metadata));
