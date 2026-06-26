#requires -Version 5.1

<#
.SYNOPSIS
Canonical PassDeck Windows portable builder.
.DESCRIPTION
Uses one orchestration path for validation, tests, build and electron-builder packaging.
The final release directory contains only one portable EXE.
#>

[CmdletBinding()]
param(
    [switch]$InstallNpmDeps,
    [switch]$SkipChecks
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Write-Step {
    param([Parameter(Mandatory = $true)][string]$Title)
    Write-Host ""
    Write-Host "==> $Title" -ForegroundColor Cyan
}

function Write-Ok {
    param([Parameter(Mandatory = $true)][string]$Message)
    Write-Host $Message -ForegroundColor Green
}

function Invoke-Native {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$Arguments = @()
    )

    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($Arguments -join ' ')"
    }
}

function Read-JsonFile {
    param([Parameter(Mandatory = $true)][string]$Path)
    return (Get-Content -LiteralPath $Path -Raw).TrimStart([char]0xFEFF) | ConvertFrom-Json
}

function Assert-Command {
    param([Parameter(Mandatory = $true)][string]$Name)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' was not found."
    }
}

function Assert-VersionConsistency {
    param([Parameter(Mandatory = $true)][string]$Root)

    $RootPackage = Read-JsonFile -Path (Join-Path $Root "package.json")
    $DesktopPackage = Read-JsonFile -Path (Join-Path $Root "apps\desktop\package.json")
    $SharedPackage = Read-JsonFile -Path (Join-Path $Root "packages\shared\package.json")

    $Versions = @(@(
        [string]$RootPackage.version,
        [string]$DesktopPackage.version,
        [string]$SharedPackage.version
    ) | Select-Object -Unique)

    if ($Versions.Count -ne 1) {
        throw "Version mismatch between root, desktop and shared packages: $($Versions -join ', ')"
    }

    return [string]$RootPackage.version
}

function Test-NpmDependenciesReady {
    param([Parameter(Mandatory = $true)][string]$Root)

    foreach ($RelativePath in @(
        "node_modules\.bin\tsc.cmd",
        "node_modules\.bin\vite.cmd",
        "node_modules\.bin\vitest.cmd",
        "node_modules\.bin\electron-builder.cmd"
    )) {
        if (-not (Test-Path -LiteralPath (Join-Path $Root $RelativePath))) {
            return $false
        }
    }

    return $true
}

function Stop-PassDeckProcesses {
    param([Parameter(Mandatory = $true)][string]$Root)

    $SelfPid = $PID
    try {
        Get-CimInstance Win32_Process | Where-Object {
            $_.ProcessId -ne $SelfPid -and
            $_.Name -in @("PassDeck.exe", "electron.exe") -and
            ($_.CommandLine -like "*$Root*" -or $_.CommandLine -like "*PassDeck-Portable*")
        } | ForEach-Object {
            Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        }
    }
    catch {
        Write-Host "Process inspection skipped: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

$Root = Split-Path -Parent $PSScriptRoot
$DesktopDir = Join-Path $Root "apps\desktop"
$ReleaseDir = Join-Path $Root "release"
$LegacyReleaseDir = Join-Path $DesktopDir "release"

try {
    if ($env:OS -ne "Windows_NT") {
        throw "Windows portable build must be run on Windows."
    }

    Set-Location $Root

    $LocalNodeDir = Join-Path $Root ".tools\node-v22.22.0-win-x64"
    if (Test-Path -LiteralPath (Join-Path $LocalNodeDir "node.exe")) {
        $env:Path = "$LocalNodeDir;$env:Path"
    }

    Write-Step "Checking toolchain"
    Assert-Command -Name "node"
    Assert-Command -Name "npm.cmd"

    $NodeVersion = (& node --version).TrimStart('v')
    $NodeMajor = [int]($NodeVersion.Split('.')[0])
    if ($NodeMajor -ne 22) {
        throw "PassDeck requires Node.js 22 LTS. Found: $NodeVersion"
    }

    $Version = Assert-VersionConsistency -Root $Root
    Write-Ok "PassDeck version: $Version"
    Write-Ok "Node.js version: $NodeVersion"

    $env:npm_config_registry = "https://registry.npmjs.org/"
    $env:npm_config_fetch_retries = "10"
    $env:npm_config_fetch_retry_mintimeout = "20000"
    $env:npm_config_fetch_retry_maxtimeout = "120000"
    $env:npm_config_fetch_timeout = "600000"
    $env:npm_config_maxsockets = "4"
    $env:CSC_IDENTITY_AUTO_DISCOVERY = "false"

    Write-Step "Checking npm dependencies"
    if (-not (Test-NpmDependenciesReady -Root $Root)) {
        if (-not $InstallNpmDeps) {
            throw "npm dependencies are incomplete. Run 'npm.cmd ci --no-audit --no-fund' or rerun with -InstallNpmDeps."
        }
        Invoke-Native -FilePath "npm.cmd" -Arguments @("ci", "--no-audit", "--no-fund", "--prefer-offline")
    }
    Write-Ok "npm build tools OK."

    Write-Step "Cleaning release output"
    Stop-PassDeckProcesses -Root $Root
    Start-Sleep -Milliseconds 300
    Remove-Item -LiteralPath $ReleaseDir -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $LegacyReleaseDir -Recurse -Force -ErrorAction SilentlyContinue

    Write-Step "Building shared package"
    Invoke-Native -FilePath "npm.cmd" -Arguments @("run", "build", "-w", "@passdeck/shared")

    if (-not $SkipChecks) {
        Write-Step "Running lint"
        Invoke-Native -FilePath "npm.cmd" -Arguments @("run", "lint", "-w", "@passdeck/shared")
        Invoke-Native -FilePath "npm.cmd" -Arguments @("run", "lint", "-w", "@passdeck/desktop")

        Write-Step "Running TypeScript checks"
        Invoke-Native -FilePath "npm.cmd" -Arguments @("run", "typecheck", "-w", "@passdeck/shared")
        Invoke-Native -FilePath "npm.cmd" -Arguments @("run", "typecheck", "-w", "@passdeck/desktop")

        Write-Step "Running tests"
        Invoke-Native -FilePath "npm.cmd" -Arguments @("run", "test", "-w", "@passdeck/desktop")
    }

    Write-Step "Building Electron application"
    Invoke-Native -FilePath "npm.cmd" -Arguments @("run", "build", "-w", "@passdeck/desktop")

    Write-Step "Building Windows portable package"
    Push-Location $DesktopDir
    try {
        Invoke-Native -FilePath "npm.cmd" -Arguments @("run", "dist:win")
    }
    finally {
        Pop-Location
    }

    $ArtifactName = "PassDeck-Portable-$Version-x64.exe"
    $ArtifactPath = Join-Path $ReleaseDir $ArtifactName
    if (-not (Test-Path -LiteralPath $ArtifactPath)) {
        throw "Portable artifact was not produced: $ArtifactPath"
    }

    Write-Step "Cleaning temporary packaging output"
    Get-ChildItem -LiteralPath $ReleaseDir -Force | Where-Object {
        $_.FullName -ne $ArtifactPath
    } | Remove-Item -Recurse -Force
    Remove-Item -LiteralPath $LegacyReleaseDir -Recurse -Force -ErrorAction SilentlyContinue

    $PortableFiles = @(Get-ChildItem -LiteralPath $ReleaseDir -File -Filter "*.exe")
    if ($PortableFiles.Count -ne 1 -or $PortableFiles[0].FullName -ne $ArtifactPath) {
        throw "Release validation failed: exactly one portable EXE must remain in release."
    }
    if (Test-Path -LiteralPath $LegacyReleaseDir) {
        throw "Legacy release directory still exists: $LegacyReleaseDir"
    }

    Write-Host ""
    Write-Host "PassDeck portable build completed successfully." -ForegroundColor Green
    Write-Host "Output: release\$ArtifactName" -ForegroundColor Green
}
catch {
    Write-Host ""
    Write-Host "PassDeck portable build failed." -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
