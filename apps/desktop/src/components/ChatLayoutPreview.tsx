import { useState } from 'react';
import { AccountSidebar } from './AccountSidebar';
import { ChatsPage, type ChatItem, type MessageItem } from './ChatsPage';
import { TransientNotice } from './HomeView';
import mascot from '../assets/freetalk-mascot.png';
import { useMobileLayout } from '../lib/mobile-layout';
import { CreateGroupDialog } from './CreateGroupDialog';
import { UserProfileDialog } from './UserProfileDialog';
import { FriendsPage } from './FriendsPage';

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
      {
        id: friendId,
        username: 'alexey_1',
        displayName: 'Алексей',
        avatarUrl: mascot,
        presence: 'dnd',
      },
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
  const previewParams = new URLSearchParams(window.location.search);
  const showNotice = previewParams.has('notice');
  const previewHomeSidebar = previewParams.has('home-sidebar');
  const previewSlowMode = previewParams.has('slow-mode');
  const previewCreateGroup = previewParams.has('create-group');
  const previewFullProfile = previewParams.has('full-profile');
  const previewOwnProfile = previewParams.get('full-profile') === 'self';
  const previewFriends = previewParams.has('friends');
  const mobile = useMobileLayout();
  const [activeChatId, setActiveChatId] = useState<string | undefined>(
    previewParams.has('list') ? undefined : chats[0]!.id,
  );
  return (
    <main
      className={`account-shell account-shell-with-chat-sidebar${previewHomeSidebar ? ' account-home-shell' : ''}${mobile ? ' mobile-account-shell mobile-chat-open' : ''}`}
    >
      {showNotice && <TransientNotice message="Комната не найдена" onDismiss={() => {}} />}
      {!mobile ? (
        <AccountSidebar
          user={self}
          activePage={previewHomeSidebar ? 'home' : previewFriends ? 'friends' : 'chats'}
          readingChatId={chats[0]!.id}
          chats={chats}
          updateStatus={{ kind: 'available', version: '0.4.0-beta.76' }}
          friends={[{ id: friendId, displayName: 'Алексей', avatarUrl: mascot, presence: 'dnd' }]}
          onNavigate={() => {}}
          onOpenChat={async () => {}}
          onCreateGroup={async () => true}
          onLeaveGroup={async () => {}}
          onInstallUpdate={() => {}}
          onSettings={() => {}}
          onLogout={() => {}}
        />
      ) : null}
      <section className="account-content account-content-chat">
        {previewFriends ? (
          <FriendsPage
            userId={self.id}
            friends={[
              {
                id: friendId,
                username: 'alexey_1',
                display_name: 'Алексей',
                avatarUrl: mascot,
                presence: 'online',
              },
              {
                id: '77777777-7777-4777-8777-777777777777',
                username: 'marina',
                display_name: 'Марина',
                presence: 'away',
              },
            ]}
            pending={[]}
            blocked={[]}
            loading={false}
            loadError=""
            onRetry={() => {}}
            onAdd={async () => {}}
            onAccept={async () => {}}
            onDecline={async () => {}}
            onMessage={async () => {}}
            onRemove={async () => {}}
            onBlock={async () => {}}
            onUnblock={async () => {}}
          />
        ) : (
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
            slowModeUntil={previewSlowMode ? Date.now() + 30_000 : undefined}
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
        )}
      </section>
      <CreateGroupDialog
        open={previewCreateGroup}
        friends={[
          { id: friendId, displayName: 'Алексей', avatarUrl: mascot, presence: 'online' },
          { id: '77777777-7777-4777-8777-777777777777', displayName: 'Марина', presence: 'away' },
          {
            id: '88888888-8888-4888-8888-888888888888',
            displayName: 'Дмитрий',
            presence: 'offline',
          },
        ]}
        onClose={() => {}}
        onCreate={async () => true}
      />
      {previewFullProfile ? (
        <UserProfileDialog
          viewerId={self.id}
          target={{
            id: previewOwnProfile ? self.id : friendId,
            displayName: previewOwnProfile ? self.displayName : 'Алексей',
            username: previewOwnProfile ? self.username : 'alexey_1',
            avatarUrl: mascot,
            presence: 'online',
          }}
          initialProfile={{
            id: previewOwnProfile ? self.id : friendId,
            displayName: previewOwnProfile ? self.displayName : 'Алексей',
            username: previewOwnProfile ? self.username : 'alexey_1',
            bio: 'Люблю живые разговоры, музыку и хорошие командные проекты.',
            avatarUrl: mascot,
            coverUrl: mascot,
            registeredAt: '2026-03-12T00:00:00.000Z',
            relationship: previewOwnProfile ? 'self' : 'friend',
            mutualFriendsCount: 2,
            mutualFriends: [
              {
                id: '77777777-7777-4777-8777-777777777777',
                username: 'marina',
                displayName: 'Марина',
                avatarUrl: mascot,
                presence: 'online',
              },
              {
                id: '88888888-8888-4888-8888-888888888888',
                username: 'dmitry',
                displayName: 'Дмитрий',
                avatarUrl: mascot,
                presence: 'away',
              },
            ],
            commonChatsCount: 2,
            commonChats: [
              {
                id: chats[0]!.id,
                type: 'direct',
                title: 'Алексей',
                avatarUrl: mascot,
                lastInteractionAt: new Date().toISOString(),
              },
              {
                id: chats[1]!.id,
                type: 'group',
                title: 'Команда FreeTalk',
                avatarUrl: null,
                lastInteractionAt: '2026-09-04T18:42:00.000Z',
              },
            ],
            sharedCalls: {
              count: 8,
              lastStartedAt: new Date().toISOString(),
              lastDurationSeconds: 2520,
            },
            presence: 'online',
          }}
          actions={{
            onMessage: () => {},
            onCall: () => {},
            onOpenChat: () => {},
            onRemoveFriend: () => {},
            onBlock: () => {},
          }}
          onClose={() => {}}
        />
      ) : null}
    </main>
  );
}
