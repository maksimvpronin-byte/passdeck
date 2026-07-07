import type { AutoTypeSelection } from '@passdeck/shared';

export function normalizeAutoTypeSelection(selection: AutoTypeSelection): AutoTypeSelection {
  if (!selection.sessionId || !selection.entryId) {
    return { sessionId: null, entryId: null };
  }

  return selection;
}
