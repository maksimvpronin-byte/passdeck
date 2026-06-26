import { contextBridge, ipcRenderer } from 'electron';
import type { PassDeckApi } from '@passdeck/shared';

const api: PassDeckApi = {
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    update: (patch) => ipcRenderer.invoke('settings:update', patch),
  },
  dialog: {
    chooseOpenFiles: () => ipcRenderer.invoke('dialog:open'),
    chooseCreateFile: (defaultName) => ipcRenderer.invoke('dialog:create', defaultName),
  },
  database: {
    open: (request) => ipcRenderer.invoke('database:open', request),
    create: (request) => ipcRenderer.invoke('database:create', request),
    list: () => ipcRenderer.invoke('database:list'),
    get: (sessionId) => ipcRenderer.invoke('database:get', sessionId),
    save: (sessionId) => ipcRenderer.invoke('database:save', sessionId),
    saveEntry: (request) => ipcRenderer.invoke('database:save-entry', request),
    deleteEntry: (sessionId, entryId) =>
      ipcRenderer.invoke('database:delete-entry', sessionId, entryId),
    createGroup: (request) => ipcRenderer.invoke('database:create-group', request),
    lock: (sessionId) => ipcRenderer.invoke('database:lock', sessionId),
    unlock: (sessionId, password) => ipcRenderer.invoke('database:unlock', sessionId, password),
    close: (sessionId) => ipcRenderer.invoke('database:close', sessionId),
    revealPassword: (sessionId, entryId) =>
      ipcRenderer.invoke('database:reveal-password', sessionId, entryId),
    revealCustomField: (sessionId, entryId, key) =>
      ipcRenderer.invoke('database:reveal-custom-field', sessionId, entryId, key),
  },

  autoType: {
    setSelection: (sessionId, entryId) =>
      ipcRenderer.invoke('autotype:set-selection', sessionId, entryId),
    onError: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, message: string) => listener(message);
      ipcRenderer.on('autotype:error', handler);
      return () => ipcRenderer.removeListener('autotype:error', handler);
    },
  },
  clipboard: {
    copy: (request) => ipcRenderer.invoke('clipboard:copy', request),
  },
  app: {
    quit: () => ipcRenderer.invoke('app:quit'),
    lockAll: () => ipcRenderer.invoke('app:lock-all'),
  },
};

contextBridge.exposeInMainWorld('passdeck', api);
