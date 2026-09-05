import { AlertTriangle, X } from 'lucide-react';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';

export function ChatActionConfirmDialog({
  title,
  description,
  confirmLabel,
  busy = false,
  error,
  onCancel,
  onConfirm,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  busy?: boolean;
  error?: string;
  onCancel(): void;
  onConfirm(): void;
}) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [busy, onCancel]);

  return createPortal(
    <div
      className="chat-confirm-backdrop"
      onPointerDown={(event) => event.target === event.currentTarget && !busy && onCancel()}
    >
      <section
        className="chat-confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="chat-confirm-title"
        aria-describedby="chat-confirm-description"
      >
        <header>
          <span className="chat-confirm-icon" aria-hidden="true">
            <AlertTriangle />
          </span>
          <div>
            <h2 id="chat-confirm-title">{title}</h2>
            <p id="chat-confirm-description">{description}</p>
          </div>
          <button type="button" aria-label="Закрыть" disabled={busy} onClick={onCancel}>
            <X />
          </button>
        </header>
        {error ? <small className="chat-confirm-error">{error}</small> : null}
        <footer>
          <button type="button" className="secondary" disabled={busy} onClick={onCancel}>
            Отмена
          </button>
          <button type="button" className="destructive" disabled={busy} onClick={onConfirm}>
            {busy ? 'Подождите…' : confirmLabel}
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
