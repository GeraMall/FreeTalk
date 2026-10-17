import { accountClient, type BrowserPushSubscription } from './api-client';

function isTauri() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function isMobileWebClient() {
  return (
    !isTauri() && /Android|iPhone|iPad|iPod|Mobile|IEMobile|Opera Mini/i.test(navigator.userAgent)
  );
}

export function browserPushSupported() {
  return (
    isMobileWebClient() &&
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window
  );
}

function decodeApplicationServerKey(value: string) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

function subscriptionPayload(subscription: PushSubscription): BrowserPushSubscription {
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth)
    throw new Error('Браузер не вернул данные подписки на уведомления');
  return {
    endpoint: json.endpoint,
    expirationTime: json.expirationTime,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
  };
}

export async function enableBrowserPush() {
  if (!browserPushSupported()) throw new Error('Уведомления не поддерживаются этим браузером');
  const permission =
    Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Разрешение на уведомления не предоставлено');

  const registration = await navigator.serviceWorker.register(
    `${import.meta.env.BASE_URL}service-worker.js`,
    { scope: import.meta.env.BASE_URL },
  );
  await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeApplicationServerKey(
        (await accountClient.webPushPublicKey()).publicKey,
      ),
    }));
  await accountClient.registerWebPushSubscription(subscriptionPayload(subscription));
  return subscription;
}

export async function restoreBrowserPush() {
  if (!browserPushSupported() || Notification.permission !== 'granted') return false;
  await enableBrowserPush();
  return true;
}
