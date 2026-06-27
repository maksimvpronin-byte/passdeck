import { contextBridge, ipcRenderer } from 'electron';
import type { BioAuthResult } from '../main/types/bio-token';

// Типы для биометрической авторизации (hex-encoded строки)
export interface BioTokenForIPC {
  sessionId: string;
  ciphertext: string;   // hex-encoded encrypted token
  iv: string;           // hex-encoded IV
  tag: string;          // hex-encoded auth tag
}

// Биометрическая авторизация (whitelisted для macOS)
const auth = {
  bioInit: (_request?: { masterPassword?: string }) =>
    ipcRenderer.invoke('auth:bio-init', _request),
  bioUnlock: (token: BioTokenForIPC) =>
    ipcRenderer.invoke('auth:bio-unlock', token).then<BioAuthResult>((result): result is BioAuthResult['data'] => {
      if (result.ok && result.data) {
        return result.data;
      }
      throw new Error(result.error || 'BIO_AUTH_FAIL');
    }),
};

// API с поддержкой биометрии
export const passdeckApi = {
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    update: (_event: Electron.IpcRendererEvent, patch: unknown) => ipcRenderer.invoke('settings:update', patch),
  },
  dialog: {
    chooseOpenFiles: () => ipcRenderer.invoke('dialog:open'),
    chooseCreateFile: (defaultName?: string) => ipcRenderer.invoke('dialog:create', defaultName),
  },
  database: {
    open: (request: unknown) => ipcRenderer.invoke('database:open', request),
    create: (request: unknown) => ipcRenderer.invoke('database:create', request),
    list: () => ipcRenderer.invoke('database:list'),
    get: (sessionId: string) => ipcRenderer.invoke('database:get', sessionId),
    save: (sessionId: string) => ipcRenderer.invoke('database:save', sessionId),
    saveEntry: (request: unknown) => ipcRenderer.invoke('database:save-entry', request),
    deleteEntry: (sessionId: string, entryId: string) =>
      ipcRenderer.invoke('database:delete-entry', sessionId, entryId),
    createGroup: (request: unknown) => ipcRenderer.invoke('database:create-group', request),
    moveEntry: (request: unknown) => ipcRenderer.invoke('database:move-entry', request),
    moveGroup: (request: unknown) => ipcRenderer.invoke('database:move-group', request),
    lock: (sessionId: string) => ipcRenderer.invoke('database:lock', sessionId),
    unlock: (sessionId: string, password: string) => ipcRenderer.invoke('database:unlock', sessionId, password),
    close: (sessionId: string) => ipcRenderer.invoke('database:close', sessionId),
    revealPassword: (sessionId: string, entryId: string) =>
      ipcRenderer.invoke('database:reveal-password', sessionId, entryId),
    revealCustomField: (sessionId: string, entryId: string, key: string) =>
      ipcRenderer.invoke('database:reveal-custom-field', sessionId, entryId, key),
    addAttachments: (sessionId: string, entryId: string) =>
      ipcRenderer.invoke('database:add-attachments', sessionId, entryId),
    exportAttachment: (sessionId: string, entryId: string, name: string) =>
      ipcRenderer.invoke('database:export-attachment', sessionId, entryId, name),
    deleteAttachment: (sessionId: string, entryId: string, name: string) =>
      ipcRenderer.invoke('database:delete-attachment', sessionId, entryId, name),
  },

  autoType: {
    setSelection: (sessionId: string | null, entryId: string | null) =>
      ipcRenderer.invoke('autotype:set-selection', sessionId, entryId),
    onError: (listener: (message: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, message: string) => listener(message);
      ipcRenderer.on('autotype:error', handler);
      return () => ipcRenderer.removeListener('autotype:error', handler);
    },
  },
  clipboard: {
    copy: (request: { value: string; kind: 'password' | 'username' | 'custom' }) =>
      ipcRenderer.invoke('clipboard:copy', request),
  },
  app: {
    quit: () => ipcRenderer.invoke('app:quit'),
    lockAll: () => ipcRenderer.invoke('app:lock-all'),
  },

  // Биометрическая авторизация (whitelisted для macOS)
  auth,
};

contextBridge.exposeInMainWorld('passdeck', passdeckApi);
