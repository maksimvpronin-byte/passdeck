#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

echo "======================================"
echo " PassDeck macOS portable build"
echo "======================================"
echo ""

if [ ! -f "package.json" ]; then
  echo "ERROR: package.json не найден."
  echo "Этот файл должен лежать в корне проекта PassDeck."
  echo "Текущая папка: $ROOT_DIR"
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js не найден. Нужна Node.js 22.x."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "ERROR: npm не найден."
  exit 1
fi

echo "Папка проекта:"
pwd
echo ""

echo "Node:"
node -v
echo "npm:"
npm -v
echo ""

node -e '
const [major, minor] = process.versions.node.split(".").map(Number);
if (major !== 22 || minor < 12) {
  console.error("ERROR: нужна Node.js >=22.12.0 и <23. Сейчас: " + process.versions.node);
  process.exit(1);
}
'

echo "Последние git-коммиты:"
git log --oneline --decorate -3 || true

echo ""
echo "Устанавливаю npm-зависимости..."
if [ -f "package-lock.json" ]; then
  npm ci --include=dev
else
  npm install --include=dev
fi

echo ""
echo "Проверяю TypeScript compiler..."
npm exec tsc -v

echo ""
echo "Отключаю code signing для локальной сборки..."
export CSC_IDENTITY_AUTO_DISCOVERY=false

echo ""
echo "Собираю macOS-версию PassDeck..."
npm run package:mac

echo ""
echo "======================================"
echo " Готово. Файлы сборки:"
echo "======================================"

if [ -d "release" ]; then
  ls -lh release
else
  echo "WARNING: папка release не найдена."
fi

echo ""
echo "Сборка завершена."
