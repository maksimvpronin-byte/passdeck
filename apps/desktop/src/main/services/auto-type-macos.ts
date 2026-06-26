import { spawn } from 'node:child_process';

import type { AutoTypeAction } from './auto-type-sequence';

export const AUTO_TYPE_MAC_SUCCESS_MARKER = '__PASSDECK_AUTOTYPE_OK__';
export const AUTO_TYPE_MAC_TARGET_CHANGED_MARKER =
  '__PASSDECK_TARGET_CHANGED__';
export const AUTO_TYPE_MAC_SELF_TARGET_MARKER = '__PASSDECK_SELF_TARGET__';
export const AUTO_TYPE_MAC_NO_TARGET_MARKER = '__PASSDECK_NO_TARGET__';

const MAX_OUTPUT_BYTES = 1024 * 1024;
const SCRIPT_TIMEOUT_MS = 15_000;

function encodedText(value: string): string {
  return JSON.stringify(Buffer.from(value, 'utf8').toString('base64'));
}

function actionScript(action: AutoTypeAction): string {
  if (action.kind === 'text') {
    return [
      'assertTarget();',
      `systemEvents.keystroke(decodeBase64(${encodedText(action.value)}));`,
    ].join('\n');
  }

  if (action.kind === 'delay') {
    return [
      'assertTarget();',
      `delay(${(action.milliseconds / 1000).toFixed(3)});`,
    ].join('\n');
  }

  const keyCode = action.value === 'TAB' ? 48 : 36;
  return ['assertTarget();', `systemEvents.keyCode(${keyCode});`].join('\n');
}

export function buildAutoTypeMacOsScript(
  passDeckProcessId: number,
  actions: AutoTypeAction[],
): string {
  const actionLines = actions
    .map(actionScript)
    .join('\ndelay(0.04);\n');

  return String.raw`
ObjC.import('Foundation');

const systemEvents = Application('System Events');
let targetPid = 0;

function decodeBase64(value) {
  const data = $.NSData.alloc.initWithBase64EncodedStringOptions(value, 0);
  const text = $.NSString.alloc.initWithDataEncoding(
    data,
    $.NSUTF8StringEncoding,
  );
  return ObjC.unwrap(text);
}

function frontmostPid() {
  const processes = systemEvents.applicationProcesses.whose({
    frontmost: true,
  })();

  if (!processes || processes.length === 0) {
    return 0;
  }

  return Number(processes[0].unixId());
}

function assertTarget() {
  if (frontmostPid() !== targetPid) {
    throw new Error('${AUTO_TYPE_MAC_TARGET_CHANGED_MARKER}');
  }
}

function run() {
  targetPid = frontmostPid();

  if (!targetPid) {
    return '${AUTO_TYPE_MAC_NO_TARGET_MARKER}';
  }

  if (targetPid === ${passDeckProcessId}) {
    return '${AUTO_TYPE_MAC_SELF_TARGET_MARKER}';
  }

  delay(0.08);

  if (frontmostPid() !== targetPid) {
    return '${AUTO_TYPE_MAC_TARGET_CHANGED_MARKER}';
  }

  try {
${actionLines
  .split('\n')
  .map((line) => `    ${line}`)
  .join('\n')}
  } catch (error) {
    if (String(error).includes('${AUTO_TYPE_MAC_TARGET_CHANGED_MARKER}')) {
      return '${AUTO_TYPE_MAC_TARGET_CHANGED_MARKER}';
    }
    throw error;
  }

  return '${AUTO_TYPE_MAC_SUCCESS_MARKER}';
}
`;
}

export function runAutoTypeMacOsScript(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/osascript', ['-l', 'JavaScript'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (error?: Error): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);

      if (error) {
        reject(error);
      } else {
        resolve(stdout.trim());
      }
    };

    const append = (current: string, chunk: Buffer | string): string => {
      const next = current + chunk.toString();
      if (Buffer.byteLength(next, 'utf8') > MAX_OUTPUT_BYTES) {
        child.kill('SIGKILL');
        finish(new Error('Вывод macOS Auto-Type превысил допустимый размер.'));
      }
      return next;
    };

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout = append(stdout, chunk);
    });

    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr = append(stderr, chunk);
    });

    child.on('error', (error) => finish(error));

    child.on('close', (code) => {
      if (code === 0) {
        finish();
        return;
      }

      finish(
        new Error(
          stderr.trim() ||
            `osascript завершился с кодом ${code ?? 'unknown'}.`,
        ),
      );
    });

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new Error('macOS Auto-Type превысил лимит времени.'));
    }, SCRIPT_TIMEOUT_MS);
    timer.unref();

    child.stdin.end(script, 'utf8');
  });
}
