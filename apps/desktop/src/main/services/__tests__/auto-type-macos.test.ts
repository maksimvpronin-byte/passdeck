import { describe, expect, it } from 'vitest';

import {
  AUTO_TYPE_MAC_SUCCESS_MARKER,
  AUTO_TYPE_MAC_TARGET_PID_PREFIX,
  AUTO_TYPE_MAC_TARGET_CHANGED_MARKER,
  buildAutoTypeMacOsScript,
  buildAutoTypeMacOsTargetScript,
} from '../auto-type-macos';

describe('macOS Auto-Type', () => {
  it('builds a target detection script without activating a window', () => {
    const script = buildAutoTypeMacOsTargetScript(12345);

    expect(script).toContain(
      "Application('/System/Library/CoreServices/System Events.app')",
    );
    expect(script).toContain('frontmost: true');
    expect(script).toContain('targetPid === 12345');
    expect(script).toContain(AUTO_TYPE_MAC_TARGET_PID_PREFIX);
    expect(script).not.toContain('.activate(');
    expect(script).not.toContain('frontmost = true');
  });

  it('builds target-checked paste input without embedding secrets', () => {
    const script = buildAutoTypeMacOsScript(12345, [
      { kind: 'text', value: 'max' },
      { kind: 'key', value: 'TAB' },
      { kind: 'text', value: 'secret+value' },
      { kind: 'delay', milliseconds: 250 },
      { kind: 'key', value: 'ENTER' },
    ]);

    expect(script).toContain(
      "Application('/System/Library/CoreServices/System Events.app')",
    );
    expect(script).toContain('frontmost: true');
    expect(script).toContain('const targetPid = 12345');
    expect(script).toContain("systemEvents.keystroke('v', { using: 'command down' })");
    expect(script).toContain('systemEvents.keyCode(48)');
    expect(script).toContain('systemEvents.keyCode(36)');
    expect(script).toContain(AUTO_TYPE_MAC_TARGET_CHANGED_MARKER);
    expect(script).toContain(AUTO_TYPE_MAC_SUCCESS_MARKER);
    expect(script).not.toContain('secret+value');
    expect(script).not.toContain('.activate(');
    expect(script).not.toContain('frontmost = true');
  });

  it('checks the target before every generated action', () => {
    const script = buildAutoTypeMacOsScript(1, [
      { kind: 'text', value: 'user' },
      { kind: 'key', value: 'TAB' },
      { kind: 'text', value: 'password' },
      { kind: 'key', value: 'ENTER' },
    ]);

    expect(script.match(/assertTarget\(\);/g)).toHaveLength(4);
  });
});
