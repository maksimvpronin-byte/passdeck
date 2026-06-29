import { contextBridge, ipcRenderer } from 'electron';
import type { ApiResult, DatabaseView, PassDeckApi } from '@passdeck/shared';
type TouchIdStatus = { available: boolean; enabled: boolean; reason?: string };
type TouchIdApi = { touchId: { status(filePath?: string): Promise<ApiResult<TouchIdStatus>>; storePassword(filePath: string, password: string): Promise<ApiResult<null>>; forget(filePath: string): Promise<ApiResult<null>>; open(filePath: string): Promise<ApiResult<DatabaseView>>; unlock(sessionId: string): Promise<ApiResult<DatabaseView>>; }; };

const api: PassDeckApi & TouchIdApi = {
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
    moveEntry: (request) => ipcRenderer.invoke('database:move-entry', request),
    moveGroup: (request) => ipcRenderer.invoke('database:move-group', request),
    lock: (sessionId) => ipcRenderer.invoke('database:lock', sessionId),
    unlock: (sessionId, password) => ipcRenderer.invoke('database:unlock', sessionId, password),
    close: (sessionId) => ipcRenderer.invoke('database:close', sessionId),
    forceReadWrite: (sessionId) =>
      ipcRenderer.invoke('database:force-read-write', sessionId),
    revealPassword: (sessionId, entryId) =>
      ipcRenderer.invoke('database:reveal-password', sessionId, entryId),
    revealCustomField: (sessionId, entryId, key) =>
      ipcRenderer.invoke('database:reveal-custom-field', sessionId, entryId, key),
    addAttachments: (sessionId, entryId) =>
      ipcRenderer.invoke('database:add-attachments', sessionId, entryId),
    exportAttachment: (sessionId, entryId, name) =>
      ipcRenderer.invoke('database:export-attachment', sessionId, entryId, name),
    deleteAttachment: (sessionId, entryId, name) =>
      ipcRenderer.invoke('database:delete-attachment', sessionId, entryId, name),
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
  }, touchId: { status: (filePath) => ipcRenderer.invoke('touchid:status', filePath), storePassword: (filePath, password) => ipcRenderer.invoke('touchid:store-password', filePath, password), forget: (filePath) => ipcRenderer.invoke('touchid:forget', filePath), open: (filePath) => ipcRenderer.invoke('touchid:open', filePath), unlock: (sessionId) => ipcRenderer.invoke('touchid:unlock', sessionId), },
  app: {
    quit: () => ipcRenderer.invoke('app:quit'),
    lockAll: () => ipcRenderer.invoke('app:lock-all'),
  },
};

contextBridge.exposeInMainWorld('passdeck', api);
