import { Modal } from './Modal';

type ErrorModalProps = {
  error: string;
  onClose: () => void;
};

export function ErrorModal({ error, onClose }: ErrorModalProps) {
  return (
    <Modal title="Ошибка" onClose={onClose}>
      <pre className="error-text">{error}</pre>
      <div className="form__actions">
        <button className="button button--primary" type="button" onClick={onClose}>
          Закрыть
        </button>
      </div>
    </Modal>
  );
}
