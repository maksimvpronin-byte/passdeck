import { Modal } from './Modal';

type ConfirmModalProps = {
  title: string;
  children: string;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConfirmModal({
  title,
  children,
  confirmLabel = 'Удалить',
  onCancel,
  onConfirm,
}: ConfirmModalProps) {
  return (
    <Modal title={title} onClose={onCancel}>
      <p className="confirm-text">{children}</p>
      <div className="form__actions">
        <button className="button button--ghost" type="button" onClick={onCancel}>
          Отмена
        </button>
        <button className="button button--danger" type="button" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
