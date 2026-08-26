import { DoorOpen, History, LogOut, MessageCircle, PhoneCall, Settings, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import type { AccountUser } from '../lib/api-client';
import { BrandLogo } from './BrandLogo';

export type AccountPage = 'home' | 'friends' | 'chats' | 'history';
export type AccountDestination = AccountPage | 'room';

export function AccountSidebar({
  user,
  activePage,
  roomActive = false,
  onNavigate,
  onSettings,
  onLogout,
}: {
  user: AccountUser;
  activePage: AccountDestination;
  roomActive?: boolean;
  onNavigate(page: AccountDestination): void;
  onSettings(): void;
  onLogout(): void;
}) {
  return (
    <aside className="account-sidebar">
      <BrandLogo variant="compact" />
      <div className="account-online-status">
        <i /> Сервисы доступны
      </div>
      <nav>
        {roomActive && (
          <Nav
            active={activePage === 'room'}
            icon={<PhoneCall />}
            label="Текущий звонок"
            live
            onClick={() => onNavigate('room')}
          />
        )}
        <Nav
          active={activePage === 'home'}
          icon={<DoorOpen />}
          label="Главная"
          onClick={() => onNavigate('home')}
        />
        <Nav
          active={activePage === 'friends'}
          icon={<Users />}
          label="Друзья"
          onClick={() => onNavigate('friends')}
        />
        <Nav
          active={activePage === 'chats'}
          icon={<MessageCircle />}
          label="Чаты"
          onClick={() => onNavigate('chats')}
        />
        <Nav
          active={activePage === 'history'}
          icon={<History />}
          label="История"
          onClick={() => onNavigate('history')}
        />
      </nav>
      <div className="account-profile-mini">
        <span className="profile-avatar-small">
          {user.avatarUrl ? (
            <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" />
          ) : (
            user.displayName.slice(0, 1).toUpperCase()
          )}
        </span>
        <span>
          <strong>{user.displayName}</strong>
          <small>@{user.username}</small>
        </span>
        <button aria-label="Настройки" onClick={onSettings}>
          <Settings size={17} />
        </button>
      </div>
      <button className="logout-button" onClick={onLogout}>
        <LogOut size={16} /> Выйти
      </button>
    </aside>
  );
}

function Nav({
  active,
  icon,
  label,
  live = false,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  live?: boolean;
  onClick(): void;
}) {
  return (
    <button
      className={`${active ? 'active' : ''} ${live ? 'call-navigation' : ''}`}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
      {live && <i aria-label="Звонок продолжается" />}
    </button>
  );
}
