# Git workflow

Архив поставляется без `.git`.

```powershell
git init
git branch -M main
git add .
git commit -m "feat: bootstrap PassDeck 0.1.0"
git switch -c dev/0.1.0
```

Рекомендуемая схема:

- `main` — проверенные состояния;
- `dev/0.1.0` — текущая разработка;
- небольшие feature-ветки при необходимости;
- теги релизов: `v0.1.0`, `v0.2.0` и далее.
