import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SettingsPanel, type SettingsTab } from './components/SettingsPanel';
import { AppTooltips } from './components/AppTooltips';
import { accountClient, ApiError, type AccountUser } from './lib/api-client';
import { defaultSettings, type LocalSettings } from './lib/settings';
import { interfaceTheme } from './lib/interface-theme';
import { appLanguage, t } from './lib/app-language';
import { installInteractionGuards } from './lib/interaction-guards';
import { installMobileViewport } from './lib/mobile-viewport';
import { createNativeSettingsBridge } from './lib/native-settings-bridge';
import type { UpdateStatus } from './lib/updater';
import './styles.css';
import './profile-panel.css';
import './gif-library.css';
import './theme-steel.css';
import './chat-theme.css';
import './control-motion.css';
import './interface-themes.css';
import './android-settings.css';

interface Bootstrap {
  user: AccountUser;
  settings: Partial<LocalSettings>;
  theme: 'default' | 'light' | 'black';
  language: string;
  version: string;
  initialTab?: SettingsTab;
  showQrShortcut?: boolean;
  devices: { inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[]; cameras: MediaDeviceInfo[] };
  cameraFacing: Record<string, 'user' | 'environment'>;
}

const host = createNativeSettingsBridge();

// The Android view owns authentication. No session or bearer token enters JavaScript.
accountClient.request = async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
  if (init.body !== undefined && typeof init.body !== 'string')
    throw new ApiError('INVALID_REQUEST', 'Неподдерживаемый запрос.', 400);
  return host.request<T>('api', {
    path,
    method: init.method ?? 'GET',
    body: init.body ? JSON.parse(init.body as string) : undefined,
  });
};
window.TRLKASettingsHost = host;

export function SharedAndroidSettings({ initial }: { initial: Bootstrap }) {
  const [user, setUser] = useState(initial.user);
  const [settings, setSettings] = useState<LocalSettings>(() => ({
    ...defaultSettings(),
    ...initial.settings,
    displayName: initial.user.displayName,
    avatarDataUrl: initial.user.avatarUrl ?? '',
  }));
  const [update, setUpdate] = useState<UpdateStatus>({ kind: 'idle' });
  const [notice, setNotice] = useState('');
  const [inputLevel, setInputLevel] = useState(0);
  const [qrVisible, setQrVisible] = useState(initial.showQrShortcut ?? true);
  const [savingQr, setSavingQr] = useState(false);
  useEffect(() => {
    let frame = requestAnimationFrame(function painted() {
      const bounds = document.querySelector('.settings-modal')?.getBoundingClientRect();
      if (!bounds || bounds.height < 100) frame = requestAnimationFrame(painted);
      else
        frame = requestAnimationFrame(() => {
          void host.request('ui.ready');
        });
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => {
      void host
        .request<number>('level')
        .then(setInputLevel)
        .catch(() => {});
    }, 400);
    return () => clearInterval(timer);
  }, []);
  function apply(patch: Partial<LocalSettings>) {
    const previous = settings;
    setSettings((current) => ({ ...current, ...patch }));
    void host.request('settings', patch).catch((error) => {
      setSettings((current) => ({
        ...current,
        ...Object.fromEntries(
          Object.keys(patch).map((key) => [key, previous[key as keyof LocalSettings]]),
        ),
      }));
      setNotice(error.message);
    });
  }
  async function setQrShortcut(visible: boolean) {
    setSavingQr(true);
    try {
      await host.request('qr.shortcut', { visible });
      setQrVisible(visible);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t('Не удалось сохранить настройки'));
    } finally {
      setSavingQr(false);
    }
  }
  return (
    <>
      <SettingsPanel
        initialTab={initial.initialTab}
        accountUser={user}
        settings={settings}
        devices={initial.devices}
        inputLevel={inputLevel}
        appVersion={initial.version}
        updateStatus={update}
        turnAvailable
        outputSupported
        nativeAndroid
        guestMode={false}
        onClose={() => {
          void host.request('close');
        }}
        onInput={(inputDeviceId) => apply({ inputDeviceId })}
        onOutput={(outputDeviceId) => apply({ outputDeviceId })}
        onCamera={(cameraDeviceId) => apply({ cameraDeviceId })}
        onSetting={apply}
        onVideoSetting={apply}
        onKey={(pushToTalkKey) => apply({ pushToTalkKey })}
        onReset={() => {
          const defaults = { ...defaultSettings(), screenAudioByDefault: false };
          setSettings({
            ...defaults,
            displayName: user.displayName,
            avatarDataUrl: user.avatarUrl ?? '',
          });
          void host.request('reset').catch((error) => setNotice(error.message));
        }}
        onCheckUpdate={() => {
          setUpdate({ kind: 'checking' });
          void host
            .request<UpdateStatus>('update.check')
            .then(setUpdate)
            .catch(() => setUpdate({ kind: 'error', message: 'Не удалось проверить обновления' }));
        }}
        onInstallUpdate={() => {
          void host.request('update.open');
        }}
        onSaveDiagnostics={() => host.request<string>('diagnostics')}
        onSaveProfile={async (name, avatar, username, bio, cover) => {
          const result = await host.request<{ user: AccountUser }>('profile.save', {
            name,
            avatar,
            username,
            bio,
            cover,
          });
          setUser(result.user);
          setSettings((current) => ({
            ...current,
            displayName: result.user.displayName,
            avatarDataUrl: result.user.avatarUrl ?? '',
          }));
        }}
        onAccountLogout={() => {
          void host.request('logout');
        }}
        onDeleteAccount={async (password) => {
          await host.request('api', {
            path: '/v1/me',
            method: 'DELETE',
            body: { password, confirmation: 'УДАЛИТЬ' },
          });
          await host.request('logout');
        }}
        onChangePassword={async (currentPassword, newPassword) => {
          await host.request('api', {
            path: '/v1/me/change-password',
            method: 'POST',
            body: { currentPassword, newPassword },
          });
        }}
        onClearChatCache={() => host.request<void>('cache.clear')}
        onNativeQrScan={() => {
          void host.request('qr.scan').catch((error) => setNotice(error.message));
        }}
        interfaceExtras={
          <div className="chat-settings-group">
            <div className="setting-row">
              <div>
                <strong>{t('Кнопка QR в нижней панели')}</strong>
                <small>{t('Вход по QR останется доступен в настройках.')}</small>
              </div>
              <button
                type="button"
                role="switch"
                aria-label={t('Кнопка QR в нижней панели')}
                aria-checked={qrVisible}
                disabled={savingQr}
                className={`switch ${qrVisible ? 'on' : ''}`}
                onClick={() => void setQrShortcut(!qrVisible)}
              >
                <span />
              </button>
            </div>
          </div>
        }
      />
      {notice && (
        <div className="app-toast" role="status" onClick={() => setNotice('')}>
          {notice}
        </div>
      )}
      <AppTooltips />
    </>
  );
}

async function start() {
  const initial = await host.request<Bootstrap>('bootstrap');
  host.cameraFacing = initial.cameraFacing;
  localStorage.setItem('trlka.ui-language', initial.language);
  localStorage.setItem('trlka.interface-theme', initial.theme);
  document.documentElement.lang = appLanguage();
  document.documentElement.classList.add('standalone-web-app', 'android-settings-app');
  interfaceTheme.receiveDeviceTheme(initial.theme);
  interfaceTheme.connect(initial.user.id);
  let deviceTheme = initial.theme;
  interfaceTheme.subscribe(() => {
    const { theme } = interfaceTheme.snapshot();
    if (theme !== deviceTheme) {
      deviceTheme = theme;
      void host.request('theme', { theme });
    }
  });
  installInteractionGuards();
  installMobileViewport();
  // Android resizes the native view for the keyboard. Keep the focused field
  // between the shared fixed header and footer after that resize settles.
  let inputFrame = 0;
  const revealInput = () => {
    cancelAnimationFrame(inputFrame);
    inputFrame = requestAnimationFrame(() => {
      const input = document.activeElement;
      if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) return;
      if (
        input instanceof HTMLInputElement &&
        !['text', 'email', 'password', 'search', 'tel', 'url', 'number'].includes(input.type)
      )
        return;
      const bounds = input.getBoundingClientRect();
      const top = document.querySelector('.settings-header')?.getBoundingClientRect().bottom ?? 0;
      const bottom =
        document.querySelector('.settings-footer, .profile-sticky-actions')?.getBoundingClientRect()
          .top ?? innerHeight - 76;
      if (bounds.top < top + 8 || bounds.bottom > bottom - 8)
        input.scrollIntoView({ block: 'center', inline: 'nearest' });
    });
  };
  document.addEventListener('focusin', revealInput);
  window.addEventListener('resize', revealInput);
  window.visualViewport?.addEventListener('resize', revealInput);
  let typedAt = 0;
  document.addEventListener('input', () => {
    if (Date.now() - typedAt > 150) {
      typedAt = Date.now();
      void host.request('typing');
    }
  });
  window.nativeSettingsBack = () => {
    const button =
      document.querySelector<HTMLButtonElement>('.qr-auth-dialog[open] header button') ??
      document.querySelector<HTMLButtonElement>(
        '.profile-confirm-dialog .profile-confirm-cancel',
      ) ??
      document.querySelector<HTMLButtonElement>('.profile-confirm-dialog button.secondary') ??
      document.querySelector<HTMLButtonElement>('.mobile-settings-back') ??
      document.querySelector<HTMLButtonElement>('.settings-sidebar-title button');
    if (button) button.click();
    else window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  };
  createRoot(document.getElementById('root')!).render(<SharedAndroidSettings initial={initial} />);
}
void start().catch(() => {
  document.getElementById('root')!.textContent =
    'Не удалось открыть настройки. Вернитесь назад и попробуйте ещё раз.';
});
