#!/usr/bin/env bash
set -euo pipefail

out_dir=$1
stage=$2
version=$3
fixture_key=${4:-}
source_dir="$PWD/apps/linux-desktop"
test ! -e "$stage/package.json"
mkdir -p "$out_dir" "$stage"

cp "$source_dir"/{main.cjs,preload.cjs,desktop-bridge.cjs,linux-updater.cjs} "$stage/"
cp "$source_dir"/{capture-picker.html,capture-picker.cjs,package.json,package-lock.json} "$stage/"
cp "$source_dir/update-config.json" "$stage/"
if [[ -f "$source_dir/capture-picker.css" ]]; then
  cp "$source_dir/capture-picker.css" "$stage/"
fi
cp -r apps/desktop/dist "$stage/frontend"
cp apps/desktop/src-tauri/tauri.conf.json "$stage/app-config.json"
cp apps/desktop/src-tauri/icons/icon.png "$stage/app-icon.png"
cp LICENSE "$stage/"
install -m 755 "$source_dir/install-update" "$stage/install-update"

node - "$stage" "$fixture_key" <<'NODE'
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const [stage, fixtureKey] = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync(path.join(stage, 'app-config.json'), 'utf8'));
const encoded = fixtureKey ? fs.readFileSync(fixtureKey, 'utf8') : config.plugins.updater.pubkey;
const key = (
  encoded.trim().startsWith('untrusted comment:')
    ? encoded
    : Buffer.from(encoded.trim(), 'base64').toString('utf8')
).trim();
const keyLines = key.split(/\r?\n/);
assert.equal(keyLines.length, 2);
assert(keyLines[0].startsWith('untrusted comment:'));
const publicKey = Buffer.from(keyLines[1], 'base64');
assert.equal(publicKey.length, 42);
assert.equal(publicKey.toString('ascii', 0, 2), 'Ed');
const publicKeyText = key + '\n';
const updaterConfigPath = path.join(stage, 'update-config.json');
const updateConfig = fixtureKey
  ? { feedUrl: 'http://127.0.0.1:41230/latest.json', allowLoopback: true }
  : JSON.parse(fs.readFileSync(updaterConfigPath, 'utf8'));
fs.writeFileSync(
  updaterConfigPath,
  JSON.stringify({ ...updateConfig, publicKey: publicKeyText }) + '\n',
);
fs.writeFileSync(path.join(stage, 'linux-updater-key.txt'), publicKeyText, { mode: 0o644 });
NODE

(
  cd "$stage"
  npm version "$version" --no-git-tag-version --ignore-scripts --allow-same-version
  npm ci --no-audit --no-fund
  for format in deb appimage; do
    node - "$format" <<'NODE'
const fs = require('node:fs');
const format = process.argv[2];
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
pkg.build.directories.output = `packages/${format}`;
pkg.build.extraResources = pkg.build.extraResources.filter(({ from }) => from === 'LICENSE');
if (format === 'deb') {
  for (const file of ['install-update', 'linux-updater-key.txt']) {
    pkg.build.extraResources.push({ from: file, to: file });
  }
}
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
NODE
    APPIMAGE_EXTRACT_AND_RUN=1 npm run "package:$format"
  done
)
cp "$stage/packages/deb/Trlka_${version}_amd64.deb" "$out_dir/"
cp "$stage/packages/appimage/Trlka_${version}_x86_64.AppImage" "$out_dir/"
