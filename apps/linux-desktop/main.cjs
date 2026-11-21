const {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  ipcMain,
  net,
  protocol,
  session,
  shell,
} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { registerDesktopBridge } = require('./desktop-bridge.cjs');

const appUrl = 'tauri://localhost/index.html';
const frontend = path.join(__dirname, 'frontend');
const pickerPath = path.join(__dirname, 'capture-picker.html');
const pickerUrl = pathToFileURL(pickerPath).href;
const icon = path.join(__dirname, 'app-icon.png');
const isWayland =
  process.env.XDG_SESSION_TYPE === 'wayland' || Boolean(process.env.WAYLAND_DISPLAY);
const allowedAppPermissions = new Set([
  'clipboard-sanitized-write',
  'display-capture',
  'fullscreen',
  'notifications',
]);
let mainWindow;
const roomInvitePattern = /^freetalk:\/\/(room|join)\/[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{12}\/?$/i;
let pendingRoomInvite = process.argv.find((arg) => roomInvitePattern.test(arg)) ?? null;

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'tauri',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

function appOrigin(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'tauri:' && url.host === 'localhost' && !url.username && !url.password
      ? url
      : null;
  } catch {
    return null;
  }
}

function isTrustedAppUrl(value) {
  const url = appOrigin(value);
  return Boolean(url && ['', '/', '/index.html'].includes(url.pathname));
}

function isTrustedMainFrame(frame) {
  return Boolean(
    frame &&
    mainWindow &&
    !mainWindow.isDestroyed() &&
    frame === mainWindow.webContents.mainFrame &&
    isTrustedAppUrl(frame.url),
  );
}

function installFrontendProtocol() {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'app-config.json'), 'utf8'));
  const csp = config.app?.security?.csp;
  if (typeof csp !== 'string' || !csp.trim()) throw new Error('Bundled application CSP is missing');
  protocol.handle('tauri', async (request) => {
    const url = appOrigin(request.url);
    if (!url) return new Response(null, { status: 403 });
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response(null, { status: 405 });
    }
    try {
      const pathname = decodeURIComponent(isTrustedAppUrl(url.href) ? '/index.html' : url.pathname);
      if (pathname.includes('\0') || pathname.includes('\\'))
        return new Response(null, { status: 403 });
      const file = path.resolve(frontend, `.${pathname}`);
      const relative = path.relative(frontend, file);
      if (
        !relative ||
        relative === '..' ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative)
      ) {
        return new Response(null, { status: 403 });
      }
      const headers = new Headers();
      const range = request.headers.get('range');
      if (range) headers.set('range', range);
      const resource = await net.fetch(pathToFileURL(file).href, {
        method: request.method,
        headers,
      });
      const responseHeaders = new Headers(resource.headers);
      responseHeaders.set('content-security-policy', `${csp}; frame-ancestors 'none'`);
      responseHeaders.set('x-content-type-options', 'nosniff');
      return new Response(resource.body, { status: resource.status, headers: responseHeaders });
    } catch {
      return new Response(null, { status: 404 });
    }
  });
}

function capturePicker(parent, sources) {
  return new Promise((resolve) => {
    const picker = new BrowserWindow({
      parent,
      modal: true,
      title: 'Демонстрация экрана',
      icon,
      width: 630,
      height: 565,
      minWidth: 420,
      minHeight: 360,
      show: false,
      autoHideMenuBar: true,
      backgroundColor: '#0e1622',
      webPreferences: {
        preload: path.join(__dirname, 'capture-picker.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    let settled = false;
    let loaded = false;
    const isPicker = (event) =>
      !picker.isDestroyed() &&
      event.sender === picker.webContents &&
      event.senderFrame === event.sender.mainFrame &&
      event.senderFrame.url === pickerUrl;
    const finish = (source) => {
      if (settled) return;
      settled = true;
      ipcMain.removeListener('trlka:capture-ready', ready);
      ipcMain.removeListener('trlka:capture-choice', choose);
      if (!picker.isDestroyed()) picker.destroy();
      resolve(source);
    };
    const ready = (event) => {
      if (!isPicker(event) || loaded) return;
      loaded = true;
      event.reply(
        'trlka:capture-options',
        sources.map((source, index) => ({
          index,
          name: source.name,
          thumbnail: source.thumbnail.isEmpty() ? '' : source.thumbnail.toDataURL(),
        })),
      );
      picker.show();
    };
    const choose = (event, index) => {
      if (!isPicker(event) || !loaded) return;
      finish(Number.isInteger(index) && index >= 0 ? sources[index] : undefined);
    };
    ipcMain.on('trlka:capture-ready', ready);
    ipcMain.on('trlka:capture-choice', choose);
    picker.on('closed', () => finish());
    picker.webContents.on('will-navigate', (event) => event.preventDefault());
    picker.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    void picker.loadFile(pickerPath).catch(() => finish());
  });
}

function installPermissions(browserSession) {
  const approvedMedia = new Set();
  const isTrustedRequest = (contents, details) =>
    Boolean(
      details.isMainFrame &&
      isTrustedMainFrame(contents?.mainFrame) &&
      (!details.requestingUrl || isTrustedAppUrl(details.requestingUrl)),
    );

  browserSession.setPermissionCheckHandler((contents, permission, requestingOrigin, details) => {
    if (!isTrustedRequest(contents, details) || !appOrigin(requestingOrigin)) return false;
    if (permission === 'media') return approvedMedia.has(details.mediaType);
    return allowedAppPermissions.has(permission);
  });

  browserSession.setPermissionRequestHandler((contents, permission, respond, details) => {
    if (!isTrustedRequest(contents, details)) return respond(false);
    if (allowedAppPermissions.has(permission)) return respond(true);
    if (permission !== 'media') return respond(false);
    const types = details.mediaTypes ?? [];
    if (!types.length || types.some((type) => type !== 'audio' && type !== 'video'))
      return respond(false);
    const pending = types.filter((type) => !approvedMedia.has(type));
    if (!pending.length) return respond(true);
    const capability =
      pending.length > 1 ? 'микрофону и камере' : pending[0] === 'audio' ? 'микрофону' : 'камере';
    void dialog
      .showMessageBox(mainWindow, {
        type: 'question',
        title: 'Trlka',
        message: `Разрешить доступ к ${capability}?`,
        buttons: ['Разрешить', 'Запретить'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      })
      .then(
        ({ response }) => {
          const allowed = response === 0 && isTrustedRequest(contents, details);
          if (allowed) pending.forEach((type) => approvedMedia.add(type));
          respond(allowed);
        },
        () => respond(false),
      );
  });

  let selecting = false;
  browserSession.setDisplayMediaRequestHandler((request, respond) => {
    if (
      selecting ||
      !request.userGesture ||
      !request.videoRequested ||
      !appOrigin(request.securityOrigin) ||
      !isTrustedMainFrame(request.frame)
    ) {
      return respond(null);
    }
    selecting = true;
    void (async () => {
      try {
        const sources = await desktopCapturer.getSources({
          types: ['screen', 'window'],
          thumbnailSize: isWayland ? { width: 0, height: 0 } : { width: 320, height: 180 },
        });
        if (!isTrustedMainFrame(request.frame) || !sources.length) return null;
        // Chromium returns only the source chosen by the system portal on Wayland.
        const source =
          isWayland && sources.length === 1 ? sources[0] : await capturePicker(mainWindow, sources);
        return source && isTrustedMainFrame(request.frame) ? { video: source } : null;
      } catch {
        return null;
      } finally {
        selecting = false;
      }
    })().then((result) => {
      try {
        respond(result);
      } catch {
        /* Frame closed while its request was resolving. */
      }
    });
  });
}

function openMainWindow() {
  mainWindow = new BrowserWindow({
    title: 'Trlka',
    icon,
    width: 1454,
    height: 903,
    minWidth: 797,
    minHeight: 714,
    autoHideMenuBar: true,
    show: false,
    backgroundColor: '#050c17',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const view = mainWindow.webContents;
  view.on('will-navigate', (event) => {
    if (!isTrustedAppUrl(event.url)) event.preventDefault();
  });
  view.on('will-redirect', (event) => {
    if (event.isMainFrame && !isTrustedAppUrl(event.url)) event.preventDefault();
  });
  view.on('will-attach-webview', (event) => event.preventDefault());
  view.setWindowOpenHandler(({ url, postBody }) => {
    if (!postBody) {
      try {
        const target = new URL(url);
        if (['https:', 'http:'].includes(target.protocol) && !target.username && !target.password) {
          void shell.openExternal(target.href).catch(() => undefined);
        }
      } catch {
        /* Unrecognized external destination. */
      }
    }
    return { action: 'deny' };
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = undefined;
  });
  return mainWindow.loadURL(appUrl);
}

if (app.commandLine.hasSwitch('no-sandbox')) {
  console.error('Trlka cannot start with the Chromium sandbox disabled.');
  app.exit(1);
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, args) => {
    const invite = args.find((arg) => roomInvitePattern.test(arg));
    if (invite) pendingRoomInvite = invite;
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    if (invite) mainWindow.webContents.send('trlka:invite-open');
  });
  app.on('window-all-closed', () => app.quit());
  void app
    .whenReady()
    .then(async () => {
      installFrontendProtocol();
      installPermissions(session.defaultSession);
      ipcMain.handle('trlka:invite-pending', (event) => {
        if (!isTrustedMainFrame(event.senderFrame)) throw new Error('Untrusted TRLKA window');
        const invite = pendingRoomInvite;
        pendingRoomInvite = null;
        return invite;
      });
      registerDesktopBridge(
        (event) =>
          event.sender === mainWindow?.webContents && isTrustedMainFrame(event.senderFrame),
      );
      await openMainWindow();
    })
    .catch((error) => {
      console.error('Trlka startup failed:', error.message);
      app.exit(1);
    });
}
