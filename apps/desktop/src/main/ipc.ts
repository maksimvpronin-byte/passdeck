import { clipboard, dialog, ipcMain } from 'electron';
import type {
  AppSettings,
  CopySecretRequest,
  CreateDatabaseRequest,
  CreateGroupRequest,
  MoveEntryRequest,
  MoveGroupRequest,
  OpenDatabaseRequest,
  SaveEntryRequest,
} from '@passdeck/shared';
import type { AutoTypeService } from './services/auto-type-service';
import type { DatabaseService } from './services/database-service';
import type { BiometricAuthContext, BioTokenForIPC } from './types/bio-token';

import { toApiError } from './services/errors';

/**
 * Регистратор IPC-каналов с поддержкой биометрической авторизации.
 * 
 * Whitelisted каналы для биометрии:
 * - auth:bio-init — инициализация токена разблокировки (создаётся в main process)
 * - auth:bio-unlock — разблокировка базы по Touch ID / Face ID
 */
export function registerIpc(
  context: BiometricAuthContext,
  databases: DatabaseService,
  autoType: AutoTypeService,
): void {
  // Настройки
  ipcMain.handle('settings:get', () => context.settings.get());
  ipcMain.handle('settings:update', (_event: Electron.IpcRendererEvent, patch: Partial<AppSettings>) =>
    context.settings.update(patch),
  );

  ipcMain.handle('dialog:open', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Открыть базу KDBX',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'KeePass database', extensions: ['kdbx'] }],
    });
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle('dialog:create', async (_event: Electron.IpcRendererEvent, defaultName: string) => {
    const result = await dialog.showSaveDialog({
      title: 'Создать базу KDBX',
      defaultPath: defaultName,
      filters: [{ name: 'KeePass database', extensions: ['kdbx'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
    return result.canceled ? null : (result.filePath ?? null);
  });

  ipcMain.handle('database:list', () => databases.listViews());
  ipcMain.handle('database:get', (_event, sessionId: string) => {
    try {
      return { ok: true, data: databases.getView(sessionId) };
    } catch (error) {
      return toApiError(error);
    }
  });
  ipcMain.handle('database:open', async (_event: Electron.IpcRendererEvent, request: OpenDatabaseRequest) => {
    try {
      return { ok: true, data: await databases.openDatabase(request) };
    } catch (error) {
      return toApiError(error);
    }
  });
  ipcMain.handle('database:create', async (_event: Electron.IpcRendererEvent, request: CreateDatabaseRequest) => {
    try {
      return { ok: true, data: await databases.createDatabase(request) };
    } catch (error) {
      return toApiError(error);
    }
  });
  ipcMain.handle('database:save', async (_event: Electron.IpcRendererEvent, sessionId: string) => {
    try {
      return { ok: true, data: await databases.saveDatabase(sessionId) };
    } catch (error) {
      return toApiError(error);
    }
  });
  ipcMain.handle('database:save-entry', (_event, request: SaveEntryRequest) => {
    try {
      return { ok: true, data: databases.saveEntry(request) };
    } catch (error) {
      return toApiError(error);
    }
  });
  ipcMain.handle('database:delete-entry', (_event: Electron.IpcRendererEvent, sessionId: string, entryId: string) => {
    try {
      return { ok: true, data: databases.deleteEntry(sessionId, entryId) };
    } catch (error) {
      return toApiError(error);
    }
  });
  ipcMain.handle('database:create-group', (_event, request: CreateGroupRequest) => {
    try {
      return { ok: true, data: databases.createGroup(request) };
    } catch (error) {
      return toApiError(error);
    }
  });
  ipcMain.handle('database:move-entry', (_event, request: MoveEntryRequest) => {
    try {
      return { ok: true, data: databases.moveEntry(request) };
    } catch (error) {
      return toApiError(error);
    }
  });
  ipcMain.handle('database:move-group', (_event, request: MoveGroupRequest) => {
    try {
      return { ok: true, data: databases.moveGroup(request) };
    } catch (error) {
      return toApiError(error);
    }
  });

  ipcMain.handle('database:lock', async (_event: Electron.IpcRendererEvent, sessionId: string) => {
    try {
      return { ok: true, data: await databases.lockDatabase(sessionId) };
    } catch (error) {
      return toApiError(error);
    }
  });
  ipcMain.handle('database:unlock', async (_event: Electron.IpcRendererEvent, sessionId: string, password: string) => {
    try {
      return { ok: true, data: await databases.unlockDatabase(sessionId, password) };
    } catch (error) {
      return toApiError(error);
    }
  });
  ipcMain.handle('database:close', async (_event: Electron.IpcRendererEvent, sessionId: string) => {
    try {
      await databases.closeDatabase(sessionId);
      return { ok: true, data: null };
    } catch (error) {
      return toApiError(error);
    }
  });
  ipcMain.handle('database:reveal-password', (_event: Electron.IpcRendererEvent, sessionId: string, entryId: string) => {
    try {
      return { ok: true, data: databases.revealPassword(sessionId, entryId) };
    } catch (error) {
      return toApiError(error);
    }
  });

  ipcMain.handle(
    'database:reveal-custom-field',
    (_event: Electron.IpcRendererEvent, sessionId: string, entryId: string, key: string) => {
      try {
        return { ok: true, data: databases.revealCustomField(sessionId, entryId, key) };
      } catch (error) {
        return toApiError(error);
      }
    },
  );

  ipcMain.handle('database:add-attachments', async (_event: Electron.IpcRendererEvent, sessionId: string, entryId: string) => {
    try {
      const result = await dialog.showOpenDialog({
        title: 'Добавить вложения',
        properties: ['openFile', 'multiSelections'],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { ok: true, data: databases.getView(sessionId) };
      }
      return {
        ok: true,
        data: await databases.addAttachments(sessionId, entryId, result.filePaths),
      };
    } catch (error) {
      return toApiError(error);
    }
  });

  ipcMain.handle(
    'database:export-attachment',
    async (_event: Electron.IpcRendererEvent, sessionId: string, entryId: string, name: string) => {
      try {
        const result = await dialog.showSaveDialog({
          title: 'Сохранить вложение',
          defaultPath: name,
          properties: ['createDirectory', 'showOverwriteConfirmation'],
        });
        if (result.canceled || !result.filePath) {
          return { ok: true, data: false };
        }
        await databases.exportAttachment(sessionId, entryId, name, result.filePath);
        return { ok: true, data: true };
      } catch (error) {
        return toApiError(error);
      }
    },
  );

  ipcMain.handle(
    'database:delete-attachment',
    (_event: Electron.IpcRendererEvent, sessionId: string, entryId: string, name: string) => {
      try {
        return { ok: true, data: databases.deleteAttachment(sessionId, entryId, name) };
      } catch (error) {
        return toApiError(error);
      }
    },
  );

  ipcMain.handle(
    'autotype:set-selection',
    (_event: Electron.IpcRendererEvent, sessionId: string | null, entryId: string | null) => {
      try {
        autoType.setSelection(sessionId, entryId);
        return { ok: true, data: null };
      } catch (error) {
        return toApiError(error);
      }
    },
  );

  // Биометрическая авторизация (whitelisted для macOS)
  ipcMain.handle('auth:bio-init', async (_event, request?: { masterPassword?: string }) => {
    try {
      const { bioService } = context;
      // Создаём зашифрованный токен в main-процессе
      const token = await bioService.initBioToken(request?.masterPassword);
      // Преобразуем для передачи через IPC (hex-encoding)
      return {
        ok: true,
        data: {
          sessionId: token.sessionId,
          ciphertext: token.ciphertext.toString('hex'),
          iv: token.iv.toString('hex'),
          tag: token.tag.toString('hex'),
        },
      };
    } catch (error) {
      console.error('[IPC] auth:bio-init error:', error);
      return toApiError(error);
    }
  });

  ipcMain.handle('auth:bio-unlock', async (_event, request: { sessionId: string; ciphertext: string; iv: string; tag: string }) => {
    try {
      const { bioService } = context;
      // Расшифровываем токен обратно и вызываем unlock
      const tokenBuffer = Buffer.from(request.ciphertext, 'hex');
      const ivBuffer = Buffer.from(request.iv, 'hex');
      const tagBuffer = Buffer.from(request.tag, 'hex');
      
      const result = await bioService.unlockWithBiometrics(tokenBuffer, ivBuffer, tagBuffer);
      return {
        ok: true,
        data: {
          success: result.success,
          error: result.error,
          details: result.details,
        },
      };
    } catch (error) {
      console.error('[IPC] auth:bio-unlock error:', error);
      return toApiError(error);
    }
  });

  // Копирование секрета
  ipcMain.handle('clipboard:copy', (_event, request: CopySecretRequest) => {
    try {
      clipboard.writeText(request.value);
      const currentValue = request.value;
      const appSettings = context.settings.get();
      const seconds =
        request.kind === 'password' || request.kind === 'custom'
          ? appSettings.clipboardPasswordSeconds
          : request.kind === 'username'
            ? appSettings.clipboardUsernameSeconds
            : 0;
      if (seconds > 0) {
        const timer = setTimeout(() => {
          if (clipboard.readText() === currentValue) {
            clipboard.clear();
          }
        }, seconds * 1000);
        timer.unref();
      }
      return { ok: true, data: null };
    } catch (error) {
      return toApiError(error);
    }
  });

  // Блокировка всех баз
  ipcMain.handle('app:lock-all', async () => {
    try {
      for (const view of databases.listViews()) {
        if (!view.locked) {
          await databases.lockDatabase(view.sessionId);
        }
      }
      return { ok: true, data: null };
    } catch (error) {
      return toApiError(error);
    }
  });
}
