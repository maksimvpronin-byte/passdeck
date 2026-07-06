import type { FormEvent } from 'react';
import { Modal } from './Modal';

type UnlockDatabaseModalProps = {
  databaseName: string;
  password: string;
  onPasswordChange: (password: string) => void;
  onSubmit: (event: FormEvent) => void;
  onCancel: () => void;
};

export function UnlockDatabaseModal({
  databaseName,
  password,
  onPasswordChange,
  onSubmit,
  onCancel,
}: UnlockDatabaseModalProps) {
  return (
    <Modal title="Разблокировка базы" onClose={onCancel}>
      <form className="form" onSubmit={onSubmit}>
        <div className="file-chip">{databaseName}</div>
        <label>
          <span>Мастер-пароль</span>
          <input
            type="password"
            value={password}
            onChange={(event) => onPasswordChange(event.target.value)}
            autoFocus
            autoComplete="current-password"
            placeholder="Введите мастер-пароль"
          />
        </label>
        <div className="form__actions">
          <button className="button button--ghost" type="button" onClick={onCancel}>
            Отмена
          </button>
          <button className="button button--primary" type="submit" disabled={!password}>
            Открыть
          </button>
        </div>
      </form>
    </Modal>
  );
}
