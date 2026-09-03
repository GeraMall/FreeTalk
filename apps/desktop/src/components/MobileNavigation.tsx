import { DoorOpen, History, MessageCircle, Users } from 'lucide-react';
import type { AccountPage } from './AccountSidebar';

const ITEMS = [
  { page: 'home' as const, label: 'Главная', icon: DoorOpen },
  { page: 'chats' as const, label: 'Чаты', icon: MessageCircle },
  { page: 'friends' as const, label: 'Друзья', icon: Users },
  { page: 'history' as const, label: 'История', icon: History },
];

export function MobileNavigation({
  activePage,
  onNavigate,
}: {
  activePage: AccountPage;
  onNavigate(page: AccountPage): void;
}) {
  return (
    <nav className="mobile-bottom-navigation" aria-label="Основная навигация">
      {ITEMS.map(({ page, label, icon: Icon }) => (
        <button
          type="button"
          className={activePage === page ? 'active' : ''}
          aria-current={activePage === page ? 'page' : undefined}
          key={page}
          onClick={() => onNavigate(page)}
        >
          <Icon aria-hidden="true" />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}
