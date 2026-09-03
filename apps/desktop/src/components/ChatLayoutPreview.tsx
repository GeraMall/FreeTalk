import { useState } from 'react';
import { AccountSidebar } from './AccountSidebar';
import { ChatsPage, type ChatItem, type MessageItem } from './ChatsPage';
import { TransientNotice } from './HomeView';
import mascot from '../assets/freetalk-mascot.png';
import { useMobileLayout } from '../lib/mobile-layout';

const self = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'gera@example.com',
  username: 'german_1',
  displayName: 'Гера',
  emailVerified: true,
  avatarUrl: mascot,
  registeredAt: '2026-01-01T00:00:00.000Z',
};
const friendId = '22222222-2222-4222-8222-222222222222';
const chats: ChatItem[] = [
  {
    id: '33333333-3333-4333-8333-333333333333',
    type: 'direct',
    title: null,
    members: [
      { id: self.id, username: self.username, displayName: self.displayName },
      { id: friendId, username: 'alexey_1', displayName: 'Алексей', avatarUrl: mascot },
    ],
    lastMessage: 'Отлично, увидимся вечером',
    lastMessageAt: '2026-08-26T12:20:00.000Z',
    currentUserRole: 'owner',
  },
  {
    id: '44444444-4444-4444-8444-444444444444',
    type: 'group',
    title: 'Команда FreeTalk',
    members: [{ id: self.id, username: self.username, displayName: self.displayName }],
    lastMessage: 'Новая версия готова',
    lastMessageAt: '2026-08-26T11:40:00.000Z',
    unreadCount: 3,
  },
];
const messages: MessageItem[] = [
  {
    id: '55555555-5555-4555-8555-555555555555',
    sender_id: friendId,
    display_name: 'Алексей',
    avatar_url: mascot,
    username: 'alexey_1',
    kind: 'text',
    body: 'Привет! Проверяем новый интерфейс чатов?',
    created_at: '2026-08-26T12:18:00.000Z',
    expires_at: null,
  },
  {
    id: '66666666-6666-4666-8666-666666666666',
    sender_id: self.id,
    display_name: 'Гера',
    avatar_url: mascot,
    username: self.username,
    kind: 'text',
    body: 'Да. Теперь список, переписка и профиль стоят вплотную.',
    created_at: '2026-08-26T12:19:00.000Z',
    expires_at: null,
  },
];

export function ChatLayoutPreview() {
  const showNotice = new URLSearchParams(window.location.search).has('notice');
  const mobile = useMobileLayout();
  const [activeChatId, setActiveChatId] = useState<string | undefined>(
    new URLSearchParams(window.location.search).has('list') ? undefined : chats[0]!.id,
  );
  return (
    <main
      className={`account-shell account-shell-with-chat-sidebar${mobile ? ' mobile-account-shell mobile-chat-open' : ''}`}
    >
      {showNotice && <TransientNotice message="Комната не найдена" onDismiss={() => {}} />}
      {!mobile ? <AccountSidebar
        user={self}
        activePage="chats"
        readingChatId={chats[0]!.id}
        chats={chats}
        updateStatus={{ kind: 'available', version: '0.4.0-beta.76' }}
        friends={[{ id: friendId, displayName: 'Алексей', avatarUrl: mascot }]}
        onNavigate={() => {}}
        onOpenChat={async () => {}}
        onCreateGroup={async () => true}
        onInstallUpdate={() => {}}
        onSettings={() => {}}
        onLogout={() => {}}
      /> : null}
      <section className="account-content account-content-chat">
        <ChatsPage
          externalSidebar={!mobile}
          mobile={mobile}
          userId={self.id}
          chats={chats}
          friends={[]}
          activeChatId={activeChatId}
          messages={messages}
          chatsLoading={false}
          messagesLoading={false}
          messagesError=""
          sentMessageVersion={0}
          onOpenChat={async (chatId) => setActiveChatId(chatId)}
          onCloseChat={() => setActiveChatId(undefined)}
          onRetryMessages={() => {}}
          onSendMessage={async () => true}
          onCreateGroup={async () => true}
          onJoinInvite={async () => true}
          onStartCall={async () => {}}
          onCreateInvite={async () => {}}
          onUpdateRetention={async () => {}}
          onClearHistory={async () => {}}
          onAddMember={async () => true}
          onJoinCall={() => {}}
        />
      </section>
    </main>
  );
}
