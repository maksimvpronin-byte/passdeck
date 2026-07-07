import type { DragEvent } from 'react';
import type { EntrySummary } from '@passdeck/shared';

type EntryListProps = {
  entries: EntrySummary[];
  readOnly: boolean;
  search: string;
  selectedEntryId: string | null;
  draggingEntryId: string | null;
  dropTargetEntryId: string | null;
  onSearchChange: (search: string) => void;
  onForceReadWrite: () => void;
  onBeginEdit: () => void;
  onSave: () => void;
  onLock: () => void;
  onSelectEntry: (entryId: string) => void;
  onBeginEntryDrag: (event: DragEvent, entry: EntrySummary) => void;
  onEndDrag: () => void;
  onAllowEntryOrderDrop: (event: DragEvent, entry: EntrySummary) => void;
  onEntryDragLeave: (entryId: string, relatedTarget: EventTarget | null) => void;
  onDropEntryBefore: (event: DragEvent, entry: EntrySummary) => void;
};

export function EntryList({
  entries,
  readOnly,
  search,
  selectedEntryId,
  draggingEntryId,
  dropTargetEntryId,
  onSearchChange,
  onForceReadWrite,
  onBeginEdit,
  onSave,
  onLock,
  onSelectEntry,
  onBeginEntryDrag,
  onEndDrag,
  onAllowEntryOrderDrop,
  onEntryDragLeave,
  onDropEntryBefore,
}: EntryListProps) {
  return (
    <section className="entry-list panel">
      {readOnly ? (
        <div className="readonly-banner">
          <div>
            <strong>База открыта только для чтения</strong>
            <span>
              Найден lock-файл PassDeck. Если база не открыта в другом окне, можно открыть её на
              запись.
            </span>
          </div>
          <button className="button button--secondary" type="button" onClick={onForceReadWrite}>
            Открыть на запись
          </button>
        </div>
      ) : null}
      <div className="entry-toolbar">
        <label className="search-box">
          <span>⌕</span>
          <input
            id="search-input"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Поиск в текущей базе"
          />
          {search ? (
            <button type="button" onClick={() => onSearchChange('')}>
              ×
            </button>
          ) : null}
        </label>
        <button
          className="button button--primary"
          type="button"
          onClick={onBeginEdit}
          disabled={readOnly}
        >
          + Запись
        </button>
      </div>
      <div className="list-heading">
        <div>
          <span className="eyebrow">Записи</span>
          <h2>{entries.length} элементов</h2>
        </div>
        <div className="list-heading__actions">
          <button
            className="icon-button"
            type="button"
            onClick={onSave}
            title="Сохранить"
            disabled={readOnly}
          >
            ↓
          </button>
          <button className="icon-button" type="button" onClick={onLock} title="Заблокировать">
            ◈
          </button>
        </div>
      </div>
      <div className="entries">
        {entries.length === 0 ? (
          <div className="empty-state">
            <span>◇</span>
            <strong>Записей не найдено</strong>
            <p>Создайте новую запись или измените фильтр.</p>
          </div>
        ) : (
          entries.map((entry) => (
            <button
              key={entry.id}
              className={`entry-row ${selectedEntryId === entry.id ? 'entry-row--active' : ''} ${
                draggingEntryId === entry.id ? 'entry-row--dragging' : ''
              } ${dropTargetEntryId === entry.id ? 'entry-row--drop-target' : ''}`}
              type="button"
              draggable={!readOnly}
              onDragStart={(event) => onBeginEntryDrag(event, entry)}
              onDragEnd={onEndDrag}
              onDragEnter={(event) => onAllowEntryOrderDrop(event, entry)}
              onDragOver={(event) => onAllowEntryOrderDrop(event, entry)}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  onEntryDragLeave(entry.id, event.relatedTarget);
                }
              }}
              onDrop={(event) => onDropEntryBefore(event, entry)}
              onClick={() => onSelectEntry(entry.id)}
            >
              <div className="entry-avatar">{entry.title.slice(0, 1).toLocaleUpperCase()}</div>
              <div className="entry-row__main">
                <div>
                  <strong>{entry.title}</strong>
                  {entry.favorite ? <span className="favorite">★</span> : null}
                </div>
                <span>{entry.username || 'Логин не указан'}</span>
              </div>
              <div className="entry-row__meta">
                <span>{entry.url ? entry.url.replace(/^https?:\/\//, '').split('/')[0] : '—'}</span>
                {entry.tags.length > 0 ? <small>{entry.tags.slice(0, 2).join(' · ')}</small> : null}
              </div>
            </button>
          ))
        )}
      </div>
    </section>
  );
}
