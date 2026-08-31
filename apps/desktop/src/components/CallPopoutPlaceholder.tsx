import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { PictureInPicture2 } from 'lucide-react';
import { accountClient, type AccountUser } from '../lib/api-client';
import { AccountSidebar, type AccountPage } from './AccountSidebar';
import { HomeView } from './HomeView';

export function CallPopoutPlaceholder() {
  const [active, setActive] = useState(false);
  const [user, setUser] = useState<AccountUser>();
  const [page, setPage] = useState<AccountPage>('home');
  const [activeChatId, setActiveChatId] = useState<string>();
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let disposed = false;
    const unlisteners: Array<() => void> = [];
    void Promise.all([
      listen('call-placeholder-shown', () => setActive(true)),
      listen('call-placeholder-hidden', () => setActive(false)),
    ]).then((listeners) => {
      if (disposed) listeners.forEach((unlisten) => unlisten());
      else unlisteners.push(...listeners);
    });
    return () => {
      disposed = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    if (!active || user) return;
    let disposed = false;
    void accountClient
      .restore()
      .then((restored) => {
        if (!disposed && restored) setUser(restored);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, [active, user]);

  const restoreCall = () => void invoke('call_popout_restore');

  if (active && user) {
    return (
      <main className="account-shell room-account-shell call-placeholder-navigation-shell">
        <AccountSidebar
          user={user}
          activePage={page}
          roomActive
          readingChatId={page === 'chats' ? activeChatId : undefined}
          onNavigate={(destination) => {
            if (destination === 'room') restoreCall();
            else setPage(destination);
          }}
          onSettings={() => setNotice('Настройки звонка доступны в отдельном окне')}
          onLogout={() => setNotice('Сначала завершите текущий звонок')}
        />
        <section className="account-room-workspace call-placeholder-navigation-workspace">
          <div className="call-placeholder-toolbar">
            <span>
              <PictureInPicture2 aria-hidden="true" />
              Звонок открыт в отдельном окне
            </span>
            <button onClick={restoreCall}>Вернуть звонок</button>
          </div>
          {notice && (
            <button className="call-placeholder-notice" onClick={() => setNotice('')}>
              {notice}
            </button>
          )}
          <HomeView
            embedded
            page={page}
            user={user}
            busy={false}
            error=""
            onPageChange={setPage}
            onActiveChatChange={setActiveChatId}
            onCreateRoom={() => setNotice('Вы уже находитесь в звонке')}
            onJoinRoom={() => setNotice('Сначала завершите текущий звонок')}
            onSettings={() => setNotice('Настройки звонка доступны в отдельном окне')}
            onLogout={() => setNotice('Сначала завершите текущий звонок')}
          />
        </section>
      </main>
    );
  }

  return (
    <main className="call-popout-placeholder">
      <div>
        <PictureInPicture2 size={30} aria-hidden="true" />
        <strong>Вы вывели плеер в отдельное окно</strong>
        <small>Звонок продолжается без переподключения.</small>
        <button onClick={restoreCall}>Вернуть в приложение</button>
      </div>
    </main>
  );
}
