import { useEffect, useState, type CSSProperties } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { PictureInPicture2 } from 'lucide-react';
import { accountClient, type AccountUser } from '../lib/api-client';
import { AccountSidebar, type AccountPage } from './AccountSidebar';
import { HomeView, type HomeSidebarState } from './HomeView';
import {
  ACCOUNT_SIDEBAR_MAX_WIDTH,
  ACCOUNT_SIDEBAR_MIN_WIDTH,
  useAccountSidebarWidth,
} from '../lib/account-sidebar-width';

export function CallPopoutPlaceholder() {
  const [active, setActive] = useState(false);
  const [user, setUser] = useState<AccountUser>();
  const [page, setPage] = useState<AccountPage>('home');
  const [activeChatId, setActiveChatId] = useState<string>();
  const [sidebarState, setSidebarState] = useState<HomeSidebarState>();
  const [notice, setNotice] = useState('');
  const {
    width: sidebarWidth,
    startResize,
    resize,
    finishResize,
    resizeWithKeyboard,
    resetWidth,
  } = useAccountSidebarWidth();

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
      <main
        className="account-shell account-shell-with-chat-sidebar room-account-shell call-placeholder-navigation-shell"
        style={{ '--account-sidebar-width': `${sidebarWidth}px` } as CSSProperties}
      >
        <AccountSidebar
          user={user}
          activePage={page}
          roomActive
          readingChatId={page === 'chats' ? activeChatId : undefined}
          chats={sidebarState?.chats ?? []}
          friends={sidebarState?.friends ?? []}
          chatsLoading={sidebarState?.chatsLoading ?? true}
          onNavigate={(destination) => {
            if (destination === 'room') restoreCall();
            else setPage(destination);
          }}
          onOpenChat={(chatId) => sidebarState?.openChat(chatId)}
          onCreateGroup={(title, memberIds) =>
            sidebarState?.createGroup(title, memberIds) ?? Promise.resolve(false)
          }
          onSettings={() => setNotice('Настройки звонка доступны в отдельном окне')}
          onLogout={() => setNotice('Сначала завершите текущий звонок')}
        />
        <div
          className="account-sidebar-resizer"
          role="separator"
          aria-label="Изменить ширину боковой панели"
          aria-orientation="vertical"
          aria-valuemin={ACCOUNT_SIDEBAR_MIN_WIDTH}
          aria-valuemax={ACCOUNT_SIDEBAR_MAX_WIDTH}
          aria-valuenow={Math.round(sidebarWidth)}
          title="Потяните для изменения ширины. Двойной щелчок — размер по умолчанию"
          tabIndex={0}
          onDoubleClick={resetWidth}
          onPointerDown={startResize}
          onPointerMove={resize}
          onPointerUp={finishResize}
          onPointerCancel={finishResize}
          onKeyDown={resizeWithKeyboard}
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
            onSidebarStateChange={setSidebarState}
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
