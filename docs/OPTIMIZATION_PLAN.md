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

### 0.2.10

- Для отсутствующего файла базы добавлена ошибка `DATABASE_FILE_MISSING` с понятным сообщением.
- Недоступный путь удаляется из `recentDatabases` и `lastOpenDatabases`.
- Renderer обновляет список последних баз и закрывает unlock-диалог для missing file ошибок.
- Добавлен unit-тест на отсутствующий `.kdbx`.

### 0.2.11

- Редактор записи вынесен в `EntryEditorModal`.
- `App.tsx` остался владельцем состояния редактора, IPC сохранения и callbacks.

### 0.2.12

- Confirmation/error-модалки вынесены в `ConfirmModal` и `ErrorModal`.

### 0.2.13

- Основные панели workspace вынесены в `GroupsSidebar` и `EntryList`.
- Drag-and-drop логика осталась в `App.tsx` и передаётся в панели через callbacks.

### 0.2.14

- Повторяющиеся IPC-обработчики `try/catch -> toApiError` сведены через общий helper.
- IPC channel names и shape `ApiResult` не менялись.

### 0.2.15

- Renderer больше не отправляет Auto-Type поля при сохранении записи.
- Фиксированная Auto-Type последовательность и KDBX customData defaults остаются на стороне main/database-service.

## Отложено

- Большие архитектурные перестройки main/database-service.
- Изменения формата базы.
- Изменения Auto-Type IPC.
- Изменения Touch ID логики.
