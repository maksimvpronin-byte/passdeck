import type { ReactNode } from 'react';

interface ModalProps {
  title: string;
  children: ReactNode;
  onClose?: () => void;
  width?: number;
}

export function Modal({ title, children, onClose, width = 520 }: ModalProps) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="modal"
        style={{ maxWidth: width }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal__header">
          <div>
            <span className="eyebrow">PassDeck</span>
            <h2>{title}</h2>
          </div>
          {onClose ? (
            <button className="icon-button" type="button" onClick={onClose} aria-label="Закрыть">
              ×
            </button>
          ) : null}
        </header>
        <div className="modal__body">{children}</div>
      </section>
    </div>
  );
}
