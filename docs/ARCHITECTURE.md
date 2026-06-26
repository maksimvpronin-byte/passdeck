# Архитектура PassDeck

## Процессы

```text
┌──────────────────────────────────────────────────────────────┐
│ Renderer: React UI                                           │
│ - без Node.js                                                │
│ - без файловой системы                                      │
│ - без прямой криптографии                                    │
│ - только window.passdeck API                                 │
└──────────────────────────────┬───────────────────────────────┘
                               │ contextBridge + ipcRenderer
┌──────────────────────────────▼───────────────────────────────┐
│ Preload                                                      │
│ - фиксированный типизированный белый список IPC              │
│ - не экспортирует ipcRenderer целиком                        │
└──────────────────────────────┬───────────────────────────────┘
                               │ ipcMain.handle
┌──────────────────────────────▼───────────────────────────────┐
│ Electron Main                                                │
│ - DatabaseService                                            │
│ - SettingsStore                                              │
│ - KDBX/Argon2                                                │
│ - атомарная запись, backup, lock                             │
│ - clipboard и OS-интеграция                                  │
└──────────────────────────────────────────────────────────────┘
```

## Workspaces

- `apps/desktop` — Electron main/preload/renderer;
- `packages/shared` — IPC DTO и общие типы;
- `test-data` — синтетические KDBX fixtures;
- `docs` — архитектура, безопасность и roadmap.

## Состояние базы

Каждая открытая вкладка соответствует main-process session:

```text
sessionId
path
name
Kdbx | undefined
locked
readOnly
dirty
ownsLock
fingerprint(mtime,size)
```

Мастер-пароль не хранится отдельной строкой после открытия. Библиотека KDBX содержит производный credential material внутри объекта базы. При блокировке ссылка на объект KDBX удаляется.

## Сохранение

1. проверка dirty/readOnly/locked;
2. проверка fingerprint;
3. backup исходного KDBX;
4. `db.save()`;
5. временный файл в директории базы;
6. fsync;
7. rename;
8. обновление fingerprint.

## Portable data root

На Windows electron-builder задаёт `PORTABLE_EXECUTABLE_DIR`. Поэтому settings root вычисляется как `<portable-dir>/data`.

В dev-режиме используется `data-dev`. В обычной непереносимой macOS-сборке используется `app.getPath('userData')/data`.

## Расширение архитектуры

Тяжёлый Argon2/KDBX поток должен быть вынесен в worker thread или Electron utility process до поддержки больших баз. IPC API при этом не меняется: renderer получает progress events и итоговый DTO.
