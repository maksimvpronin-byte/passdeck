#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

VERSION="$(node -p "require('./package.json').version")"
echo "=== PassDeck ${VERSION} macOS ARM build ==="

command -v node >/dev/null 2>&1 || { echo "Node.js 22 LTS не найден" >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "npm не найден" >&2; exit 1; }

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [[ "$NODE_MAJOR" != "22" ]]; then
  echo "Требуется Node.js 22 LTS" >&2
  exit 1
fi

export npm_config_registry="https://registry.npmjs.org/"
if [[ ! -d node_modules ]]; then
  npm ci --prefer-offline --no-fund --no-audit
else
  echo "node_modules найден: повторная установка зависимостей пропущена."
fi

npm run build -w @passdeck/shared
npm audit --audit-level=high
npm run lint
npm run typecheck
npm run test
npm run package:mac

mkdir -p release
find apps/desktop/release -maxdepth 1 -type f \( -name "PassDeck-${VERSION}-arm64.dmg" -o -name "PassDeck-${VERSION}-arm64.zip" \) -exec cp -f {} release/ \;

echo "Готово. Результаты находятся в release/."
echo "Сборка не подписана и не notarized; macOS может показать предупреждение Gatekeeper."
