import { describe, expect, it } from 'vitest';
import { normalizeAutoTypeSelection } from '../auto-type-selection';

describe('Auto-Type selection', () => {
  it('keeps complete selections', () => {
    expect(normalizeAutoTypeSelection({ sessionId: 'session-1', entryId: 'entry-1' })).toEqual({
      sessionId: 'session-1',
      entryId: 'entry-1',
    });
  });

  it('clears partial selections', () => {
    expect(normalizeAutoTypeSelection({ sessionId: 'session-1', entryId: null })).toEqual({
      sessionId: null,
      entryId: null,
    });
    expect(normalizeAutoTypeSelection({ sessionId: null, entryId: 'entry-1' })).toEqual({
      sessionId: null,
      entryId: null,
    });
  });
});
