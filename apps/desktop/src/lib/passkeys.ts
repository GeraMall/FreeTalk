import { invoke } from '@tauri-apps/api/core';
import { accountClient } from './api-client';

export function openPasskeyBrowser(challenge?: string) {
  return invoke('open_passkey_browser', { challenge: challenge ?? null });
}

export async function signInWithPasskey(desktopChallenge?: string) {
  const { startAuthentication } = await import('@simplewebauthn/browser');
  const { state, options } = await accountClient.startPasskeyLogin(desktopChallenge);
  const response = await startAuthentication({ optionsJSON: options });
  return accountClient.finishPasskeyLogin(state, response);
}
