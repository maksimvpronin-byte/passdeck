# PassDeck Deferred Big Work Plan

План крупных отложенных изменений после завершения малых оптимизационных патчей `0.2.10`-`0.2.15`.

Цель документа: собрать большие темы в управляемую очередь работ, не смешивая их с короткими cleanup-патчами. Каждый блок ниже требует отдельного согласования перед стартом реализации.

## Общие правила

- Не менять формат KDBX и пользовательских данных без отдельного migration/compatibility решения.
- Не расширять renderer-доступ к секретам, файловой системе или произвольному IPC.
- Не добавлять generic `invoke(channel, payload)`.
- Любой новый IPC должен быть типизирован в `packages/shared`.
- Сначала проектировать контракты и тестовые сценарии, затем переносить код.
- Для каждого этапа запускать:

```powershell
npm run lint
npm run typecheck
npm run test
npm run build
```

## Рекомендуемый порядок

1. `0.3.x` — стабилизация `DatabaseService` и main-архитектуры.
2. `0.4.x` — worker/utility process для тяжёлых KDBX/Argon2 операций и крупных баз.
3. `0.5.x` — формализованный data/compatibility contract без изменения формата базы.
4. `0.6.x` — Auto-Type IPC cleanup.
5. `0.7.x` — Touch ID lifecycle cleanup.
6. `0.8.x` — recovery-копии и связанные UX/security проверки.
7. `1.0` gates — compatibility suite, performance tests, security review, пользовательская документация.

## 0.3.x — DatabaseService Architecture Split

### Цель

Разделить большой `DatabaseService` на меньшие сервисы без изменения поведения и IPC-контрактов.

### Предлагаемые модули

- `DatabaseSessionStore` — хранение сессий, active/locked/readOnly/dirty/fingerprint.
- `KdbxFileService` — open/load/save, atomic write, backup, fingerprint.
- `EntryService` — записи, поля, protected custom fields, вложения.
- `GroupService` — группы, перемещение, удаление.
- `LockFileService` — lock-файлы, stale lock, force read-write.
- `OpenTabsService` — restore/last open/recent cleanup.

### Ограничения

- `DatabaseView`, `EntrySummary`, `SaveEntryRequest` не менять без отдельного shared-контрактного патча.
- Не менять lock/readOnly/external-change поведение.
- Не менять лимиты вложений.
- Не менять Auto-Type, Touch ID и UI.

### Этапы

1. Покрыть существующее поведение тестами там, где есть пробелы: save conflict, stale lock, attachments, protected fields.
2. Вынести lock-файлы в отдельный сервис.
3. Вынести session-store и restore-tabs.
4. Вынести file save/open/backup/fingerprint.
5. Вынести entry/group операции.
6. Удалить из `DatabaseService` прямую ответственность за детали, оставив фасад для IPC.

### Acceptance Criteria

- Публичные методы `DatabaseService` для IPC не меняются.
- Unit tests покрывают прежние сценарии.
- Нет изменений в `DatabaseView` snapshots/shape.
- `npm run lint`, `typecheck`, `test`, `build` проходят.

## 0.4.x — Worker Or Utility Process For Heavy Operations

### Цель

Убрать тяжёлые KDBX/Argon2 операции из main event loop до поддержки больших баз.

### Контекст

Архитектура уже фиксирует, что тяжёлый Argon2/KDBX поток должен быть вынесен в worker thread или Electron utility process, при этом renderer API остаётся прежним.

### Решение Нужно Выбрать

- Node worker thread: проще тестировать и интегрировать.
- Electron utility process: сильнее изоляция, сложнее сборка и lifecycle.

### Этапы

1. Измерить текущие open/save времена на демо и синтетических крупных базах.
2. Спроектировать internal main-to-worker protocol.
3. Вынести Argon2/KDBX load/save в worker boundary.
4. Добавить progress/status events только если они реально нужны UX.
5. Добавить cancellation/timeout policy.

### Ограничения

- Renderer `window.passdeck` API не ломать.
- Секреты не писать в worker logs/errors.
- Временные файлы и backup остаются под контролем main-service слоя.

### Acceptance Criteria

- Main window не зависает при open/save крупной базы.
- Есть performance tests или benchmark script.
- Ошибки worker корректно превращаются в `ApiResult`.

## 0.5.x — Data Format And Compatibility Contract

### Цель

Зафиксировать правила изменения данных без фактической миграции формата базы на этом этапе.

### Что Нужно Описать

- Какие customData ключи принадлежат PassDeck.
- Какие поля можно добавлять без миграции.
- Как версионировать PassDeck metadata внутри KDBX, если это понадобится.
- Как проверять совместимость с KeePass/KeePassXC.
- Как отличать KDBX compatibility от PassDeck internal state.

### Ограничения

- Не менять формат базы до отдельного утверждения.
- Не добавлять несовместимые customData значения.
- Не включать UI истории, корзины, Save As или recovery key без отдельного продуктового решения.

### Acceptance Criteria

- Есть документ compatibility contract.
- Есть минимальный compatibility suite: создать в PassDeck, открыть в KeePassXC; открыть внешнюю KDBX в PassDeck; сохранить и повторно открыть.
- Нет изменений пользовательских файлов без явного тестового подтверждения.

## 0.6.x — Auto-Type IPC Cleanup

### Цель

Сделать Auto-Type контракт явным и узким после удаления UI-настроек Auto-Type.

### Текущий Принцип

Auto-Type использует фиксированную последовательность:

```text
{USERNAME}{TAB}{PASSWORD}{ENTER}
```

### Этапы

1. Инвентаризировать Auto-Type DTO и IPC: selection, payload, errors.
2. Убедиться, что renderer не может передать произвольную последовательность или секрет.
3. Проверить, нужны ли `autoTypeEnabled` и `autoTypeSequence` в `EntrySummary` для UI или только для main logic.
4. Разделить read-model для Auto-Type и обычный `EntrySummary`, если это уменьшит поверхность секретов.
5. Добавить негативные тесты на locked/readOnly/no-selection/window-changed cases.

### Ограничения

- Не менять глобальные hotkeys.
- Не добавлять кнопку запуска Auto-Type, новые настройки, модалку или отдельную страницу без отдельного продуктового решения.
- Не менять fixed sequence без security/UX решения.

### Acceptance Criteria

- Auto-Type IPC минимален и типизирован.
- Ошибки Auto-Type остаются понятными в UI.
- Windows/macOS сценарии не регрессируют.

## 0.7.x — Touch ID Lifecycle Cleanup

### Цель

Упорядочить Touch ID lifecycle, Keychain errors и UX fallback на мастер-пароль.

### Этапы

1. Инвентаризировать Touch ID flows: status, store password, open, unlock, forget.
2. Разделить Keychain access и database open/unlock orchestration.
3. Нормализовать ошибки: cancel, unavailable, missing secret, denied, unexpected.
4. Проверить поведение при перемещённом/удалённом файле базы.
5. Добавить тестируемый adapter boundary для Keychain, чтобы не мокать Electron/OS напрямую.

### Ограничения

- Секрет для Touch ID хранить только через macOS Keychain.
- При любой ошибке Touch ID должен быть fallback на мастер-пароль.
- Не хранить мастер-пароль в settings, logs, exceptions.

### Acceptance Criteria

- Touch ID ошибки не выглядят как raw system errors.
- Пользователь всегда может вернуться к мастер-паролю.
- Есть unit tests для orchestration и manual QA checklist для macOS.

## 0.8.x — Recovery Copies

### Цель

Реализовать recovery-копии без риска утечки секретов и без конфликтов с backup/atomic save.

### Требования Из Product Prompt

- При включении первая зашифрованная recovery-копия создаётся через 60 секунд после первого несохранённого изменения.
- Хранить одну recovery-копию на базу в `data/recovery`.
- После успешного сохранения удалить recovery.
- При запуске предложить восстановить более свежую recovery-копию.

### Этапы

1. Спроектировать recovery metadata: source path, mtime, fingerprint, createdAt.
2. Определить, где живёт scheduler: main service, не renderer.
3. Реализовать создание recovery только из уже зашифрованного KDBX save output.
4. Реализовать cleanup после успешного save.
5. Реализовать startup detection и UX восстановления.
6. Добавить тесты аварийных сценариев.

### Ограничения

- Recovery не должен хранить plaintext.
- Recovery не должен перезаписывать основную базу без подтверждения.
- Recovery должен учитывать external-change и lock-файлы.

### Acceptance Criteria

- Recovery создаётся, обнаруживается, восстанавливается и удаляется по правилам.
- Есть negative tests: stale recovery, moved source, external change, read-only database.
- Security docs обновлены.

## 1.0 Gates

Перед стабильным `1.0.0` нужны отдельные gate-задачи:

- Compatibility suite KeePass/KeePassXC.
- Performance tests для крупных баз.
- Security review.
- Пользовательская документация.
- Стабильные Windows и macOS сборки.

Подробный gate-план: [`RELEASE_1_0_GATES.md`](RELEASE_1_0_GATES.md).

## Не Входит В Этот План

- Генератор паролей.
- Аудит слабых/повторяющихся/просроченных паролей.
- Пользовательские иконки.
- Импорт/экспорт.
- Смена мастер-пароля.
- Локализация.
- Playwright E2E.

Эти темы остаются продуктовыми направлениями из roadmap и должны планироваться отдельно.
