import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ChatLayoutPreview } from './components/ChatLayoutPreview';
import './styles.css';

const preview =
  import.meta.env.DEV && new URLSearchParams(window.location.search).has('chat-preview');

createRoot(document.getElementById('root')!).render(
  <StrictMode>{preview ? <ChatLayoutPreview /> : <App />}</StrictMode>,
);
