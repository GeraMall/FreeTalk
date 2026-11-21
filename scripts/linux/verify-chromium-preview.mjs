/* global RTCPeerConnection, document, window -- Browser symbols run through CDP. */
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { promisify } from 'node:util';

const [binary, reportDir] = process.argv.slice(2);
assert(
  binary,
  'Usage: node scripts/linux/verify-chromium-preview.mjs <packaged binary> [report dir]',
);
assert.equal(process.platform, 'linux', 'Run this smoke test from a Linux graphical session');

const origin = 'tauri://localhost';
const xdo = promisify(execFile);
const version = JSON.parse(await readFile(new URL('../../package.json', import.meta.url))).version;
const profile = await mkdtemp(join(tmpdir(), 'trlka-linux-smoke-'));
const productProfile = join(profile, 'config');
const logs = [];
const app = spawn(
  resolve(binary),
  [
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=0',
    '--ozone-platform=x11',
    '--use-fake-device-for-media-stream',
    '--allow-loopback-in-peer-connection',
    '--disable-features=WebRtcHideLocalIpsWithMdns',
    '--disable-background-networking',
    '--disable-renderer-backgrounding',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost',
    '--proxy-server=http://127.0.0.1:1',
  ],
  {
    env: {
      ...process.env,
      XDG_CONFIG_HOME: productProfile,
      XDG_DATA_HOME: join(profile, 'data'),
      XDG_CACHE_HOME: join(profile, 'cache'),
      XDG_SESSION_TYPE: 'x11',
      WAYLAND_DISPLAY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
const appClosed = new Promise((resolveExit) => app.once('close', resolveExit));
let launchError;
app.once('error', (error) => {
  launchError = error;
});
for (const stream of [app.stdout, app.stderr]) {
  stream.on('data', (chunk) => {
    logs.push(chunk.toString());
    if (logs.length > 100) logs.shift();
  });
}

async function waitFor(label, timeout, check) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (launchError) throw launchError;
    if (app.exitCode !== null || app.signalCode !== null) {
      throw new Error(`App exited before ${label}: ${app.exitCode ?? app.signalCode}`);
    }
    const result = await check();
    if (result) return result;
    await pause(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function connectToPage(url) {
  assert.equal(new URL(url).hostname, '127.0.0.1');
  const opened = Promise.withResolvers();
  const socket = new WebSocket(url);
  const pending = new Map();
  let nextRequest = 0;
  socket.addEventListener('open', opened.resolve, { once: true });
  socket.addEventListener(
    'error',
    () => opened.reject(new Error('Could not open Chromium debugger')),
    { once: true },
  );
  socket.addEventListener('close', () => {
    const error = new Error('Chromium debugger closed');
    opened.reject(error);
    for (const request of pending.values()) request.reject(error);
  });
  socket.addEventListener('message', ({ data }) => {
    const response = JSON.parse(data);
    const request = pending.get(response.id);
    if (!request) return;
    if (response.error) request.reject(new Error(response.error.message));
    else request.resolve(response.result);
  });

  await opened.promise;
  async function command(method, params = {}, timeout = 10_000) {
    const id = ++nextRequest;
    const request = Promise.withResolvers();
    const timer = setTimeout(() => request.reject(new Error(`${method} timed out`)), timeout);
    pending.set(id, request);
    try {
      socket.send(JSON.stringify({ id, method, params }));
      return await request.promise;
    } finally {
      clearTimeout(timer);
      pending.delete(id);
    }
  }

  return {
    close: () => socket.close(),
    command,
    async evaluate(fn, arg, timeout) {
      const { exceptionDetails, result } = await command(
        'Runtime.evaluate',
        {
          expression: `(${fn.toString()})(${JSON.stringify(arg) ?? ''})`,
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

async function visibleTrlkaWindows() {
  try {
    const { stdout } = await xdo('xdotool', ['search', '--onlyvisible', '--name', '^Trlka$'], {
      timeout: 2_000,
    });
    return stdout.trim().split(/\s+/);
  } catch (error) {
    if (error.code === 1) return [];
    throw error;
  }
}

async function verifyMedia() {
  if (!window.isSecureContext || typeof navigator.mediaDevices?.getUserMedia !== 'function') {
    throw new Error('Bundled renderer cannot access secure media APIs');
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    video: { width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 15 } },
  });
  const peers = [
    new RTCPeerConnection({ iceServers: [] }),
    new RTCPeerConnection({ iceServers: [] }),
  ];
  const [sender, receiver] = peers;

  async function gatherDescription(peer) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (peer.iceGatheringState === 'complete') return peer.localDescription;
      await new Promise((done) => setTimeout(done, 50));
    }
    throw new Error(`ICE gathering did not complete (${peer.iceGatheringState})`);
  }

  async function receivedMedia(peer) {
    const stats = Array.from((await peer.getStats()).values());
    const audio = stats.find((entry) => entry.type === 'inbound-rtp' && entry.kind === 'audio');
    const video = stats.find((entry) => entry.type === 'inbound-rtp' && entry.kind === 'video');
    return {
      state: peer.connectionState,
      audioPackets: audio?.packetsReceived ?? 0,
      audioSamples: audio?.totalSamplesReceived ?? 0,
      videoFrames: video?.framesDecoded ?? 0,
      width: video?.frameWidth ?? 0,
      height: video?.frameHeight ?? 0,
    };
  }

  try {
    const tracks = stream.getTracks();
    if (tracks.length !== 2 || tracks.some((track) => track.readyState !== 'live')) {
      throw new Error('Expected live audio and video tracks from the synthetic capture devices');
    }
    for (const peer of peers) {
      for (const track of tracks) peer.addTrack(track, stream);
    }
    await sender.setLocalDescription(await sender.createOffer());
    await receiver.setRemoteDescription(await gatherDescription(sender));
    await receiver.setLocalDescription(await receiver.createAnswer());
    await sender.setRemoteDescription(await gatherDescription(receiver));

    let stats;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      stats = await Promise.all(peers.map(receivedMedia));
      if (
        stats.every(
          (peer) =>
            peer.state === 'connected' &&
            peer.audioPackets >= 5 &&
            peer.audioSamples > 0 &&
            peer.videoFrames >= 5 &&
            peer.width > 0 &&
            peer.height > 0,
        )
      ) {
        return stats;
      }
      await new Promise((done) => setTimeout(done, 100));
    }
    throw new Error(`Did not decode audio and video in both directions: ${JSON.stringify(stats)}`);
  } finally {
    for (const peer of peers) peer.close();
    for (const track of stream.getTracks()) track.stop();
  }
}

async function verifyDisplayCapture(cancel) {
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  } catch (error) {
    if (cancel && error.name === 'NotAllowedError') return { canceled: true };
    throw error;
  }

  const video = document.createElement('video');
  video.style.cssText = 'position:fixed; bottom:0; right:0; width:160px; height:120px;';
  video.muted = true;
  video.srcObject = stream;
  document.body.appendChild(video);
  try {
    if (cancel) throw new Error('Canceled picker returned an active capture');
    await video.play();
    const frame = await new Promise((done, fail) => {
      const timeout = setTimeout(
        () => fail(new Error('Display capture did not yield a frame')),
        8_000,
      );
      video.requestVideoFrameCallback((_now, metadata) => {
        clearTimeout(timeout);
        done({ width: metadata.width, height: metadata.height });
      });
    });
    if (frame.width < 640 || frame.height < 360) {
      throw new Error(`Unexpected virtual screen capture dimensions: ${JSON.stringify(frame)}`);
    }
    return frame;
  } finally {
    for (const track of stream.getTracks()) track.stop();
    video.remove();
  }
}

let page;
try {
  if (reportDir) await mkdir(resolve(reportDir), { recursive: true });
  const port = await waitFor(
    'local Chromium debugger',
    25_000,
    () => logs.join('').match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//)?.[1],
  );
  const readTargets = async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
      signal: AbortSignal.timeout(3_000),
    });
    return await response.json();
  };
  const target = await waitFor('bundled TRLKA window', 20_000, async () => {
    const targets = await readTargets();
    return targets.find(
      (candidate) => candidate.type === 'page' && candidate.url === `${origin}/index.html`,
    );
  });
  page = await connectToPage(target.webSocketDebuggerUrl);
  const title = await waitFor('rendered TRLKA sign-in form', 20_000, () =>
    page.evaluate(() => {
      const welcome = document.querySelector('.welcome-shell');
      const form = welcome?.querySelector('form');
      if (
        form?.getBoundingClientRect().height > 80 &&
        form.querySelector('input[type="password"]')
      ) {
        return welcome.querySelector('#welcome-title')?.textContent?.trim();
      }
    }),
  );
  assert.equal(title, 'Trlka');

  if (reportDir) {
    const { data } = await page.command('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(reportDir, 'startup.png'), Buffer.from(data, 'base64'));
  }

  const sentinel = `trlka-offline-smoke-${crypto.randomUUID()}`;
  const nativeVersion = await page.evaluate(() => window.trlkaLinuxDesktop.version());
  assert.equal(nativeVersion, version);
  try {
    await page.evaluate(async (token) => {
      const { session } = window.trlkaLinuxDesktop;
      await session.save(token);
      if ((await session.read()) !== token) throw new Error('Linux session did not round-trip');
    }, sentinel);
    const entries = await readdir(productProfile, { recursive: true, withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const data = await readFile(join(entry.parentPath, entry.name)).catch((error) => {
        if (error.code === 'ENOENT') return undefined;
        throw error;
      });
      assert(!data?.includes(sentinel), `Plaintext session material found in ${entry.name}`);
    }
  } finally {
    await page.evaluate(async () => {
      const { session } = window.trlkaLinuxDesktop;
      await session.clear();
      if ((await session.read()) !== null) throw new Error('Linux session was not cleared');
    });
  }

  const initialWindows = await waitFor('visible TRLKA desktop window', 10_000, async () => {
    const windows = await visibleTrlkaWindows();
    return windows.length > 0 ? windows : null;
  });
  let mediaFinished = false;
  const mediaPromise = page.evaluate(verifyMedia, undefined, 32_000).finally(() => {
    mediaFinished = true;
  });
  void mediaPromise.catch(() => undefined);
  const observedWindows = new Set(initialWindows);
  while (!mediaFinished) {
    const consent = await waitFor(
      'microphone and camera consent or completed media',
      30_000,
      async () => {
        if (mediaFinished) return { done: true };
        const windowId = (await visibleTrlkaWindows()).find((id) => !observedWindows.has(id));
        return windowId ? { windowId } : null;
      },
    );
    if (consent.done) break;
    observedWindows.add(consent.windowId);
    // The GTK dialog starts with its deny button focused. Tab selects Allow.
    await xdo('xdotool', ['windowfocus', '--sync', consent.windowId, 'key', 'Tab', 'space'], {
      timeout: 5_000,
    });
  }
  const media = await mediaPromise;

  async function chooseDisplay(cancel) {
    const capture = page.evaluate(verifyDisplayCapture, cancel, 27_000);
    void capture.catch(() => undefined);
    let picker;
    try {
      const target = await Promise.race([
        waitFor('TRLKA display picker', 12_000, async () => {
          const targets = await readTargets();
          return targets.find(
            (candidate) =>
              candidate.type === 'page' &&
              new URL(candidate.url).pathname.endsWith('/capture-picker.html'),
          );
        }),
        capture.then(() => {
          throw new Error('Capture completed before showing the picker');
        }),
      ]);
      picker = await connectToPage(target.webSocketDebuggerUrl);
      const sourceCount = await waitFor('available display sources', 8_000, () =>
        picker.evaluate(() => document.querySelectorAll('.capture-source').length),
      );
      const selected = await picker.evaluate((cancel) => {
        const button = document.querySelector(cancel ? '.capture-cancel' : '.capture-source');
        if (!button) return false;
        setTimeout(() => button.click(), 50);
        return true;
      }, cancel);
      assert(selected, 'No picker button available');
      return { sourceCount, ...(await capture) };
    } finally {
      picker?.close();
    }
  }

  const canceledDisplayCapture = await chooseDisplay(true);
  const displayCapture = await chooseDisplay(false);
  const report = {
    version: nativeVersion,
    signIn: title,
    sessionRoundTrip: true,
    media,
    canceledDisplayCapture,
    displayCapture,
  };
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (reportDir) await writeFile(join(reportDir, 'report.json'), json);
  console.log(json);
} catch (error) {
  const log = logs.join('');
  if (reportDir) await writeFile(join(reportDir, 'app.log'), log).catch(() => undefined);
  console.error(log);
  throw error;
} finally {
  page?.close();
  if (app.exitCode === null && app.signalCode === null) app.kill();
  await Promise.race([appClosed, pause(5_000, undefined, { ref: false })]);
  if (app.exitCode === null && app.signalCode === null) {
    app.kill('SIGKILL');
    await Promise.race([appClosed, pause(5_000, undefined, { ref: false })]);
  }
  await rm(profile, { recursive: true, force: true, maxRetries: 3 });
}
