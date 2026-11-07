import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
);
const site = process.argv[2] || 'https://trlka.com/';
const response = await fetch(site, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
assert.equal(response.status, 200, `Landing unavailable: ${site}`);
const html = await response.text();
const links = [
  ...html.matchAll(
    /href=["'](https:\/\/github\.com\/GeraMall\/FreeTalk\/releases\/download\/[^"']+)["']/g,
  ),
].map((match) => match[1]);
assert(links.length > 0, 'Landing contains no installer links');
for (const link of new Set(links)) {
  const url = new URL(link);
  const expectedFolder = `/GeraMall/FreeTalk/releases/download/v${version}/`;
  assert(url.pathname.startsWith(expectedFolder), `Outdated release folder: ${link}`);
  const name = decodeURIComponent(url.pathname.slice(expectedFolder.length));
  assert(
    name.startsWith(`Trlka_${version}_`),
    `Installer filename differs from release version: ${link}`,
  );
  const asset = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(30000) });
  assert.equal(asset.status, 200, `Installer unavailable: ${link}`);
  assert(
    Number(asset.headers.get('content-length')) > 1000000,
    `Unexpected installer size: ${link}`,
  );
  assert(
    !asset.headers.get('content-type')?.includes('text/html'),
    `Download returned a webpage: ${link}`,
  );
  console.log(
    JSON.stringify({
      name,
      status: asset.status,
      bytes: Number(asset.headers.get('content-length')),
    }),
  );
}
console.log(`Verified ${links.length} download buttons for ${version}.`);
