import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { t } from '../lib/app-language';

export function AppToast({
  message,
  error = false,
  onClose,
}: {
  message: string;
  error?: boolean;
  onClose(): void;
}) {
  const [closing, setClosing] = useState(false);
  const dismiss = useRef(onClose);
  dismiss.current = onClose;
  useEffect(() => {
    setClosing(false);
    if (!message || error) return;
    const fade = window.setTimeout(() => setClosing(true), 4220);
    const close = window.setTimeout(() => dismiss.current(), 4500);
    return () => {
      window.clearTimeout(fade);
      window.clearTimeout(close);
    };
  }, [message, error]);
  if (!message) return null;
  return (
    <div
      className={`toast ${error ? 'error' : ''} ${closing ? 'closing' : ''}`}
      role={error ? 'alert' : 'status'}
    >
      <span>{t(message)}</span>
      <button type="button" aria-label={t('Закрыть сообщение')} onClick={onClose}>
        <X size={16} />
      </button>
    </div>
  );
}
