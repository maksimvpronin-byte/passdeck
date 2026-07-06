# PassDeck Optimization Plan

Рабочий план малых patch-изменений для разгрузки кода без смены поведения.

## Принципы

- Делать изменения маленькими patch-ветками.
- На каждый patch поднимать версию проекта.
- После каждого изменения запускать:

```powershell
npm run lint
npm run typecheck
npm run build
```

- Пушить каждую patch-ветку отдельно.
- Сначала разгружать renderer и UI, затем переходить к более чувствительным main/shared-контрактам.

## Уже сделано

### 0.2.3

Ветка: `chore/optimize-readability-0.2.3`

- Приведены к читаемому виду Touch ID IPC, preload API и renderer-логика авторазблокировки.
- Поведение не менялось.

### 0.2.4

Ветка: `chore/optimize-group-counts-0.2.4`

- Подсчёт записей по группам вынесен из JSX в `useMemo`.
- Список групп больше не фильтрует все записи в каждой строке.

### 0.2.5

Ветка: `chore/debounce-window-bounds-0.2.5`

- Добавлен debounce сохранения размеров окна.
- Финальные размеры сохраняются при скрытии в tray и перед штатным выходом.

### 0.2.6

Ветка: `chore/extract-entry-filter-0.2.6`

- Фильтрация и поиск записей вынесены из `App.tsx` в `entry-filter.ts`.

### 0.2.7

Ветка: `chore/extract-entry-details-0.2.7`

- Правая панель выбранной записи вынесена в `EntryDetails`.
- IPC-обработчики и состояние остались в `App.tsx`.

### 0.2.8

Ветка: `chore/extract-settings-modal-0.2.8`

- Модальное окно настроек вынесено в `SettingsModal`.
- Обновление настроек осталось в `App.tsx`.

### 0.2.9

Ветка: `chore/extract-database-modals-0.2.9`

- Модалки разблокировки и создания базы вынесены в `UnlockDatabaseModal` и `CreateDatabaseModal`.
- State, валидация, очередь открытия баз и IPC-операции остались в `App.tsx`.

## Следующие шаги

### 0.2.10 — Entry editor modal

Цель: вынести JSX редактора записи из `App.tsx` в `EntryEditorModal`.

Ограничения:

- Не переносить IPC-логику сохранения записи.
- Не менять формат `EditorState`.
- Не менять поведение защищённых пользовательских полей.
- `App.tsx` пока остаётся владельцем `editor`, `submitEntry`, `toggleEditorPassword`, `addCustomField`, `updateCustomField`, `removeCustomField`.

Ожидаемый результат:

- Новый компонент `apps/desktop/src/renderer/components/EntryEditorModal.tsx`.
- `App.tsx` передаёт editor-state и callbacks через props.

### 0.2.11 — Confirm and error modals

Цель: вынести повторяющиеся confirmation/error-модалки из `App.tsx`.

Кандидаты:

- удаление записи;
- удаление группы;
- удаление вложения;
- error modal.

Ожидаемый результат:

- Меньше JSX в нижней части `App.tsx`.
- Единый небольшой компонент для confirm-сценариев, если это не усложнит props.

### 0.2.12 — Sidebar and entry list

Цель: вынести основные панели workspace:

- `GroupsSidebar`;
- `EntryList`.

Ограничения:

- Drag-and-drop поведение не менять.
- Сначала переносить JSX и callbacks, не переписывать DnD-логику.

### 0.2.13 — IPC helper

Цель: снизить повторение `try/catch -> toApiError` в `apps/desktop/src/main/ipc.ts`.

Ограничения:

- Не менять IPC channel names.
- Не менять shape `ApiResult`.
- Touch ID, Auto-Type и database IPC проверять особенно внимательно.

### 0.2.14 — Auto-Type contract cleanup

Цель: проверить, нужны ли `autoTypeEnabled` и `autoTypeSequence` в renderer/shared-контракте после удаления UI-настроек Auto-Type.

Ограничения:

- Не ломать совместимость с KDBX customData без явного решения.
- Не менять фиксированную последовательность Auto-Type.
- Не менять глобальные hotkeys.

## Отложено

- Большие архитектурные перестройки main/database-service.
- Изменения формата базы.
- Изменения Auto-Type IPC.
- Изменения Touch ID логики.
