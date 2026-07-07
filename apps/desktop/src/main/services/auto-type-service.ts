import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { clipboard, globalShortcut, systemPreferences, type BrowserWindow } from 'electron';

import { parseAutoTypeSequence, type AutoTypeAction } from './auto-type-sequence';
import type { AutoTypeSelection } from '@passdeck/shared';
import { normalizeAutoTypeSelection } from './auto-type-selection';
import type { DatabaseService } from './database-service';
import { PassDeckError } from './errors';
import {
  AUTO_TYPE_MAC_NO_TARGET_MARKER,
  AUTO_TYPE_MAC_SELF_TARGET_MARKER,
  AUTO_TYPE_MAC_SUCCESS_MARKER,
  AUTO_TYPE_MAC_TARGET_CHANGED_MARKER,
  AUTO_TYPE_MAC_TARGET_PID_PREFIX,
  buildAutoTypeMacOsScript,
  buildAutoTypeMacOsTargetScript,
  runAutoTypeMacOsScript,
} from './auto-type-macos';
import { AUTO_TYPE_TARGET_CHANGED_MARKER, buildAutoTypeWindowsScript } from './auto-type-windows';

const execFileAsync = promisify(execFile);

export const AUTO_TYPE_SHORTCUT = 'CommandOrControl+Alt+A';
export const AUTO_TYPE_SHORTCUT_LABEL = process.platform === 'darwin' ? '⌘+⌥+A' : 'Ctrl+Alt+A';

interface ForegroundWindowInfo {
  handle: number;
  title: string;
  processId: number;
  processName: string;
}

function encodePowerShell(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

async function runPowerShell(script: string): Promise<string> {
  const { stdout } = await execFileAsync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-EncodedCommand',
      encodePowerShell(script),
    ],
    {
      windowsHide: true,
      timeout: 15_000,
      maxBuffer: 1024 * 1024,
    },
  );

  return stdout.trim();
}

async function readForegroundWindow(): Promise<ForegroundWindowInfo> {
  const script = String.raw`
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class PassDeckNative {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
'@
$handle = [PassDeckNative]::GetForegroundWindow()
$builder = New-Object Text.StringBuilder 2048
[PassDeckNative]::GetWindowText($handle, $builder, $builder.Capacity) | Out-Null
[uint32]$processIdValue = 0
[PassDeckNative]::GetWindowThreadProcessId($handle, [ref]$processIdValue) | Out-Null
$processName = ''
try { $processName = (Get-Process -Id $processIdValue -ErrorAction Stop).ProcessName } catch {}
[pscustomobject]@{
  handle = $handle.ToInt64()
  title = $builder.ToString()
  processId = [int]$processIdValue
  processName = $processName
} | ConvertTo-Json -Compress
`;

  const output = await runPowerShell(script);
  const parsed = JSON.parse(output) as Partial<ForegroundWindowInfo>;

  if (!parsed.handle || !parsed.processId) {
    throw new PassDeckError('AUTO_TYPE_TARGET', 'Не удалось определить активное окно.');
  }

  return {
    handle: parsed.handle,
    title: parsed.title?.trim() || 'Окно без заголовка',
    processId: parsed.processId,
    processName: parsed.processName?.trim() || 'unknown',
  };
}

async function sendActionsToWindows(
  target: ForegroundWindowInfo,
  actions: AutoTypeAction[],
): Promise<void> {
  const result = await runPowerShell(buildAutoTypeWindowsScript(target.handle, actions));

  if (result.includes(AUTO_TYPE_TARGET_CHANGED_MARKER)) {
    throw new PassDeckError(
      'AUTO_TYPE_TARGET_CHANGED',
      'Целевое окно изменилось до начала Auto-Type. Повторите сочетание в нужном окне.',
    );
  }
}

function isMacOsPermissionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /not authorized|not allowed|assistive access|accessibility|automation|apple events|-1743|-25211/i.test(
    message,
  );
}

async function readMacOsTargetPid(): Promise<number> {
  let result: string;

  try {
    result = await runAutoTypeMacOsScript(buildAutoTypeMacOsTargetScript(process.pid));
  } catch (error) {
    if (isMacOsPermissionError(error)) {
      throw new PassDeckError(
        'AUTO_TYPE_PERMISSION',
        'Разрешите PassDeck в «Системные настройки → Конфиденциальность и безопасность → Универсальный доступ». При запросе «Автоматизация» разрешите управление System Events, затем повторите ⌘+⌥+A.',
      );
    }
    throw error;
  }

  if (result.includes(AUTO_TYPE_MAC_SELF_TARGET_MARKER)) {
    throw new PassDeckError(
      'AUTO_TYPE_TARGET',
      'Перейдите в окно сайта или приложения и нажмите ⌘+⌥+A ещё раз.',
    );
  }

  if (result.includes(AUTO_TYPE_MAC_NO_TARGET_MARKER)) {
    throw new PassDeckError('AUTO_TYPE_TARGET', 'Не удалось определить активное приложение macOS.');
  }

  if (!result.startsWith(AUTO_TYPE_MAC_TARGET_PID_PREFIX)) {
    throw new PassDeckError('AUTO_TYPE_TARGET', 'Не удалось определить активное приложение macOS.');
  }

  const targetPid = Number(result.slice(AUTO_TYPE_MAC_TARGET_PID_PREFIX.length));
  if (!Number.isInteger(targetPid) || targetPid <= 0) {
    throw new PassDeckError('AUTO_TYPE_TARGET', 'Не удалось определить активное приложение macOS.');
  }

  return targetPid;
}

async function runMacOsAction(targetPid: number, action: AutoTypeAction): Promise<void> {
  let result: string;

  try {
    result = await runAutoTypeMacOsScript(buildAutoTypeMacOsScript(targetPid, [action]));
  } catch (error) {
    if (isMacOsPermissionError(error)) {
      throw new PassDeckError(
        'AUTO_TYPE_PERMISSION',
        'Разрешите PassDeck в «Системные настройки → Конфиденциальность и безопасность → Универсальный доступ». При запросе «Автоматизация» разрешите управление System Events, затем повторите ⌘+⌥+A.',
      );
    }
    throw error;
  }

  if (result.includes(AUTO_TYPE_MAC_TARGET_CHANGED_MARKER)) {
    throw new PassDeckError(
      'AUTO_TYPE_TARGET_CHANGED',
      'Целевое окно изменилось до или во время Auto-Type. Повторите ⌘+⌥+A в нужном окне.',
    );
  }

  if (!result.includes(AUTO_TYPE_MAC_SUCCESS_MARKER)) {
    throw new PassDeckError(
      'AUTO_TYPE_FAILED',
      'macOS Auto-Type завершился без подтверждения успешного ввода.',
    );
  }
}

async function sendActionsToMacOs(actions: AutoTypeAction[]): Promise<void> {
  const targetPid = await readMacOsTargetPid();
  const previousClipboardText = clipboard.readText();

  try {
    for (const action of actions) {
      if (action.kind === 'text') {
        clipboard.writeText(action.value);
      }
      await runMacOsAction(targetPid, action);
    }
  } finally {
    clipboard.writeText(previousClipboardText);
  }
}

export class AutoTypeService {
  private selectedSessionId: string | null = null;
  private selectedEntryId: string | null = null;
  private running = false;

  constructor(
    private readonly databases: DatabaseService,
    private readonly getMainWindow: () => BrowserWindow | null,
  ) {}

  registerShortcut(): boolean {
    if (process.platform !== 'win32' && process.platform !== 'darwin') {
      return false;
    }

    return globalShortcut.register(AUTO_TYPE_SHORTCUT, () => {
      void this.runFromShortcut();
    });
  }

  unregisterShortcut(): void {
    globalShortcut.unregister(AUTO_TYPE_SHORTCUT);
  }

  setSelection(selection: AutoTypeSelection): void {
    const normalized = normalizeAutoTypeSelection(selection);
    this.selectedSessionId = normalized.sessionId;
    this.selectedEntryId = normalized.entryId;
  }

  private async runFromShortcut(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;

    try {
      if (!this.selectedSessionId || !this.selectedEntryId) {
        throw new PassDeckError(
          'AUTO_TYPE_SELECTION',
          `Сначала выберите запись в PassDeck, затем перейдите в целевое окно и нажмите ${AUTO_TYPE_SHORTCUT_LABEL}.`,
        );
      }

      const payload = this.databases.getAutoTypePayload(
        this.selectedSessionId,
        this.selectedEntryId,
      );
      const actions = parseAutoTypeSequence(payload.sequence, payload);

      if (process.platform === 'darwin') {
        if (!systemPreferences.isTrustedAccessibilityClient(true)) {
          throw new PassDeckError(
            'AUTO_TYPE_PERMISSION',
            'Разрешите PassDeck в «Системные настройки → Конфиденциальность и безопасность → Универсальный доступ», затем повторите ⌘+⌥+A. После выдачи разрешения может потребоваться перезапуск приложения.',
          );
        }

        await sendActionsToMacOs(actions);
        return;
      }

      const target = await readForegroundWindow();

      if (target.processId === process.pid) {
        throw new PassDeckError(
          'AUTO_TYPE_TARGET',
          'Перейдите в окно сайта или приложения и нажмите Ctrl+Alt+A ещё раз.',
        );
      }

      await sendActionsToWindows(target, actions);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось выполнить Auto-Type.';
      const window = this.getMainWindow();

      if (window) {
        if (window.isMinimized()) {
          window.restore();
        }

        window.show();
        window.focus();
        window.webContents.send('autotype:error', message);
      }
    } finally {
      this.running = false;
    }
  }
}
