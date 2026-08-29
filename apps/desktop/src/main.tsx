import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ChatLayoutPreview } from './components/ChatLayoutPreview';
import { CustomTitleBar } from './components/CustomTitleBar';
import { NotificationOverlay } from './components/NotificationOverlay';
import { usesCustomWindowChrome } from './lib/window-chrome';
import './styles.css';

const preview =
  import.meta.env.DEV && new URLSearchParams(window.location.search).has('chat-preview');
const notificationOverlay = new URLSearchParams(window.location.search).has('notification-overlay');
if (notificationOverlay) document.documentElement.classList.add('notification-overlay-document');
const content = notificationOverlay ? (
  <NotificationOverlay />
) : preview ? (
  <ChatLayoutPreview />
) : (
  <App />
);
const customWindowChrome = usesCustomWindowChrome();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {customWindowChrome && !notificationOverlay ? (
      <div className="desktop-app-frame">
        <CustomTitleBar />
        <div className="desktop-app-content">{content}</div>
      </div>
    ) : (
      content
    )}
  </StrictMode>,
);
