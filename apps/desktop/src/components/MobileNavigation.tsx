import { t } from '../lib/app-language';
import { DoorOpen, History, LockKeyhole, MessageCircle, Store, Users } from 'lucide-react';
import { createPortal } from 'react-dom';
import type { AccountPage } from './AccountSidebar';

const ITEMS = [
  { page: 'home' as const, label: 'Главная', icon: DoorOpen },
  { page: 'chats' as const, label: 'Чаты', icon: MessageCircle },
  { page: 'friends' as const, label: 'Друзья', icon: Users },
  { page: 'store' as const, label: 'Магазин', icon: Store },
  { page: 'history' as const, label: 'История', icon: History },
];

export function MobileNavigation({
  activePage,
  onNavigate,
  storeUnlocked = false,
}: {
  activePage: AccountPage;
  storeUnlocked?: boolean;
  onNavigate(page: AccountPage): void;
}) {
  const currentTab = activePage === 'food' ? 'store' : activePage;
  const navigation = (
    <nav className="mobile-bottom-navigation" aria-label={t('Основная навигация')}>
      {ITEMS.map(({ page, label, icon: Icon }) => (
        <button
          type="button"
          className={currentTab === page ? 'active' : ''}
          aria-current={currentTab === page ? 'page' : undefined}
          key={page}
          onClick={() => onNavigate(page)}
        >
          {page === 'store' && !storeUnlocked ? (
            <LockKeyhole aria-hidden="true" />
          ) : (
            <Icon aria-hidden="true" />
          )}
          <span>{t(label)}</span>
        </button>
      ))}
    </nav>
  );

  // WebKit can retain Safari's toolbar-reduced containing block after the site
  // is launched from the iOS home screen. Portaling the fixed navigation out of
  // the application grid makes its bottom edge relative to the real window.
  return createPortal(navigation, document.body);
}
