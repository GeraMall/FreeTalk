import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { AppWindow, Monitor, X } from 'lucide-react';
import { screenPickerStore } from '../lib/native-screen-picker';
import './native-screen-picker.css';

export function NativeScreenSourcePicker() {
  const request = useSyncExternalStore(screenPickerStore.subscribe, screenPickerStore.snapshot);
  const [tab, setTab] = useState<'screen' | 'window'>('screen');
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!request) return;
    setTab('screen');
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, [request]);
  if (!request) return null;
  return createPortal(
    <dialog
      ref={dialog}
      className="native-screen-picker"
      onCancel={(event) => {
        event.preventDefault();
        request.complete(null);
      }}
    >
      <header>
        <div>
          <h2>Демонстрация экрана</h2>
          <p>Выберите, что увидят участники звонка</p>
        </div>
        <button aria-label="Отмена" onClick={() => request.complete(null)}>
          <X size={20} />
        </button>
      </header>
      <div role="tablist" aria-label="Источник демонстрации">
        <button role="tab" aria-selected={tab === 'screen'} onClick={() => setTab('screen')}>
          <Monitor size={18} />
          Экраны
        </button>
        <button role="tab" aria-selected={tab === 'window'} onClick={() => setTab('window')}>
          <AppWindow size={18} />
          Окна
        </button>
      </div>
      <div className="native-screen-sources">
        {request.sources
          .filter((source) => source.kind === tab)
          .map((source, index) => (
            <button key={source.id} onClick={() => request.complete(source)}>
              {tab === 'screen' ? <Monitor size={26} /> : <AppWindow size={26} />}
              <span>{source.title || `Экран ${index + 1}`}</span>
            </button>
          ))}
        {!request.sources.some((source) => source.kind === tab) && (
          <p>Нет доступных окон. Откройте нужное приложение и повторите выбор.</p>
        )}
      </div>
      <footer>
        <span>
          {tab === 'window'
            ? 'Будет показано только выбранное окно'
            : 'Участники увидят всё на выбранном экране'}
        </span>
        <button onClick={() => request.complete(null)}>Отмена</button>
      </footer>
    </dialog>,
    document.body,
  );
}
