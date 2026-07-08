import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseService } from '../database-service';
import type { PassDeckError } from '../errors';
import type { SettingsStore } from '../settings-store';

const temporaryDirectories: string[] = [];

async function createHarness() {
  const root = await mkdtemp(path.join(tmpdir(), 'passdeck-test-'));
  temporaryDirectories.push(root);
  const backupDir = path.join(root, 'backups');
  const recoveryDir = path.join(root, 'recovery');
  const forgottenDatabases: string[] = [];
  const settings = {
    backupDir,
    recoveryDir,
    get: () => ({
      recoveryEnabled: false,
    }),
    rememberDatabase: () => Promise.resolve(),
    forgetDatabase: (filePath: string) => {
      forgottenDatabases.push(filePath);
      return Promise.resolve();
    },
    setLastOpenDatabases: () => Promise.resolve(),
  } as unknown as SettingsStore;
  return { root, backupDir, forgottenDatabases, settings, service: new DatabaseService(settings) };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('DatabaseService', () => {
  it('returns a friendly error and forgets a missing database file', async () => {
    const { root, forgottenDatabases, service } = await createHarness();
    const filePath = path.join(root, 'Missing.kdbx');

    await expect(
      service.openDatabase({ path: filePath, password: 'PassDeck-Demo-2026!' }),
    ).rejects.toMatchObject({
      code: 'DATABASE_FILE_MISSING',
      message: 'Файл базы не найден. Возможно, он был перемещён или удалён.',
      details: filePath,
    } satisfies Partial<PassDeckError>);
    expect(forgottenDatabases).toEqual([filePath]);
  });

  it('skips and forgets missing databases during locked tab restore', async () => {
    const { root, forgottenDatabases, service } = await createHarness();
    const filePath = path.join(root, 'Missing.kdbx');

    await service.restoreLockedTabs([filePath]);

    expect(service.listViews()).toHaveLength(0);
    expect(forgottenDatabases).toEqual([filePath]);
  });

  it('creates, edits, saves, locks and reopens a KDBX 4.1 database', async () => {
    const { root, service } = await createHarness();
    const filePath = path.join(root, 'Demo.kdbx');
    const password = 'PassDeck-Demo-2026!';

    const created = await service.createDatabase({ path: filePath, password, name: 'Demo' });
    expect(created.locked).toBe(false);
    expect(created.groups.length).toBeGreaterThan(0);

    const groupId = created.groups[0]?.id;
    expect(groupId).toBeTruthy();
    const changed = service.saveEntry({
      sessionId: created.sessionId,
      groupId: groupId!,
      title: 'Example account',
      username: 'demo-user',
      password: 'correct horse battery staple',
      url: 'https://example.test',
      notes: 'Synthetic test data',
      tags: ['demo', 'test'],
      favorite: true,
      expires: false,
    });
    expect(changed.dirty).toBe(true);
    expect(changed.entries).toHaveLength(1);
    await service.saveDatabase(created.sessionId);

    expect(service.revealPassword(created.sessionId, changed.entries[0]!.id)).toBe(
      'correct horse battery staple',
    );
    expect(service.getAutoTypePayload(created.sessionId, changed.entries[0]!.id)).toEqual({
      title: 'Example account',
      username: 'demo-user',
      password: 'correct horse battery staple',
      url: 'https://example.test',
      sequence: '{USERNAME}{TAB}{PASSWORD}{ENTER}',
    });

    const locked = await service.lockDatabase(created.sessionId);
    expect(locked.locked).toBe(true);
    const unlocked = await service.unlockDatabase(created.sessionId, password);
    expect(unlocked.entries[0]?.title).toBe('Example account');
    expect(unlocked.entries[0]?.username).toBe('demo-user');

    await service.closeDatabase(created.sessionId);

    const second = await createHarness();
    const reopened = await second.service.openDatabase({ path: filePath, password });
    expect(reopened.entries[0]?.title).toBe('Example account');
    expect(reopened.entries[0]?.favorite).toBe(true);
    await second.service.closeDatabase(reopened.sessionId);
  }, 30_000);

  it('can force a read-only database back to writable when its lock is stale', async () => {
    const { root, service, settings } = await createHarness();
    const filePath = path.join(root, 'Readonly.kdbx');
    const password = 'PassDeck-Readonly-2026!';
    const created = await service.createDatabase({ path: filePath, password, name: 'Readonly' });
    await service.saveDatabase(created.sessionId);

    const secondService = new DatabaseService(settings);
    const readOnly = await secondService.openDatabase({ path: filePath, password });
    expect(readOnly.readOnly).toBe(true);
    expect(() =>
      secondService.saveEntry({
        sessionId: readOnly.sessionId,
        groupId: readOnly.groups[0]!.id,
        title: 'Blocked',
        username: '',
        password: '',
        url: '',
        notes: '',
        tags: [],
        favorite: false,
        expires: false,
      }),
    ).toThrow('только для чтения');

    const writable = await secondService.forceReadWrite(readOnly.sessionId);
    expect(writable.readOnly).toBe(false);
    const changed = secondService.saveEntry({
      sessionId: writable.sessionId,
      groupId: writable.groups[0]!.id,
      title: 'Writable again',
      username: '',
      password: '',
      url: '',
      notes: '',
      tags: [],
      favorite: false,
      expires: false,
    });
    expect(changed.entries[0]?.title).toBe('Writable again');

    await secondService.closeDatabase(writable.sessionId);
    await service.closeDatabase(created.sessionId);
  }, 30_000);

  it('stores, masks, reveals and preserves protected custom fields', async () => {
    const { root, service } = await createHarness();
    const filePath = path.join(root, 'CustomFields.kdbx');
    const password = 'PassDeck-Custom-Fields-2026!';
    const created = await service.createDatabase({
      path: filePath,
      password,
      name: 'Custom fields',
    });
    const groupId = created.groups[0]!.id;

    const changed = service.saveEntry({
      sessionId: created.sessionId,
      groupId,
      title: 'Service account',
      username: 'svc-passdeck',
      password: 'entry-password',
      url: 'https://example.test',
      notes: '',
      tags: [],
      favorite: false,
      expires: false,
      customFields: [
        { key: 'Account ID', value: 'account-42', protected: false },
        { key: 'API token', value: 'token-secret-123', protected: true },
      ],
    });
    const entry = changed.entries[0]!;
    expect(entry.customFields).toEqual([
      {
        key: 'Account ID',
        value: 'account-42',
        protected: false,
        hasValue: true,
      },
      {
        key: 'API token',
        value: '',
        protected: true,
        hasValue: true,
      },
    ]);
    expect(service.revealCustomField(created.sessionId, entry.id, 'API token')).toBe(
      'token-secret-123',
    );

    const edited = service.saveEntry({
      sessionId: created.sessionId,
      entryId: entry.id,
      groupId,
      title: 'Service account',
      username: 'svc-passdeck',
      url: 'https://example.test',
      notes: '',
      tags: [],
      favorite: false,
      expires: false,
      customFields: [
        { key: 'Account ID', value: 'account-43', protected: false },
        {
          key: 'Renamed token',
          protected: true,
          preserveValue: true,
          originalKey: 'API token',
        },
      ],
    });
    expect(edited.entries[0]!.customFields[1]).toEqual({
      key: 'Renamed token',
      value: '',
      protected: true,
      hasValue: true,
    });
    expect(service.revealCustomField(created.sessionId, entry.id, 'Renamed token')).toBe(
      'token-secret-123',
    );

    await service.saveDatabase(created.sessionId);
    await service.closeDatabase(created.sessionId);

    const second = await createHarness();
    const reopened = await second.service.openDatabase({ path: filePath, password });
    expect(reopened.entries[0]!.customFields[0]!.value).toBe('account-43');
    expect(
      second.service.revealCustomField(
        reopened.sessionId,
        reopened.entries[0]!.id,
        'Renamed token',
      ),
    ).toBe('token-secret-123');
    await second.service.closeDatabase(reopened.sessionId);
  }, 30_000);

  it('adds, exports, persists and deletes entry attachments', async () => {
    const { root, service } = await createHarness();
    const filePath = path.join(root, 'Attachments.kdbx');
    const password = 'PassDeck-Attachments-2026!';
    const created = await service.createDatabase({
      path: filePath,
      password,
      name: 'Attachments',
    });
    const groupId = created.groups[0]!.id;
    const changed = service.saveEntry({
      sessionId: created.sessionId,
      groupId,
      title: 'Entry with files',
      username: '',
      password: '',
      url: '',
      notes: '',
      tags: [],
      favorite: false,
      expires: false,
    });
    const entryId = changed.entries[0]!.id;
    const textPath = path.join(root, 'notes.txt');
    const binaryPath = path.join(root, 'sample.bin');
    await writeFile(textPath, 'attachment text', 'utf8');
    await writeFile(binaryPath, Uint8Array.from([0, 1, 2, 3, 255]));

    const withAttachments = await service.addAttachments(created.sessionId, entryId, [
      textPath,
      binaryPath,
    ]);
    expect(withAttachments.entries[0]!.attachments).toEqual([
      { name: 'notes.txt', size: 15 },
      { name: 'sample.bin', size: 5 },
    ]);

    const exportedPath = path.join(root, 'exported-notes.txt');
    await service.exportAttachment(created.sessionId, entryId, 'notes.txt', exportedPath);
    expect(await readFile(exportedPath, 'utf8')).toBe('attachment text');
    await expect(service.addAttachments(created.sessionId, entryId, [textPath])).rejects.toThrow(
      'уже существует',
    );

    await service.saveDatabase(created.sessionId);
    await service.closeDatabase(created.sessionId);

    const second = await createHarness();
    const reopened = await second.service.openDatabase({ path: filePath, password });
    expect(reopened.entries[0]!.attachments).toEqual([
      { name: 'notes.txt', size: 15 },
      { name: 'sample.bin', size: 5 },
    ]);
    const reopenedEntryId = reopened.entries[0]!.id;
    second.service.deleteAttachment(reopened.sessionId, reopenedEntryId, 'notes.txt');
    await second.service.saveDatabase(reopened.sessionId);
    await second.service.closeDatabase(reopened.sessionId);

    const third = await createHarness();
    const finalView = await third.service.openDatabase({ path: filePath, password });
    expect(finalView.entries[0]!.attachments).toEqual([{ name: 'sample.bin', size: 5 }]);
    await third.service.closeDatabase(finalView.sessionId);
  }, 30_000);

  it('moves an entry between groups and keeps the move after reopening', async () => {
    const { root, service } = await createHarness();
    const filePath = path.join(root, 'Moves.kdbx');
    const password = 'PassDeck-Moves-2026!';
    const created = await service.createDatabase({ path: filePath, password, name: 'Moves' });
    const rootGroupId = created.groups[0]!.id;

    const withWork = service.createGroup({
      sessionId: created.sessionId,
      parentId: rootGroupId,
      name: 'Work',
    });
    const workGroupId = withWork.groups.find((group) => group.name === 'Work')!.id;
    const withArchive = service.createGroup({
      sessionId: created.sessionId,
      parentId: rootGroupId,
      name: 'Archive',
    });
    const archiveGroupId = withArchive.groups.find((group) => group.name === 'Archive')!.id;

    const withEntry = service.saveEntry({
      sessionId: created.sessionId,
      groupId: workGroupId,
      title: 'Movable entry',
      username: 'demo',
      password: 'move-password',
      url: '',
      notes: '',
      tags: [],
      favorite: false,
      expires: false,
    });
    const entryId = withEntry.entries[0]!.id;

    const movedEntry = service.moveEntry({
      sessionId: created.sessionId,
      entryId,
      targetGroupId: archiveGroupId,
    });
    expect(movedEntry.entries.find((entry) => entry.id === entryId)!.groupId).toBe(archiveGroupId);

    await service.saveDatabase(created.sessionId);
    await service.closeDatabase(created.sessionId);

    const second = await createHarness();
    const reopened = await second.service.openDatabase({ path: filePath, password });
    expect(reopened.entries.find((entry) => entry.id === entryId)!.groupId).toBe(archiveGroupId);
    second.service.deleteEntry(reopened.sessionId, entryId);
    await second.service.saveDatabase(reopened.sessionId);
    await second.service.closeDatabase(reopened.sessionId);

    const third = await createHarness();
    const afterDelete = await third.service.openDatabase({ path: filePath, password });
    expect(afterDelete.entries).toHaveLength(0);
    expect(afterDelete.groups.some((group) => group.name === 'Recycle Bin')).toBe(false);
    await third.service.closeDatabase(afterDelete.sessionId);
  }, 30_000);

  it('manually reorders entries and keeps the order after reopening', async () => {
    const { root, service } = await createHarness();
    const filePath = path.join(root, 'EntryOrder.kdbx');
    const password = 'PassDeck-Entry-Order-2026!';
    const created = await service.createDatabase({ path: filePath, password, name: 'Entry order' });
    const groupId = created.groups[0]!.id;

    const first = service.saveEntry({
      sessionId: created.sessionId,
      groupId,
      title: 'First',
      username: '',
      password: '',
      url: '',
      notes: '',
      tags: [],
      favorite: false,
      expires: false,
    }).entries.find((entry) => entry.title === 'First')!;
    const second = service.saveEntry({
      sessionId: created.sessionId,
      groupId,
      title: 'Second',
      username: '',
      password: '',
      url: '',
      notes: '',
      tags: [],
      favorite: false,
      expires: false,
    }).entries.find((entry) => entry.title === 'Second')!;
    const third = service.saveEntry({
      sessionId: created.sessionId,
      groupId,
      title: 'Third',
      username: '',
      password: '',
      url: '',
      notes: '',
      tags: [],
      favorite: false,
      expires: false,
    }).entries.find((entry) => entry.title === 'Third')!;

    const reordered = service.moveEntry({
      sessionId: created.sessionId,
      entryId: third.id,
      targetGroupId: groupId,
      beforeEntryId: first.id,
    });
    expect(reordered.entries.map((entry) => entry.title)).toEqual(['Third', 'First', 'Second']);

    service.moveEntry({
      sessionId: created.sessionId,
      entryId: first.id,
      targetGroupId: groupId,
      beforeEntryId: null,
    });
    expect(service.getView(created.sessionId).entries.map((entry) => entry.title)).toEqual([
      'Third',
      'Second',
      'First',
    ]);

    expect(() =>
      service.moveEntry({
        sessionId: created.sessionId,
        entryId: second.id,
        targetGroupId: groupId,
        beforeEntryId: 'missing-entry',
      }),
    ).toThrow('Целевая позиция');

    await service.saveDatabase(created.sessionId);
    await service.closeDatabase(created.sessionId);

    const secondHarness = await createHarness();
    const reopened = await secondHarness.service.openDatabase({ path: filePath, password });
    expect(reopened.entries.map((entry) => entry.title)).toEqual(['Third', 'Second', 'First']);
    await secondHarness.service.closeDatabase(reopened.sessionId);
  }, 30_000);

  it('moves a group with all descendants and rejects invalid targets', async () => {
    const { root, service } = await createHarness();
    const filePath = path.join(root, 'GroupMoves.kdbx');
    const password = 'PassDeck-Group-Moves-2026!';
    const created = await service.createDatabase({
      path: filePath,
      password,
      name: 'Group moves',
    });
    const rootGroupId = created.groups[0]!.id;

    const withWork = service.createGroup({
      sessionId: created.sessionId,
      parentId: rootGroupId,
      name: 'Work',
    });
    const workGroupId = withWork.groups.find((group) => group.name === 'Work')!.id;

    const withChild = service.createGroup({
      sessionId: created.sessionId,
      parentId: workGroupId,
      name: 'Child',
    });
    const childGroupId = withChild.groups.find((group) => group.name === 'Child')!.id;

    const withArchive = service.createGroup({
      sessionId: created.sessionId,
      parentId: rootGroupId,
      name: 'Archive',
    });
    const archiveGroupId = withArchive.groups.find((group) => group.name === 'Archive')!.id;

    const moved = service.moveGroup({
      sessionId: created.sessionId,
      groupId: workGroupId,
      targetGroupId: archiveGroupId,
    });

    expect(moved.groups.find((group) => group.id === workGroupId)!.parentId).toBe(
      archiveGroupId,
    );
    expect(moved.groups.find((group) => group.id === childGroupId)!.parentId).toBe(
      workGroupId,
    );

    expect(() =>
      service.moveGroup({
        sessionId: created.sessionId,
        groupId: archiveGroupId,
        targetGroupId: childGroupId,
      }),
    ).toThrow('собственную вложенную группу');

    expect(() =>
      service.moveGroup({
        sessionId: created.sessionId,
        groupId: rootGroupId,
        targetGroupId: archiveGroupId,
      }),
    ).toThrow('Корневую группу');

    await service.saveDatabase(created.sessionId);
    await service.closeDatabase(created.sessionId);

    const second = await createHarness();
    const reopened = await second.service.openDatabase({ path: filePath, password });
    const reopenedWork = reopened.groups.find((group) => group.name === 'Work')!;
    const reopenedArchive = reopened.groups.find((group) => group.name === 'Archive')!;
    const reopenedChild = reopened.groups.find((group) => group.name === 'Child')!;

    expect(reopenedWork.parentId).toBe(reopenedArchive.id);
    expect(reopenedChild.parentId).toBe(reopenedWork.id);

    await second.service.closeDatabase(reopened.sessionId);
  }, 30_000);

  it('deletes a group with descendants and rejects deleting the root group', async () => {
    const { root, service } = await createHarness();
    const filePath = path.join(root, 'GroupDelete.kdbx');
    const password = 'PassDeck-Group-Delete-2026!';
    const created = await service.createDatabase({
      path: filePath,
      password,
      name: 'Group delete',
    });
    const rootGroupId = created.groups[0]!.id;
    const withWork = service.createGroup({
      sessionId: created.sessionId,
      parentId: rootGroupId,
      name: 'Work',
    });
    const workGroupId = withWork.groups.find((group) => group.name === 'Work')!.id;
    const withChild = service.createGroup({
      sessionId: created.sessionId,
      parentId: workGroupId,
      name: 'Child',
    });
    const childGroupId = withChild.groups.find((group) => group.name === 'Child')!.id;
    service.saveEntry({
      sessionId: created.sessionId,
      groupId: childGroupId,
      title: 'Nested entry',
      username: '',
      password: '',
      url: '',
      notes: '',
      tags: [],
      favorite: false,
      expires: false,
    });

    expect(() => service.deleteGroup(created.sessionId, rootGroupId)).toThrow('Корневую группу');
    const deleted = service.deleteGroup(created.sessionId, workGroupId);
    expect(deleted.groups.some((group) => group.id === workGroupId)).toBe(false);
    expect(deleted.groups.some((group) => group.id === childGroupId)).toBe(false);
    expect(deleted.entries).toHaveLength(0);
    expect(deleted.groups.some((group) => group.name === 'Recycle Bin')).toBe(false);

    await service.saveDatabase(created.sessionId);
    await service.closeDatabase(created.sessionId);

    const second = await createHarness();
    const reopened = await second.service.openDatabase({ path: filePath, password });
    expect(reopened.groups.some((group) => group.name === 'Work')).toBe(false);
    expect(reopened.entries).toHaveLength(0);
    await second.service.closeDatabase(reopened.sessionId);
  }, 30_000);

  it('rejects empty, reserved and duplicate custom field names without mutating the entry', async () => {
    const { root, service } = await createHarness();
    const filePath = path.join(root, 'CustomFieldValidation.kdbx');
    const created = await service.createDatabase({
      path: filePath,
      password: 'PassDeck-Validation-2026!',
      name: 'Validation',
    });
    const groupId = created.groups[0]!.id;
    const initial = service.saveEntry({
      sessionId: created.sessionId,
      groupId,
      title: 'Original title',
      username: '',
      password: '',
      url: '',
      notes: '',
      tags: [],
      favorite: false,
      expires: false,
    });
    const entryId = initial.entries[0]!.id;

    expect(() =>
      service.saveEntry({
        sessionId: created.sessionId,
        entryId,
        groupId,
        title: 'Should not be saved',
        username: '',
        url: '',
        notes: '',
        tags: [],
        favorite: false,
        expires: false,
        customFields: [{ key: 'password', value: 'bad', protected: false }],
      }),
    ).toThrow('зарезервировано');
    expect(service.getView(created.sessionId).entries[0]!.title).toBe('Original title');

    expect(() =>
      service.saveEntry({
        sessionId: created.sessionId,
        entryId,
        groupId,
        title: 'Original title',
        username: '',
        url: '',
        notes: '',
        tags: [],
        favorite: false,
        expires: false,
        customFields: [
          { key: 'Token', value: 'one', protected: false },
          { key: 'token', value: 'two', protected: true },
        ],
      }),
    ).toThrow('несколько раз');

    expect(() =>
      service.saveEntry({
        sessionId: created.sessionId,
        entryId,
        groupId,
        title: 'Original title',
        username: '',
        url: '',
        notes: '',
        tags: [],
        favorite: false,
        expires: false,
        customFields: [{ key: '   ', value: '', protected: false }],
      }),
    ).toThrow('не может быть пустым');
    await service.closeDatabase(created.sessionId);
  }, 30_000);

  it('keeps only the two most recent encrypted backups', async () => {
    const { root, backupDir, service } = await createHarness();
    const filePath = path.join(root, 'Backups.kdbx');
    const created = await service.createDatabase({
      path: filePath,
      password: 'PassDeck-Backups-2026!',
      name: 'Backups',
    });
    const groupId = created.groups[0]!.id;

    for (let index = 0; index < 4; index += 1) {
      service.saveEntry({
        sessionId: created.sessionId,
        groupId,
        title: `Entry ${index}`,
        username: 'user',
        password: `password-${index}`,
        url: '',
        notes: '',
        tags: [],
        favorite: false,
        expires: false,
      });
      await service.saveDatabase(created.sessionId);
    }

    const backups = (await readdir(backupDir)).filter((file) => file.endsWith('.kdbx'));
    expect(backups).toHaveLength(2);
    await service.closeDatabase(created.sessionId);
  }, 30_000);
});
