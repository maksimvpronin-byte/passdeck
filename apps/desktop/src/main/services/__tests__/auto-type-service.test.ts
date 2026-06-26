import { describe, expect, it } from 'vitest';
import { escapeSendKeysLiteral, parseAutoTypeSequence } from '../auto-type-sequence';

describe('Auto-Type sequence', () => {
  it('expands credentials, keys and bounded delays', () => {
    expect(
      parseAutoTypeSequence('{USERNAME}{TAB}{PASSWORD}{DELAY=9000}{ENTER}', {
        username: 'max',
        password: 'secret',
        url: 'https://example.test',
      }),
    ).toEqual([
      { kind: 'text', value: 'max' },
      { kind: 'key', value: 'TAB' },
      { kind: 'text', value: 'secret' },
      { kind: 'delay', milliseconds: 5000 },
      { kind: 'key', value: 'ENTER' },
    ]);
  });

  it('escapes SendKeys metacharacters without breaking line breaks', () => {
    expect(escapeSendKeysLiteral('a+b^(c)\n{x}')).toBe('a{+}b{^}{(}c{)}{ENTER}{{}x{}}');
  });
});
