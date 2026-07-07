import type { FormEvent } from 'react';
import type { EntrySummary, GroupSummary } from '@passdeck/shared';
import { Modal } from './Modal';

export type EditorCustomField = {
  id: string;
  key: string;
  value: string;
  protected: boolean;
  preserveValue: boolean;
  hasStoredValue: boolean;
  originalKey?: string;
};

export type EditorState = {
  entry?: EntrySummary;
  groupId: string;
  title: string;
  username: string;
  password: string;
  passwordVisible: boolean;
  passwordLoaded: boolean;
  url: string;
  notes: string;
  tags: string;
  favorite: boolean;
  expires: boolean;
  expiryTime: string;
  customFields: EditorCustomField[];
};

type EntryEditorModalProps = {
  editor: EditorState;
  groups: GroupSummary[];
  onEditorChange: (editor: EditorState) => void;
  onSubmit: (event: FormEvent) => void;
  onClose: () => void;
  onTogglePassword: () => void;
  onAddCustomField: () => void;
  onUpdateCustomField: (id: string, patch: Partial<Omit<EditorCustomField, 'id'>>) => void;
  onRemoveCustomField: (id: string) => void;
};

export function EntryEditorModal({
  editor,
  groups,
  onEditorChange,
  onSubmit,
  onClose,
  onTogglePassword,
  onAddCustomField,
  onUpdateCustomField,
  onRemoveCustomField,
}: EntryEditorModalProps) {
  return (
    <Modal
      title={editor.entry ? 'Редактирование записи' : 'Новая запись'}
      width={820}
      onClose={onClose}
    >
      <form className="form form--grid" onSubmit={onSubmit}>
        <label className="span-2">
          <span>Название</span>
          <input
            value={editor.title}
            onChange={(event) => onEditorChange({ ...editor, title: event.target.value })}
            autoFocus
          />
        </label>
        <label>
          <span>Логин</span>
          <input
            value={editor.username}
            onChange={(event) => onEditorChange({ ...editor, username: event.target.value })}
          />
        </label>
        <label>
          <span>Пароль</span>
          <div className="password-editor">
            <input
              type={editor.passwordVisible ? 'text' : 'password'}
              value={editor.password}
              placeholder={editor.entry && !editor.passwordLoaded ? '••••••••••••' : ''}
              onChange={(event) =>
                onEditorChange({
                  ...editor,
                  password: event.target.value,
                  passwordLoaded: true,
                })
              }
              autoComplete={editor.entry ? 'current-password' : 'new-password'}
            />
            <button
              className="password-editor__toggle"
              type="button"
              onClick={onTogglePassword}
              title={editor.passwordVisible ? 'Скрыть пароль' : 'Показать пароль'}
              aria-label={editor.passwordVisible ? 'Скрыть пароль' : 'Показать пароль'}
            >
              ◉
            </button>
          </div>
        </label>
        <label className="span-2">
          <span>URL</span>
          <input
            value={editor.url}
            onChange={(event) => onEditorChange({ ...editor, url: event.target.value })}
            placeholder="https://"
          />
        </label>
        <label className="span-2">
          <span>Теги через запятую</span>
          <input
            value={editor.tags}
            onChange={(event) => onEditorChange({ ...editor, tags: event.target.value })}
          />
        </label>
        <label className="span-2">
          <span>Группа</span>
          <select
            value={editor.groupId}
            onChange={(event) => onEditorChange({ ...editor, groupId: event.target.value })}
          >
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {'—'.repeat(group.depth)} {group.name}
              </option>
            ))}
          </select>
        </label>
        <label className="span-2">
          <span>Заметки</span>
          <textarea
            rows={6}
            value={editor.notes}
            onChange={(event) => onEditorChange({ ...editor, notes: event.target.value })}
          />
        </label>
        <section className="custom-fields-editor span-2">
          <div className="custom-fields-editor__header">
            <div>
              <span>Пользовательские поля</span>
              <small>Дополнительные поля записи KDBX</small>
            </div>
            <button className="button button--secondary" type="button" onClick={onAddCustomField}>
              + Добавить поле
            </button>
          </div>
          {editor.customFields.length === 0 ? (
            <p className="custom-fields-editor__empty">Дополнительных полей пока нет.</p>
          ) : (
            <div className="custom-fields-editor__list">
              {editor.customFields.map((field) => (
                <div className="custom-field-row" key={field.id}>
                  <label>
                    <span>Название</span>
                    <input
                      value={field.key}
                      onChange={(event) =>
                        onUpdateCustomField(field.id, { key: event.target.value })
                      }
                      placeholder="Например, API token"
                    />
                  </label>
                  <label>
                    <span>Значение</span>
                    <input
                      type={field.protected ? 'password' : 'text'}
                      value={field.value}
                      onChange={(event) =>
                        onUpdateCustomField(field.id, {
                          value: event.target.value,
                          preserveValue: false,
                        })
                      }
                      placeholder={
                        field.preserveValue && field.hasStoredValue
                          ? 'Сохранено — оставьте пустым, чтобы не менять'
                          : 'Введите значение'
                      }
                    />
                    {field.preserveValue && field.hasStoredValue ? (
                      <small className="form__hint">
                        Скрытое значение останется без изменений.
                      </small>
                    ) : null}
                  </label>
                  <label className="check custom-field-row__protected">
                    <input
                      type="checkbox"
                      checked={field.protected}
                      onChange={(event) =>
                        onUpdateCustomField(field.id, { protected: event.target.checked })
                      }
                    />
                    <span>Защищённое</span>
                  </label>
                  <button
                    className="icon-button custom-field-row__remove"
                    type="button"
                    onClick={() => onRemoveCustomField(field.id)}
                    title="Удалить поле"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
        <label className="check">
          <input
            type="checkbox"
            checked={editor.favorite}
            onChange={(event) => onEditorChange({ ...editor, favorite: event.target.checked })}
          />
          <span>Избранное</span>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={editor.expires}
            onChange={(event) => onEditorChange({ ...editor, expires: event.target.checked })}
          />
          <span>Срок действия</span>
        </label>
        {editor.expires ? (
          <label className="span-2">
            <span>Дата окончания</span>
            <input
              type="date"
              value={editor.expiryTime}
              onChange={(event) => onEditorChange({ ...editor, expiryTime: event.target.value })}
            />
          </label>
        ) : null}
        <div className="form__actions span-2">
          <button className="button button--ghost" type="button" onClick={onClose}>
            Отмена
          </button>
          <button className="button button--primary" type="submit">
            Сохранить запись
          </button>
        </div>
      </form>
    </Modal>
  );
}
