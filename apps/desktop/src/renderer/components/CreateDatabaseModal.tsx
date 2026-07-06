import type { FormEvent } from 'react';
import { Modal } from './Modal';

type CreateDatabaseModalProps = {
  targetPath: string;
  name: string;
  password: string;
  confirmPassword: string;
  onNameChange: (name: string) => void;
  onPasswordChange: (password: string) => void;
  onConfirmPasswordChange: (password: string) => void;
  onSubmit: (event: FormEvent) => void;
  onCancel: () => void;
};

export function CreateDatabaseModal({
  targetPath,
  name,
  password,
  confirmPassword,
  onNameChange,
  onPasswordChange,
  onConfirmPasswordChange,
  onSubmit,
  onCancel,
}: CreateDatabaseModalProps) {
  return (
    <Modal title="Новая база KDBX" onClose={onCancel}>
      <form className="form" onSubmit={onSubmit}>
        <div className="file-chip">{targetPath}</div>
        <label>
          <span>Название базы</span>
          <input value={name} onChange={(event) => onNameChange(event.target.value)} autoFocus />
        </label>
        <label>
          <span>Мастер-пароль</span>
          <input
            type="password"
            value={password}
            onChange={(event) => onPasswordChange(event.target.value)}
            autoComplete="new-password"
          />
        </label>
        <label>
          <span>Повторите пароль</span>
          <input
            type="password"
            value={confirmPassword}
            onChange={(event) => onConfirmPasswordChange(event.target.value)}
            autoComplete="new-password"
          />
        </label>
        <p className="form__hint">
          Минимум 8 символов. Восстановить забытый мастер-пароль невозможно.
        </p>
        <div className="form__actions">
          <button className="button button--ghost" type="button" onClick={onCancel}>
            Отмена
          </button>
          <button className="button button--primary" type="submit">
            Создать
          </button>
        </div>
      </form>
    </Modal>
  );
}
