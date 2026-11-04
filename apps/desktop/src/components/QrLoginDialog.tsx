import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, QrCode, X } from 'lucide-react';
import { accountClient, type AccountUser } from '../lib/api-client';
import { t } from '../lib/app-language';

const qrPrefix = 'trlka:qr-login:v1:';

function QrDialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose(): void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  return createPortal(
    <dialog
      ref={dialog}
      className="qr-auth-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header>
        <QrCode size={21} aria-hidden="true" />
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="icon-button" aria-label={t('Закрыть')} onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      <div className="qr-auth-content">{children}</div>
    </dialog>,
    document.body,
  );
}

export function QrLoginDialog({
  onClose,
  onLogin,
}: {
  onClose(): void;
  onLogin(user: AccountUser): Promise<void>;
}) {
  const [attempt, setAttempt] = useState(0);
  const [qr, setQr] = useState<{ image: string; code: string }>();
  const [status, setStatus] = useState<'loading' | 'waiting' | 'expired' | 'failed'>('loading');
  const finishLogin = useRef(onLogin);
  useEffect(() => {
    finishLogin.current = onLogin;
  }, [onLogin]);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    let timer = 0;

    async function start() {
      try {
        const { challenge, pollToken, expiresIn } = await accountClient.startQrLogin(signal);
        const { toDataURL } = await import('qrcode');
        const image = await toDataURL(qrPrefix + challenge, { width: 240, margin: 3 });
        if (signal.aborted) return;
        const expires = Date.now() + expiresIn * 1000;
        setQr({ image, code: challenge.slice(0, 5).toUpperCase() });
        setStatus('waiting');

        const poll = async () => {
          if (signal.aborted) return;
          try {
            const result = await accountClient.redeemQrLogin(pollToken, signal);
            if (signal.aborted) return;
            if (result.status === 'approved') {
              await finishLogin.current(result.user);
            } else if (result.status === 'expired' || Date.now() >= expires) {
              setStatus('expired');
            } else {
              timer = window.setTimeout(poll, 2000);
            }
          } catch {
            if (!signal.aborted) {
              if (Date.now() >= expires) setStatus('expired');
              else timer = window.setTimeout(poll, 3000);
            }
          }
        };
        timer = window.setTimeout(poll, 1000);
      } catch {
        if (!signal.aborted) setStatus('failed');
      }
    }

    void start();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [attempt]);

  return (
    <QrDialog title={t('Вход по QR-коду')} onClose={onClose}>
      {status === 'loading' && <p role="status">{t('Создаём QR-код…')}</p>}
      {status === 'waiting' && qr && (
        <>
          <p>{t('Откройте настройки TRLKA на телефоне и нажмите «Сканировать QR для входа».')}</p>
          <img className="qr-auth-code" src={qr.image} alt={t('QR-код для входа')} />
          <p>
            {t('Код сверки')} <strong className="qr-auth-match">{qr.code}</strong>
          </p>
        </>
      )}
      {(status === 'expired' || status === 'failed') && (
        <>
          <p role="alert">
            {status === 'expired'
              ? t('Срок действия QR-кода истёк.')
              : t('Не удалось создать QR-код.')}
          </p>
          <button
            type="button"
            className="primary"
            onClick={() => {
              setStatus('loading');
              setAttempt((value) => value + 1);
            }}
          >
            {t('Получить новый QR-код')}
          </button>
        </>
      )}
    </QrDialog>
  );
}

export function QrScanDialog({ onClose }: { onClose(): void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [challenge, setChallenge] = useState('');
  const [cameraError, setCameraError] = useState(false);
  const [approveError, setApproveError] = useState(false);
  const [approving, setApproving] = useState(false);
  const [approved, setApproved] = useState(false);

  useEffect(() => {
    if (challenge) return;
    const preview = video.current;
    if (!preview) return;
    let stream: MediaStream | undefined;
    let stopped = false;
    let frame = 0;

    async function scan() {
      try {
        const { default: decodeQr } = await import('jsqr');
        if (stopped || !preview) return;
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' } },
        });
        if (stopped) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        preview.srcObject = stream;
        await preview.play();
        if (stopped) return;
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw Error('Canvas unavailable');

        const readFrame = () => {
          if (preview.videoWidth > 0 && preview.videoHeight > 0) {
            const scale = Math.min(1, 640 / Math.max(preview.videoWidth, preview.videoHeight));
            canvas.width = Math.round(preview.videoWidth * scale);
            canvas.height = Math.round(preview.videoHeight * scale);
            context.drawImage(preview, 0, 0, canvas.width, canvas.height);
            const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
            const qr = decodeQr(pixels.data, pixels.width, pixels.height, {
              inversionAttempts: 'dontInvert',
            });
            if (qr?.data.startsWith(qrPrefix)) {
              const token = qr.data.slice(qrPrefix.length);
              if (/^[A-Za-z0-9_-]{43}$/.test(token)) {
                setChallenge(token);
                return;
              }
            }
          }
          frame = window.setTimeout(readFrame, 180);
        };
        readFrame();
      } catch {
        stream?.getTracks().forEach((track) => track.stop());
        if (!stopped) setCameraError(true);
      }
    }
    void scan();
    return () => {
      stopped = true;
      window.clearTimeout(frame);
      stream?.getTracks().forEach((track) => track.stop());
      preview.srcObject = null;
    };
  }, [challenge]);

  async function approve() {
    setApproving(true);
    setApproveError(false);
    try {
      await accountClient.approveQrLogin(challenge);
      setApproved(true);
    } catch {
      setApproveError(true);
    } finally {
      setApproving(false);
    }
  }

  return (
    <QrDialog title={t('Сканировать QR для входа')} onClose={onClose}>
      {approved ? (
        <p className="qr-auth-approved" role="status">
          <Check size={18} /> {t('Вход на компьютере подтверждён.')}
        </p>
      ) : challenge ? (
        <>
          <p>{t('Сверьте код на своём компьютере и подтвердите вход.')}</p>
          <strong className="qr-auth-match">{challenge.slice(0, 5).toUpperCase()}</strong>
          {approveError && (
            <p role="alert">
              {t('Не удалось подтвердить вход. Откройте новый QR-код на компьютере.')}
            </p>
          )}
          <button
            type="button"
            className="primary"
            disabled={approving || approveError}
            onClick={() => void approve()}
          >
            {t('Подтвердить вход')}
          </button>
          {approveError && (
            <button
              type="button"
              className="qr-login-trigger"
              onClick={() => {
                setApproveError(false);
                setChallenge('');
              }}
            >
              {t('Сканировать снова')}
            </button>
          )}
        </>
      ) : cameraError ? (
        <p role="alert">
          {t('Камера недоступна. Разрешите доступ к камере и откройте сканер снова.')}
        </p>
      ) : (
        <>
          <p>{t('Наведите камеру на QR-код на экране компьютера.')}</p>
          <video ref={video} className="qr-auth-camera" muted playsInline autoPlay />
        </>
      )}
    </QrDialog>
  );
}
