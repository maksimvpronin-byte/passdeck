import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell, Tray, Menu, globalShortcut } from 'electron';
import path from 'node:path';
import {
  AUTO_TYPE_SHORTCUT_LABEL,
  AutoTypeService,
} from './services/auto-type-service';
import { DatabaseService } from './services/database-service';
import { SettingsStore } from './services/settings-store';
import { registerIpc, type BiometricAuthContext } from './ipc';
import { toApiError } from './services/errors';
import { BioAuthService } from './services/bio-auth-service';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let shutdownInProgress = false;
let settings: SettingsStore;
let databases: DatabaseService;
let autoType: AutoTypeService;
let bioService: BioAuthService | null = null;

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

  const loadPromise = window.loadFile(path.join(__dirname, '../renderer/index.html'));
  loadPromise.then(() => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.show();
      mainWindow.focus();
    }
  });

  return window;
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
      { type: 'separator' },
      { role: 'quit' },
    ]),
  );

  tray.on('double-click', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
}

function registerShutdownShortcuts(): void {
  const shortcuts = [
    { key: 'Q', ctrl: true, action: shutdownApp, title: 'Выход (q)' },
  ];

  for (const { key, ctrl, action, title } of shortcuts) {
    const modifier = ctrl ? 'Control' : undefined;
    globalShortcut.register(`${modifier}+${key}`, action);
    console.log(`[Shortcut] Registered ${title}`);
  }
}

function gracefulQuit(): Promise<void> {
  return new Promise((resolve) => {
    shutdownInProgress = true;
    setTimeout(() => {
      app.exit(0);
      resolve();
    }, 3500);
  });
}

async function shutdownApp(): Promise<void> {
  if (shutdownInProgress) {
    return;
  }

  const answer = await dialog.showMessageBox(mainWindow!, {
    type: 'question',
    buttons: ['Вы уверены?', 'Отмена'],
    defaultId: 0,
    cancelId: 1,
    message: 'Закрыть все базы данных и выйти из PassDeck?',
  });

  if (answer.response === 0) {
    shutdownInProgress = true;
    await gracefulQuit();
  }
}

function createBiometricAuthContext(): BiometricAuthContext {
  return {
    settings,
    bioService: new BioAuthService(),
  };
}

void app.whenReady().then(async () => {
  settings = new SettingsStore();
  await settings.init();
  databases = new DatabaseService(settings);
  autoType = new AutoTypeService(databases, () => mainWindow);

  if (settings.get().restoreTabs) {
    await databases.restoreLockedTabs(settings.get().lastOpenDatabases);
  }

  // Создаём контекст для биометрической авторизации (только macOS)
  const bioAuthContext: BiometricAuthContext = createBiometricAuthContext();

  registerIpc(bioAuthContext, databases, autoType);

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
  if (
    (process.platform === 'win32' || process.platform === 'darwin') &&
    !shortcutRegistered
  ) {
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow?.webContents.send(
        'autotype:error',
        `Не удалось зарегистрировать ${AUTO_TYPE_SHORTCUT_LABEL}. Возможно, сочетание занято другим приложением.`,
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

// Регистрация глобальных коротких клавиш
globalShortcut.unregisterAll();
const appMenu = Menu.buildFromTemplate([
  { role: 'fileMenu' },
]);
Menu.setApplicationMenu(appMenu);
