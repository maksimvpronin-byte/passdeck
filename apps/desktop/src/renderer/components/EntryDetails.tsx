import type { EntrySummary } from '@passdeck/shared';

type RevealedSecret = {
  entryId: string;
  key: string;
  value: string;
} | null;

type EntryDetailsProps = {
  entry: EntrySummary | null;
  readOnly: boolean;
  revealed: RevealedSecret;
  onCopyUsername: (entry: EntrySummary) => void;
  onCopyUrl: (entry: EntrySummary) => void;
  onRevealPassword: (entry: EntrySummary) => void;
  onCopyPassword: (entry: EntrySummary) => void;
  onRevealCustomField: (entry: EntrySummary, key: string) => void;
  onCopyCustomField: (entry: EntrySummary, key: string) => void;
  onAddAttachments: (entry: EntrySummary) => void;
  onExportAttachment: (entry: EntrySummary, name: string) => void;
  onDeleteAttachment: (entry: EntrySummary, name: string) => void;
  onEdit: (entry: EntrySummary) => void;
  onDelete: (entry: EntrySummary) => void;
};

function formatFileSize(size: number): string {
  if (size < 1024) {
    return `${size} Б`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} КБ`;
  }
  return `${(size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} МБ`;
}

function DetailField({
  label,
  value,
  onCopy,
  onOpen,
}: {
  label: string;
  value: string;
  onCopy?: () => void;
  onOpen?: () => void;
}) {
  return (
    <div className="detail-field">
      <label>{label}</label>
      <div>
        <span className="truncate">{value}</span>
        {onOpen ? (
          <button type="button" onClick={onOpen} title="Открыть">
            ↗
          </button>
        ) : null}
        {onCopy && value !== '—' ? (
          <button type="button" onClick={onCopy} title="Копировать">
            ▣
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function EntryDetails({
  entry,
  readOnly,
  revealed,
  onCopyUsername,
  onCopyUrl,
  onRevealPassword,
  onCopyPassword,
  onRevealCustomField,
  onCopyCustomField,
  onAddAttachments,
  onExportAttachment,
  onDeleteAttachment,
  onEdit,
  onDelete,
}: EntryDetailsProps) {
  if (!entry) {
    return (
      <div className="details-placeholder">
        <div>◇</div>
        <h2>Выберите запись</h2>
        <p>Здесь появятся логин, URL, заметки и действия с паролем.</p>
      </div>
    );
  }

  return (
    <>
      <div className="details__header">
        <div className="entry-avatar entry-avatar--large">
          {entry.title.slice(0, 1).toLocaleUpperCase()}
        </div>
        <div>
          <span className="eyebrow">Запись</span>
          <h2>{entry.title}</h2>
        </div>
        {entry.favorite ? <span className="favorite favorite--large">★</span> : null}
      </div>

      <div className="field-stack">
        <DetailField
          label="Логин"
          value={entry.username || '—'}
          onCopy={() => onCopyUsername(entry)}
        />
        <div className="detail-field">
          <label>Пароль</label>
          <div className="secret-value">
            <code>
              {revealed?.entryId === entry.id && revealed.key === 'Password'
                ? revealed.value
                : '••••••••••••'}
            </code>
            <button
              type="button"
              onClick={() => onRevealPassword(entry)}
              title="Показать на 10 секунд"
            >
              ◉
            </button>
            <button type="button" onClick={() => onCopyPassword(entry)} title="Копировать пароль">
              ▣
            </button>
          </div>
        </div>
        <DetailField
          label="URL"
          value={entry.url || '—'}
          onCopy={() => onCopyUrl(entry)}
          {...(entry.url
            ? {
                onOpen: () => {
                  window.open(entry.url, '_blank', 'noopener,noreferrer');
                },
              }
            : {})}
        />
      </div>

      <section className="autotype-help">
        <div className="autotype-help-title">Auto-Type</div>
        <ol className="autotype-help-steps">
          <li>Выберите эту запись в PassDeck.</li>
          <li>Перейдите в поле логина сайта или приложения.</li>
          <li>Нажмите Ctrl+Alt+A на Windows или ⌘ Command + ⌥ Option + A на macOS.</li>
        </ol>
        <div className="autotype-help-sequence">
          PassDeck введёт: логин → Tab → пароль → Enter
        </div>
        <p className="autotype-help-note">
          PassDeck не активирует целевое окно сам. Перед нажатием горячей клавиши фокус должен быть
          уже в нужном поле.
        </p>
      </section>

      {entry.customFields.length > 0 ? (
        <section className="custom-fields-details">
          <div className="section-heading">
            <label>Пользовательские поля</label>
            <span>{entry.customFields.length}</span>
          </div>
          <div className="field-stack field-stack--custom">
            {entry.customFields.map((field) =>
              field.protected ? (
                <div className="detail-field" key={field.key}>
                  <label>
                    {field.key} <span className="protected-badge">Защищено</span>
                  </label>
                  <div className="secret-value">
                    <code>
                      {revealed?.entryId === entry.id && revealed.key === field.key
                        ? revealed.value || '—'
                        : field.hasValue
                          ? '••••••••••••'
                          : '—'}
                    </code>
                    <button
                      type="button"
                      onClick={() => onRevealCustomField(entry, field.key)}
                      title="Показать на 10 секунд"
                    >
                      ◉
                    </button>
                    <button
                      type="button"
                      onClick={() => onCopyCustomField(entry, field.key)}
                      title="Копировать значение"
                    >
                      ▣
                    </button>
                  </div>
                </div>
              ) : (
                <DetailField
                  key={field.key}
                  label={field.key}
                  value={field.value || '—'}
                  onCopy={() => onCopyCustomField(entry, field.key)}
                />
              ),
            )}
          </div>
        </section>
      ) : null}

      <section className="attachments-details">
        <div className="section-heading section-heading--actions">
          <div>
            <label>Вложения</label>
            <span>{entry.attachments.length}</span>
          </div>
          <button
            className="button button--ghost button--small"
            type="button"
            onClick={() => onAddAttachments(entry)}
            disabled={readOnly}
          >
            + Добавить
          </button>
        </div>
        {entry.attachments.length === 0 ? (
          <p className="attachments-empty">Вложений нет.</p>
        ) : (
          <div className="attachments-list">
            {entry.attachments.map((attachment) => (
              <div className="attachment-row" key={attachment.name}>
                <div className="attachment-row__icon">▧</div>
                <div className="attachment-row__main">
                  <strong title={attachment.name}>{attachment.name}</strong>
                  <span>{formatFileSize(attachment.size)}</span>
                </div>
                <button
                  type="button"
                  onClick={() => onExportAttachment(entry, attachment.name)}
                  title="Сохранить вложение"
                >
                  ↓
                </button>
                <button
                  className="attachment-row__delete"
                  type="button"
                  onClick={() => onDeleteAttachment(entry, attachment.name)}
                  title="Удалить вложение"
                  disabled={readOnly}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <small className="attachments-limit">До 25 МБ на файл и 100 МБ на запись.</small>
      </section>

      {entry.tags.length > 0 ? (
        <div className="tag-list">
          {entry.tags.map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
      ) : null}

      <section className="notes">
        <label>Заметки</label>
        <p>{entry.notes || 'Заметки отсутствуют.'}</p>
      </section>

      <div className="details__footer">
        <button
          className="button button--secondary"
          type="button"
          onClick={() => onEdit(entry)}
          disabled={readOnly}
        >
          Редактировать
        </button>
        <button
          className="button button--danger"
          type="button"
          onClick={() => onDelete(entry)}
          disabled={readOnly}
        >
          Удалить
        </button>
      </div>
    </>
  );
}
