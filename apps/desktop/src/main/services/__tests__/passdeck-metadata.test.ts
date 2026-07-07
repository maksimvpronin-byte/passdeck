import { describe, expect, it } from 'vitest';
import { PASSDECK_CUSTOM_DATA_KEYS } from '../passdeck-metadata';

describe('PassDeck metadata contract', () => {
  it('keeps the KDBX customData key set explicit', () => {
    expect(PASSDECK_CUSTOM_DATA_KEYS).toEqual([
      'PassDeck.Favorite',
      'PassDeck.AutoTypeEnabled',
      'PassDeck.AutoTypeSequence',
    ]);
  });
});
