import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell, Tray, Menu } from 'electron';
import path from 'node:path';
import { AutoTypeService } from './services/auto-type-service';
import { DatabaseService } from './services/database-service';
import { SettingsStore } from './services/settings-store';
import { registerIpc } from './ipc';
import { toApiError } from './services/errors';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let shutdownInProgress = false;
let settings: SettingsStore;
let databases: DatabaseService;
let autoType: AutoTypeService;

const gotLock = app.requestSingleInstanceLock();

function createWindow(): BrowserWindow {
  const bounds = settings.get().windowBounds;
  const window = new BrowserWindow({
    width: bounds?.width ?? 1280,
    height: bounds?.height ?? 800,
    ...(bounds?.x !== undefined ? { x: bounds.x } : {}),
    ...(bounds?.y !== undefined ? { y: bounds.y } : {}),
    minWidth: 920,
    minHeight: 620,
    show: false,
    backgroundColor: '#0b1220',
    title: 'PassDeck',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event) => event.preventDefault());

  window.once('ready-to-show', () => window.show());
  window.on('resize', () => persistWindowBounds(window));
  window.on('move', () => persistWindowBounds(window));
  window.on('close', (event) => {
    if (isQuitting) {
      return;
    }
    if (settings.get().closeBehavior === 'tray') {
      event.preventDefault();
      window.hide();
      return;
    }
    event.preventDefault();
    void gracefulQuit();
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    void window.loadURL(devUrl);
  } else {
    void window.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  return window;
}

function persistWindowBounds(window: BrowserWindow): void {
  if (window.isMinimized() || window.isMaximized()) {
    return;
  }
  const bounds = window.getBounds();
  void settings.update({ windowBounds: bounds });
}

function createTray(): void {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(__dirname, '../../build/icon.png');
  const image = nativeImage.createFromPath(iconPath);
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
  tray.setToolTip('PassDeck');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: 'Показать PassDeck',
        click: () => {
          mainWindow?.show();
          mainWindow?.focus();
        },
      },
      {
        label: 'Заблокировать все базы',
        click: () => {
          void Promise.all(
            databases
              .listViews()
              .filter((view) => !view.locked)
              .map((view) => databases.lockDatabase(view.sessionId)),
          );
        },
      },
      { type: 'separator' },
      {
        label: 'Выход',
        click: () => void gracefulQuit(),
      },
    ]),
  );
  tray.on('double-click', () => mainWindow?.show());
}

async function gracefulQuit(): Promise<void> {
  if (shutdownInProgress) {
    return;
  }
  shutdownInProgress = true;
  try {
    await databases.shutdown();
    isQuitting = true;
    app.quit();
  } catch (error) {
    shutdownInProgress = false;
    const apiError = toApiError(error);
    mainWindow?.show();
    const messageBoxOptions = {
      type: 'error' as const,
      title: 'PassDeck — ошибка сохранения',
      message: apiError.error?.message ?? 'Не удалось сохранить одну из открытых баз.',
      detail:
        apiError.error?.details ?? 'Приложение не будет закрыто, чтобы не потерять изменения.',
      buttons: ['Закрыть'],
      defaultId: 0,
      noLink: true,
    };
    if (mainWindow) {
      await dialog.showMessageBox(mainWindow, messageBoxOptions);
    } else {
      await dialog.showMessageBox(messageBoxOptions);
    }
  }
}

if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.show();
      mainWindow.focus();
    }
  });

  void app.whenReady().then(async () => {
    settings = new SettingsStore();
    await settings.init();
    databases = new DatabaseService(settings);
    autoType = new AutoTypeService(databases, () => mainWindow);
    if (settings.get().restoreTabs) {
      await databases.restoreLockedTabs(settings.get().lastOpenDatabases);
    }
    registerIpc(settings, databases, autoType);
    ipcMain.handle('app:quit', async () => {
      try {
        await gracefulQuit();
        return { ok: true, data: null };
      } catch (error) {
        return toApiError(error);
      }
    });
    mainWindow = createWindow();
    createTray();
    const shortcutRegistered = autoType.registerShortcut();
    if (process.platform === 'win32' && !shortcutRegistered) {
      mainWindow.webContents.once('did-finish-load', () => {
        mainWindow?.webContents.send(
          'autotype:error',
          'Не удалось зарегистрировать Ctrl+Alt+A. Возможно, сочетание занято другим приложением.',
        );
      });
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createWindow();
      } else {
        mainWindow?.show();
      }
    });
  });

  app.on('will-quit', () => {
    autoType?.unregisterShortcut();
  });

  app.on('before-quit', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      void gracefulQuit();
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && settings?.get().closeBehavior !== 'tray') {
      void gracefulQuit();
    }
  });
}
