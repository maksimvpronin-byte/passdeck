import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  copyFile,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { KdbxBinaries, ProtectedValue } from 'kdbxweb';
import type { Kdbx, KdbxBinary, KdbxBinaryWithHash, KdbxEntry, KdbxGroup } from 'kdbxweb';
import { DEFAULT_AUTO_TYPE_SEQUENCE } from '@passdeck/shared';
import type {
  CreateDatabaseRequest,
  CreateGroupRequest,
  CustomFieldInput,
  DatabaseView,
  EntrySummary,
  GroupSummary,
  MoveEntryRequest,
  MoveGroupRequest,
  OpenDatabaseRequest,
  SaveEntryRequest,
} from '@passdeck/shared';
import {
  DatabaseSessionStore,
  type DatabaseSession,
  type FileFingerprint,
} from './database-session-store';
import { PassDeckError } from './errors';
import { KdbxOperations } from './kdbx-operations';
import { LockFileService } from './lock-file-service';
import { AUTO_TYPE_ENABLED_KEY, AUTO_TYPE_SEQUENCE_KEY, FAVORITE_KEY } from './passdeck-metadata';
import type { SettingsStore } from './settings-store';

export interface AutoTypePayload {
  title: string;
  username: string;
  password: string;
  url: string;
  sequence: string;
}

const STANDARD_FIELDS = new Set(['Title', 'UserName', 'Password', 'URL', 'Notes']);
const RESERVED_FIELD_NAMES = new Set(
  [...STANDARD_FIELDS].map((fieldName) => fieldName.toLowerCase()),
);
const MAX_ATTACHMENT_SIZE_BYTES = 25 * 1024 * 1024;
const MAX_ENTRY_ATTACHMENTS_BYTES = 100 * 1024 * 1024;

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

function binaryArrayBuffer(binary: KdbxBinary | KdbxBinaryWithHash): ArrayBuffer {
  const value = KdbxBinaries.isKdbxBinaryWithHash(binary) ? binary.value : binary;
  return value instanceof ProtectedValue
    ? bufferToArrayBuffer(Buffer.from(value.getBinary()))
    : value;
}

function attachmentSize(binary: KdbxBinary | KdbxBinaryWithHash): number {
  return binaryArrayBuffer(binary).byteLength;
}

export class DatabaseService {
  private readonly sessions = new DatabaseSessionStore();
  private readonly locks = new LockFileService();
  private readonly kdbx = new KdbxOperations();

  constructor(private readonly settings: SettingsStore) {}

  listViews(): DatabaseView[] {
    return this.sessions.list().map((session) => this.toView(session));
  }

  async restoreLockedTabs(paths: string[]): Promise<void> {
    for (const item of paths) {
      const absolutePath = path.resolve(item);
      if (this.sessions.findByPath(absolutePath)) {
        continue;
      }
      if (!(await this.fileExists(absolutePath))) {
        await this.settings.forgetDatabase(absolutePath);
        continue;
      }
      const id = randomUUID();
      this.sessions.add({
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
    return this.toView(this.sessions.get(sessionId));
  }

  async openDatabase(request: OpenDatabaseRequest): Promise<DatabaseView> {
    const absolutePath = path.resolve(request.path);
    const existing = this.sessions.findByPath(absolutePath);
    if (existing) {
      if (existing.locked) {
        await this.unlockDatabase(existing.id, request.password);
      }
      return this.toView(existing);
    }

    await this.ensureDatabaseFileExists(absolutePath);
    const lockState = await this.locks.acquire(absolutePath, request.forceReadWrite === true);
    try {
      const db = await this.kdbx.load(absolutePath, request.password);
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
      this.sessions.add(session);
      await this.settings.rememberDatabase(absolutePath);
      await this.persistOpenTabs();
      return this.toView(session);
    } catch (error) {
      if (lockState.ownsLock) {
        await this.locks.releaseFile(absolutePath);
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
    const db = await this.kdbx.create(request.name || 'PassDeck', request.password);

    const lockState = await this.locks.acquire(absolutePath, true);
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
    this.sessions.add(session);

    try {
      await this.saveDatabase(session.id, true);
      await this.settings.rememberDatabase(absolutePath);
      await this.persistOpenTabs();
      return this.toView(session);
    } catch (error) {
      this.sessions.delete(session.id);
      await this.locks.release(session);
      throw error;
    }
  }

  async saveDatabase(sessionId: string, isInitial = false): Promise<DatabaseView> {
    const session = this.sessions.getUnlocked(sessionId);
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

    const data = await this.kdbx.save(session.db);
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
    for (const session of this.sessions.list()) {
      if (session.dirty && !session.locked && !session.readOnly) {
        await this.saveDatabase(session.id);
      }
    }
  }

  saveEntry(request: SaveEntryRequest): DatabaseView {
    const session = this.sessions.getWritable(request.sessionId);
    const db = session.db;
    const group = this.findGroup(db, request.groupId);
    if (!group || this.isRecycleBin(db, group)) {
      throw new PassDeckError('GROUP_NOT_FOUND', 'Группа не найдена.');
    }

    let existingEntry: KdbxEntry | undefined;
    if (request.entryId) {
      existingEntry = this.findEntry(db, request.entryId);
      if (!existingEntry) {
        throw new PassDeckError('ENTRY_NOT_FOUND', 'Запись не найдена.');
      }
    }
    const preparedCustomFields =
      request.customFields === undefined
        ? undefined
        : this.prepareCustomFields(existingEntry, request.customFields);

    let entry: KdbxEntry;
    if (existingEntry) {
      existingEntry.pushHistory();
      entry = existingEntry;
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
      value: 'true',
      lastModified: new Date(),
    });
    entry.customData.set(AUTO_TYPE_SEQUENCE_KEY, {
      value: DEFAULT_AUTO_TYPE_SEQUENCE,
      lastModified: new Date(),
    });

    if (preparedCustomFields !== undefined) {
      for (const key of [...entry.fields.keys()]) {
        if (!STANDARD_FIELDS.has(key)) {
          entry.fields.delete(key);
        }
      }
      for (const field of preparedCustomFields) {
        entry.fields.set(
          field.key,
          field.protected ? ProtectedValue.fromString(field.value) : field.value,
        );
      }
    }

    entry.times.update();
    session.dirty = true;
    return this.toView(session);
  }

  deleteEntry(sessionId: string, entryId: string): DatabaseView {
    const session = this.sessions.getWritable(sessionId);
    const entry = this.findEntry(session.db, entryId);
    if (!entry) {
      throw new PassDeckError('ENTRY_NOT_FOUND', 'Запись не найдена.');
    }
    session.db.move(entry, undefined);
    session.dirty = true;
    return this.toView(session);
  }

  moveEntry(request: MoveEntryRequest): DatabaseView {
    const session = this.sessions.getWritable(request.sessionId);
    const entry = this.findEntry(session.db, request.entryId);
    if (!entry) {
      throw new PassDeckError('ENTRY_NOT_FOUND', 'Запись не найдена.');
    }
    const target = this.findGroup(session.db, request.targetGroupId);
    if (!target || this.isRecycleBin(session.db, target)) {
      throw new PassDeckError('GROUP_NOT_FOUND', 'Группа назначения не найдена.');
    }
    if (
      entry.parentGroup?.uuid.toString() === target.uuid.toString() &&
      request.beforeEntryId === undefined
    ) {
      return this.toView(session);
    }
    if (entry.parentGroup?.uuid.toString() !== target.uuid.toString()) {
      session.db.move(entry, target);
    }
    this.placeEntryBefore(target, entry, request.beforeEntryId ?? null);
    entry.times.update();
    session.dirty = true;
    return this.toView(session);
  }

  moveGroup(request: MoveGroupRequest): DatabaseView {
    const session = this.sessions.getWritable(request.sessionId);
    const group = this.findGroup(session.db, request.groupId);

    if (!group || this.isRecycleBin(session.db, group)) {
      throw new PassDeckError('GROUP_NOT_FOUND', 'Перемещаемая группа не найдена.');
    }

    const root = session.db.getDefaultGroup();
    if (group.uuid.toString() === root.uuid.toString()) {
      throw new PassDeckError('GROUP_MOVE_ROOT', 'Корневую группу перемещать нельзя.');
    }

    const target = this.findGroup(session.db, request.targetGroupId);
    if (!target || this.isRecycleBin(session.db, target)) {
      throw new PassDeckError('GROUP_NOT_FOUND', 'Группа назначения не найдена.');
    }

    if (group.uuid.toString() === target.uuid.toString()) {
      throw new PassDeckError('GROUP_MOVE_SELF', 'Нельзя переместить группу в саму себя.');
    }

    if (group.parentGroup?.uuid.toString() === target.uuid.toString()) {
      return this.toView(session);
    }

    let current: KdbxGroup | undefined = target;
    while (current) {
      if (current.uuid.toString() === group.uuid.toString()) {
        throw new PassDeckError(
          'GROUP_MOVE_CYCLE',
          'Нельзя переместить группу в собственную вложенную группу.',
        );
      }
      current = current.parentGroup;
    }

    session.db.move(group, target);
    group.times.update();
    session.dirty = true;
    return this.toView(session);
  }

  deleteGroup(sessionId: string, groupId: string): DatabaseView {
    const session = this.sessions.getWritable(sessionId);
    const group = this.findGroup(session.db, groupId);

    if (!group || this.isRecycleBin(session.db, group)) {
      throw new PassDeckError('GROUP_NOT_FOUND', 'Группа не найдена.');
    }

    const root = session.db.getDefaultGroup();
    if (group.uuid.toString() === root.uuid.toString()) {
      throw new PassDeckError('GROUP_DELETE_ROOT', 'Корневую группу удалять нельзя.');
    }

    session.db.move(group, undefined);
    session.dirty = true;
    return this.toView(session);
  }

  createGroup(request: CreateGroupRequest): DatabaseView {
    const session = this.sessions.getWritable(request.sessionId);
    const parent = request.parentId
      ? this.findGroup(session.db, request.parentId)
      : session.db.getDefaultGroup();
    if (!parent || this.isRecycleBin(session.db, parent)) {
      throw new PassDeckError('GROUP_NOT_FOUND', 'Родительская группа не найдена.');
    }
    session.db.createGroup(parent, request.name.trim() || 'Новая группа');
    session.dirty = true;
    return this.toView(session);
  }

  async lockDatabase(sessionId: string): Promise<DatabaseView> {
    const session = this.sessions.get(sessionId);
    if (session.dirty && !session.readOnly && session.db) {
      await this.saveDatabase(sessionId);
    }
    session.db = undefined;
    session.locked = true;
    session.dirty = false;
    return this.toView(session);
  }

  async unlockDatabase(sessionId: string, password: string): Promise<DatabaseView> {
    const session = this.sessions.get(sessionId);
    if (!session.locked) {
      return this.toView(session);
    }
    if (!session.ownsLock) {
      const lockState = await this.locks.acquire(session.path, false);
      session.readOnly = lockState.readOnly;
      session.ownsLock = lockState.ownsLock;
    }
    try {
      session.db = await this.kdbx.load(session.path, password);
    } catch (error) {
      if (session.ownsLock) {
        await this.locks.release(session);
      }
      throw error;
    }
    session.name = session.db.meta.name || session.name;
    session.locked = false;
    session.fingerprint = await this.getFingerprint(session.path);
    return this.toView(session);
  }

  revealPassword(sessionId: string, entryId: string): string {
    const session = this.sessions.getUnlocked(sessionId);
    const entry = this.findEntry(session.db, entryId);
    if (!entry) {
      throw new PassDeckError('ENTRY_NOT_FOUND', 'Запись не найдена.');
    }
    return fieldText(entry, 'Password');
  }

  revealCustomField(sessionId: string, entryId: string, key: string): string {
    const session = this.sessions.getUnlocked(sessionId);
    const entry = this.findEntry(session.db, entryId);
    if (!entry) {
      throw new PassDeckError('ENTRY_NOT_FOUND', 'Запись не найдена.');
    }
    const fieldKey = key.trim();
    if (!fieldKey || RESERVED_FIELD_NAMES.has(fieldKey.toLowerCase())) {
      throw new PassDeckError('CUSTOM_FIELD_NOT_FOUND', 'Пользовательское поле не найдено.');
    }
    const value = entry.fields.get(fieldKey);
    if (value === undefined) {
      throw new PassDeckError('CUSTOM_FIELD_NOT_FOUND', 'Пользовательское поле не найдено.');
    }
    return value instanceof ProtectedValue ? value.getText() : value;
  }

  async addAttachments(
    sessionId: string,
    entryId: string,
    filePaths: string[],
  ): Promise<DatabaseView> {
    const session = this.sessions.getWritable(sessionId);
    const entry = this.findEntry(session.db, entryId);
    if (!entry) {
      throw new PassDeckError('ENTRY_NOT_FOUND', 'Запись не найдена.');
    }
    if (filePaths.length === 0) {
      return this.toView(session);
    }

    const existingNames = new Set(
      [...entry.binaries.keys()].map((name) => name.toLocaleLowerCase()),
    );
    const selectedNames = new Set<string>();
    const prepared: Array<{ sourcePath: string; name: string; size: number }> = [];

    for (const sourcePath of filePaths) {
      const info = await stat(sourcePath);
      if (!info.isFile()) {
        throw new PassDeckError('ATTACHMENT_NOT_FILE', 'Для вложения необходимо выбрать файл.');
      }
      const name = path.basename(sourcePath).trim();
      const normalizedName = name.toLocaleLowerCase();
      if (!name) {
        throw new PassDeckError('ATTACHMENT_EMPTY_NAME', 'Имя вложения не может быть пустым.');
      }
      if (existingNames.has(normalizedName) || selectedNames.has(normalizedName)) {
        throw new PassDeckError(
          'ATTACHMENT_EXISTS',
          `Вложение «${name}» уже существует в записи. Переименуйте файл или удалите старое вложение.`,
        );
      }
      if (info.size > MAX_ATTACHMENT_SIZE_BYTES) {
        throw new PassDeckError('ATTACHMENT_TOO_LARGE', `Файл «${name}» превышает лимит 25 МБ.`);
      }
      selectedNames.add(normalizedName);
      prepared.push({ sourcePath, name, size: info.size });
    }

    const currentSize = [...entry.binaries.values()].reduce(
      (total, binary) => total + attachmentSize(binary),
      0,
    );
    const addedSize = prepared.reduce((total, item) => total + item.size, 0);
    if (currentSize + addedSize > MAX_ENTRY_ATTACHMENTS_BYTES) {
      throw new PassDeckError(
        'ATTACHMENTS_TOTAL_TOO_LARGE',
        'Суммарный размер вложений одной записи не может превышать 100 МБ.',
      );
    }

    const binaries: Array<{ name: string; binary: KdbxBinaryWithHash }> = [];
    for (const item of prepared) {
      const file = await readFile(item.sourcePath);
      const binary = await session.db.binaries.add(
        new Uint8Array(file.buffer, file.byteOffset, file.byteLength),
      );
      binaries.push({ name: item.name, binary });
    }

    entry.pushHistory();
    for (const item of binaries) {
      entry.binaries.set(item.name, item.binary);
    }
    entry.times.update();
    session.dirty = true;
    return this.toView(session);
  }

  async exportAttachment(
    sessionId: string,
    entryId: string,
    name: string,
    destinationPath: string,
  ): Promise<void> {
    const session = this.sessions.getUnlocked(sessionId);
    const entry = this.findEntry(session.db, entryId);
    if (!entry) {
      throw new PassDeckError('ENTRY_NOT_FOUND', 'Запись не найдена.');
    }
    const binary = entry.binaries.get(name);
    if (!binary) {
      throw new PassDeckError('ATTACHMENT_NOT_FOUND', 'Вложение не найдено.');
    }
    const data = binaryArrayBuffer(binary);
    await writeFile(destinationPath, new Uint8Array(data));
  }

  deleteAttachment(sessionId: string, entryId: string, name: string): DatabaseView {
    const session = this.sessions.getWritable(sessionId);
    const entry = this.findEntry(session.db, entryId);
    if (!entry) {
      throw new PassDeckError('ENTRY_NOT_FOUND', 'Запись не найдена.');
    }
    if (!entry.binaries.has(name)) {
      throw new PassDeckError('ATTACHMENT_NOT_FOUND', 'Вложение не найдено.');
    }
    entry.pushHistory();
    entry.binaries.delete(name);
    entry.times.update();
    session.dirty = true;
    return this.toView(session);
  }

  getAutoTypePayload(sessionId: string, entryId: string): AutoTypePayload {
    const session = this.sessions.getUnlocked(sessionId);
    const entry = this.findEntry(session.db, entryId);
    if (!entry) {
      throw new PassDeckError('ENTRY_NOT_FOUND', 'Запись не найдена.');
    }
    return {
      title: fieldText(entry, 'Title') || 'Без названия',
      username: fieldText(entry, 'UserName'),
      password: fieldText(entry, 'Password'),
      url: fieldText(entry, 'URL'),
      sequence: DEFAULT_AUTO_TYPE_SEQUENCE,
    };
  }

  async closeDatabase(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session.dirty && !session.readOnly && session.db) {
      await this.saveDatabase(session.id);
    }
    this.sessions.delete(session.id);
    await this.locks.release(session);
    await this.persistOpenTabs();
  }

  async forceReadWrite(sessionId: string): Promise<DatabaseView> {
    const session = this.sessions.getUnlocked(sessionId);
    if (!session.readOnly) {
      return this.toView(session);
    }

    const lockState = await this.locks.acquire(session.path, true);
    session.readOnly = false;
    session.ownsLock = lockState.ownsLock;
    return this.toView(session);
  }

  async shutdown(): Promise<void> {
    await this.saveAllDirty();
    await this.persistOpenTabs();
    for (const session of this.sessions.list()) {
      await this.locks.release(session);
    }
  }

  async closeAll(): Promise<void> {
    await this.saveAllDirty();
    for (const session of this.sessions.list()) {
      await this.locks.release(session);
    }
    this.sessions.clear();
    await this.settings.setLastOpenDatabases([]);
  }

  private prepareCustomFields(
    entry: KdbxEntry | undefined,
    fields: CustomFieldInput[],
  ): Array<{ key: string; value: string; protected: boolean }> {
    const seenKeys = new Set<string>();
    return fields.map((field) => {
      const key = field.key.trim();
      const normalizedKey = key.toLowerCase();
      if (!key) {
        throw new PassDeckError(
          'CUSTOM_FIELD_EMPTY_NAME',
          'Название пользовательского поля не может быть пустым.',
        );
      }
      if (RESERVED_FIELD_NAMES.has(normalizedKey)) {
        throw new PassDeckError(
          'CUSTOM_FIELD_RESERVED_NAME',
          `Имя «${key}» зарезервировано стандартным полем KDBX.`,
        );
      }
      if (seenKeys.has(normalizedKey)) {
        throw new PassDeckError(
          'CUSTOM_FIELD_DUPLICATE_NAME',
          `Пользовательское поле «${key}» указано несколько раз.`,
        );
      }
      seenKeys.add(normalizedKey);

      let value = field.value ?? '';
      if (field.preserveValue === true) {
        const originalKey = (field.originalKey ?? key).trim();
        const existingValue = entry?.fields.get(originalKey);
        if (existingValue === undefined || STANDARD_FIELDS.has(originalKey)) {
          throw new PassDeckError(
            'CUSTOM_FIELD_SOURCE_NOT_FOUND',
            `Не удалось сохранить скрытое значение поля «${originalKey}».`,
          );
        }
        value = existingValue instanceof ProtectedValue ? existingValue.getText() : existingValue;
      }

      return { key, value, protected: field.protected };
    });
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
    const recycleBinId = session.db.meta.recycleBinUuid?.toString();

    const visit = (group: KdbxGroup, parentId: string | null, depth: number): void => {
      const groupId = group.uuid.toString();
      if (parentId !== null && groupId === recycleBinId) {
        return;
      }
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
          .map(([key, value]) => {
            const isProtected = value instanceof ProtectedValue;
            const plainValue = isProtected ? value.getText() : value;
            return {
              key,
              value: isProtected ? '' : plainValue,
              protected: isProtected,
              hasValue: plainValue.length > 0,
            };
          });
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
          attachments: [...entry.binaries.entries()]
            .map(([name, binary]) => ({ name, size: attachmentSize(binary) }))
            .sort((left, right) => left.name.localeCompare(right.name)),
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

  private isRecycleBin(db: Kdbx, group: KdbxGroup): boolean {
    return db.meta.recycleBinUuid?.toString() === group.uuid.toString();
  }

  private findGroup(db: Kdbx, groupId: string): KdbxGroup | undefined {
    return db.getGroup(groupId);
  }

  private findEntry(db: Kdbx, entryId: string): KdbxEntry | undefined {
    for (const group of db.getDefaultGroup().allGroups()) {
      if (this.isRecycleBin(db, group)) {
        continue;
      }
      const found = group.entries.find((entry) => entry.uuid.toString() === entryId);
      if (found) {
        return found;
      }
    }
    return undefined;
  }

  private placeEntryBefore(group: KdbxGroup, entry: KdbxEntry, beforeEntryId: string | null): void {
    if (beforeEntryId === entry.uuid.toString()) {
      return;
    }

    const currentIndex = group.entries.findIndex(
      (item) => item.uuid.toString() === entry.uuid.toString(),
    );
    if (currentIndex === -1) {
      return;
    }

    const beforeIndex = beforeEntryId
      ? group.entries.findIndex((item) => item.uuid.toString() === beforeEntryId)
      : -1;
    if (beforeEntryId && beforeIndex === -1) {
      throw new PassDeckError(
        'ENTRY_ORDER_TARGET',
        'Целевая позиция записи не найдена в выбранной группе.',
      );
    }

    const [movedEntry] = group.entries.splice(currentIndex, 1);
    if (!movedEntry) {
      return;
    }

    if (!beforeEntryId || beforeEntryId === movedEntry.uuid.toString()) {
      group.entries.push(movedEntry);
      return;
    }

    group.entries.splice(beforeIndex > currentIndex ? beforeIndex - 1 : beforeIndex, 0, movedEntry);
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

  private async ensureDatabaseFileExists(filePath: string): Promise<void> {
    if (await this.fileExists(filePath)) {
      return;
    }

    await this.settings.forgetDatabase(filePath);
    throw new PassDeckError(
      'DATABASE_FILE_MISSING',
      'Файл базы не найден. Возможно, он был перемещён или удалён.',
      filePath,
    );
  }

  private async getFingerprint(filePath: string): Promise<FileFingerprint> {
    const info = await stat(filePath);
    return { mtimeMs: info.mtimeMs, size: info.size };
  }

  private async persistOpenTabs(): Promise<void> {
    await this.settings.setLastOpenDatabases(this.sessions.openPaths());
  }
}
