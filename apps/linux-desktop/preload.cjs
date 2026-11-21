const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('trlkaLinuxDesktop', {
  version: () => ipcRenderer.invoke('trlka:version'),
  updates: {
    check: () => ipcRenderer.invoke('trlka:update-check'),
    prepare: () => ipcRenderer.invoke('trlka:update-prepare'),
    apply: () => ipcRenderer.invoke('trlka:update-apply'),
    restart: () => ipcRenderer.invoke('trlka:update-restart'),
    onProgress: (onProgress) => {
      const listener = (_event, status) => onProgress(status);
      ipcRenderer.on('trlka:update-progress', listener);
      return () => ipcRenderer.removeListener('trlka:update-progress', listener);
    },
  },
  session: {
    read: () => ipcRenderer.invoke('trlka:session-read'),
    save: (token) => ipcRenderer.invoke('trlka:session-save', token),
    clear: () => ipcRenderer.invoke('trlka:session-clear'),
  },
  notifications: {
    show: (preview) => ipcRenderer.invoke('trlka:notification-show', preview),
    onOpen: (onOpen) => {
      const listener = (_event, chatId) => onOpen(chatId);
      ipcRenderer.on('trlka:notification-open', listener);
      return () => ipcRenderer.removeListener('trlka:notification-open', listener);
    },
  },
  invites: {
    pending: () => ipcRenderer.invoke('trlka:invite-pending'),
    onOpen: (onOpen) => {
      const listener = () => onOpen();
      ipcRenderer.on('trlka:invite-open', listener);
      return () => ipcRenderer.removeListener('trlka:invite-open', listener);
    },
  },
});
