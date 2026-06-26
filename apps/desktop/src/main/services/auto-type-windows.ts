import {
  escapeSendKeysLiteral,
  type AutoTypeAction,
} from './auto-type-sequence';

export const AUTO_TYPE_TARGET_CHANGED_MARKER =
  '__PASSDECK_TARGET_CHANGED__';

function textActionScript(value: string): string {
  const escaped = escapeSendKeysLiteral(value);
  const encoded = Buffer.from(escaped, 'utf8').toString('base64');

  return [
    `$text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))`,
    '[System.Windows.Forms.SendKeys]::SendWait($text)',
  ].join('\n');
}

export function buildAutoTypeWindowsScript(
  targetHandle: number,
  actions: AutoTypeAction[],
): string {
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

  return String.raw`
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;

public static class PassDeckNative {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
'@

$target = [IntPtr]::new(${targetHandle})
$current = [PassDeckNative]::GetForegroundWindow()

if ($current -ne $target) {
  Write-Output '${AUTO_TYPE_TARGET_CHANGED_MARKER}'
  exit 0
}

${actionScript}
`;
}
