import { signInWithPasskey, openPasskeyBrowser } from '../lib/passkeys';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, QrCode, X } from 'lucide-react';
import { accountClient, type AccountUser } from '../lib/api-client';
import { t } from '../lib/app-language';
import mascot from '../../src-tauri/icons/app-icon-source.png';

const qrPrefix = 'trlka:qr-login:v1:';
const qrRefreshMs = 30_000;

async function renderLoginQr(challenge: string) {
  const { toCanvas } = await import('qrcode');
  const canvas = document.createElement('canvas');
  const ink = '#000000';
  const paper = '#ffffff';
  await toCanvas(canvas, qrPrefix + challenge, {
    scale: 5,
    margin: 4,
    errorCorrectionLevel: 'H',
    color: { dark: ink, light: paper },
  });

  const logo = new Image();
  logo.src = mascot;
  await logo.decode();
  const mark = document.createElement('canvas');
  mark.width = mark.height = 43;
  const markContext = mark.getContext('2d');
  const context = canvas.getContext('2d');
  if (!context || !markContext) throw new Error('QR canvas unavailable');

  markContext.drawImage(logo, 0, 0, mark.width, mark.height);
  const image = markContext.getImageData(0, 0, mark.width, mark.height);
  // Keep the emblem while removing the original icon tile.
  for (let index = 0; index < image.data.length; index += 4) {
    const lightness = Math.max(image.data[index], image.data[index + 1], image.data[index + 2]);
    const alpha = Math.max(0, Math.min(1, (lightness - 124) / 110));
    image.data[index + 3] *= alpha;
  }
  markContext.putImageData(image, 0, 0);
  markContext.globalCompositeOperation = 'source-in';
  markContext.fillStyle = paper;
  markContext.fillRect(0, 0, mark.width, mark.height);

  const center = Math.floor(canvas.width / 2);
  context.beginPath();
  context.arc(center, center, 23, 0, 2 * Math.PI);
  context.fillStyle = paper;
  context.fill();
  context.beginPath();
  context.arc(center, center, 19, 0, 2 * Math.PI);
  context.fillStyle = ink;
  context.fill();
  const markOffset = Math.floor(mark.width / 2);
  context.drawImage(mark, center - markOffset, center - markOffset);
  return canvas.toDataURL('image/png');
}

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

export function QrLoginSection({ onLogin }: { onLogin(user: AccountUser): Promise<void> }) {
  const [attempt, setAttempt] = useState(0);
  const [qr, setQr] = useState<{ image: string; challenge: string; code: string }>();
  const [status, setStatus] = useState<'loading' | 'waiting' | 'expired' | 'failed'>('loading');
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [passkeyStatus, setPasskeyStatus] = useState('');
  const desktop = '__TAURI_INTERNALS__' in window;
  const finishLogin = useRef(onLogin);
  useEffect(() => {
    finishLogin.current = onLogin;
  }, [onLogin]);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    // Keep recently scanned codes redeemable until their server expiration.
    const requests: { token: string; expiresAt: number }[] = [];
    let rotateTimer = 0;
    let pollTimer = 0;
    let visibleUntil = 0;
    let finished = false;

    async function rotate() {
      if (document.hidden) {
        rotateTimer = window.setTimeout(rotate, 5_000);
        return;
      }
      const startedAt = Date.now();
      try {
        const { challenge, pollToken, expiresIn } = await accountClient.startQrLogin(signal);
        const image = await renderLoginQr(challenge);
        if (signal.aborted || finished) return;
        visibleUntil = startedAt + expiresIn * 1000;
        requests.push({ token: pollToken, expiresAt: visibleUntil });
        setQr({ image, challenge, code: challenge.slice(0, 5).toUpperCase() });
        setStatus('waiting');
        rotateTimer = window.setTimeout(
          rotate,
          Math.max(0, qrRefreshMs - (Date.now() - startedAt)),
        );
        if (!pollTimer) pollTimer = window.setTimeout(poll, 1000);
      } catch {
        if (signal.aborted || finished) return;
        if (Date.now() >= visibleUntil) {
          setStatus(visibleUntil ? 'expired' : 'failed');
        } else {
          rotateTimer = window.setTimeout(rotate, 5000);
        }
      }
    }

    async function poll() {
      if (signal.aborted || finished) return;
      let request = requests.shift();
      while (request && request.expiresAt <= Date.now()) request = requests.shift();
      if (request) {
        try {
          const result = await accountClient.redeemQrLogin(request.token, signal);
          if (signal.aborted) return;
          if (result.status === 'approved') {
            finished = true;
            window.clearTimeout(rotateTimer);
            await finishLogin.current(result.user);
            return;
          }
          if (result.status === 'pending') requests.push(request);
        } catch {
          if (signal.aborted) return;
          if (finished) {
            setStatus('failed');
            return;
          }
          requests.push(request);
        }
      }
      if (!requests.length && Date.now() >= visibleUntil) setStatus('expired');
      pollTimer = window.setTimeout(poll, 1500);
    }

    void rotate();
    return () => {
      controller.abort();
      window.clearTimeout(rotateTimer);
      window.clearTimeout(pollTimer);
    };
  }, [attempt]);

  async function passkeyLogin() {
    setPasskeyBusy(true);
    setPasskeyStatus('');
    try {
      if (desktop && qr) {
        await openPasskeyBrowser(qr.challenge);
        setPasskeyStatus(t('Сверьте код {p0} в браузере и подтвердите вход.', { p0: qr.code }));
      } else if (!desktop) {
        const user = await signInWithPasskey();
        if (user) await onLogin(user);
      }
    } catch {
      setPasskeyStatus(t('Не удалось войти с помощью ключа доступа.'));
    } finally {
      setPasskeyBusy(false);
    }
  }

  return (
    <section className="qr-auth-content qr-login-section" aria-labelledby="qr-login-title">
      <h2 id="qr-login-title">{t('Войти с помощью QR-кода')}</h2>
      <p>
        {t('Сканируйте код с помощью мобильного приложения TRLKA, чтобы сразу войти в систему.')}
      </p>
      <div className="qr-login-visual">
        {' '}
        {status === 'loading' && <p role="status">{t('Создаём QR-код…')}</p>}
        {status === 'waiting' && qr && (
          <>
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
      </div>
      <button
        className="text-action passkey-login-link"
        type="button"
        disabled={passkeyBusy || (desktop && status !== 'waiting')}
        onClick={() => void passkeyLogin()}
      >
        {t('Или войти с помощью ключа доступа')}
      </button>
      {passkeyStatus && <p role="status">{passkeyStatus}</p>}
    </section>
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
