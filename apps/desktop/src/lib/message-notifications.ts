import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';

function isTauriDesktop() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function appIsInForeground() {
  return document.visibilityState === 'visible' && document.hasFocus();
}

export async function prepareMessageNotifications() {
  if (!isTauriDesktop()) return false;
  try {
    if (await isPermissionGranted()) return true;
    return (await requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

export async function showMessageNotification(senderName: string, body: string) {
  if (!isTauriDesktop() || appIsInForeground()) return false;
  if (!(await prepareMessageNotifications())) return false;
  sendNotification({
    title: senderName,
    body: body.length > 180 ? `${body.slice(0, 177)}…` : body,
  });
  return true;
}
