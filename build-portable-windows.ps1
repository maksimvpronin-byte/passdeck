param(
    [switch]$CleanInstall
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ProjectRoot

$Package = Get-Content (Join-Path $ProjectRoot "package.json") -Raw | ConvertFrom-Json
$Version = [string]$Package.version

Write-Host "=== PassDeck $Version Windows Portable build ===" -ForegroundColor Cyan

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js 22 LTS не найден. Установите Node.js 22 и повторите запуск."
}
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    throw "npm не найден."
}

$NodeVersion = (& node --version).TrimStart('v')
$NodeMajor = [int]($NodeVersion.Split('.')[0])
if ($NodeMajor -ne 22) {
    throw "Требуется Node.js 22 LTS. Обнаружена версия $NodeVersion."
}

$env:npm_config_registry = "https://registry.npmjs.org/"
$env:npm_config_fetch_retries = "10"
$env:npm_config_fetch_retry_mintimeout = "20000"
$env:npm_config_fetch_retry_maxtimeout = "120000"
$env:npm_config_fetch_timeout = "600000"
$env:npm_config_maxsockets = "4"

Write-Host "Node.js: $NodeVersion"

$NodeModules = Join-Path $ProjectRoot "node_modules"
if ($CleanInstall -or -not (Test-Path $NodeModules)) {
    Write-Host "Установка зафиксированных зависимостей..."
    & npm.cmd ci --prefer-offline --no-fund --no-audit
    if ($LASTEXITCODE -ne 0) { throw "npm ci завершился с ошибкой." }
} else {
    Write-Host "node_modules найден: повторная установка зависимостей пропущена."
}

Write-Host "Сборка общего пакета типов..."
& npm.cmd run build -w @passdeck/shared
if ($LASTEXITCODE -ne 0) { throw "Сборка @passdeck/shared завершилась с ошибкой." }

Write-Host "Проверка зависимостей..."
& npm.cmd audit --audit-level=high
if ($LASTEXITCODE -ne 0) { throw "npm audit обнаружил уязвимости уровня high/critical." }

Write-Host "Lint..."
& npm.cmd run lint
if ($LASTEXITCODE -ne 0) { throw "Lint завершился с ошибкой." }

Write-Host "TypeScript..."
& npm.cmd run typecheck
if ($LASTEXITCODE -ne 0) { throw "Typecheck завершился с ошибкой." }

Write-Host "Тесты..."
& npm.cmd run test
if ($LASTEXITCODE -ne 0) { throw "Тесты завершились с ошибкой." }

Write-Host "Сборка Windows Portable..."
& npm.cmd run package:win
if ($LASTEXITCODE -ne 0) { throw "Сборка portable завершилась с ошибкой." }

$ArtifactName = "PassDeck-Portable-$Version-x64.exe"
$SourceArtifact = Join-Path $ProjectRoot "apps\desktop\release\$ArtifactName"
$ReleaseDir = Join-Path $ProjectRoot "release"
New-Item -ItemType Directory -Force -Path $ReleaseDir | Out-Null
if (-not (Test-Path $SourceArtifact)) {
    throw "Сборка завершилась, но файл не найден: $SourceArtifact"
}
Copy-Item $SourceArtifact (Join-Path $ReleaseDir $ArtifactName) -Force

Write-Host ""
Write-Host "Готово: release\$ArtifactName" -ForegroundColor Green
