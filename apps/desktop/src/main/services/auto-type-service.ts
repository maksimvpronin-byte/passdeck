import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { globalShortcut, type BrowserWindow } from 'electron';
import {
  escapeSendKeysLiteral,
  parseAutoTypeSequence,
  type AutoTypeAction,
} from './auto-type-sequence';
import type { DatabaseService } from './database-service';
import { PassDeckError } from './errors';

const execFileAsync = promisify(execFile);

export const AUTO_TYPE_SHORTCUT = 'Control+Alt+A';

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

function textActionScript(value: string): string {
  const escaped = escapeSendKeysLiteral(value);
  const encoded = Buffer.from(escaped, 'utf8').toString('base64');
  return [
    `$text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))`,
    '[System.Windows.Forms.SendKeys]::SendWait($text)',
  ].join('\n');
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

async function sendActionsToWindow(
  target: ForegroundWindowInfo,
  actions: AutoTypeAction[],
): Promise<void> {
  const actionScript = actions
    .map((action) => {
      if (action.kind === 'text') {
        return textActionScript(action.value);
      }
      if (action.kind === 'delay') {
        return `Start-Sleep -Milliseconds ${action.milliseconds}`;
      }
      return `[System.Windows.Forms.SendKeys]::SendWait('{${action.value}}')`;
    })
    .join('\nStart-Sleep -Milliseconds 40\n');

  const script = String.raw`
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class PassDeckNative {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int command);
}
'@
$target = [IntPtr]::new(${target.handle})
[PassDeckNative]::ShowWindow($target, 9) | Out-Null
[PassDeckNative]::SetForegroundWindow($target) | Out-Null
Start-Sleep -Milliseconds 120
${actionScript}
`;
  await runPowerShell(script);
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
    if (process.platform !== 'win32') {
      return false;
    }
    return globalShortcut.register(AUTO_TYPE_SHORTCUT, () => {
      void this.runFromShortcut();
    });
  }

  unregisterShortcut(): void {
    globalShortcut.unregister(AUTO_TYPE_SHORTCUT);
  }

  setSelection(sessionId: string | null, entryId: string | null): void {
    this.selectedSessionId = sessionId;
    this.selectedEntryId = entryId;
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
          'Сначала выберите запись в PassDeck, затем перейдите в целевое окно и нажмите Ctrl+Alt+A.',
        );
      }

      const payload = this.databases.getAutoTypePayload(
        this.selectedSessionId,
        this.selectedEntryId,
      );
      const target = await readForegroundWindow();
      if (target.processId === process.pid) {
        throw new PassDeckError(
          'AUTO_TYPE_TARGET',
          'Перейдите в окно сайта или приложения и нажмите Ctrl+Alt+A ещё раз.',
        );
      }

      const actions = parseAutoTypeSequence(payload.sequence, payload);
      await sendActionsToWindow(target, actions);
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
