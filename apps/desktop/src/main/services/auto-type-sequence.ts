import { DEFAULT_AUTO_TYPE_SEQUENCE } from '@passdeck/shared';

export type AutoTypeAction =
  | { kind: 'text'; value: string }
  | { kind: 'key'; value: 'TAB' | 'ENTER' }
  | { kind: 'delay'; milliseconds: number };

export function escapeSendKeysLiteral(value: string): string {
  return value
    .split(/\r\n|\r|\n/)
    .map((part) => part.replace(/[+^%~()[\]{}]/g, (character) => `{${character}}`))
    .join('{ENTER}');
}

export function parseAutoTypeSequence(
  sequence: string,
  values: { username: string; password: string; url: string },
): AutoTypeAction[] {
  const source = (sequence.trim() || DEFAULT_AUTO_TYPE_SEQUENCE).slice(0, 500);
  const tokenPattern = /\{(USERNAME|PASSWORD|URL|TAB|ENTER|DELAY(?:=|:)\d+)\}/gi;
  const actions: AutoTypeAction[] = [];
  let cursor = 0;

  for (const match of source.matchAll(tokenPattern)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      actions.push({ kind: 'text', value: source.slice(cursor, index) });
    }

    const token = match[1]?.toUpperCase() ?? '';
    if (token === 'USERNAME') {
      actions.push({ kind: 'text', value: values.username });
    } else if (token === 'PASSWORD') {
      actions.push({ kind: 'text', value: values.password });
    } else if (token === 'URL') {
      actions.push({ kind: 'text', value: values.url });
    } else if (token === 'TAB' || token === 'ENTER') {
      actions.push({ kind: 'key', value: token });
    } else if (token.startsWith('DELAY')) {
      const milliseconds = Number(token.split(/[=:]/)[1]);
      actions.push({
        kind: 'delay',
        milliseconds: Number.isFinite(milliseconds)
          ? Math.min(5000, Math.max(0, Math.trunc(milliseconds)))
          : 0,
      });
    }
    cursor = index + match[0].length;
  }

  if (cursor < source.length) {
    actions.push({ kind: 'text', value: source.slice(cursor) });
  }

  return actions.filter((action) => action.kind !== 'text' || action.value.length > 0);
}
