import { app } from 'electron';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AppSettings } from '@passdeck/shared';

const DEFAULT_SETTINGS: AppSettings = {
  language: 'ru',
  theme: 'dark',
  accent: 'teal',
  uiScale: 1,
  clipboardPasswordSeconds: 30,
  clipboardUsernameSeconds: 60,
  autoLockMinutes: 10,
  closeBehavior: 'quit',
  restoreTabs: true,
  recoveryEnabled: false,
  recentDatabases: [],
  lastOpenDatabases: [],
  windowBounds: {
    width: 1280,
    height: 800,
  },
};

export class SettingsStore {
  readonly dataDir: string;
  readonly backupDir: string;
  readonly recoveryDir: string;
  private readonly settingsPath: string;
  private settings: AppSettings = structuredClone(DEFAULT_SETTINGS);

  constructor() {
    const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
    const devDir =
      process.env.NODE_ENV === 'development' ? path.resolve(process.cwd(), 'data-dev') : undefined;

    this.dataDir = portableDir
      ? path.join(portableDir, 'data')
      : (devDir ?? path.join(app.getPath('userData'), 'data'));
    this.backupDir = path.join(this.dataDir, 'backups');
    this.recoveryDir = path.join(this.dataDir, 'recovery');
    this.settingsPath = path.join(this.dataDir, 'settings.json');
  }

  async init(): Promise<void> {
    await mkdir(this.backupDir, { recursive: true });
    await mkdir(this.recoveryDir, { recursive: true });

    try {
      const raw = await readFile(this.settingsPath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<AppSettings>;
      this.settings = this.sanitize({ ...DEFAULT_SETTINGS, ...parsed });
    } catch {
      this.settings = structuredClone(DEFAULT_SETTINGS);
      await this.persist();
    }
  }

  get(): AppSettings {
    return structuredClone(this.settings);
  }

  async update(patch: Partial<AppSettings>): Promise<AppSettings> {
    this.settings = this.sanitize({ ...this.settings, ...patch });
    await this.persist();
    return this.get();
  }

  async rememberDatabase(filePath: string): Promise<void> {
    const recent = [
      filePath,
      ...this.settings.recentDatabases.filter((item) => item !== filePath),
    ].slice(0, 12);
    await this.update({ recentDatabases: recent });
  }

  async setLastOpenDatabases(paths: string[]): Promise<void> {
    await this.update({ lastOpenDatabases: [...new Set(paths)].slice(0, 100) });
  }

  private sanitize(input: AppSettings): AppSettings {
    const scale = Number.isFinite(input.uiScale) ? Math.min(1.5, Math.max(0.8, input.uiScale)) : 1;
    return {
      ...DEFAULT_SETTINGS,
      ...input,
      uiScale: scale,
      clipboardPasswordSeconds: this.clampSeconds(input.clipboardPasswordSeconds, 30),
      clipboardUsernameSeconds: this.clampSeconds(input.clipboardUsernameSeconds, 60),
      autoLockMinutes: this.clampMinutes(input.autoLockMinutes, 10),
      recentDatabases: Array.isArray(input.recentDatabases)
        ? input.recentDatabases.slice(0, 12)
        : [],
      lastOpenDatabases: Array.isArray(input.lastOpenDatabases)
        ? input.lastOpenDatabases.slice(0, 100)
        : [],
    };
  }

  private clampSeconds(value: number, fallback: number): number {
    if (!Number.isFinite(value)) {
      return fallback;
    }
    return Math.min(3600, Math.max(0, Math.round(value)));
  }

  private clampMinutes(value: number, fallback: number): number {
    if (!Number.isFinite(value)) {
      return fallback;
    }
    return Math.min(1440, Math.max(0, Math.round(value)));
  }

  private async persist(): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    const tempPath = `${this.settingsPath}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(this.settings, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    await rename(tempPath, this.settingsPath);
  }
}
