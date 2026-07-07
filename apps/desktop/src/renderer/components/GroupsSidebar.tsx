import type { DragEvent } from 'react';
import type { DatabaseView, GroupSummary } from '@passdeck/shared';

type GroupsSidebarProps = {
  active: DatabaseView;
  selectedGroup: GroupSummary | null;
  selectedGroupId: string | null;
  dropTargetGroupId: string | null;
  entryCountByGroupId: Map<string, number>;
  basename: (filePath: string) => string;
  onSelectAll: () => void;
  onSelectGroup: (groupId: string) => void;
  onCreateGroup: () => void;
  onDeleteGroup: (group: GroupSummary) => void;
  onBeginGroupDrag: (event: DragEvent, groupId: string) => void;
  onEndDrag: () => void;
  onAllowTreeDrop: (event: DragEvent, groupId: string) => void;
  onGroupDragLeave: (groupId: string, relatedTarget: EventTarget | null) => void;
  onDropOnGroup: (event: DragEvent, groupId: string) => void;
};

export function GroupsSidebar({
  active,
  selectedGroup,
  selectedGroupId,
  dropTargetGroupId,
  entryCountByGroupId,
  basename,
  onSelectAll,
  onSelectGroup,
  onCreateGroup,
  onDeleteGroup,
  onBeginGroupDrag,
  onEndDrag,
  onAllowTreeDrop,
  onGroupDragLeave,
  onDropOnGroup,
}: GroupsSidebarProps) {
  return (
    <aside className="sidebar panel">
      <div className="panel__header">
        <div>
          <span className="eyebrow">Структура</span>
          <h2>Группы</h2>
        </div>
        <div className="panel__actions">
          <button
            className="icon-button"
            type="button"
            onClick={onCreateGroup}
            title="Новая группа"
            disabled={active.readOnly}
          >
            +
          </button>
          <button
            className="icon-button"
            type="button"
            onClick={() => selectedGroup && onDeleteGroup(selectedGroup)}
            title="Удалить группу"
            disabled={active.readOnly || !selectedGroup || selectedGroup.parentId === null}
          >
            ×
          </button>
        </div>
      </div>
      <div className="group-list">
        <button
          className={`group-row ${selectedGroupId === null ? 'group-row--active' : ''}`}
          type="button"
          onClick={onSelectAll}
        >
          <span>▦</span>
          <strong>Все записи</strong>
          <em>{active.entries.length}</em>
        </button>
        {active.groups.map((group) => (
          <button
            key={group.id}
            className={`group-row ${selectedGroupId === group.id ? 'group-row--active' : ''} ${
              dropTargetGroupId === group.id ? 'group-row--drop-target' : ''
            }`}
            style={{ paddingLeft: 14 + group.depth * 18 }}
            type="button"
            draggable={group.parentId !== null && !active.readOnly}
            onDragStart={(event) => onBeginGroupDrag(event, group.id)}
            onDragEnd={onEndDrag}
            onClick={() => onSelectGroup(group.id)}
            onDragEnter={(event) => onAllowTreeDrop(event, group.id)}
            onDragOver={(event) => onAllowTreeDrop(event, group.id)}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                onGroupDragLeave(group.id, event.relatedTarget);
              }
            }}
            onDrop={(event) => onDropOnGroup(event, group.id)}
          >
            <span>{group.depth === 0 ? '◇' : '›'}</span>
            <strong>{group.name}</strong>
            <em>{entryCountByGroupId.get(group.id) ?? 0}</em>
          </button>
        ))}
      </div>
      <div className="sidebar__footer">
        <span>{basename(active.path)}</span>
        <small>{active.readOnly ? 'Только чтение' : 'Локальный файл'}</small>
      </div>
    </aside>
  );
}
