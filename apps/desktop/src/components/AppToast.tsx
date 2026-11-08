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
  const timers = useRef<number[]>([]);
  dismiss.current = onClose;
  useEffect(() => {
    setClosing(false);
    if (message && !error)
      timers.current = [
        window.setTimeout(() => setClosing(true), 4220),
        window.setTimeout(() => dismiss.current(), 4500),
      ];
    return () => {
      timers.current.forEach(window.clearTimeout);
      timers.current = [];
    };
  }, [message, error]);
  const close = () => {
    timers.current.forEach(window.clearTimeout);
    setClosing(true);
    timers.current = [window.setTimeout(() => dismiss.current(), 280)];
  };
  if (!message) return null;
  return (
    <div
      className={`toast ${error ? 'error' : ''} ${closing ? 'closing' : ''}`}
      role={error ? 'alert' : 'status'}
    >
      <span>{t(message)}</span>
      <button type="button" aria-label={t('Закрыть сообщение')} onClick={close}>
        <X size={16} />
      </button>
    </div>
  );
}
