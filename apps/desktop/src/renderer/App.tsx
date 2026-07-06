import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_AUTO_TYPE_SEQUENCE } from '@passdeck/shared';
import type {
  AppSettings,
  CustomFieldInput,
  DatabaseView,
  EntrySummary,
  GroupSummary,
  SaveEntryRequest,
} from '@passdeck/shared';
import { CreateDatabaseModal } from './components/CreateDatabaseModal';
import { EntryDetails } from './components/EntryDetails';
import { Logo } from './components/Logo';
import { Modal } from './components/Modal';
import { SettingsModal } from './components/SettingsModal';
import { UnlockDatabaseModal } from './components/UnlockDatabaseModal';
import { filterEntries } from './entry-filter';

type EditorCustomField = {
  id: string;
  key: string;
  value: string;
  protected: boolean;
  preserveValue: boolean;
  hasStoredValue: boolean;
  originalKey?: string;
};

type EditorState = {
  entry?: EntrySummary;
  groupId: string;
  title: string;
  username: string;
  password: string;
  passwordVisible: boolean;
  passwordLoaded: boolean;
  url: string;
  notes: string;
  tags: string;
  favorite: boolean;
  expires: boolean;
  expiryTime: string;
  customFields: EditorCustomField[];
};

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
      autoTypeEnabled: true,
      autoTypeSequence: DEFAULT_AUTO_TYPE_SEQUENCE,
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
      current = parentId
        ? active.groups.find((item) => item.id === parentId)
        : undefined;
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

  async function dropEntryBefore(
    event: React.DragEvent,
    beforeEntry: EntrySummary,
  ): Promise<void> {
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

  async function dropGroup(
    event: React.DragEvent,
    targetGroupId: string,
  ): Promise<void> {
    event.preventDefault();

    if (!active || active.readOnly) {
      return;
    }

    const groupId =
      event.dataTransfer.getData('application/x-passdeck-group-id') ||
      draggingGroupId;

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

  async function dropOnGroup(
    event: React.DragEvent,
    targetGroupId: string,
  ): Promise<void> {
    const groupId =
      event.dataTransfer.getData('application/x-passdeck-group-id') ||
      draggingGroupId;

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
          <aside className="sidebar panel">
            <div className="panel__header">
              <div>
                <span className="eyebrow">Структура</span>
                <h2>Группы</h2>
              </div>
              <div className="panel__actions">
                <button
                  className="icon-button"
                  type="button"
                  onClick={() => setGroupModal(true)}
                  title="Новая группа"
                  disabled={active.readOnly}
                >
                  +
                </button>
                <button
                  className="icon-button"
                  type="button"
                  onClick={() => selectedGroup && setConfirmGroupDelete(selectedGroup)}
                  title="Удалить группу"
                  disabled={active.readOnly || !selectedGroup || selectedGroup.parentId === null}
                >
                  ×
                </button>
              </div>
            </div>
            <div className="group-list">
              <button
                className={`group-row ${selectedGroupId === null ? 'group-row--active' : ''}`}
                type="button"
                onClick={() => {
                  setSelectedGroupId(null);
                  setSelectedEntryId(null);
                }}
              >
                <span>▦</span>
                <strong>Все записи</strong>
                <em>{active.entries.length}</em>
              </button>
              {active.groups.map((group) => (
                <button
                  key={group.id}
                  className={`group-row ${
                    selectedGroupId === group.id ? 'group-row--active' : ''
                  } ${dropTargetGroupId === group.id ? 'group-row--drop-target' : ''}`}
                  style={{ paddingLeft: 14 + group.depth * 18 }}
                  type="button"
          draggable={group.parentId !== null && !active.readOnly}
          onDragStart={(event) => beginGroupDrag(event, group.id)}
          onDragEnd={endEntryDrag}
                  onClick={() => {
                    setSelectedGroupId(group.id);
                    setSelectedEntryId(null);
                  }}
                  onDragEnter={(event) => allowTreeDrop(event, group.id)}
                  onDragOver={(event) => allowTreeDrop(event, group.id)}
                  onDragLeave={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                      setDropTargetGroupId((current) => (current === group.id ? null : current));
                    }
                  }}
                  onDrop={(event) => void dropOnGroup(event, group.id)}
                >
                  <span>{group.depth === 0 ? '◇' : '›'}</span>
                  <strong>{group.name}</strong>
                  <em>{entryCountByGroupId.get(group.id) ?? 0}</em>
                </button>
              ))}
            </div>
            <div className="sidebar__footer">
              <span>{basename(active.path)}</span>
              <small>{active.readOnly ? 'Только чтение' : 'Локальный файл'}</small>
            </div>
          </aside>

          <section className="entry-list panel">
            {active.readOnly ? (
              <div className="readonly-banner">
                <div>
                  <strong>База открыта только для чтения</strong>
                  <span>
                    Найден lock-файл PassDeck. Если база не открыта в другом окне, можно открыть
                    её на запись.
                  </span>
                </div>
                <button
                  className="button button--secondary"
                  type="button"
                  onClick={() => void forceReadWriteActive()}
                >
                  Открыть на запись
                </button>
              </div>
            ) : null}
            <div className="entry-toolbar">
              <label className="search-box">
                <span>⌕</span>
                <input
                  id="search-input"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Поиск в текущей базе"
                />
                {search ? (
                  <button type="button" onClick={() => setSearch('')}>
                    ×
                  </button>
                ) : null}
              </label>
              <button
                className="button button--primary"
                type="button"
                onClick={() => beginEdit()}
                disabled={active.readOnly}
              >
                + Запись
              </button>
            </div>
            <div className="list-heading">
              <div>
                <span className="eyebrow">Записи</span>
                <h2>{filteredEntries.length} элементов</h2>
              </div>
              <div className="list-heading__actions">
                <button
                  className="icon-button"
                  type="button"
                  onClick={() => void saveActive()}
                  title="Сохранить"
                  disabled={active.readOnly}
                >
                  ↓
                </button>
                <button
                  className="icon-button"
                  type="button"
                  onClick={() => void lockActive()}
                  title="Заблокировать"
                >
                  ◈
                </button>
              </div>
            </div>
            <div className="entries">
              {filteredEntries.length === 0 ? (
                <div className="empty-state">
                  <span>◇</span>
                  <strong>Записей не найдено</strong>
                  <p>Создайте новую запись или измените фильтр.</p>
                </div>
              ) : (
                filteredEntries.map((entry) => (
                  <button
                    key={entry.id}
                    className={`entry-row ${selectedEntryId === entry.id ? 'entry-row--active' : ''} ${
                      draggingEntryId === entry.id ? 'entry-row--dragging' : ''
                    } ${dropTargetEntryId === entry.id ? 'entry-row--drop-target' : ''}`}
                    type="button"
                    draggable={!active.readOnly}
                    onDragStart={(event) => beginEntryDrag(event, entry)}
                    onDragEnd={endEntryDrag}
                    onDragEnter={(event) => allowEntryOrderDrop(event, entry)}
                    onDragOver={(event) => allowEntryOrderDrop(event, entry)}
                    onDragLeave={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                        setDropTargetEntryId((current) => (current === entry.id ? null : current));
                      }
                    }}
                    onDrop={(event) => void dropEntryBefore(event, entry)}
                    onClick={() => {
                      setSelectedEntryId(entry.id);
                      setRevealed(null);
                    }}
                  >
                    <div className="entry-avatar">
                      {entry.title.slice(0, 1).toLocaleUpperCase()}
                    </div>
                    <div className="entry-row__main">
                      <div>
                        <strong>{entry.title}</strong>
                        {entry.favorite ? <span className="favorite">★</span> : null}
                      </div>
                      <span>{entry.username || 'Логин не указан'}</span>
                    </div>
                    <div className="entry-row__meta">
                      <span>
                        {entry.url ? entry.url.replace(/^https?:\/\//, '').split('/')[0] : '—'}
                      </span>
                      {entry.tags.length > 0 ? (
                        <small>{entry.tags.slice(0, 2).join(' · ')}</small>
                      ) : null}
                    </div>
                  </button>
                ))
              )}
            </div>
          </section>

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
        <Modal
          title={editor.entry ? 'Редактирование записи' : 'Новая запись'}
          width={820}
          onClose={() => setEditor(null)}
        >
          <form className="form form--grid" onSubmit={(event) => void submitEntry(event)}>
            <label className="span-2">
              <span>Название</span>
              <input
                value={editor.title}
                onChange={(event) => setEditor({ ...editor, title: event.target.value })}
                autoFocus
              />
            </label>
            <label>
              <span>Логин</span>
              <input
                value={editor.username}
                onChange={(event) => setEditor({ ...editor, username: event.target.value })}
              />
            </label>
            <label>
              <span>Пароль</span>
              <div className="password-editor">
                <input
                  type={editor.passwordVisible ? 'text' : 'password'}
                  value={editor.password}
                  placeholder={editor.entry && !editor.passwordLoaded ? '••••••••••••' : ''}
                  onChange={(event) =>
                    setEditor({
                      ...editor,
                      password: event.target.value,
                      passwordLoaded: true,
                    })
                  }
                  autoComplete={editor.entry ? 'current-password' : 'new-password'}
                />
                <button
                  className="password-editor__toggle"
                  type="button"
                  onClick={() => void toggleEditorPassword()}
                  title={editor.passwordVisible ? 'Скрыть пароль' : 'Показать пароль'}
                  aria-label={editor.passwordVisible ? 'Скрыть пароль' : 'Показать пароль'}
                >
                  ◉
                </button>
              </div>
            </label>
            <label className="span-2">
              <span>URL</span>
              <input
                value={editor.url}
                onChange={(event) => setEditor({ ...editor, url: event.target.value })}
                placeholder="https://"
              />
            </label>
            <label className="span-2">
              <span>Теги через запятую</span>
              <input
                value={editor.tags}
                onChange={(event) => setEditor({ ...editor, tags: event.target.value })}
              />
            </label>
            <label className="span-2">
              <span>Группа</span>
              <select
                value={editor.groupId}
                onChange={(event) => setEditor({ ...editor, groupId: event.target.value })}
              >
                {active.groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {'—'.repeat(group.depth)} {group.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="span-2">
              <span>Заметки</span>
              <textarea
                rows={6}
                value={editor.notes}
                onChange={(event) => setEditor({ ...editor, notes: event.target.value })}
              />
            </label>
            <section className="custom-fields-editor span-2">
              <div className="custom-fields-editor__header">
                <div>
                  <span>Пользовательские поля</span>
                  <small>Дополнительные поля записи KDBX</small>
                </div>
                <button className="button button--secondary" type="button" onClick={addCustomField}>
                  + Добавить поле
                </button>
              </div>
              {editor.customFields.length === 0 ? (
                <p className="custom-fields-editor__empty">Дополнительных полей пока нет.</p>
              ) : (
                <div className="custom-fields-editor__list">
                  {editor.customFields.map((field) => (
                    <div className="custom-field-row" key={field.id}>
                      <label>
                        <span>Название</span>
                        <input
                          value={field.key}
                          onChange={(event) =>
                            updateCustomField(field.id, { key: event.target.value })
                          }
                          placeholder="Например, API token"
                        />
                      </label>
                      <label>
                        <span>Значение</span>
                        <input
                          type={field.protected ? 'password' : 'text'}
                          value={field.value}
                          onChange={(event) =>
                            updateCustomField(field.id, {
                              value: event.target.value,
                              preserveValue: false,
                            })
                          }
                          placeholder={
                            field.preserveValue && field.hasStoredValue
                              ? 'Сохранено — оставьте пустым, чтобы не менять'
                              : 'Введите значение'
                          }
                        />
                        {field.preserveValue && field.hasStoredValue ? (
                          <small className="form__hint">
                            Скрытое значение останется без изменений.
                          </small>
                        ) : null}
                      </label>
                      <label className="check custom-field-row__protected">
                        <input
                          type="checkbox"
                          checked={field.protected}
                          onChange={(event) =>
                            updateCustomField(field.id, { protected: event.target.checked })
                          }
                        />
                        <span>Защищённое</span>
                      </label>
                      <button
                        className="icon-button custom-field-row__remove"
                        type="button"
                        onClick={() => removeCustomField(field.id)}
                        title="Удалить поле"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
            <label className="check">
              <input
                type="checkbox"
                checked={editor.favorite}
                onChange={(event) => setEditor({ ...editor, favorite: event.target.checked })}
              />
              <span>Избранное</span>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={editor.expires}
                onChange={(event) => setEditor({ ...editor, expires: event.target.checked })}
              />
              <span>Срок действия</span>
            </label>
            {editor.expires ? (
              <label className="span-2">
                <span>Дата окончания</span>
                <input
                  type="date"
                  value={editor.expiryTime}
                  onChange={(event) => setEditor({ ...editor, expiryTime: event.target.value })}
                />
              </label>
            ) : null}
            <div className="form__actions span-2">
              <button
                className="button button--ghost"
                type="button"
                onClick={() => setEditor(null)}
              >
                Отмена
              </button>
              <button className="button button--primary" type="submit">
                Сохранить запись
              </button>
            </div>
          </form>
        </Modal>
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
        <Modal title="Удалить запись?" onClose={() => setConfirmDelete(null)}>
          <p className="confirm-text">
            Запись «{confirmDelete.title}» будет перемещена в корзину базы.
          </p>
          <div className="form__actions">
            <button
              className="button button--ghost"
              type="button"
              onClick={() => setConfirmDelete(null)}
            >
              Отмена
            </button>
            <button
              className="button button--danger"
              type="button"
              onClick={() => void deleteEntry()}
            >
              Удалить
            </button>
          </div>
        </Modal>
      ) : null}

      {confirmGroupDelete ? (
        <Modal title="Удалить группу?" onClose={() => setConfirmGroupDelete(null)}>
          <p className="confirm-text">
            Группа «{confirmGroupDelete.name}» и все вложенные элементы будут перемещены в корзину
            базы.
          </p>
          <div className="form__actions">
            <button
              className="button button--ghost"
              type="button"
              onClick={() => setConfirmGroupDelete(null)}
            >
              Отмена
            </button>
            <button
              className="button button--danger"
              type="button"
              onClick={() => void deleteGroup()}
            >
              Удалить
            </button>
          </div>
        </Modal>
      ) : null}

      {confirmAttachmentDelete ? (
        <Modal title="Удалить вложение?" onClose={() => setConfirmAttachmentDelete(null)}>
          <p className="confirm-text">
            Вложение «{confirmAttachmentDelete.name}» будет удалено из записи.
          </p>
          <div className="form__actions">
            <button
              className="button button--ghost"
              type="button"
              onClick={() => setConfirmAttachmentDelete(null)}
            >
              Отмена
            </button>
            <button
              className="button button--danger"
              type="button"
              onClick={() => void deleteAttachment()}
            >
              Удалить
            </button>
          </div>
        </Modal>
      ) : null}

      {error ? (
        <Modal title="Ошибка" onClose={() => setError(null)}>
          <pre className="error-text">{error}</pre>
          <div className="form__actions">
            <button className="button button--primary" type="button" onClick={() => setError(null)}>
              Закрыть
            </button>
          </div>
        </Modal>
      ) : null}
      {toast ? (
        <div className="toast" onAnimationEnd={() => setToast(null)}>
          {toast}
        </div>
      ) : null}
    </div>
  );
}
