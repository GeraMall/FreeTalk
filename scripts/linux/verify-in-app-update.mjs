/* global document, window -- These callbacks run in the packaged app through CDP. */
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { promisify } from 'node:util';

const [format, oldFile, candidateFile, casesDir, reportDir] = process.argv.slice(2);
assert(
  ['appimage', 'deb'].includes(format) && oldFile && candidateFile && casesDir && reportDir,
  'Usage: verify-in-app-update.mjs <appimage|deb> <old-executable> <candidate> <cases-dir> <report-dir>',
);
assert.equal(
  process.platform,
  'linux',
  'Run the update smoke in an isolated Linux graphical session',
);

const oldVersion = '0.4.0-beta.233';
const newVersion = '0.4.0-beta.234';
const feedOrigin = 'http://127.0.0.1:41230';
const cdpOrigin = 'http://127.0.0.1:41231';
const rendererUrl = 'tauri://localhost/index.html';
const marker = randomUUID();
const candidate = resolve(candidateFile);
const installed = resolve(oldFile);
const candidatePath = `/${encodeURIComponent(basename(candidate))}`;
const run = promisify(execFile);
const report = { format, oldVersion, newVersion, requests: [], checks: {} };

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

const [candidateSha256, { size: candidateSize }, valid, badSignature, badHash] = await Promise.all([
  sha256(candidate),
  stat(candidate),
  readFile(join(casesDir, 'valid.json')),
  readFile(join(casesDir, 'bad-signature.json')),
  readFile(join(casesDir, 'bad-hash.json')),
]);
const manifests = { valid, badSignature, badHash };

function unpack(envelope) {
  const { payload, signature } = JSON.parse(envelope);
  const manifest = Buffer.from(payload, 'base64');
  return { manifest, signature: Buffer.from(signature, 'base64') };
}

const candidateUrl = `${feedOrigin}${candidatePath}`;
const platform = JSON.parse(unpack(valid).manifest).platforms[format];
assert.equal(platform.url, candidateUrl);
assert.equal(platform.sha256, candidateSha256);
assert.equal(platform.size, candidateSize);

let feedCase = 'closed';
const feed = createServer((request, response) => {
  const { method, url } = request;
  report.requests.push({ method, url, case: feedCase });
  if (!['GET', 'HEAD'].includes(method)) return response.writeHead(405).end();
  if (url === '/latest.json' && manifests[feedCase]) {
    const manifest = manifests[feedCase];
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Length': manifest.length,
      'Content-Type': 'application/json',
    });
    return response.end(method === 'GET' ? manifest : undefined);
  }
  if (url === candidatePath && ['valid', 'badHash'].includes(feedCase)) {
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Length': candidateSize,
      'Content-Type': 'application/octet-stream',
    });
    if (method === 'HEAD') return response.end();
    const stream = createReadStream(candidate);
    response.once('close', () => stream.destroy());
    stream.once('error', () => response.destroy());
    return stream.pipe(response);
  }
  response.writeHead(404).end();
});

async function eventually(description, test, timeout = 35_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await test();
    if (result) return result;
    await pause(150);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function connect(url) {
  assert.equal(new URL(url).hostname, '127.0.0.1');
  const socket = new WebSocket(url);
  const opening = Promise.withResolvers();
  const requests = new Map();
  let sequence = 0;
  socket.addEventListener('open', opening.resolve, { once: true });
  socket.addEventListener('error', () => opening.reject(new Error('Unable to attach Chromium')));
  socket.addEventListener('close', () => {
    const error = new Error('Chromium debugger disconnected');
    opening.reject(error);
    for (const request of requests.values()) request.reject(error);
  });
  socket.addEventListener('message', ({ data }) => {
    const response = JSON.parse(data);
    const request = requests.get(response.id);
    if (response.error) request?.reject(new Error(response.error.message));
    else request?.resolve(response.result);
  });
  const openingTimer = setTimeout(() => socket.close(), 5_000);
  try {
    await opening.promise;
  } finally {
    clearTimeout(openingTimer);
  }

  async function command(method, params = {}, timeout = 10_000) {
    const id = ++sequence;
    const request = Promise.withResolvers();
    const timer = setTimeout(() => request.reject(new Error(`${method} timed out`)), timeout);
    requests.set(id, request);
    try {
      socket.send(JSON.stringify({ id, method, params }));
      return await request.promise;
    } finally {
      clearTimeout(timer);
      requests.delete(id);
    }
  }

  return {
    close: () => socket.close(),
    command,
    async evaluate(action, arg, timeout) {
      const { result, exceptionDetails } = await command(
        'Runtime.evaluate',
        {
          expression: `(${action.toString()})(${JSON.stringify(arg) ?? ''})`,
          awaitPromise: true,
          returnByValue: true,
          userGesture: true,
        },
        timeout,
      );
      if (exceptionDetails) {
        throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
      }
      return result.value;
    },
  };
}

async function queryDebugger(path) {
  try {
    const response = await fetch(`${cdpOrigin}${path}`, { signal: AbortSignal.timeout(2_000) });
    return await response.json();
  } catch {
    return undefined;
  }
}

const profile = await mkdtemp(join(tmpdir(), 'trlka-update-smoke-'));
const runtimeTemp = join(profile, 'temp');
await mkdir(runtimeTemp);
const logs = [];
const children = [];
function launch() {
  const child = spawn(
    installed,
    [
      '--remote-debugging-address=127.0.0.1',
      '--remote-debugging-port=41231',
      '--ozone-platform=x11',
      '--disable-background-networking',
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost',
      '--proxy-server=http://127.0.0.1:1',
    ],
    {
      detached: true,
      env: {
        ...process.env,
        XDG_CONFIG_HOME: join(profile, 'config'),
        XDG_DATA_HOME: join(profile, 'data'),
        XDG_CACHE_HOME: join(profile, 'cache'),
        TMPDIR: runtimeTemp,
        XDG_SESSION_TYPE: 'x11',
        WAYLAND_DISPLAY: '',
        ...(format === 'appimage' ? { APPIMAGE_EXTRACT_AND_RUN: '1' } : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  children.push(child);
  child.on('error', (error) => logs.push(String(error)));
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk) => {
      logs.push(chunk.toString());
      if (logs.length > 100) logs.shift();
    });
  }
}

async function pageFor(replacedId) {
  const target = await eventually('active packaged renderer', async () => {
    const targets = await queryDebugger('/json/list');
    return targets?.find(
      (entry) => entry.type === 'page' && entry.url === rendererUrl && entry.id !== replacedId,
    );
  });
  const page = await connect(target.webSocketDebuggerUrl);
  await eventually('sign-in view', () =>
    page.evaluate(() => Boolean(document.querySelector('.auth-form-login #login-password'))),
  );
  return { page, id: target.id };
}

async function screenshot(page, name) {
  const { data } = await page.command('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(reportDir, name), Buffer.from(data, 'base64'));
}

async function closeBrowser() {
  const debuggerInfo = await queryDebugger('/json/version');
  if (!debuggerInfo?.webSocketDebuggerUrl) return;
  const browser = await connect(debuggerInfo.webSocketDebuggerUrl);
  try {
    await browser.command('Browser.close', {}, 3_000).catch(() => undefined);
  } finally {
    browser.close();
  }
}

async function check(page) {
  return await page.evaluate(async () => {
    try {
      return await window.trlkaLinuxDesktop.updates.check();
    } catch (error) {
      return { kind: 'error', message: String(error) };
    }
  });
}

async function prepare(page) {
  return await page.evaluate(
    async () => {
      const { updates } = window.trlkaLinuxDesktop;
      let progressEvents = 0;
      const removeProgress = updates.onProgress(() => {
        progressEvents += 1;
      });
      try {
        return { result: await updates.prepare(), progressEvents };
      } catch (error) {
        return { error: String(error), progressEvents };
      } finally {
        removeProgress?.();
      }
    },
    undefined,
    65_000,
  );
}

async function debVersion() {
  const { stdout } = await run('dpkg-query', ['-W', '-f=${Version}', 'trlka'], { timeout: 10_000 });
  return stdout.trim().replace('~beta.', '-beta.');
}

async function runDebHelper(stage) {
  const uid = process.getuid();
  assert(uid > 0, 'Run the application as the unprivileged CI user');
  await run('sudo', ['-n', `PKEXEC_UID=${uid}`, '/opt/Trlka/resources/install-update', stage], {
    timeout: 120_000,
  });
}

async function installInvalidDeb(envelope) {
  const stage = await mkdtemp(join(profile, 'package-'));
  const { manifest, signature } = unpack(envelope);
  await Promise.all([
    writeFile(join(stage, 'manifest.json'), manifest, { mode: 0o600 }),
    writeFile(join(stage, 'manifest.json.minisig'), signature, { mode: 0o600 }),
    copyFile(candidate, join(stage, 'package.deb')),
  ]);
  try {
    await runDebHelper(stage);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

let currentPage;
try {
  await mkdir(reportDir, { recursive: true });
  await new Promise((ready, fail) => {
    feed.once('error', fail);
    feed.listen(41230, '127.0.0.1', ready);
  });
  if (format === 'deb') assert.equal(await debVersion(), oldVersion);
  launch();
  const old = await pageFor();
  currentPage = old.page;
  assert.equal(await old.page.evaluate(() => window.trlkaLinuxDesktop.version()), oldVersion);
  await old.page.evaluate((value) => {
    const key = 'freetalk.settings.v1';
    const settings = JSON.parse(localStorage.getItem(key) ?? '{}');
    localStorage.setItem(key, JSON.stringify({ ...settings, autoUpdate: false }));
    localStorage.setItem('trlka-updater-smoke-profile', value);
  }, marker);
  const timeOrigin = await old.page.evaluate(() => performance.timeOrigin);
  await old.page.command('Page.reload');
  await eventually('reloaded manual update settings', async () => {
    try {
      return await old.page.evaluate(
        (initial) =>
          performance.timeOrigin !== initial &&
          Boolean(document.querySelector('.auth-form-login #login-password')),
        timeOrigin,
      );
    } catch (error) {
      if (/context|navigat/i.test(error.message)) return false;
      throw error;
    }
  });

  feedCase = 'badSignature';
  assert.equal((await check(old.page)).kind, 'error', 'Altered signature was not rejected');
  assert(
    report.requests.some((item) => item.case === 'badSignature' && item.url === '/latest.json'),
  );
  assert(
    !report.requests.some((item) => item.case === 'badSignature' && item.url === candidatePath),
  );
  report.checks.invalidSignatureRejected = true;

  feedCase = 'badHash';
  const wrongHash = await check(old.page);
  assert.equal(wrongHash.kind, 'available');
  assert.equal(wrongHash.version, newVersion);
  const refused = await prepare(old.page);
  assert(refused.error, 'Signed wrong digest was not rejected');
  assert(report.requests.some((item) => item.case === 'badHash' && item.url === candidatePath));
  assert.equal(await old.page.evaluate(() => window.trlkaLinuxDesktop.version()), oldVersion);
  report.checks.invalidArtifactHashRejected = true;

  feedCase = 'valid';
  if (format === 'appimage') {
    assert(
      await old.page.evaluate(() => {
        const settings = document.querySelector('.welcome-topbar button.icon-button.quiet');
        settings?.click();
        return Boolean(settings);
      }),
      'Settings button missing',
    );
    await eventually('About tab', () =>
      old.page.evaluate(() => {
        const buttons = document.querySelectorAll('.settings-sidebar nav button');
        const about = Array.from(buttons).at(-1);
        about?.click();
        return Boolean(about);
      }),
    );
    await eventually('Check for updates action', () =>
      old.page.evaluate(() => {
        const button = document.querySelector('.about-section .update-section button');
        button?.click();
        return Boolean(button);
      }),
    );
    await eventually('new version offered by settings', () =>
      old.page.evaluate(
        (version) =>
          document
            .querySelector('.about-section .update-section button.primary')
            ?.textContent?.includes(version),
        newVersion,
      ),
    );
    await screenshot(old.page, 'before-update.png');
    await old.page.evaluate(() => {
      const update = document.querySelector('.about-section .update-section button.primary');
      update.click();
    });
    report.checks.installTriggeredThroughUi = true;
  } else {
    const found = await check(old.page);
    assert.equal(found.kind, 'available');
    assert.equal(found.version, newVersion);
    const prepared = await prepare(old.page);
    assert.equal(prepared.result?.kind, 'available');
    assert.equal(prepared.result?.downloaded, true);
    assert(prepared.progressEvents > 0);
    report.checks.verifiedDownload = true;

    await assert.rejects(installInvalidDeb(badSignature), (error) =>
      error.stderr?.includes('Update manifest signature is invalid'),
    );
    await assert.rejects(installInvalidDeb(badHash), (error) =>
      error.stderr?.includes('Debian package failed integrity verification'),
    );
    assert.equal(await debVersion(), oldVersion);
    report.checks.rootHelperRejectedInvalidInputs = true;

    const refusal = await old.page.evaluate(
      async () => {
        try {
          await window.trlkaLinuxDesktop.updates.apply();
          return null;
        } catch (error) {
          return String(error);
        }
      },
      undefined,
      120_000,
    );
    if (refusal) {
      assert.match(refusal, /Система не предоставила права|Установка обновления отменена/);
      assert.equal(await debVersion(), oldVersion);
      const stages = (await readdir(runtimeTemp)).filter((entry) =>
        entry.startsWith('trlka-update-'),
      );
      assert.equal(stages.length, 1, 'Missing runtime-verified Debian stage');
      const stage = join(runtimeTemp, stages[0]);
      const { manifest, signature } = unpack(valid);
      assert.deepEqual(await readFile(join(stage, 'manifest.json')), manifest);
      assert.deepEqual(await readFile(join(stage, 'manifest.json.minisig')), signature);
      assert.equal(await sha256(join(stage, 'package.deb')), candidateSha256);
      await runDebHelper(stage);
      report.checks.installPath = 'sudo /opt/Trlka/resources/install-update';
      report.checks.policyKitRefusal = refusal;
      await closeBrowser();
      await eventually('old debugger closed', async () => !(await queryDebugger('/json/version')));
      launch();
    } else {
      report.checks.installPath = 'in-app PolicyKit with isolated CI authorization';
      await old.page.evaluate(() => {
        setTimeout(() => {
          void window.trlkaLinuxDesktop.updates.restart();
        }, 50);
      });
    }
    assert.equal(await debVersion(), newVersion);
  }

  const next = await pageFor(old.id);
  currentPage = next.page;
  assert.equal(await next.page.evaluate(() => window.trlkaLinuxDesktop.version()), newVersion);
  assert.equal(
    await next.page.evaluate(() => localStorage.getItem('trlka-updater-smoke-profile')),
    marker,
  );
  assert(report.requests.some((item) => item.case === 'valid' && item.url === candidatePath));
  if (format === 'appimage') {
    assert.equal(await sha256(installed), candidateSha256);
    report.checks.installPath = 'in-app replacement of original AppImage';
    report.checks.originalAppImageNowMatchesCandidate = true;
  }
  report.checks.profileRetained = true;
  report.checks.newProcessReportsCandidateVersion = true;
  report.checks.signedCandidateSha256 = candidateSha256;
  await screenshot(next.page, 'after-update.png');
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.error = String(error);
  if (currentPage) await screenshot(currentPage, 'failure.png').catch(() => undefined);
  throw error;
} finally {
  await closeBrowser().catch(() => undefined);
  currentPage?.close();
  await pause(500);
  for (const child of children) {
    if (child.pid) {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch (error) {
        if (error.code !== 'ESRCH')
          console.warn('Could not stop the test process group', error.code);
      }
    }
  }
  feed.closeAllConnections();
  feed.close();
  await Promise.all([
    writeFile(join(reportDir, 'report.json'), JSON.stringify(report, null, 2)),
    writeFile(join(reportDir, 'app.log'), logs.join('')),
    rm(profile, { recursive: true, force: true, maxRetries: 3 }),
  ]);
}
