# Проверка сборки PassDeck 0.1.2

Проверено в среде Node.js 22:

- `npm run lint` — успешно;
- `npm run typecheck` — успешно;
- `npm test` — 4 теста успешно;
- `npm run build` — успешно;
- KDBX create/open/save/backup — успешно;
- разбор Auto-Type и экранирование SendKeys — успешно;
- Windows runtime Auto-Type требует проверки на Windows 10/11.

Ожидаемый артефакт:

```text
release\PassDeck-Portable-0.1.2-x64.exe
```
