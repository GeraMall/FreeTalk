// Local recording fixture. Uses production components; never imported by the application entry.
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AccountSidebar } from '../src/components/AccountSidebar';
import { FriendsPage } from '../src/components/FriendsPage';
import { ChatsPage, type ChatItem, type MessageItem } from '../src/components/ChatsPage';
import { RoomView } from '../src/components/RoomView';
import { defaultSettings } from '../src/lib/settings';
import { ChatRealtimeClient } from '../src/lib/chat-realtime';
import { accountClient } from '../src/lib/api-client';
import '../src/styles.css';
import '../src/profile-panel.css';
import '../src/gif-library.css';
import '../src/theme-steel.css';

if (!import.meta.env.DEV || !['localhost', '127.0.0.1'].includes(location.hostname)) {
  throw new Error('The recording stand is local-only');
}
const noop = () => {};
const done = async () => {};
const yes = async () => true;
// No production account, HTTP request or signaling connection is used by this stand.
ChatRealtimeClient.prototype.start = function () {
  (this as any).onSelfPresence?.('online');
};
ChatRealtimeClient.prototype.stop = noop;
accountClient.request = async <T,>() =>
  ({ profile: { presence: 'online' }, calls: [], chats: [], friends: [] }) as T;
const ids = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444',
];
// Original geometric avatars, not photos of real people.
function avatar(index: number) {
  const colors = [
    ['#36558b', '#b9d1ff'],
    ['#754768', '#f1c6df'],
    ['#997045', '#ffdfad'],
    ['#326d65', '#b4e7d9'],
  ][index]!;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240"><rect width="240" height="240" fill="${colors[0]}"/><circle cx="195" cy="30" r="110" fill="${colors[1]}" opacity=".17"/><path d="M25 240 Q25 155 120 155 Q215 155 215 240" fill="${colors[1]}" opacity=".85"/><circle cx="120" cy="101" r="52" fill="${colors[1]}"/><path d="M72 83 Q75 30 125 42 Q178 45 172 87 Q140 81 120 65 Q105 86 72 83" fill="${colors[0]}"/><circle cx="103" cy="104" r="4" fill="${colors[0]}"/><circle cx="138" cy="104" r="4" fill="${colors[0]}"/><path d="M108 126 Q120 136 133 126" fill="none" stroke="${colors[0]}" stroke-width="4" stroke-linecap="round"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
const people = ['Сергей', 'Аня', 'Макс', 'Даша'].map((displayName, i) => ({
  id: ids[i]!,
  displayName,
  display_name: displayName,
  username: ['sergey', 'anya', 'max', 'dasha'][i]!,
  avatarUrl: avatar(i),
  presence: 'online' as const,
}));
const self = {
  ...people[0]!,
  email: 'sergey@example.invalid',
  emailVerified: true,
  registeredAt: '2026-01-01T00:00:00Z',
};
const friends = people.slice(1);
const groupId = '55555555-5555-4555-8555-555555555555';
const chats: ChatItem[] = [
  {
    id: groupId,
    type: 'group',
    title: 'Вечер вместе',
    members: people,
    lastMessage: 'Я уже здесь. Залетайте!',
    currentUserRole: 'owner',
  },
  ...friends.map((p) => ({
    id: p.id,
    type: 'direct' as const,
    title: null,
    members: [self, p],
    lastMessage: (
      {
        Аня: 'Скинула идеи на выходные',
        Макс: 'Через пять минут буду',
        Даша: 'Отлично, до вечера!',
      } as Record<string, string>
    )[p.displayName],
  })),
];
const lines: [[number, string], ...Array<[number, string]>] = [
  [1, 'Ну что, соберёмся сегодня?'],
  [2, 'Да! Я как раз закончил дела.'],
  [0, 'Давайте в нашу комнату.'],
  [3, 'Я с вами 🙌'],
  [1, 'Покажу маршрут на выходные. Там невероятные места.'],
  [2, 'Звучит как план!'],
  [0, 'Беру чай и включаю звонок ☕'],
];
function message(i: number, body: string, n: number): MessageItem {
  const p = people[i]!;
  return {
    id: `demo-message-${n}`,
    kind: 'text',
    body,
    sender_id: p.id,
    display_name: p.displayName,
    username: p.username,
    avatar_url: p.avatarUrl,
    created_at: new Date(new Date().setHours(19, 30 + n, 0, 0)).toISOString(),
    expires_at: null,
    reactions:
      n === 3
        ? [{ emoji: '❤️', count: 3, userIds: [ids[0]!, ids[1]!, ids[2]!], reactedByMe: true }]
        : [],
  };
}
const initialMessages = lines.map(([i, body], n) => message(i, body, n));

function sharedScreen() {
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext('2d')!;
  let frame = 0;
  function paint() {
    frame++;
    ctx.fillStyle = '#e7ebdf';
    ctx.fillRect(0, 0, 1280, 720);
    ctx.fillStyle = '#253e38';
    ctx.font = '700 28px sans-serif';
    ctx.fillText('ВЫХОДНЫЕ ВМЕСТЕ', 58, 62);
    ctx.font = 'bold 66px sans-serif';
    ctx.fillText('Куда отправимся?', 58, 160);
    ctx.font = '24px sans-serif';
    ctx.fillStyle = '#5e736b';
    ctx.fillText('Суббота. Свои люди. Никакой спешки.', 60, 210);
    const cols = ['#95b2a0', '#bbbd99', '#8babb0'];
    ['К озеру', 'В горы', 'На побережье'].forEach((label, i) => {
      const x = 58 + i * 405;
      ctx.fillStyle = cols[i]!;
      ctx.beginPath();
      ctx.roundRect(x, 260, 380, 340, 24);
      ctx.fill();
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x, 260, 380, 340, 24);
      ctx.clip();
      ctx.fillStyle = '#e2dfb3';
      ctx.beginPath();
      ctx.arc(x + 290, 335, 39, 0, Math.PI * 2);
      ctx.fill();
      for (let j = 0; j < 3; j++) {
        ctx.fillStyle = ['#56766e', '#395e59', '#264a46'][j]!;
        ctx.beginPath();
        ctx.moveTo(x, 460 + j * 42);
        for (let k = 0; k <= 380; k += 8)
          ctx.lineTo(x + k, 420 + j * 47 + Math.sin(k / 95 + i + j + frame / 700) * 35);
        ctx.lineTo(x + 380, 650);
        ctx.lineTo(x, 650);
        ctx.fill();
      }
      ctx.fillStyle = '#f6f8ee';
      ctx.font = 'bold 29px sans-serif';
      ctx.fillText(label, x + 26, 564);
      ctx.restore();
    });
    ctx.fillStyle = '#3b5c50';
    ctx.font = '22px sans-serif';
    ctx.fillText('Обсудим маршрут?  →', 60, 666);
    requestAnimationFrame(paint);
  }
  paint();
  return canvas.captureStream(30);
}

export function Stand() {
  const [scene, setScene] = useState(
    new URLSearchParams(location.search).get('scene') || 'friends',
  );
  const [messages, setMessages] = useState(initialMessages);
  const [speaker, setSpeaker] = useState(1);
  const [stream] = useState(sharedScreen);
  const [reaction, setReaction] = useState<any[]>([]);
  const [muted, setMuted] = useState(false);
  const [count, setCount] = useState(3);
  const roster = Array.from({ length: count }, (_, i) =>
    i < 4
      ? people[i]!
      : {
          ...people[i % 4]!,
          id: `demo-guest-${i}`,
          displayName: ['Лена', 'Илья', 'Оля', 'Никита'][i - 4]!,
        },
  );
  useEffect(() => {
    (window as any).marketing = {
      scene: setScene,
      roster: setCount,
      reply: () => setMessages((m) => [...m, message(1, 'Я уже здесь. Залетайте! ✨', m.length)]),
      react: () => setReaction([{ id: String(Date.now()), participantId: ids[1], reaction: '❤️' }]),
    };
    const timer = setInterval(() => setSpeaker((s) => (s + 1) % 4), 2200);
    return () => clearInterval(timer);
  }, []);
  const call = scene === 'call' || scene === 'screen';
  const dock = {
    active: call,
    muted,
    deafened: false,
    strength: 100,
    pingMs: 32,
    title: 'Вечер вместе',
    camera: false,
    screen: scene === 'screen',
    noiseSuppression: true,
    busy: false,
    inputs: [],
    outputs: [],
    inputId: 'default',
    outputId: 'default',
    onMute: () => setMuted(!muted),
    onDeafen: noop,
    onCamera: noop,
    onScreen: () => setScene('screen'),
    onNoise: noop,
    onLeave: () => setScene('chat'),
    onOpen: () => setScene('call'),
    onReaction: noop,
    onInput: noop,
    onOutput: noop,
    onDevices: noop,
  };
  return (
    <main
      className={`account-shell account-shell-with-chat-sidebar${call ? ' room-account-shell' : ''}`}
      style={
        {
          '--account-sidebar-width': '240px',
          '--account-sidebar-center-offset': '120px',
        } as React.CSSProperties
      }
    >
      <AccountSidebar
        user={self}
        activePage={call ? 'room' : scene === 'friends' ? 'friends' : 'chats'}
        roomActive={call}
        chats={chats}
        friends={friends}
        readingChatId={scene === 'chat' ? groupId : undefined}
        onOpenChat={() => setScene('chat')}
        onCreateGroup={yes}
        onNavigate={(p) => setScene(p === 'room' ? 'call' : p === 'friends' ? 'friends' : 'chat')}
        onSettings={noop}
        onLogout={noop}
        callDock={dock}
      />
      <section
        className={
          call
            ? 'account-room-workspace'
            : scene === 'friends'
              ? 'account-content'
              : 'account-content account-content-chat'
        }
      >
        {scene === 'friends' ? (
          <FriendsPage
            userId={self.id}
            friends={friends}
            pending={[]}
            blocked={[]}
            loading={false}
            loadError=""
            onRetry={noop}
            onAdd={done}
            onAccept={done}
            onDecline={done}
            onMessage={async () => setScene('chat')}
            onCall={async () => setScene('call')}
            onRemove={done}
            onBlock={done}
            onUnblock={done}
          />
        ) : !call ? (
          <ChatsPage
            externalSidebar
            userId={self.id}
            chats={chats}
            friends={friends}
            activeChatId={groupId}
            messages={messages}
            chatsLoading={false}
            messagesLoading={false}
            messagesError=""
            sentMessageVersion={messages.length}
            onOpenChat={done}
            onRetryMessages={noop}
            onSendMessage={async (body) => {
              setMessages((m) => [...m, message(0, body, m.length)]);
              return true;
            }}
            onCreateGroup={yes}
            onJoinInvite={yes}
            onStartCall={async () => setScene('call')}
            onCreateInvite={done}
            onUpdateRetention={done}
            onClearHistory={done}
            onAddMember={yes}
            onJoinCall={() => setScene('call')}
            onReactMessage={yes}
          />
        ) : (
          <RoomView
            embedded
            roomId="DEMO-TRLKA"
            viewerId={self.id}
            selfId={self.id}
            participants={roster.map((p, i) => ({
              id: p.id,
              accountId: p.id,
              name: p.displayName,
              avatar: p.avatarUrl,
              muted: i === 0 ? muted : false,
              isOwner: i === 0,
              connectedAt: 1,
            }))}
            peerState={Object.fromEntries(
              people
                .slice(1)
                .map((p, i) => [
                  p.id,
                  { connection: 'connected', speaking: speaker === i + 1, hasAudio: true },
                ]),
            )}
            localSpeaking={speaker === 0}
            localVideo={{
              source: 'none',
              cameraEnabled: false,
              screenEnabled: false,
              screenAudioEnabled: false,
            }}
            remoteVideos={scene === 'screen' ? { [ids[1]!]: { screen: stream } } : {}}
            videoBusy={false}
            muted={muted}
            roomStartedAt={Date.now() - 125000}
            reactions={reaction}
            roomChatMessages={[]}
            screenFocusMode={false}
            signalingState="connected"
            signalStrength={100}
            reconnectAttempt={0}
            settings={defaultSettings()}
            inviteCopied={false}
            turnAvailable
            recordingState={{ phase: 'idle' }}
            recordingBannerMessage=""
            devices={{ inputs: [], outputs: [], cameras: [] }}
            friends={friends}
            onCopyInvite={noop}
            onInviteFriends={yes}
            onMute={() => setMuted(!muted)}
            onCamera={noop}
            onInputDevice={noop}
            onOutputDevice={noop}
            onCameraDevice={noop}
            onCameraBackground={noop}
            onScreen={() => setScene('screen')}
            onReaction={(r) =>
              setReaction([{ id: String(Date.now()), participantId: self.id, reaction: r }])
            }
            onRoomChatSend={() => true}
            onScreenFocusChange={noop}
            onSettings={noop}
            onRecording={noop}
            onRecordingBannerClose={noop}
            onLeave={() => setScene('chat')}
            onPeerVolume={noop}
            onScreenVolume={noop}
            onPeerMute={noop}
            onModerationMute={noop}
          />
        )}
      </section>
    </main>
  );
}
const standRoot = ((window as any).__marketingRoot ??= createRoot(
  document.getElementById('root')!,
));
standRoot.render(<Stand />);
