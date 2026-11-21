const { createHash, createPublicKey, verify } = require('node:crypto');
const { spawn } = require('node:child_process');
const { createReadStream, createWriteStream } = require('node:fs');
const {
  access,
  chmod,
  copyFile,
  lstat,
  mkdtemp,
  open,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} = require('node:fs/promises');
const { dirname, isAbsolute, join } = require('node:path');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const releaseAssets = 'https://github.com/GeraMall/FreeTalk/releases/download/';
const installer = '/opt/Trlka/resources/install-update';
const maxPackageSize = 400 * 1024 * 1024;
const maxPayloadSize = 64 * 1024;
const downloadHosts = new Set([
  'github.com',
  'raw.githubusercontent.com',
  'release-assets.githubusercontent.com',
  'objects.githubusercontent.com',
]);
const invalidUpdate = 'Подпись или контрольная сумма обновления не совпала.';

class UpdateAuthorizationError extends Error {}

function decodeBase64(value, limit) {
  if (typeof value !== 'string' || value.length > Math.ceil(limit / 3) * 4)
    throw new Error(invalidUpdate);
  const decoded = Buffer.from(value, 'base64');
  if (!decoded.length || decoded.length > limit || decoded.toString('base64') !== value)
    throw new Error(invalidUpdate);
  return decoded;
}

function verifyFeed(envelope, publicKey) {
  const payload = decodeBase64(envelope?.payload, maxPayloadSize);
  const signature = decodeBase64(envelope?.signature, 4096);
  const [, packetText, comment, globalText] = signature.toString('utf8').trimEnd().split(/\r?\n/);
  const packet = decodeBase64(packetText, 74);
  const globalSignature = decodeBase64(globalText, 64);
  const [, keyText] = publicKey.trimEnd().split(/\r?\n/);
  const keyPacket = decodeBase64(keyText, 42);
  const commentPrefix = 'trusted comment: ';
  if (
    packet.length !== 74 ||
    packet.subarray(0, 2).toString('ascii') !== 'ED' ||
    globalSignature.length !== 64 ||
    keyPacket.length !== 42 ||
    keyPacket.subarray(0, 2).toString('ascii') !== 'Ed' ||
    !packet.subarray(2, 10).equals(keyPacket.subarray(2, 10)) ||
    !comment?.startsWith(commentPrefix)
  ) {
    throw new Error(invalidUpdate);
  }
  const key = createPublicKey({
    format: 'jwk',
    key: { kty: 'OKP', crv: 'Ed25519', x: keyPacket.subarray(10).toString('base64url') },
  });
  const signatureBytes = packet.subarray(10);
  const authenticatedComment = Buffer.concat([
    signatureBytes,
    Buffer.from(comment.slice(commentPrefix.length), 'utf8'),
  ]);
  if (
    !verify(null, createHash('blake2b512').update(payload).digest(), key, signatureBytes) ||
    !verify(null, authenticatedComment, key, globalSignature)
  ) {
    throw new Error(invalidUpdate);
  }
  return { manifest: JSON.parse(payload.toString('utf8')), payload, signature };
}

function linuxVersion(value) {
  if (typeof value !== 'string') throw new Error('Invalid Linux update version');
  const match =
    /^(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})(?:-beta\.(0|[1-9][0-9]{0,5}))?$/.exec(
      value,
    );
  if (!match) throw new Error('Invalid Linux update version');
  return [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4] ?? Infinity)];
}

function newer(candidate, current) {
  const target = linuxVersion(candidate);
  const baseline = linuxVersion(current);
  const different = target.findIndex((part, index) => part !== baseline[index]);
  return different !== -1 && target[different] > baseline[different];
}

function releaseName(version, format) {
  return format === 'deb'
    ? 'Trlka_' + version + '_amd64.deb'
    : 'Trlka_' + version + '_x86_64.AppImage';
}

function allowUrl(url, testOrigin) {
  if (url.username || url.password) return false;
  if (testOrigin) return url.origin === testOrigin;
  return url.protocol === 'https:' && !url.port && downloadHosts.has(url.hostname);
}

async function fetchUpdate(initialUrl, testOrigin, signal) {
  let url = new URL(initialUrl);
  for (let redirects = 0; redirects < 5; redirects += 1) {
    if (!allowUrl(url, testOrigin)) throw new Error('Недопустимый адрес сервера обновлений.');
    const response = await fetch(url, { redirect: 'manual', signal });
    if (response.status >= 300 && response.status < 400 && response.headers.has('location')) {
      await response.body?.cancel();
      url = new URL(response.headers.get('location'), url);
      continue;
    }
    if (response.ok && response.body) return response;
    await response.body?.cancel();
    throw new Error('Сервер обновлений Linux временно недоступен.');
  }
  throw new Error('Сервер обновлений Linux временно недоступен.');
}

async function readEnvelope(response) {
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 96 * 1024) throw new Error(invalidUpdate);
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function selectPackage(manifest, format, testOrigin) {
  if (manifest?.schema !== 1) throw new Error(invalidUpdate);
  const { version } = manifest;
  linuxVersion(version);
  const asset = manifest.platforms?.[format];
  const name = releaseName(version, format);
  const expected = testOrigin
    ? testOrigin + '/' + name
    : releaseAssets + 'linux-v' + version + '/' + name;
  if (
    !asset ||
    asset.url !== expected ||
    !Number.isSafeInteger(asset.size) ||
    asset.size <= 0 ||
    asset.size > maxPackageSize ||
    typeof asset.sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(asset.sha256)
  ) {
    throw new Error(invalidUpdate);
  }
  return asset;
}

async function transfer(asset, destination, testOrigin, report) {
  const response = await fetchUpdate(asset.url, testOrigin, AbortSignal.timeout(15 * 60 * 1000));
  let received = 0;
  const hash = createHash('sha256');
  let lastProgress = 0;
  const measure = new Transform({
    transform(chunk, _encoding, done) {
      received += chunk.length;
      if (received > asset.size) return done(new Error(invalidUpdate));
      hash.update(chunk);
      const progress = Math.floor((received * 100) / asset.size);
      if (progress > lastProgress && progress < 100) {
        lastProgress = progress;
        report(progress);
      }
      done(null, chunk);
    },
  });
  await pipeline(
    Readable.fromWeb(response.body),
    measure,
    createWriteStream(destination, { flags: 'wx', mode: 0o600 }),
  );
  if (received !== asset.size || hash.digest('hex') !== asset.sha256)
    throw new Error(invalidUpdate);
  report(100);
}

async function appImageFile(value) {
  if (!isAbsolute(value)) throw new Error('Не удалось найти исходный файл AppImage.');
  const path = await realpath(value);
  const stats = await lstat(path);
  if (!stats.isFile() || stats.uid !== process.getuid()) {
    throw new Error('Для обновления AppImage нужен доступ на запись в папку с программой.');
  }
  const file = await open(path, 'r');
  try {
    const header = Buffer.alloc(11);
    await file.read(header, 0, header.length, 0);
    if (
      header.subarray(0, 4).toString('hex') !== '7f454c46' ||
      header.subarray(8).toString('hex') !== '414902'
    )
      throw new Error('Не удалось проверить исходный файл AppImage.');
    return { path, stats };
  } finally {
    await file.close();
  }
}

async function replaceAppImage(source, verifiedTarget, asset) {
  const { path, stats } = verifiedTarget;
  const changed = 'Файл AppImage изменился. Перезапустите приложение и повторите обновление.';
  const checkTarget = async () => {
    const current = await lstat(path);
    if (
      !current.isFile() ||
      current.ino !== stats.ino ||
      current.dev !== stats.dev ||
      current.size !== stats.size ||
      current.mtimeMs !== stats.mtimeMs ||
      current.ctimeMs !== stats.ctimeMs
    ) {
      throw new Error(changed);
    }
  };
  await checkTarget();
  const folder = await mkdtemp(join(dirname(path), '.trlka-update-'));
  try {
    const temporary = join(folder, 'Trlka.AppImage');
    await copyFile(source, temporary);
    const hash = createHash('sha256');
    let size = 0;
    for await (const chunk of createReadStream(temporary)) {
      size += chunk.length;
      if (size > asset.size) throw new Error(invalidUpdate);
      hash.update(chunk);
    }
    if (size !== asset.size || hash.digest('hex') !== asset.sha256) throw new Error(invalidUpdate);
    await chmod(temporary, stats.mode & 0o777);
    const file = await open(temporary, 'r+');
    try {
      await file.sync();
    } finally {
      await file.close();
    }
    await checkTarget();
    await rename(temporary, path);
  } finally {
    await rm(folder, { recursive: true, force: true }).catch(() => undefined);
  }
}

function installDeb(folder) {
  return new Promise((resolve, reject) => {
    const process = spawn('/usr/bin/pkexec', ['--disable-internal-agent', installer, folder], {
      stdio: 'ignore',
    });
    process.once('error', () =>
      reject(new Error('Не удалось запустить системную установку обновления.')),
    );
    process.once('close', (code) => {
      if (code === 0) resolve();
      else if (code === 126) reject(new UpdateAuthorizationError('Установка обновления отменена.'));
      else if (code === 127)
        reject(
          new UpdateAuthorizationError('Система не предоставила права на установку обновления.'),
        );
      else
        reject(new Error('Системный установщик не смог обновить Trlka. Можно повторить попытку.'));
    });
  });
}

function registerLinuxUpdater({ app, ipcMain, isTrusted }) {
  const version = app.getVersion();
  const image = app.isPackaged && process.env.APPIMAGE;
  const format = image
    ? 'appimage'
    : app.isPackaged && process.execPath === '/opt/Trlka/trlka'
      ? 'deb'
      : null;
  const config = require('./update-config.json');
  const feed = new URL(config.feedUrl);
  const testOrigin =
    config.allowLoopback && feed.protocol === 'http:' && feed.hostname === '127.0.0.1'
      ? feed.origin
      : null;
  let candidate;
  let prepared;
  let preparing;
  let applying;
  let installed;

  const guard = (channel, action) =>
    ipcMain.handle('trlka:update-' + channel, (event) => {
      if (!isTrusted(event)) throw new Error('Untrusted TRLKA window');
      return action(event.sender);
    });
  const available = (update, downloaded = false) => ({
    kind: 'available',
    version: update.manifest.version,
    notes: typeof update.manifest.notes === 'string' ? update.manifest.notes : undefined,
    downloaded,
  });
  const discard = async () => {
    if (!prepared) return;
    const { folder } = prepared;
    prepared = undefined;
    await rm(folder, { recursive: true, force: true }).catch(() => undefined);
  };

  guard('check', async () => {
    if (!format)
      return { kind: 'unavailable', message: 'Обновления доступны в AppImage и пакете .deb.' };
    if (installed || prepared) return available(installed ?? prepared.update, true);
    if (preparing) return preparing;
    try {
      if (format === 'deb') await access(installer);
      const publicKey = await readFile(join(__dirname, 'linux-updater.pub'), 'utf8');
      const response = await fetchUpdate(feed, testOrigin, AbortSignal.timeout(12_000));
      const signed = verifyFeed(await readEnvelope(response), publicKey);
      const asset = selectPackage(signed.manifest, format, testOrigin);
      candidate = newer(signed.manifest.version, version) ? { ...signed, asset } : undefined;
      return candidate ? available(candidate) : { kind: 'current', version };
    } catch (error) {
      candidate = undefined;
      return {
        kind: 'error',
        message:
          error.message === invalidUpdate
            ? invalidUpdate
            : 'Сервер обновлений Linux временно недоступен.',
      };
    }
  });

  guard('prepare', (view) => {
    if (installed || prepared) return available(installed ?? prepared.update, true);
    if (preparing) return preparing;
    if (!candidate) throw new Error('Сначала проверьте наличие обновлений.');
    preparing = (async (update) => {
      const target = image ? await appImageFile(image) : undefined;
      const folder = await mkdtemp(join(app.getPath('temp'), 'trlka-update-'));
      const packagePath = join(folder, format === 'deb' ? 'package.deb' : 'Trlka.AppImage');
      try {
        const report = (progress) => {
          if (!view.isDestroyed()) {
            view.send('trlka:update-progress', {
              kind: 'downloading',
              version: update.manifest.version,
              progress,
            });
          }
        };
        report(0);
        await transfer(update.asset, packagePath, testOrigin, report);
        if (format === 'deb') {
          await writeFile(join(folder, 'manifest.json'), update.payload, { mode: 0o600 });
          await writeFile(join(folder, 'manifest.json.minisig'), update.signature, { mode: 0o600 });
        }
        prepared = { folder, packagePath, target, update };
        return available(update, true);
      } catch (error) {
        await rm(folder, { recursive: true, force: true }).catch(() => undefined);
        throw error;
      }
    })(candidate).finally(() => {
      preparing = undefined;
    });
    return preparing;
  });

  guard('apply', () => {
    if (installed) return;
    if (!prepared) throw new Error('Сначала загрузите обновление.');
    applying ??= (async ({ folder, packagePath, target, update }) => {
      try {
        if (target) await replaceAppImage(packagePath, target, update.asset);
        else await installDeb(folder);
      } catch (error) {
        if (!(error instanceof UpdateAuthorizationError)) await discard();
        if (error.code === 'EACCES' || error.code === 'EROFS') {
          throw new Error('Для обновления AppImage нужен доступ на запись в папку с программой.');
        }
        throw error;
      }
      installed = { ...update, imagePath: target?.path };
      await discard();
    })(prepared).finally(() => {
      applying = undefined;
    });
    return applying;
  });

  guard('restart', () => {
    if (!installed) throw new Error('Сначала установите обновление.');
    app.relaunch(
      installed.imagePath ? { execPath: installed.imagePath, args: process.argv.slice(1) } : {},
    );
    app.quit();
  });
  app.on('quit', () => {
    if (!applying) void discard();
  });
}

module.exports = { registerLinuxUpdater, verifyFeed };
