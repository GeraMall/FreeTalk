import { accountClient } from './api-client';
export const interfaceThemes = ['default', 'light', 'black'] as const;
export type InterfaceTheme = (typeof interfaceThemes)[number];
const storageKey = 'trlka.interface-theme';
export const isInterfaceTheme = (value: unknown): value is InterfaceTheme =>
  interfaceThemes.includes(value as InterfaceTheme);
export function storedInterfaceTheme(): InterfaceTheme {
  try {
    const value = localStorage.getItem(storageKey);
    return isInterfaceTheme(value) ? value : 'default';
  } catch {
    return 'default';
  }
}
export function applyInterfaceTheme(theme = storedInterfaceTheme()) {
  document.documentElement.dataset.uiTheme =
    document.documentElement.dataset.authScreen === 'true' ? 'default' : theme;
}
type Preference = { theme: InterfaceTheme; syncEnabled: boolean };
type ThemeState = Preference & { ready: boolean; busy: boolean; error: boolean; account: boolean };
export class ThemeController {
  private state: ThemeState = {
    theme: storedInterfaceTheme(),
    syncEnabled: false,
    ready: true,
    busy: false,
    error: false,
    account: false,
  };
  private listeners = new Set<() => void>();
  private generation = 0;
  private edits = 0;
  private unsavedTheme = false;
  private pending?: Preference;
  private writing = false;
  private confirmedSync = false;
  private reading = false;
  private timer?: ReturnType<typeof setInterval>;
  subscribe = (callback: () => void) => {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  };
  snapshot = () => this.state;
  private update(patch: Partial<ThemeState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }
  private local(theme: InterfaceTheme) {
    try {
      localStorage.setItem(storageKey, theme);
    } catch {
      /* The current session can still change its theme. */
    }
    applyInterfaceTheme(theme);
    this.update({ theme });
  }
  choose = (theme: InterfaceTheme) => {
    if (!isInterfaceTheme(theme)) return;
    this.edits++;
    this.local(theme);
    if (this.state.account && this.state.syncEnabled) {
      this.unsavedTheme = true;
      this.queue({ theme, syncEnabled: true });
    }
  };
  toggleSync = (syncEnabled: boolean) => {
    if (!this.state.account || !this.state.ready || this.state.busy) return;
    this.edits++;
    this.queue({ theme: this.state.theme, syncEnabled });
  };
  private queue(preference: Preference) {
    this.pending = preference;
    this.update({ syncEnabled: preference.syncEnabled });
    void this.flush();
  }
  private async flush() {
    if (this.writing) return;
    this.writing = true;
    const generation = this.generation;
    this.update({ busy: true, error: false });
    try {
      while (this.pending && generation === this.generation) {
        const next = this.pending;
        this.pending = undefined;
        await accountClient.request('/v1/me/appearance', {
          method: 'PUT',
          body: JSON.stringify(next),
        });
        if (generation === this.generation) {
          this.confirmedSync = next.syncEnabled;
          if (!this.pending) {
            if (next.theme === this.state.theme) this.unsavedTheme = false;
            this.update({ syncEnabled: next.syncEnabled });
          }
        }
      }
    } catch {
      if (generation === this.generation) {
        this.pending = undefined;
        this.update({ error: true, syncEnabled: this.confirmedSync });
      }
    } finally {
      if (generation === this.generation) {
        this.writing = false;
        this.update({ busy: false });
      }
    }
  }
  refresh = async () => {
    if (!this.state.account || this.reading || this.writing) return;
    const generation = this.generation,
      edits = this.edits,
      wasReady = this.state.ready;
    this.reading = true;
    try {
      const result = await accountClient.request<{ appearance: Preference }>('/v1/me/appearance');
      if (
        generation !== this.generation ||
        this.writing ||
        (wasReady && edits !== this.edits) ||
        !isInterfaceTheme(result.appearance?.theme) ||
        typeof result.appearance.syncEnabled !== 'boolean'
      )
        return;
      const preference = result.appearance;
      this.confirmedSync = preference.syncEnabled;
      this.update({ syncEnabled: preference.syncEnabled, error: false });
      if (preference.syncEnabled) {
        if (edits === this.edits && !this.unsavedTheme) this.local(preference.theme);
        else this.queue({ theme: this.state.theme, syncEnabled: true });
      }
    } catch {
      if (generation === this.generation) this.update({ error: true });
    } finally {
      if (generation === this.generation) {
        this.reading = false;
        this.update({ ready: true });
      }
    }
  };
  connect(accountId?: string) {
    this.disconnect();
    this.confirmedSync = false;
    this.unsavedTheme = false;
    this.update({
      account: Boolean(accountId),
      syncEnabled: false,
      ready: !accountId,
      busy: false,
      error: false,
    });
    if (!accountId) return () => {};
    void this.refresh();
    const focus = () => {
      void this.refresh();
    };
    window.addEventListener('focus', focus);
    this.timer = setInterval(() => {
      if (document.visibilityState !== 'hidden') void this.refresh();
    }, 60_000);
    return () => {
      window.removeEventListener('focus', focus);
      this.disconnect();
    };
  }
  receiveDeviceTheme(theme: InterfaceTheme) {
    applyInterfaceTheme(theme);
    this.update({ theme });
  }
  private disconnect() {
    this.generation++;
    this.pending = undefined;
    this.writing = false;
    this.reading = false;
    if (this.timer) clearInterval(this.timer);
  }
}
export const interfaceTheme = new ThemeController();

window.addEventListener('storage', (event) => {
  if (event.key === storageKey && isInterfaceTheme(event.newValue))
    interfaceTheme.receiveDeviceTheme(event.newValue);
});
