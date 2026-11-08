import { createRoot } from 'react-dom/client';
import { serverMessageSchema } from '@freetalk/protocol';
import { CallActivity } from './components/CallActivity';
import { parseAndroidTabletState } from './lib/android-tablet-bridge';
import { publishActivityPointer } from './lib/activity-pointers';
import './styles.css';
import './theme-steel.css';
import './control-motion.css';
import './interface-themes.css';
import './android-tablet.css';

declare global {
  interface Window {
    TRLKANativeTablet?: { postMessage(message: string): void };
    TRLKATablet?: { receive(raw: string): void; pointer(raw: string): void };
  }
}

const root = createRoot(document.getElementById('root')!);
const send = (type: string, action?: unknown) =>
  window.TRLKANativeTablet?.postMessage(JSON.stringify({ type, ...(action ? { action } : {}) }));

window.TRLKATablet = {
  receive(raw) {
    const state = parseAndroidTabletState(raw);
    if (!state) return;
    localStorage.setItem('trlka.ui-language', state.language);
    document.documentElement.lang = state.language;
    document.documentElement.dataset.uiTheme = state.theme;
    root.render(
      <CallActivity
        activity={state.activity}
        selfId={state.selfId}
        participants={state.participants}
        muted={state.muted}
        deafened={state.deafened}
        onAction={(action) => send('action', action)}
        onClose={() => send('close')}
        onEnd={() => send('action', { kind: 'close' })}
        onMute={() => send('mute')}
        onDeafen={() => send('deafen')}
      />,
    );
  },
  pointer(raw) {
    try {
      const message = serverMessageSchema.safeParse(JSON.parse(raw));
      if (message.success && message.data.type === 'activity-pointer')
        publishActivityPointer(message.data);
    } catch {
      /* A malformed transient pointer must not interrupt the game. */
    }
  },
};
send('ready');
