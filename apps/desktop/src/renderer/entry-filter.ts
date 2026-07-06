import type { EntrySummary } from '@passdeck/shared';

function searchableEntryValues(entry: EntrySummary): string[] {
  return [
    entry.title,
    entry.username,
    entry.url,
    entry.notes,
    entry.tags.join(' '),
    ...entry.customFields.map((field) =>
      field.protected ? field.key : `${field.key} ${field.value}`,
    ),
  ];
}

export function filterEntries(
  entries: EntrySummary[],
  selectedGroupId: string | null,
  search: string,
): EntrySummary[] {
  const query = search.trim().toLocaleLowerCase();

  return entries.filter((entry) => {
    if (selectedGroupId && entry.groupId !== selectedGroupId) {
      return false;
    }
    if (!query) {
      return true;
    }

    return searchableEntryValues(entry).some((value) =>
      value.toLocaleLowerCase().includes(query),
    );
  });
}
