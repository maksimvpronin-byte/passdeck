# Roadmap PassDeck

## 0.1.0 — рабочий каркас

- [x] Electron/React/TypeScript/Vite;
- [x] portable settings;
- [x] KDBX create/open/save;
- [x] KDBX 4.1 + Argon2id;
- [x] вкладки;
- [x] группы и записи;
- [x] lock/read-only/external change;
- [x] две резервные копии;
- [x] clipboard timers;
- [x] basic tray;
- [x] unit/integration tests;
- [x] Windows/macOS build configs.

## 0.2.0 — полнота KDBX UI

- [x] пользовательские поля;
- [ ] вложения;
- [ ] история записей;
- [ ] пользовательские иконки;
- [ ] полноценная корзина и восстановление;
- [ ] перенос групп/записей;
- [ ] Save As и conflict UI.

## 0.3.0 — безопасность и удобство

- [ ] генератор паролей;
- [ ] аудит слабых/повторяющихся/просроченных записей;
- [ ] recovery-копии;
- [ ] смена мастер-пароля;
- [ ] Argon2 calibration;
- [ ] worker thread/utility process;
- [ ] быстрые фильтры;
- [ ] глобальный поиск.

## 0.4.0 — перенос данных и Auto-Type

- [ ] CSV import KeePass/Chrome/Edge/Firefox;
- [ ] CSV export с предупреждением;
- [ ] import preview/mapping/report;
- [x] Auto-Type Windows;
- [x] глобальная горячая клавиша `Ctrl+Alt+A`;
- [x] мгновенный ввод в активное окно без подтверждения.

## 0.5.0 — macOS

- [ ] Apple Silicon `.app/.dmg/.zip`;
- [ ] Accessibility Auto-Type;
- [ ] Keychain;
- [ ] Touch ID;
- [ ] Gatekeeper UX;
- [ ] подготовка signing/notarization;
- [ ] Intel x64.

## 1.0.0

- [ ] полный E2E suite;
- [ ] compatibility suite KeePass/KeePassXC;
- [ ] performance tests 20 000 записей;
- [ ] security review;
- [ ] документация пользователя;
- [ ] стабильные Windows/macOS сборки.
