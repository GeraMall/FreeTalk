const { app, BrowserWindow, ipcMain, Notification, safeStorage } = require('electron');
const { Buffer } = require('node:buffer');
const { randomUUID } = require('node:crypto');
const { mkdir, readFile, rename, rm, writeFile } = require('node:fs/promises');
const { dirname, join } = require('node:path');

function encryptionAvailable() {
  const backend = safeStorage.getSelectedStorageBackend();
  return backend !== 'basic_text' && backend !== 'unknown' && safeStorage.isEncryptionAvailable();
}

function registerDesktopBridge(isTrusted) {
  const tokenFile = join(app.getPath('userData'), 'session', 'refresh-token.encrypted');
  let sessionToken;
  let pending = Promise.resolve();

  const handle = (channel, operation) => {
    ipcMain.handle(channel, (event, ...args) => {
      if (!isTrusted(event)) throw new Error('Untrusted TRLKA window');
      const result = pending.then(() => operation(...args));
      pending = result.catch(() => undefined);
      return result;
    });
  };

  handle('trlka:version', () => app.getVersion());
  handle('trlka:session-read', async () => {
    if (sessionToken !== undefined) return sessionToken;
    if (!encryptionAvailable()) return null;
    try {
      const ciphertext = await readFile(tokenFile);
      sessionToken = safeStorage.decryptString(ciphertext);
      return sessionToken;
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn('Could not restore the Linux session');
      return null;
    }
  });
  handle('trlka:session-save', async (token) => {
    if (typeof token !== 'string' || !token || Buffer.byteLength(token) > 16_384) {
      throw new Error('Invalid TRLKA session');
    }
    sessionToken = token;
    if (!encryptionAvailable()) {
      // The active session remains usable without an OS keyring.
      return;
    }
    const temporary = `${tokenFile}.${randomUUID()}.tmp`;
    try {
      const ciphertext = safeStorage.encryptString(token);
      await mkdir(dirname(tokenFile), { recursive: true, mode: 0o700 });
      await writeFile(temporary, ciphertext, { mode: 0o600, flag: 'wx' });
      await rename(temporary, tokenFile);
    } catch {
      console.warn('Could not store the Linux session in the keyring');
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  });
  handle('trlka:session-clear', async () => {
    sessionToken = null;
    await rm(tokenFile, { force: true });
  });

  let chatNotification;
  ipcMain.handle('trlka:notification-show', (event, preview) => {
    if (!isTrusted(event)) throw new Error('Untrusted TRLKA window');
    if (!Notification.isSupported() || !preview) return false;
    const { chatId, senderName, body } = preview;
    if (
      typeof chatId !== 'string' ||
      !chatId ||
      chatId.length > 128 ||
      typeof senderName !== 'string' ||
      typeof body !== 'string'
    ) {
      return false;
    }

    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || window.isFocused()) return false;
    chatNotification?.close();
    const notification = new Notification({
      title: senderName.slice(0, 120),
      body: body.slice(0, 2_000),
      silent: true,
    });
    chatNotification = notification;
    notification.once('close', () => {
      if (chatNotification === notification) chatNotification = undefined;
    });
    notification.once('click', () => {
      if (window.isDestroyed()) return;
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
      window.webContents.send('trlka:notification-open', chatId);
    });
    notification.show();
    return true;
  });
}

module.exports = { registerDesktopBridge };
