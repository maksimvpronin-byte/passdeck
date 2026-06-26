import { hostname } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  copyFile,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { Consts, Kdbx, KdbxCredentials, ProtectedValue } from 'kdbxweb';
import type { KdbxEntry, KdbxGroup } from 'kdbxweb';
import { DEFAULT_AUTO_TYPE_SEQUENCE } from '@passdeck/shared';
import type {
  CreateDatabaseRequest,
  CreateGroupRequest,
  DatabaseView,
  EntrySummary,
  GroupSummary,
  OpenDatabaseRequest,
  SaveEntryRequest,
} from '@passdeck/shared';
import { configureArgon2 } from './argon2';
import { PassDeckError } from './errors';
import type { SettingsStore } from './settings-store';

interface FileFingerprint {
  mtimeMs: number;
  size: number;
}

interface DatabaseSession {
  id: string;
  path: string;
  name: string;
  db: Kdbx | undefined;
  locked: boolean;
  readOnly: boolean;
  dirty: boolean;
  ownsLock: boolean;
  fingerprint: FileFingerprint | undefined;
}

export interface AutoTypePayload {
  title: string;
  username: string;
  password: string;
  url: string;
  sequence: string;
}

const STANDARD_FIELDS = new Set(['Title', 'UserName', 'Password', 'URL', 'Notes']);
const FAVORITE_KEY = 'PassDeck.Favorite';
const AUTO_TYPE_ENABLED_KEY = 'PassDeck.AutoTypeEnabled';
const AUTO_TYPE_SEQUENCE_KEY = 'PassDeck.AutoTypeSequence';

function bufferToArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
}

function fieldText(entry: KdbxEntry, key: string): string {
  const value = entry.fields.get(key);
  if (value instanceof ProtectedValue) {
    return value.getText();
  }
  return typeof value === 'string' ? value : '';
}

export class DatabaseService {
  private readonly sessions = new Map<string, DatabaseSession>();

  constructor(private readonly settings: SettingsStore) {
    configureArgon2();
  }

  listViews(): DatabaseView[] {
    return [...this.sessions.values()].map((session) => this.toView(session));
  }

  async restoreLockedTabs(paths: string[]): Promise<void> {
    for (const item of paths) {
      const absolutePath = path.resolve(item);
      if ([...this.sessions.values()].some((session) => session.path === absolutePath)) {
        continue;
      }
      if (!(await this.fileExists(absolutePath))) {
        continue;
      }
      const id = randomUUID();
      this.sessions.set(id, {
        id,
        path: absolutePath,
        name: path.basename(absolutePath, path.extname(absolutePath)),
        db: undefined,
        locked: true,
        readOnly: false,
        dirty: false,
        ownsLock: false,
        fingerprint: await this.getFingerprint(absolutePath),
      });
    }
  }

  getView(sessionId: string): DatabaseView {
    return this.toView(this.getSession(sessionId));
  }

  async openDatabase(request: OpenDatabaseRequest): Promise<DatabaseView> {
    const absolutePath = path.resolve(request.path);
    const existing = [...this.sessions.values()].find((session) => session.path === absolutePath);
    if (existing) {
      if (existing.locked) {
        await this.unlockDatabase(existing.id, request.password);
      }
      return this.toView(existing);
    }

    const lockState = await this.acquireLock(absolutePath, request.forceReadWrite === true);
    try {
      const db = await this.loadKdbx(absolutePath, request.password);
      const fingerprint = await this.getFingerprint(absolutePath);
      const session: DatabaseSession = {
        id: randomUUID(),
        path: absolutePath,
        name: db.meta.name || path.basename(absolutePath, path.extname(absolutePath)),
        db,
        locked: false,
        readOnly: lockState.readOnly,
        dirty: false,
        ownsLock: lockState.ownsLock,
        fingerprint,
      };
      this.sessions.set(session.id, session);
      await this.settings.rememberDatabase(absolutePath);
      await this.persistOpenTabs();
      return this.toView(session);
    } catch (error) {
      if (lockState.ownsLock) {
        await this.releaseLockFile(absolutePath);
      }
      throw error;
    }
  }

  async createDatabase(request: CreateDatabaseRequest): Promise<DatabaseView> {
    const absolutePath = path.resolve(request.path);
    if (request.password.length < 8) {
      throw new PassDeckError(
        'WEAK_MASTER_PASSWORD',
        'Мастер-пароль должен содержать минимум 8 символов.',
      );
    }

    try {
      await stat(absolutePath);
      throw new PassDeckError('FILE_EXISTS', 'Файл уже существует. Выберите другое имя.');
    } catch (error) {
      if (error instanceof PassDeckError) {
        throw error;
      }
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code !== 'ENOENT') {
        throw error;
      }
    }

    await mkdir(path.dirname(absolutePath), { recursive: true });
    const credentials = new KdbxCredentials(ProtectedValue.fromString(request.password));
    await credentials.ready;
    const db = Kdbx.create(credentials, request.name || 'PassDeck');
    db.setVersion(4);
    db.header.versionMinor = 1;
    db.setKdf(Consts.KdfId.Argon2id);
    db.meta.generator = 'PassDeck 0.1.1';
    db.meta.historyMaxItems = 10;
    db.createRecycleBin();

    const lockState = await this.acquireLock(absolutePath, true);
    const session: DatabaseSession = {
      id: randomUUID(),
      path: absolutePath,
      name: request.name || 'PassDeck',
      db,
      locked: false,
      readOnly: false,
      dirty: true,
      ownsLock: lockState.ownsLock,
      fingerprint: undefined,
    };
    this.sessions.set(session.id, session);

    try {
      await this.saveDatabase(session.id, true);
      await this.settings.rememberDatabase(absolutePath);
      await this.persistOpenTabs();
      return this.toView(session);
    } catch (error) {
      this.sessions.delete(session.id);
      await this.releaseLock(session);
      throw error;
    }
  }

  async saveDatabase(sessionId: string, isInitial = false): Promise<DatabaseView> {
    const session = this.getUnlockedSession(sessionId);
    if (session.readOnly) {
      throw new PassDeckError('READ_ONLY', 'База открыта только для чтения.');
    }
    if (!session.db) {
      throw new PassDeckError('LOCKED', 'База заблокирована.');
    }

    if (!isInitial && session.fingerprint) {
      const current = await this.getFingerprint(session.path);
      if (
        current.mtimeMs !== session.fingerprint.mtimeMs ||
        current.size !== session.fingerprint.size
      ) {
        throw new PassDeckError(
          'EXTERNAL_CHANGE',
          'Файл базы был изменён другим приложением. Сохранение отменено.',
        );
      }
    }

    await mkdir(path.dirname(session.path), { recursive: true });
    const exists = await this.fileExists(session.path);
    if (exists) {
      await this.createBackup(session.path);
    }

    const data = Buffer.from(await session.db.save());
    const tempPath = path.join(
      path.dirname(session.path),
      `.${path.basename(session.path)}.${process.pid}.${Date.now()}.tmp`,
    );
    const handle = await open(tempPath, 'w', 0o600);
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }

    await rename(tempPath, session.path);
    session.fingerprint = await this.getFingerprint(session.path);
    session.dirty = false;
    return this.toView(session);
  }

  async saveAllDirty(): Promise<void> {
    for (const session of this.sessions.values()) {
      if (session.dirty && !session.locked && !session.readOnly) {
        await this.saveDatabase(session.id);
      }
    }
  }

  saveEntry(request: SaveEntryRequest): DatabaseView {
    const session = this.getWritableSession(request.sessionId);
    const db = session.db;
    const group = this.findGroup(db, request.groupId);
    if (!group) {
      throw new PassDeckError('GROUP_NOT_FOUND', 'Группа не найдена.');
    }

    let entry: KdbxEntry;
    if (request.entryId) {
      const existing = this.findEntry(db, request.entryId);
      if (!existing) {
        throw new PassDeckError('ENTRY_NOT_FOUND', 'Запись не найдена.');
      }
      existing.pushHistory();
      entry = existing;
      if (entry.parentGroup?.uuid.toString() !== group.uuid.toString()) {
        db.move(entry, group);
      }
    } else {
      entry = db.createEntry(group);
    }

    entry.fields.set('Title', ProtectedValue.fromString(request.title.trim() || 'Без названия'));
    entry.fields.set('UserName', ProtectedValue.fromString(request.username));
    if (request.password !== undefined) {
      entry.fields.set('Password', ProtectedValue.fromString(request.password));
    }
    entry.fields.set('URL', ProtectedValue.fromString(request.url));
    entry.fields.set('Notes', ProtectedValue.fromString(request.notes));
    entry.tags = request.tags.map((tag) => tag.trim()).filter(Boolean);
    entry.times.expires = request.expires;
    entry.times.expiryTime =
      request.expires && request.expiryTime ? new Date(request.expiryTime) : undefined;
    entry.customData ??= new Map();
    entry.customData.set(FAVORITE_KEY, {
      value: request.favorite ? 'true' : 'false',
      lastModified: new Date(),
    });
    entry.customData.set(AUTO_TYPE_ENABLED_KEY, {
      value: request.autoTypeEnabled === false ? 'false' : 'true',
      lastModified: new Date(),
    });
    entry.customData.set(AUTO_TYPE_SEQUENCE_KEY, {
      value: (request.autoTypeSequence?.trim() || DEFAULT_AUTO_TYPE_SEQUENCE).slice(0, 500),
      lastModified: new Date(),
    });

    if (request.customFields !== undefined) {
      for (const key of [...entry.fields.keys()]) {
        if (!STANDARD_FIELDS.has(key)) {
          entry.fields.delete(key);
        }
      }
      for (const field of request.customFields) {
        const key = field.key.trim();
        if (!key || STANDARD_FIELDS.has(key)) {
          continue;
        }
        entry.fields.set(
          key,
          field.protected ? ProtectedValue.fromString(field.value) : field.value,
        );
      }
    }

    entry.times.update();
    session.dirty = true;
    return this.toView(session);
  }

  deleteEntry(sessionId: string, entryId: string): DatabaseView {
    const session = this.getWritableSession(sessionId);
    const entry = this.findEntry(session.db, entryId);
    if (!entry) {
      throw new PassDeckError('ENTRY_NOT_FOUND', 'Запись не найдена.');
    }
    session.db.remove(entry);
    session.dirty = true;
    return this.toView(session);
  }

  createGroup(request: CreateGroupRequest): DatabaseView {
    const session = this.getWritableSession(request.sessionId);
    const parent = request.parentId
      ? this.findGroup(session.db, request.parentId)
      : session.db.getDefaultGroup();
    if (!parent) {
      throw new PassDeckError('GROUP_NOT_FOUND', 'Родительская группа не найдена.');
    }
    session.db.createGroup(parent, request.name.trim() || 'Новая группа');
    session.dirty = true;
    return this.toView(session);
  }

  async lockDatabase(sessionId: string): Promise<DatabaseView> {
    const session = this.getSession(sessionId);
    if (session.dirty && !session.readOnly && session.db) {
      await this.saveDatabase(sessionId);
    }
    session.db = undefined;
    session.locked = true;
    session.dirty = false;
    return this.toView(session);
  }

  async unlockDatabase(sessionId: string, password: string): Promise<DatabaseView> {
    const session = this.getSession(sessionId);
    if (!session.locked) {
      return this.toView(session);
    }
    if (!session.ownsLock) {
      const lockState = await this.acquireLock(session.path, false);
      session.readOnly = lockState.readOnly;
      session.ownsLock = lockState.ownsLock;
    }
    try {
      session.db = await this.loadKdbx(session.path, password);
    } catch (error) {
      if (session.ownsLock) {
        await this.releaseLock(session);
      }
      throw error;
    }
    session.name = session.db.meta.name || session.name;
    session.locked = false;
    session.fingerprint = await this.getFingerprint(session.path);
    return this.toView(session);
  }

  revealPassword(sessionId: string, entryId: string): string {
    const session = this.getUnlockedSession(sessionId);
    const entry = this.findEntry(session.db, entryId);
    if (!entry) {
      throw new PassDeckError('ENTRY_NOT_FOUND', 'Запись не найдена.');
    }
    return fieldText(entry, 'Password');
  }

  getAutoTypePayload(sessionId: string, entryId: string): AutoTypePayload {
    const session = this.getUnlockedSession(sessionId);
    const entry = this.findEntry(session.db, entryId);
    if (!entry) {
      throw new PassDeckError('ENTRY_NOT_FOUND', 'Запись не найдена.');
    }
    if (entry.customData?.get(AUTO_TYPE_ENABLED_KEY)?.value === 'false') {
      throw new PassDeckError('AUTO_TYPE_DISABLED', 'Auto-Type отключён для этой записи.');
    }
    return {
      title: fieldText(entry, 'Title') || 'Без названия',
      username: fieldText(entry, 'UserName'),
      password: fieldText(entry, 'Password'),
      url: fieldText(entry, 'URL'),
      sequence: entry.customData?.get(AUTO_TYPE_SEQUENCE_KEY)?.value || DEFAULT_AUTO_TYPE_SEQUENCE,
    };
  }

  async closeDatabase(sessionId: string): Promise<void> {
    const session = this.getSession(sessionId);
    if (session.dirty && !session.readOnly && session.db) {
      await this.saveDatabase(session.id);
    }
    this.sessions.delete(session.id);
    await this.releaseLock(session);
    await this.persistOpenTabs();
  }

  async shutdown(): Promise<void> {
    await this.saveAllDirty();
    await this.persistOpenTabs();
    for (const session of [...this.sessions.values()]) {
      await this.releaseLock(session);
    }
  }

  async closeAll(): Promise<void> {
    await this.saveAllDirty();
    for (const session of [...this.sessions.values()]) {
      await this.releaseLock(session);
    }
    this.sessions.clear();
    await this.settings.setLastOpenDatabases([]);
  }

  private async loadKdbx(filePath: string, password: string): Promise<Kdbx> {
    const raw = await readFile(filePath);
    const credentials = new KdbxCredentials(ProtectedValue.fromString(password));
    await credentials.ready;
    return Kdbx.load(bufferToArrayBuffer(raw), credentials, { preserveXml: true });
  }

  private toView(session: DatabaseSession): DatabaseView {
    if (session.locked || !session.db) {
      return {
        sessionId: session.id,
        path: session.path,
        name: session.name,
        locked: true,
        readOnly: session.readOnly,
        dirty: false,
        groups: [],
        entries: [],
        selectedGroupId: null,
      };
    }

    const groups: GroupSummary[] = [];
    const entries: EntrySummary[] = [];
    const root = session.db.getDefaultGroup();

    const visit = (group: KdbxGroup, parentId: string | null, depth: number): void => {
      const groupId = group.uuid.toString();
      groups.push({
        id: groupId,
        name: group.name || 'Без названия',
        parentId,
        depth,
        entryCount: group.entries.length,
      });

      for (const entry of group.entries) {
        const customFields = [...entry.fields.entries()]
          .filter(([key]) => !STANDARD_FIELDS.has(key))
          .map(([key, value]) => ({
            key,
            value: value instanceof ProtectedValue ? '••••••' : value,
            protected: value instanceof ProtectedValue,
          }));
        entries.push({
          id: entry.uuid.toString(),
          groupId,
          title: fieldText(entry, 'Title') || 'Без названия',
          username: fieldText(entry, 'UserName'),
          url: fieldText(entry, 'URL'),
          notes: fieldText(entry, 'Notes'),
          tags: [...entry.tags],
          favorite: entry.customData?.get(FAVORITE_KEY)?.value === 'true',
          expires: entry.times.expires === true,
          ...(entry.times.expiryTime ? { expiryTime: entry.times.expiryTime.toISOString() } : {}),
          ...(entry.times.lastModTime ? { modifiedAt: entry.times.lastModTime.toISOString() } : {}),
          customFields,
          autoTypeEnabled: entry.customData?.get(AUTO_TYPE_ENABLED_KEY)?.value !== 'false',
          autoTypeSequence:
            entry.customData?.get(AUTO_TYPE_SEQUENCE_KEY)?.value || DEFAULT_AUTO_TYPE_SEQUENCE,
        });
      }

      for (const child of group.groups) {
        visit(child, groupId, depth + 1);
      }
    };

    visit(root, null, 0);
    return {
      sessionId: session.id,
      path: session.path,
      name: session.name,
      locked: false,
      readOnly: session.readOnly,
      dirty: session.dirty,
      groups,
      entries,
      selectedGroupId: root.uuid.toString(),
    };
  }

  private getSession(sessionId: string): DatabaseSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new PassDeckError('SESSION_NOT_FOUND', 'Сессия базы не найдена.');
    }
    return session;
  }

  private getUnlockedSession(sessionId: string): DatabaseSession & { db: Kdbx } {
    const session = this.getSession(sessionId);
    if (!session.db || session.locked) {
      throw new PassDeckError('LOCKED', 'База заблокирована.');
    }
    return session as DatabaseSession & { db: Kdbx };
  }

  private getWritableSession(sessionId: string): DatabaseSession & { db: Kdbx } {
    const session = this.getUnlockedSession(sessionId);
    if (session.readOnly) {
      throw new PassDeckError('READ_ONLY', 'База открыта только для чтения.');
    }
    return session;
  }

  private findGroup(db: Kdbx, groupId: string): KdbxGroup | undefined {
    return db.getGroup(groupId);
  }

  private findEntry(db: Kdbx, entryId: string): KdbxEntry | undefined {
    for (const group of db.getDefaultGroup().allGroups()) {
      const found = group.entries.find((entry) => entry.uuid.toString() === entryId);
      if (found) {
        return found;
      }
    }
    return undefined;
  }

  private lockPath(filePath: string): string {
    return `${filePath}.passdeck.lock`;
  }

  private async acquireLock(
    filePath: string,
    forceReadWrite: boolean,
  ): Promise<{ readOnly: boolean; ownsLock: boolean }> {
    const lockPath = this.lockPath(filePath);
    if (forceReadWrite) {
      await rm(lockPath, { force: true });
    }

    try {
      await writeFile(
        lockPath,
        `${JSON.stringify({ pid: process.pid, host: hostname(), openedAt: new Date().toISOString() }, null, 2)}\n`,
        { flag: 'wx', encoding: 'utf8', mode: 0o600 },
      );
      return { readOnly: false, ownsLock: true };
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === 'EEXIST') {
        return { readOnly: true, ownsLock: false };
      }
      throw error;
    }
  }

  private async releaseLock(session: DatabaseSession): Promise<void> {
    if (session.ownsLock) {
      await this.releaseLockFile(session.path);
      session.ownsLock = false;
    }
  }

  private async releaseLockFile(filePath: string): Promise<void> {
    await rm(this.lockPath(filePath), { force: true });
  }

  private async createBackup(filePath: string): Promise<void> {
    await mkdir(this.settings.backupDir, { recursive: true });
    const base = path.basename(filePath, path.extname(filePath));
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const destination = path.join(this.settings.backupDir, `${base}-${stamp}.kdbx`);
    await copyFile(filePath, destination);

    const files = (await readdir(this.settings.backupDir, { withFileTypes: true }))
      .filter(
        (entry) =>
          entry.isFile() && entry.name.startsWith(`${base}-`) && entry.name.endsWith('.kdbx'),
      )
      .map((entry) => entry.name)
      .sort()
      .reverse();
    for (const stale of files.slice(2)) {
      await unlink(path.join(this.settings.backupDir, stale));
    }
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await stat(filePath);
      return true;
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === 'ENOENT') {
        return false;
      }
      throw error;
    }
  }

  private async getFingerprint(filePath: string): Promise<FileFingerprint> {
    const info = await stat(filePath);
    return { mtimeMs: info.mtimeMs, size: info.size };
  }

  private async persistOpenTabs(): Promise<void> {
    await this.settings.setLastOpenDatabases(
      [...this.sessions.values()].map((session) => session.path),
    );
  }
}
