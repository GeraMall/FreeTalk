import assert from 'node:assert/strict';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';

const [installer, signatureFile, configFile = 'apps/desktop/src-tauri/tauri.conf.json'] =
  process.argv.slice(2);
assert(
  installer && signatureFile,
  'Usage: node verify-updater.mjs installer.exe installer.exe.sig [tauri.conf.json]',
);
const decodeEnvelope = (value) => {
  const text = value.trim();
  return (
    text.startsWith('untrusted comment:') ? text : Buffer.from(text, 'base64').toString('utf8')
  ).split(/\r?\n/);
};
const keyLines = decodeEnvelope(
  JSON.parse(readFileSync(configFile, 'utf8')).plugins.updater.pubkey,
);
const signatureLines = decodeEnvelope(readFileSync(signatureFile, 'utf8'));
const key = Buffer.from(keyLines[1], 'base64');
const signature = Buffer.from(signatureLines[1], 'base64');
assert.equal(key.length, 42);
assert.equal(signature.length, 74);
assert(key.subarray(2, 10).equals(signature.subarray(2, 10)), 'Updater key identifier mismatch');
const algorithm = signature.toString('ascii', 0, 2);
assert(['Ed', 'ED'].includes(algorithm), 'Unsupported signature algorithm');
const publicKey = createPublicKey({
  key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), key.subarray(10)]),
  format: 'der',
  type: 'spki',
});
const bytes = readFileSync(installer);
const message = algorithm === 'ED' ? createHash('blake2b512').update(bytes).digest() : bytes;
assert(verify(null, message, publicKey, signature.subarray(10)), 'Invalid installer signature');
const prefix = 'trusted comment: ';
assert(signatureLines[2].startsWith(prefix), 'Missing trusted comment');
assert(
  verify(
    null,
    Buffer.concat([
      signature.subarray(10),
      Buffer.from(signatureLines[2].slice(prefix.length), 'utf8'),
    ]),
    publicKey,
    Buffer.from(signatureLines[3], 'base64'),
  ),
  'Invalid trusted-comment signature',
);
console.log(
  JSON.stringify({
    installer,
    verified: true,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }),
);
