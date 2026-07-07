import { clipboard, dialog, ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import type {
  AppSettings,
  ApiResult,
  AutoTypeSelection,
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
import { toApiError } from './services/errors';
import type { SettingsStore } from './services/settings-store';
import { TouchIdService } from './services/touch-id-service';

type IpcHandler<T, Args extends unknown[]> = (...args: Args) => T | Promise<T>;

function asApiHandler<T, Args extends unknown[]>(
  handler: IpcHandler<T, Args>,
): (_event: IpcMainInvokeEvent, ...args: Args) => Promise<ApiResult<T>> {
  return async (_event, ...args) => {
    try {
      return { ok: true, data: await handler(...args) };
    } catch (error) {
      return toApiError(error);
    }
  };
}

export function registerIpc(
  settings: SettingsStore,
  databases: DatabaseService,
  autoType: AutoTypeService,
  onSettingsUpdated?: (settings: AppSettings) => void,
): void {
  const touchId = new TouchIdService();

  ipcMain.handle(
    'touchid:status',
    asApiHandler((filePath?: string) => touchId.status(filePath)),
  );

  ipcMain.handle(
    'touchid:store-password',
    asApiHandler(async (filePath: string, password: string) => {
      await touchId.storePassword(filePath, password);
      return null;
    }),
  );

  ipcMain.handle(
    'touchid:forget',
    asApiHandler(async (filePath: string) => {
      await touchId.forget(filePath);
      return null;
    }),
  );

  ipcMain.handle(
    'touchid:open',
    asApiHandler(async (filePath: string) => {
      const password = await touchId.getPassword(filePath);
      return databases.openDatabase({ path: filePath, password });
    }),
  );

  ipcMain.handle(
    'touchid:unlock',
    asApiHandler(async (sessionId: string) => {
      const currentView = databases.getView(sessionId);
      const password = await touchId.getPassword(currentView.path);
      return databases.unlockDatabase(sessionId, password);
    }),
  );

  ipcMain.handle('settings:get', () => settings.get());
  ipcMain.handle('settings:update', async (_event, patch: Partial<AppSettings>) => {
    const next = await settings.update(patch);
    onSettingsUpdated?.(next);
    return next;
  });

  ipcMain.handle('dialog:open', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Открыть базу KDBX',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'KeePass database', extensions: ['kdbx'] }],
    });
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle('dialog:create', async (_event, defaultName: string) => {
    const result = await dialog.showSaveDialog({
      title: 'Создать базу KDBX',
      defaultPath: defaultName,
      filters: [{ name: 'KeePass database', extensions: ['kdbx'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
    return result.canceled ? null : (result.filePath ?? null);
  });

  ipcMain.handle('database:list', () => databases.listViews());
  ipcMain.handle(
    'database:get',
    asApiHandler((sessionId: string) => databases.getView(sessionId)),
  );
  ipcMain.handle(
    'database:open',
    asApiHandler(async (request: OpenDatabaseRequest) => {
      const view = await databases.openDatabase(request);
      if ('password' in request && typeof request.password === 'string') {
        void touchId.storePassword(view.path, request.password).catch(() => undefined);
      }
      return view;
    }),
  );
  ipcMain.handle(
    'database:create',
    asApiHandler((request: CreateDatabaseRequest) => databases.createDatabase(request)),
  );
  ipcMain.handle(
    'database:save',
    asApiHandler((sessionId: string) => databases.saveDatabase(sessionId)),
  );
  ipcMain.handle(
    'database:save-entry',
    asApiHandler((request: SaveEntryRequest) => databases.saveEntry(request)),
  );
  ipcMain.handle(
    'database:delete-entry',
    asApiHandler((sessionId: string, entryId: string) => databases.deleteEntry(sessionId, entryId)),
  );
  ipcMain.handle(
    'database:create-group',
    asApiHandler((request: CreateGroupRequest) => databases.createGroup(request)),
  );
  ipcMain.handle(
    'database:delete-group',
    asApiHandler((sessionId: string, groupId: string) => databases.deleteGroup(sessionId, groupId)),
  );
  ipcMain.handle(
    'database:move-entry',
    asApiHandler((request: MoveEntryRequest) => databases.moveEntry(request)),
  );
  ipcMain.handle(
    'database:move-group',
    asApiHandler((request: MoveGroupRequest) => databases.moveGroup(request)),
  );

  ipcMain.handle(
    'database:lock',
    asApiHandler((sessionId: string) => databases.lockDatabase(sessionId)),
  );
  ipcMain.handle(
    'database:unlock',
    asApiHandler(async (sessionId: string, password: string) => {
      const view = await databases.unlockDatabase(sessionId, password);
      void touchId.storePassword(view.path, password).catch(() => undefined);
      return view;
    }),
  );
  ipcMain.handle(
    'database:close',
    asApiHandler(async (sessionId: string) => {
      await databases.closeDatabase(sessionId);
      return null;
    }),
  );
  ipcMain.handle(
    'database:force-read-write',
    asApiHandler((sessionId: string) => databases.forceReadWrite(sessionId)),
  );
  ipcMain.handle(
    'database:reveal-password',
    asApiHandler((sessionId: string, entryId: string) =>
      databases.revealPassword(sessionId, entryId),
    ),
  );

  ipcMain.handle(
    'database:reveal-custom-field',
    asApiHandler((sessionId: string, entryId: string, key: string) =>
      databases.revealCustomField(sessionId, entryId, key),
    ),
  );

  ipcMain.handle(
    'database:add-attachments',
    asApiHandler(async (sessionId: string, entryId: string) => {
      const result = await dialog.showOpenDialog({
        title: 'Добавить вложения',
        properties: ['openFile', 'multiSelections'],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return databases.getView(sessionId);
      }
      return databases.addAttachments(sessionId, entryId, result.filePaths);
    }),
  );

  ipcMain.handle(
    'database:export-attachment',
    asApiHandler(async (sessionId: string, entryId: string, name: string) => {
      const result = await dialog.showSaveDialog({
        title: 'Сохранить вложение',
        defaultPath: name,
        properties: ['createDirectory', 'showOverwriteConfirmation'],
      });
      if (result.canceled || !result.filePath) {
        return false;
      }
      await databases.exportAttachment(sessionId, entryId, name, result.filePath);
      return true;
    }),
  );

  ipcMain.handle(
    'database:delete-attachment',
    asApiHandler((sessionId: string, entryId: string, name: string) =>
      databases.deleteAttachment(sessionId, entryId, name),
    ),
  );

  ipcMain.handle(
    'autotype:set-selection',
    asApiHandler((selection: AutoTypeSelection) => {
      autoType.setSelection(selection);
      return null;
    }),
  );
  ipcMain.handle(
    'clipboard:copy',
    asApiHandler((request: CopySecretRequest) => {
      clipboard.writeText(request.value);
      const currentValue = request.value;
      const appSettings = settings.get();
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
      return null;
    }),
  );

  ipcMain.handle(
    'app:lock-all',
    asApiHandler(async () => {
      for (const view of databases.listViews()) {
        if (!view.locked) {
          await databases.lockDatabase(view.sessionId);
        }
      }
      return null;
    }),
  );
}
