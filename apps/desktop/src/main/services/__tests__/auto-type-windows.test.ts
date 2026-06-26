import { describe, expect, it } from 'vitest';

import {
  AUTO_TYPE_TARGET_CHANGED_MARKER,
  buildAutoTypeWindowsScript,
} from '../auto-type-windows';

describe('Windows Auto-Type target handling', () => {
  it('does not restore, resize or activate the target window', () => {
    const script = buildAutoTypeWindowsScript(12345, [
      { kind: 'text', value: 'max' },
      { kind: 'key', value: 'TAB' },
      { kind: 'text', value: 'secret' },
      { kind: 'key', value: 'ENTER' },
    ]);

    expect(script).toContain('GetForegroundWindow');
    expect(script).toContain(AUTO_TYPE_TARGET_CHANGED_MARKER);
    expect(script).not.toContain('ShowWindow');
    expect(script).not.toContain('SetForegroundWindow');
    expect(script).not.toContain('SW_RESTORE');
  });
});
