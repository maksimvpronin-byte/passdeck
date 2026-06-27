/**
 * Дефолтные типы API PassDeck для контекстного изоляции в preload-процессе.
 * 
 * Этот тип определяется здесь и используется в apps/desktop/src/preload/index.ts
 * через импорт type { PassDeckApi } from '@passdeck/shared'.
 */

export interface PassDeckApi {
  settings: {
    get: () => unknown;
    update: (patch: unknown) => Promise<unknown>;
  };
  dialog: {
    chooseOpenFiles: () => Promise<string[]>;
    chooseCreateFile: (defaultName?: string) => Promise<string | null>;
  };
  database: {
    open: (request: { path: string }) => Promise<unknown>;
    create: (request: unknown) => Promise<unknown>;
    list: () => Promise<unknown[]>;
    get: (sessionId: string) => Promise<unknown>;
    save: (sessionId: string) => Promise<unknown>;
    saveEntry: (request: unknown) => Promise<unknown>;
    deleteEntry: (sessionId: string, entryId: string) => Promise<unknown>;
    createGroup: (request: unknown) => Promise<unknown>;
    moveEntry: (request: unknown) => Promise<unknown>;
    moveGroup: (request: unknown) => Promise<unknown>;
    lock: (sessionId: string) => Promise<unknown>;
    unlock: (sessionId: string, password: string) => Promise<unknown>;
    close: (sessionId: string) => Promise<void>;
    revealPassword: (sessionId: string, entryId: string) => Promise<unknown>;
    revealCustomField: (sessionId: string, entryId: string, key: string) => Promise<unknown>;
    addAttachments: (sessionId: string, entryId: string) => Promise<unknown>;
    exportAttachment: (sessionId: string, entryId: string, name: string) => Promise<void>;
    deleteAttachment: (sessionId: string, entryId: string, name: string) => Promise<unknown>;
  };
  autoType: {
    setSelection: (sessionId?: string | null, entryId?: string | null) => void;
    onError: (listener: (message: string) => void) => () => void;
  };
  clipboard: {
    copy: (request: { value: string; kind: 'password' | 'username' | 'custom' }) => void;
  };
  app: {
    quit: () => void;
    lockAll: () => Promise<void>;
  };

  // Биометрическая авторизация (whitelisted для macOS)
  auth: {
    bioInit: (_request?: { masterPassword?: string }) => Promise<{ ok: boolean; data?: unknown; error?: string; details?: string }>;
    bioUnlock: (token: unknown) => Promise<string | null>;
  };
}
