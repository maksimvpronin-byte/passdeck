import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AppSettings,
  CustomFieldInput,
  DatabaseView,
  EntrySummary,
  GroupSummary,
  SaveEntryRequest,
} from '@passdeck/shared';
import { ConfirmModal } from './components/ConfirmModal';
import { CreateDatabaseModal } from './components/CreateDatabaseModal';
import { EntryDetails } from './components/EntryDetails';
import { EntryEditorModal } from './components/EntryEditorModal';
import type { EditorCustomField, EditorState } from './components/EntryEditorModal';
import { EntryList } from './components/EntryList';
import { ErrorModal } from './components/ErrorModal';
import { GroupsSidebar } from './components/GroupsSidebar';
import { Logo } from './components/Logo';
import { Modal } from './components/Modal';
import { SettingsModal } from './components/SettingsModal';
import { UnlockDatabaseModal } from './components/UnlockDatabaseModal';
import { filterEntries } from './entry-filter';

const emptyEditor = (groupId: string): EditorState => ({
  groupId,
  title: '',
  username: '',
  password: '',
  passwordVisible: false,
  passwordLoaded: true,
  url: '',
  notes: '',
  tags: '',
  favorite: false,
  expires: false,
  expiryTime: '',
  customFields: [],
});

const RESERVED_CUSTOM_FIELD_NAMES = new Set(['title', 'username', 'password', 'url', 'notes']);

let customFieldIdSequence = 0;

function createCustomFieldId(): string {
  customFieldIdSequence += 1;
  return `custom-field-${Date.now()}-${customFieldIdSequence}`;
}

function newCustomField(): EditorCustomField {
  return {
    id: createCustomFieldId(),
    key: '',
    value: '',
    protected: false,
    preserveValue: false,
    hasStoredValue: false,
  };
}

function basename(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath;
}

function resultMessage(result: { error?: { message: string; details?: string } }): string {
  return result.error?.details
    ? `${result.error.message}\n${result.error.details}`
    : result.error?.message || 'Неизвестная ошибка';
}

function isMissingDatabaseError(result: { error?: { code: string } }): boolean {
  return result.error?.code === 'DATABASE_FILE_MISSING';
}

export function App() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [sessions, setSessions] = useState<DatabaseView[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [unlockTarget, setUnlockTarget] = useState<{ path?: string; sessionId?: string } | null>(
    null,
  );
  const [unlockPassword, setUnlockPassword] = useState('');
  const [openQueue, setOpenQueue] = useState<string[]>([]);
  const [createTarget, setCreateTarget] = useState<string | null>(null);
  const [createName, setCreateName] = useState('PassDeck');
  const [createPassword, setCreatePassword] = useState('');
  const [createConfirm, setCreateConfirm] = useState('');
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [groupModal, setGroupModal] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [draggingEntryId, setDraggingEntryId] = useState<string | null>(null);

  const [draggingGroupId, setDraggingGroupId] = useState<string | null>(null);
  const [dropTargetGroupId, setDropTargetGroupId] = useState<string | null>(null);
  const [dropTargetEntryId, setDropTargetEntryId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<EntrySummary | null>(null);
  const [confirmGroupDelete, setConfirmGroupDelete] = useState<GroupSummary | null>(null);
  const [confirmAttachmentDelete, setConfirmAttachmentDelete] = useState<{
    entry: EntrySummary;
    name: string;
  } | null>(null);
  const [revealed, setRevealed] = useState<{ entryId: string; key: string; value: string } | null>(
    null,
  );
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const revealTimer = useRef<number | null>(null);

  const active = sessions.find((session) => session.sessionId === activeId) ?? sessions[0] ?? null;
  const selectedEntry = active?.entries.find((entry) => entry.id === selectedEntryId) ?? null;
  const selectedGroup = active?.groups.find((group) => group.id === selectedGroupId) ?? null;

  const updateSession = useCallback((view: DatabaseView) => {
    setSessions((current) => {
      const index = current.findIndex((item) => item.sessionId === view.sessionId);
      if (index === -1) {
        return [...current, view];
      }
      return current.map((item) => (item.sessionId === view.sessionId ? view : item));
    });
    activateSession(view);
  }, []);

  const refreshSessions = useCallback(async () => {
    const list = await window.passdeck.database.list();
    setSessions(list);
    setActiveId((current) => current ?? list[0]?.sessionId ?? null);
  }, []);

  useEffect(() => {
    void Promise.all([window.passdeck.settings.get(), window.passdeck.database.list()]).then(
      ([loadedSettings, loadedSessions]) => {
        setSettings(loadedSettings);
        setSessions(loadedSessions);
        const first = loadedSessions[0];
        if (first) {
          activateSession(first);
        }
      },
    );
  }, []);

  useEffect(() => {
    const unsubscribeError = window.passdeck.autoType.onError((message) => {
      setError(message);
    });
    return unsubscribeError;
  }, []);

  useEffect(() => {
    void window.passdeck.autoType.setSelection(
      active && !active.locked ? active.sessionId : null,
      selectedEntry?.id ?? null,
    );
  }, [active, selectedEntry?.id]);

  useEffect(() => {
    if (!settings) {
      return;
    }
    document.documentElement.dataset.theme = settings.theme === 'system' ? 'dark' : settings.theme;
    document.documentElement.style.setProperty('--ui-scale', String(settings.uiScale));
  }, [settings]);

  useEffect(() => {
    if (!settings || settings.autoLockMinutes <= 0 || sessions.every((session) => session.locked)) {
      return;
    }
    let timer = window.setTimeout(() => {
      void window.passdeck.app.lockAll().then(() => refreshSessions());
    }, settings.autoLockMinutes * 60_000);
    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void window.passdeck.app.lockAll().then(() => refreshSessions());
      }, settings.autoLockMinutes * 60_000);
    };
    window.addEventListener('keydown', reset);
    window.addEventListener('pointerdown', reset);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', reset);
      window.removeEventListener('pointerdown', reset);
    };
  }, [settings, sessions, refreshSessions]);

  const lockedActiveSessionId = active?.locked === true ? active.sessionId : null;
  const lockedActivePath = active?.locked === true ? active.path : null;

  function activateSession(session: DatabaseView): void {
    setActiveId(session.sessionId);
    setSelectedEntryId(null);
    setRevealed(null);
    if (revealTimer.current) {
      window.clearTimeout(revealTimer.current);
    }
    setSelectedGroupId(
      session.locked ? null : (session.selectedGroupId ?? session.groups[0]?.id ?? null),
    );
  }

  useEffect(() => {
    if (!lockedActiveSessionId || !lockedActivePath) {
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void window.passdeck.touchId
        .status(lockedActivePath)
        .then((statusResult) => {
          if (cancelled || !statusResult.ok || !statusResult.data?.enabled) {
            return null;
          }
          return window.passdeck.touchId.unlock(lockedActiveSessionId);
        })
        .then((result) => {
          if (!result || cancelled) {
            return;
          }
          if (!result.ok || !result.data) {
            const message = result.error?.message ?? '';
            if (message && !/cancel|отмен|Touch ID/i.test(message)) {
              setError(resultMessage(result));
            }
            return;
          }
          updateSession(result.data);
          setUnlockTarget(null);
          setUnlockPassword('');
          setToast('База разблокирована через Touch ID');
        })
        .catch(() => undefined);
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [lockedActivePath, lockedActiveSessionId, updateSession]);

  const filteredEntries = useMemo(() => {
    if (!active || active.locked) {
      return [];
    }
    return filterEntries(active.entries, selectedGroupId, search);
  }, [active, search, selectedGroupId]);

  const entryCountByGroupId = useMemo(() => {
    const counts = new Map<string, number>();
    if (!active || active.locked) {
      return counts;
    }

    for (const entry of active.entries) {
      counts.set(entry.groupId, (counts.get(entry.groupId) ?? 0) + 1);
    }

    return counts;
  }, [active]);

  async function chooseOpen(): Promise<void> {
    const paths = await window.passdeck.dialog.chooseOpenFiles();
    const first = paths[0];
    if (first) {
      setOpenQueue(paths.slice(1));
      setUnlockTarget({ path: first });
    }
  }

  function openRecent(filePath: string): void {
    setUnlockTarget({ path: filePath });
  }

  async function submitUnlock(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!unlockTarget) {
      return;
    }
    if (!unlockPassword) {
      await unlockWithTouchId();
      return;
    }
    const result = unlockTarget.sessionId
      ? await window.passdeck.database.unlock(unlockTarget.sessionId, unlockPassword)
      : await window.passdeck.database.open({
          path: unlockTarget.path ?? '',
          password: unlockPassword,
        });
    setUnlockPassword('');
    if (!result.ok || !result.data) {
      if (isMissingDatabaseError(result)) {
        setUnlockTarget(null);
        setOpenQueue([]);
        setSettings(await window.passdeck.settings.get());
      }
      setError(resultMessage(result));
      return;
    }
    updateSession(result.data);
    const next = openQueue[0];
    if (next) {
      setOpenQueue(openQueue.slice(1));
      setUnlockTarget({ path: next });
    } else {
      setUnlockTarget(null);
    }
    setToast('База открыта');
  }

  async function unlockWithTouchId(): Promise<void> {
    if (!unlockTarget) {
      return;
    }
    const result = unlockTarget.sessionId
      ? await window.passdeck.touchId.unlock(unlockTarget.sessionId)
      : unlockTarget.path
        ? await window.passdeck.touchId.open(unlockTarget.path)
        : null;
    if (!result) {
      return;
    }
    if (!result.ok || !result.data) {
      if (isMissingDatabaseError(result)) {
        setUnlockTarget(null);
        setOpenQueue([]);
        setSettings(await window.passdeck.settings.get());
      }
      setError(resultMessage(result));
      return;
    }
    setUnlockPassword('');
    updateSession(result.data);
    const next = openQueue[0];
    if (next) {
      setOpenQueue(openQueue.slice(1));
      setUnlockTarget({ path: next });
    } else {
      setUnlockTarget(null);
    }
    setToast('База открыта через Touch ID');
  }

  async function chooseCreate(): Promise<void> {
    const target = await window.passdeck.dialog.chooseCreateFile('PassDeck.kdbx');
    if (target) {
      setCreateTarget(target);
      setCreateName(basename(target).replace(/\.kdbx$/i, '') || 'PassDeck');
    }
  }

  async function submitCreate(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!createTarget) {
      return;
    }
    if (createPassword.length < 8) {
      setError('Мастер-пароль должен содержать минимум 8 символов.');
      return;
    }
    if (createPassword !== createConfirm) {
      setError('Пароли не совпадают.');
      return;
    }
    const result = await window.passdeck.database.create({
      path: createTarget,
      name: createName.trim() || 'PassDeck',
      password: createPassword,
    });
    setCreatePassword('');
    setCreateConfirm('');
    if (!result.ok || !result.data) {
      setError(resultMessage(result));
      return;
    }
    updateSession(result.data);
    setCreateTarget(null);
    setToast('Новая база создана');
    const updatedSettings = await window.passdeck.settings.get();
    setSettings(updatedSettings);
  }

  async function saveActive(): Promise<void> {
    if (!active) {
      return;
    }
    const result = await window.passdeck.database.save(active.sessionId);
    if (!result.ok || !result.data) {
      setError(resultMessage(result));
      return;
    }
    updateSession(result.data);
    setToast('База сохранена');
  }

  async function lockActive(): Promise<void> {
    if (!active) {
      return;
    }
    const result = await window.passdeck.database.lock(active.sessionId);
    if (!result.ok || !result.data) {
      setError(resultMessage(result));
      return;
    }
    updateSession(result.data);
    setSelectedEntryId(null);
    setRevealed(null);
  }

  async function forceReadWriteActive(): Promise<void> {
    if (!active || !active.readOnly) {
      return;
    }
    const result = await window.passdeck.database.forceReadWrite(active.sessionId);
    if (!result.ok || !result.data) {
      setError(resultMessage(result));
      return;
    }
    updateSession(result.data);
    setToast('База открыта на запись');
  }

  async function closeSession(sessionId: string): Promise<void> {
    const result = await window.passdeck.database.close(sessionId);
    if (!result.ok) {
      setError(resultMessage(result));
      return;
    }
    setSessions((current) => current.filter((session) => session.sessionId !== sessionId));
    setActiveId((current) => {
      if (current !== sessionId) {
        return current;
      }
      return sessions.find((session) => session.sessionId !== sessionId)?.sessionId ?? null;
    });
  }

  function beginEdit(entry?: EntrySummary): void {
    if (!active || active.locked) {
      return;
    }
    const groupId = entry?.groupId ?? selectedGroupId ?? active.groups[0]?.id;
    if (!groupId) {
      setError('Сначала создайте группу.');
      return;
    }
    setEditor(
      entry
        ? {
            entry,
            groupId,
            title: entry.title,
            username: entry.username,
            password: '',
            passwordVisible: false,
            passwordLoaded: false,
            url: entry.url,
            notes: entry.notes,
            tags: entry.tags.join(', '),
            favorite: entry.favorite,
            expires: entry.expires,
            expiryTime: entry.expiryTime?.slice(0, 10) ?? '',
            customFields: entry.customFields.map((field) => ({
              id: createCustomFieldId(),
              key: field.key,
              value: field.protected ? '' : field.value,
              protected: field.protected,
              preserveValue: field.protected,
              hasStoredValue: field.hasValue,
              originalKey: field.key,
            })),
          }
        : emptyEditor(groupId),
    );
  }

  async function toggleEditorPassword(): Promise<void> {
    if (!active || !editor) {
      return;
    }

    if (!editor.entry || editor.passwordLoaded || editor.password) {
      setEditor({
        ...editor,
        passwordVisible: !editor.passwordVisible,
        passwordLoaded: true,
      });
      return;
    }

    const result = await window.passdeck.database.revealPassword(active.sessionId, editor.entry.id);
    if (!result.ok || result.data === undefined) {
      setError(resultMessage(result));
      return;
    }

    setEditor((current) =>
      current && current.entry?.id === editor.entry?.id
        ? {
            ...current,
            password: result.data ?? '',
            passwordVisible: true,
            passwordLoaded: true,
          }
        : current,
    );
  }

  async function submitEntry(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!active || !editor) {
      return;
    }

    const seenCustomFieldNames = new Set<string>();
    const customFields: CustomFieldInput[] = [];
    for (const field of editor.customFields) {
      const key = field.key.trim();
      const normalizedKey = key.toLowerCase();
      if (!key) {
        setError('Название пользовательского поля не может быть пустым.');
        return;
      }
      if (RESERVED_CUSTOM_FIELD_NAMES.has(normalizedKey)) {
        setError(`Имя «${key}» зарезервировано стандартным полем KDBX.`);
        return;
      }
      if (seenCustomFieldNames.has(normalizedKey)) {
        setError(`Пользовательское поле «${key}» указано несколько раз.`);
        return;
      }
      seenCustomFieldNames.add(normalizedKey);

      const customField: CustomFieldInput = {
        key,
        protected: field.protected,
      };
      if (field.preserveValue && field.originalKey) {
        customField.preserveValue = true;
        customField.originalKey = field.originalKey;
      } else {
        customField.value = field.value;
      }
      customFields.push(customField);
    }

    const request: SaveEntryRequest = {
      sessionId: active.sessionId,
      ...(editor.entry ? { entryId: editor.entry.id } : {}),
      groupId: editor.groupId,
      title: editor.title,
      username: editor.username,
      ...(editor.password || !editor.entry ? { password: editor.password } : {}),
      url: editor.url,
      notes: editor.notes,
      tags: editor.tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
      favorite: editor.favorite,
      expires: editor.expires,
      ...(editor.expires && editor.expiryTime
        ? { expiryTime: new Date(editor.expiryTime).toISOString() }
        : {}),
      customFields,
    };
    const result = await window.passdeck.database.saveEntry(request);
    if (!result.ok || !result.data) {
      setError(resultMessage(result));
      return;
    }
    updateSession(result.data);
    setEditor(null);
    setToast(editor.entry ? 'Запись изменена' : 'Запись создана');
  }

  function addCustomField(): void {
    if (!editor) {
      return;
    }
    setEditor({ ...editor, customFields: [...editor.customFields, newCustomField()] });
  }

  function updateCustomField(id: string, patch: Partial<Omit<EditorCustomField, 'id'>>): void {
    if (!editor) {
      return;
    }
    setEditor({
      ...editor,
      customFields: editor.customFields.map((field) =>
        field.id === id ? { ...field, ...patch } : field,
      ),
    });
  }

  function removeCustomField(id: string): void {
    if (!editor) {
      return;
    }
    setEditor({
      ...editor,
      customFields: editor.customFields.filter((field) => field.id !== id),
    });
  }

  async function submitGroup(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!active || !groupName.trim()) {
      return;
    }
    const result = await window.passdeck.database.createGroup({
      sessionId: active.sessionId,
      parentId: selectedGroupId,
      name: groupName,
    });
    if (!result.ok || !result.data) {
      setError(resultMessage(result));
      return;
    }
    updateSession(result.data);
    setGroupName('');
    setGroupModal(false);
    setToast('Группа создана');
  }

  function beginEntryDrag(event: React.DragEvent, entry: EntrySummary): void {
    if (!active || active.readOnly) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-passdeck-entry-id', entry.id);
    event.dataTransfer.setData('text/plain', entry.id);
    setDraggingEntryId(entry.id);
    setDraggingGroupId(null);
    setDropTargetGroupId(null);
    setDropTargetEntryId(null);
  }

  function canMoveGroup(groupId: string, targetGroupId: string): boolean {
    if (!active) {
      return false;
    }

    const group = active.groups.find((item) => item.id === groupId);
    const target = active.groups.find((item) => item.id === targetGroupId);

    if (
      !group ||
      !target ||
      group.parentId === null ||
      group.id === target.id ||
      group.parentId === target.id
    ) {
      return false;
    }

    let current: (typeof active.groups)[number] | undefined = target;
    while (current) {
      if (current.id === group.id) {
        return false;
      }

      const parentId: string | null = current.parentId;
      current = parentId ? active.groups.find((item) => item.id === parentId) : undefined;
    }

    return true;
  }

  function beginGroupDrag(event: React.DragEvent, groupId: string): void {
    if (!active || active.readOnly) {
      event.preventDefault();
      return;
    }

    const group = active.groups.find((item) => item.id === groupId);
    if (!group || group.parentId === null) {
      event.preventDefault();
      return;
    }

    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-passdeck-group-id', group.id);
    event.dataTransfer.setData('text/plain', group.id);
    setDraggingGroupId(group.id);
    setDraggingEntryId(null);
    setDropTargetGroupId(null);
    setDropTargetEntryId(null);
  }

  function allowGroupDrop(event: React.DragEvent, targetGroupId: string): void {
    if (
      !active ||
      active.readOnly ||
      !draggingGroupId ||
      !canMoveGroup(draggingGroupId, targetGroupId)
    ) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropTargetGroupId(targetGroupId);
  }

  function allowTreeDrop(event: React.DragEvent, targetGroupId: string): void {
    if (draggingGroupId) {
      allowGroupDrop(event, targetGroupId);
      return;
    }

    allowEntryDrop(event, targetGroupId);
  }

  function allowEntryDrop(event: React.DragEvent, groupId: string): void {
    if (!active || active.readOnly || !draggingEntryId) {
      return;
    }
    const entry = active.entries.find((item) => item.id === draggingEntryId);
    if (!entry) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropTargetGroupId(groupId);
    setDropTargetEntryId(null);
  }

  async function dropEntry(event: React.DragEvent, targetGroupId: string): Promise<void> {
    event.preventDefault();
    if (!active || active.readOnly) {
      return;
    }
    const entryId =
      event.dataTransfer.getData('application/x-passdeck-entry-id') ||
      event.dataTransfer.getData('text/plain') ||
      draggingEntryId;
    setDraggingEntryId(null);
    setDropTargetGroupId(null);
    setDropTargetEntryId(null);
    if (!entryId) {
      return;
    }
    const entry = active.entries.find((item) => item.id === entryId);
    if (!entry || entry.groupId === targetGroupId) {
      return;
    }
    const result = await window.passdeck.database.moveEntry({
      sessionId: active.sessionId,
      entryId,
      targetGroupId,
      beforeEntryId: null,
    });
    if (!result.ok || !result.data) {
      setError(resultMessage(result));
      return;
    }
    updateSession(result.data);
    setSelectedGroupId(targetGroupId);
    setSelectedEntryId(entryId);
    setToast('Запись перемещена');
  }

  function allowEntryOrderDrop(event: React.DragEvent, beforeEntry: EntrySummary): void {
    if (!active || active.readOnly || !draggingEntryId || draggingEntryId === beforeEntry.id) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropTargetGroupId(null);
    setDropTargetEntryId(beforeEntry.id);
  }

  async function dropEntryBefore(event: React.DragEvent, beforeEntry: EntrySummary): Promise<void> {
    event.preventDefault();
    if (!active || active.readOnly) {
      return;
    }
    const entryId =
      event.dataTransfer.getData('application/x-passdeck-entry-id') ||
      event.dataTransfer.getData('text/plain') ||
      draggingEntryId;

    setDraggingEntryId(null);
    setDropTargetGroupId(null);
    setDropTargetEntryId(null);

    if (!entryId || entryId === beforeEntry.id) {
      return;
    }

    const result = await window.passdeck.database.moveEntry({
      sessionId: active.sessionId,
      entryId,
      targetGroupId: beforeEntry.groupId,
      beforeEntryId: beforeEntry.id,
    });
    if (!result.ok || !result.data) {
      setError(resultMessage(result));
      return;
    }
    updateSession(result.data);
    setSelectedGroupId(beforeEntry.groupId);
    setSelectedEntryId(entryId);
    setToast('Порядок записей изменён');
  }

  async function dropGroup(event: React.DragEvent, targetGroupId: string): Promise<void> {
    event.preventDefault();

    if (!active || active.readOnly) {
      return;
    }

    const groupId =
      event.dataTransfer.getData('application/x-passdeck-group-id') || draggingGroupId;

    setDraggingEntryId(null);
    setDraggingGroupId(null);
    setDropTargetGroupId(null);
    setDropTargetEntryId(null);

    if (!groupId || !canMoveGroup(groupId, targetGroupId)) {
      return;
    }

    const result = await window.passdeck.database.moveGroup({
      sessionId: active.sessionId,
      groupId,
      targetGroupId,
    });

    if (!result.ok || !result.data) {
      setError(resultMessage(result));
      return;
    }

    updateSession(result.data);
    setSelectedGroupId(groupId);
    setSelectedEntryId(null);
    setToast('Группа перемещена');
  }

  async function dropOnGroup(event: React.DragEvent, targetGroupId: string): Promise<void> {
    const groupId =
      event.dataTransfer.getData('application/x-passdeck-group-id') || draggingGroupId;

    if (groupId) {
      await dropGroup(event, targetGroupId);
      return;
    }

    await dropEntry(event, targetGroupId);
  }

  function endEntryDrag(): void {
    setDraggingEntryId(null);
    setDraggingGroupId(null);
    setDropTargetGroupId(null);
    setDropTargetEntryId(null);
  }

  async function deleteEntry(): Promise<void> {
    if (!active || !confirmDelete) {
      return;
    }
    const result = await window.passdeck.database.deleteEntry(active.sessionId, confirmDelete.id);
    if (!result.ok || !result.data) {
      setError(resultMessage(result));
      return;
    }
    updateSession(result.data);
    setConfirmDelete(null);
    setSelectedEntryId(null);
    setToast('Запись удалена');
  }

  async function deleteGroup(): Promise<void> {
    if (!active || !confirmGroupDelete) {
      return;
    }
    const result = await window.passdeck.database.deleteGroup(
      active.sessionId,
      confirmGroupDelete.id,
    );
    if (!result.ok || !result.data) {
      setError(resultMessage(result));
      return;
    }
    updateSession(result.data);
    setConfirmGroupDelete(null);
    setSelectedGroupId(result.data.selectedGroupId);
    setSelectedEntryId(null);
    setToast('Группа удалена');
  }

  async function addAttachments(entry: EntrySummary): Promise<void> {
    if (!active) {
      return;
    }
    const result = await window.passdeck.database.addAttachments(active.sessionId, entry.id);
    if (!result.ok || !result.data) {
      setError(resultMessage(result));
      return;
    }
    updateSession(result.data);
    setSelectedGroupId(entry.groupId);
    setSelectedEntryId(entry.id);
    const nextAttachmentCount = result.data.entries.find((item) => item.id === entry.id)
      ?.attachments.length;
    if (nextAttachmentCount !== entry.attachments.length) {
      setToast('Вложения добавлены');
    }
  }

  async function exportAttachment(entry: EntrySummary, name: string): Promise<void> {
    if (!active) {
      return;
    }
    const result = await window.passdeck.database.exportAttachment(
      active.sessionId,
      entry.id,
      name,
    );
    if (!result.ok) {
      setError(resultMessage(result));
      return;
    }
    if (result.data) {
      setToast('Вложение сохранено');
    }
  }

  async function deleteAttachment(): Promise<void> {
    if (!active || !confirmAttachmentDelete) {
      return;
    }
    const { entry, name } = confirmAttachmentDelete;
    const result = await window.passdeck.database.deleteAttachment(
      active.sessionId,
      entry.id,
      name,
    );
    if (!result.ok || !result.data) {
      setError(resultMessage(result));
      return;
    }
    updateSession(result.data);
    setSelectedGroupId(entry.groupId);
    setSelectedEntryId(entry.id);
    setConfirmAttachmentDelete(null);
    setToast('Вложение удалено');
  }

  async function copyValue(
    value: string,
    kind: 'username' | 'password' | 'url' | 'custom',
  ): Promise<void> {
    const result = await window.passdeck.clipboard.copy({ value, kind });
    if (!result.ok) {
      setError(resultMessage(result));
      return;
    }
    setToast(
      kind === 'password'
        ? 'Пароль скопирован'
        : kind === 'username'
          ? 'Логин скопирован'
          : kind === 'custom'
            ? 'Значение поля скопировано'
            : 'URL скопирован',
    );
  }

  async function copyPassword(entry: EntrySummary): Promise<void> {
    if (!active) {
      return;
    }
    const result = await window.passdeck.database.revealPassword(active.sessionId, entry.id);
    if (!result.ok || result.data === undefined) {
      setError(resultMessage(result));
      return;
    }
    await copyValue(result.data, 'password');
  }

  async function revealPassword(entry: EntrySummary): Promise<void> {
    if (!active) {
      return;
    }
    if (revealed?.entryId === entry.id && revealed.key === 'Password') {
      setRevealed(null);
      return;
    }
    const result = await window.passdeck.database.revealPassword(active.sessionId, entry.id);
    if (!result.ok || result.data === undefined) {
      setError(resultMessage(result));
      return;
    }
    setRevealed({ entryId: entry.id, key: 'Password', value: result.data });
    if (revealTimer.current) {
      window.clearTimeout(revealTimer.current);
    }
    revealTimer.current = window.setTimeout(() => setRevealed(null), 10_000);
  }

  async function copyCustomField(entry: EntrySummary, key: string): Promise<void> {
    if (!active) {
      return;
    }
    const field = entry.customFields.find((item) => item.key === key);
    if (!field) {
      return;
    }
    if (!field.protected) {
      await copyValue(field.value, 'custom');
      return;
    }
    const result = await window.passdeck.database.revealCustomField(
      active.sessionId,
      entry.id,
      key,
    );
    if (!result.ok || result.data === undefined) {
      setError(resultMessage(result));
      return;
    }
    await copyValue(result.data, 'custom');
  }

  async function revealCustomField(entry: EntrySummary, key: string): Promise<void> {
    if (!active) {
      return;
    }
    if (revealed?.entryId === entry.id && revealed.key === key) {
      setRevealed(null);
      return;
    }
    const result = await window.passdeck.database.revealCustomField(
      active.sessionId,
      entry.id,
      key,
    );
    if (!result.ok || result.data === undefined) {
      setError(resultMessage(result));
      return;
    }
    setRevealed({ entryId: entry.id, key, value: result.data });
    if (revealTimer.current) {
      window.clearTimeout(revealTimer.current);
    }
    revealTimer.current = window.setTimeout(() => setRevealed(null), 10_000);
  }

  async function updateSettings(patch: Partial<AppSettings>): Promise<void> {
    const next = await window.passdeck.settings.update(patch);
    setSettings(next);
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const ctrl = event.ctrlKey || event.metaKey;
      if (!ctrl) {
        return;
      }
      if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveActive();
      } else if (event.key.toLowerCase() === 'f') {
        event.preventDefault();
        document.querySelector<HTMLInputElement>('#search-input')?.focus();
      } else if (event.key.toLowerCase() === 'n') {
        event.preventDefault();
        beginEdit();
      } else if (event.shiftKey && event.key.toLowerCase() === 'l') {
        event.preventDefault();
        void lockActive();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  if (!settings) {
    return (
      <div className="loading">
        <Logo />
        <span>Инициализация защищённого хранилища…</span>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <Logo />
        <div className="topbar__actions">
          <button className="button button--ghost" type="button" onClick={() => void chooseOpen()}>
            Открыть
          </button>
          <button
            className="button button--primary"
            type="button"
            onClick={() => void chooseCreate()}
          >
            Новая база
          </button>
          <button
            className="icon-button"
            type="button"
            onClick={() => setSettingsOpen(true)}
            title="Настройки"
          >
            ⚙
          </button>
        </div>
      </header>

      {sessions.length > 0 ? (
        <nav className="tabs" aria-label="Открытые базы">
          {sessions.map((session) => (
            <button
              key={session.sessionId}
              className={`tab ${session.sessionId === active?.sessionId ? 'tab--active' : ''}`}
              type="button"
              onClick={() => activateSession(session)}
            >
              <span className={`status-dot ${session.locked ? 'status-dot--locked' : ''}`} />
              <span className="tab__name">{session.name}</span>
              {session.dirty ? <span className="tab__dirty">●</span> : null}
              {session.readOnly ? <span className="tab__readonly">RO</span> : null}
              <span
                className="tab__close"
                role="button"
                tabIndex={0}
                onClick={(event) => {
                  event.stopPropagation();
                  void closeSession(session.sessionId);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    void closeSession(session.sessionId);
                  }
                }}
              >
                ×
              </span>
            </button>
          ))}
        </nav>
      ) : null}

      {!active ? (
        <main className="welcome">
          <div className="welcome__panel">
            <Logo />
            <h1>Локальный менеджер паролей</h1>
            <p>
              PassDeck работает с файлами KeePass <strong>.kdbx</strong>, не использует облако,
              телеметрию и сетевую синхронизацию.
            </p>
            <div className="welcome__actions">
              <button
                className="button button--primary button--large"
                type="button"
                onClick={() => void chooseOpen()}
              >
                Открыть базу
              </button>
              <button
                className="button button--secondary button--large"
                type="button"
                onClick={() => void chooseCreate()}
              >
                Создать новую
              </button>
            </div>
            {settings.recentDatabases.length > 0 ? (
              <section className="recent">
                <h3>Последние базы</h3>
                {settings.recentDatabases.map((filePath) => (
                  <button
                    key={filePath}
                    type="button"
                    className="recent__item"
                    onClick={() => openRecent(filePath)}
                  >
                    <span>◈</span>
                    <div>
                      <strong>{basename(filePath)}</strong>
                      <small>{filePath}</small>
                    </div>
                  </button>
                ))}
              </section>
            ) : null}
          </div>
        </main>
      ) : active.locked ? (
        <main className="locked-view">
          <div className="locked-card">
            <div className="locked-card__icon">◆</div>
            <span className="eyebrow">Заблокированная база</span>
            <h1>{active.name}</h1>
            <p>{active.path}</p>
            <button
              className="button button--primary button--large"
              type="button"
              onClick={() => setUnlockTarget({ sessionId: active.sessionId })}
            >
              Разблокировать
            </button>
          </div>
        </main>
      ) : (
        <main className="workspace">
          <GroupsSidebar
            active={active}
            selectedGroup={selectedGroup}
            selectedGroupId={selectedGroupId}
            dropTargetGroupId={dropTargetGroupId}
            entryCountByGroupId={entryCountByGroupId}
            basename={basename}
            onSelectAll={() => {
              setSelectedGroupId(null);
              setSelectedEntryId(null);
            }}
            onSelectGroup={(groupId) => {
              setSelectedGroupId(groupId);
              setSelectedEntryId(null);
            }}
            onCreateGroup={() => setGroupModal(true)}
            onDeleteGroup={(group) => setConfirmGroupDelete(group)}
            onBeginGroupDrag={(event, groupId) => beginGroupDrag(event, groupId)}
            onEndDrag={endEntryDrag}
            onAllowTreeDrop={(event, groupId) => allowTreeDrop(event, groupId)}
            onGroupDragLeave={(groupId) =>
              setDropTargetGroupId((current) => (current === groupId ? null : current))
            }
            onDropOnGroup={(event, groupId) => void dropOnGroup(event, groupId)}
          />

          <EntryList
            entries={filteredEntries}
            readOnly={active.readOnly}
            search={search}
            selectedEntryId={selectedEntryId}
            draggingEntryId={draggingEntryId}
            dropTargetEntryId={dropTargetEntryId}
            onSearchChange={setSearch}
            onForceReadWrite={() => void forceReadWriteActive()}
            onBeginEdit={() => beginEdit()}
            onSave={() => void saveActive()}
            onLock={() => void lockActive()}
            onSelectEntry={(entryId) => {
              setSelectedEntryId(entryId);
              setRevealed(null);
            }}
            onBeginEntryDrag={(event, entry) => beginEntryDrag(event, entry)}
            onEndDrag={endEntryDrag}
            onAllowEntryOrderDrop={(event, entry) => allowEntryOrderDrop(event, entry)}
            onEntryDragLeave={(entryId) =>
              setDropTargetEntryId((current) => (current === entryId ? null : current))
            }
            onDropEntryBefore={(event, entry) => void dropEntryBefore(event, entry)}
          />

          <aside className="details panel">
            <EntryDetails
              entry={selectedEntry}
              readOnly={active.readOnly}
              revealed={revealed}
              onCopyUsername={(entry) => void copyValue(entry.username, 'username')}
              onCopyUrl={(entry) => void copyValue(entry.url, 'url')}
              onRevealPassword={(entry) => void revealPassword(entry)}
              onCopyPassword={(entry) => void copyPassword(entry)}
              onRevealCustomField={(entry, key) => void revealCustomField(entry, key)}
              onCopyCustomField={(entry, key) => void copyCustomField(entry, key)}
              onAddAttachments={(entry) => void addAttachments(entry)}
              onExportAttachment={(entry, name) => void exportAttachment(entry, name)}
              onDeleteAttachment={(entry, name) => setConfirmAttachmentDelete({ entry, name })}
              onEdit={(entry) => beginEdit(entry)}
              onDelete={(entry) => setConfirmDelete(entry)}
            />
          </aside>
        </main>
      )}

      {unlockTarget ? (
        <UnlockDatabaseModal
          databaseName={unlockTarget.path ? basename(unlockTarget.path) : (active?.name ?? '')}
          password={unlockPassword}
          onPasswordChange={setUnlockPassword}
          onSubmit={(event) => void submitUnlock(event)}
          onCancel={() => {
            setUnlockTarget(null);
            setOpenQueue([]);
            setUnlockPassword('');
          }}
        />
      ) : null}

      {createTarget ? (
        <CreateDatabaseModal
          targetPath={createTarget}
          name={createName}
          password={createPassword}
          confirmPassword={createConfirm}
          onNameChange={setCreateName}
          onPasswordChange={setCreatePassword}
          onConfirmPasswordChange={setCreateConfirm}
          onSubmit={(event) => void submitCreate(event)}
          onCancel={() => setCreateTarget(null)}
        />
      ) : null}

      {editor && active ? (
        <EntryEditorModal
          editor={editor}
          groups={active.groups}
          onEditorChange={setEditor}
          onSubmit={(event) => void submitEntry(event)}
          onClose={() => setEditor(null)}
          onTogglePassword={() => void toggleEditorPassword()}
          onAddCustomField={addCustomField}
          onUpdateCustomField={updateCustomField}
          onRemoveCustomField={removeCustomField}
        />
      ) : null}

      {groupModal ? (
        <Modal title="Новая группа" onClose={() => setGroupModal(false)}>
          <form className="form" onSubmit={(event) => void submitGroup(event)}>
            <label>
              <span>Название группы</span>
              <input
                value={groupName}
                onChange={(event) => setGroupName(event.target.value)}
                autoFocus
              />
            </label>
            <div className="form__actions">
              <button
                className="button button--ghost"
                type="button"
                onClick={() => setGroupModal(false)}
              >
                Отмена
              </button>
              <button className="button button--primary" type="submit">
                Создать
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      {settingsOpen ? (
        <SettingsModal
          settings={settings}
          onUpdate={(patch) => void updateSettings(patch)}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}

      {confirmDelete ? (
        <ConfirmModal
          title="Удалить запись?"
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => void deleteEntry()}
        >
          {`Запись «${confirmDelete.title}» будет перемещена в корзину базы.`}
        </ConfirmModal>
      ) : null}

      {confirmGroupDelete ? (
        <ConfirmModal
          title="Удалить группу?"
          onCancel={() => setConfirmGroupDelete(null)}
          onConfirm={() => void deleteGroup()}
        >
          {`Группа «${confirmGroupDelete.name}» и все вложенные элементы будут перемещены в корзину базы.`}
        </ConfirmModal>
      ) : null}

      {confirmAttachmentDelete ? (
        <ConfirmModal
          title="Удалить вложение?"
          onCancel={() => setConfirmAttachmentDelete(null)}
          onConfirm={() => void deleteAttachment()}
        >
          {`Вложение «${confirmAttachmentDelete.name}» будет удалено из записи.`}
        </ConfirmModal>
      ) : null}

      {error ? <ErrorModal error={error} onClose={() => setError(null)} /> : null}
      {toast ? (
        <div className="toast" onAnimationEnd={() => setToast(null)}>
          {toast}
        </div>
      ) : null}
    </div>
  );
}
