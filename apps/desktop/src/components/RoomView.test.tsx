// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Participant, RoomChatMessage } from '@freetalk/protocol';
import { defaultSettings } from '../lib/settings';
import { RoomView, type RemoteVideoUiState } from './RoomView';

const selfId = '11111111-1111-4111-8111-111111111111';
const peerId = '22222222-2222-4222-8222-222222222222';
const participants: Participant[] = [
  { id: selfId, name: 'Гера', muted: false, isOwner: true, connectedAt: 1 },
  { id: peerId, name: 'Друг', muted: false, isOwner: false, connectedAt: 2 },
];
const stream = {} as MediaStream;
const { invokeMock, listenMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  listenMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }));

beforeAll(() => {
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    configurable: true,
    value: vi.fn().mockResolvedValue(undefined),
  });
});

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  invokeMock.mockReset().mockResolvedValue(undefined);
  listenMock.mockReset().mockResolvedValue(vi.fn());
  const previewTrack = { stop: vi.fn() } as unknown as MediaStreamTrack;
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn().mockResolvedValue({
        getVideoTracks: () => [previewTrack],
        getTracks: () => [previewTrack],
      } as unknown as MediaStream),
    },
  });
});

function view(
  localSource: 'none' | 'camera' | 'screen' | 'both' = 'none',
  remoteVideos: RemoteVideoUiState = {},
  remoteSpeaking = false,
  onScreen = vi.fn(),
  onReaction = vi.fn(),
  onScreenVolume = vi.fn(),
  handlers: {
    onMute?: () => void;
    onCamera?: () => void;
    onInputDevice?: (deviceId: string) => void;
    onOutputDevice?: (deviceId: string) => void;
    onCameraDevice?: (deviceId: string) => void;
    onCameraBackground?: (
      deviceId: string,
      mode: 'none' | 'blur' | 'custom',
      dataUrl: string,
      previewAlways: boolean,
    ) => void;
    devices?: { inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[]; cameras: MediaDeviceInfo[] };
    onSettings?: () => void;
    onLeave?: () => void;
    onRoomChatSend?: (text: string) => boolean;
    onScreenFocusChange?: (active: boolean) => void;
    roomChatMessages?: RoomChatMessage[];
    screenFocusMode?: boolean;
    recordingState?: { phase: 'idle' | 'recording' | 'saving'; path?: string; startedAt?: number };
    recordingBannerMessage?: string;
    onRecording?: () => void;
    onRecordingBannerClose?: () => void;
    viewerId?: string;
    participants?: Participant[];
  } = {},
) {
  return (
    <RoomView
      viewerId={handlers.viewerId}
      roomId="ABCDEF123456"
      selfId={selfId}
      participants={handlers.participants ?? participants}
      peerState={{
        [peerId]: { connection: 'connected', speaking: remoteSpeaking, hasAudio: true },
      }}
      localSpeaking={false}
      localVideo={{
        source: localSource === 'both' ? 'screen' : localSource,
        cameraEnabled: localSource === 'camera' || localSource === 'both',
        screenEnabled: localSource === 'screen' || localSource === 'both',
        screenAudioEnabled: localSource === 'screen' || localSource === 'both',
        previewStream: localSource === 'none' ? undefined : stream,
        cameraStream: localSource === 'camera' || localSource === 'both' ? stream : undefined,
        screenStream: localSource === 'screen' || localSource === 'both' ? stream : undefined,
      }}
      remoteVideos={remoteVideos}
      videoBusy={false}
      muted={false}
      roomStartedAt={Date.now() - 65_000}
      reactions={[]}
      roomChatMessages={handlers.roomChatMessages ?? []}
      screenFocusMode={handlers.screenFocusMode ?? false}
      signalingState="connected"
      reconnectAttempt={0}
      settings={defaultSettings()}
      inviteCopied={false}
      turnAvailable
      recordingState={handlers.recordingState ?? { phase: 'idle' }}
      recordingBannerMessage={handlers.recordingBannerMessage ?? ''}
      devices={handlers.devices ?? { inputs: [], outputs: [], cameras: [] }}
      onCopyInvite={vi.fn()}
      onMute={handlers.onMute ?? vi.fn()}
      onCamera={handlers.onCamera ?? vi.fn()}
      onInputDevice={handlers.onInputDevice ?? vi.fn()}
      onOutputDevice={handlers.onOutputDevice ?? vi.fn()}
      onCameraDevice={handlers.onCameraDevice ?? vi.fn()}
      onCameraBackground={handlers.onCameraBackground ?? vi.fn()}
      onScreen={onScreen}
      onReaction={onReaction}
      onRoomChatSend={handlers.onRoomChatSend ?? vi.fn(() => true)}
      onScreenFocusChange={handlers.onScreenFocusChange ?? vi.fn()}
      onSettings={handlers.onSettings ?? vi.fn()}
      onRecording={handlers.onRecording ?? vi.fn()}
      onRecordingBannerClose={handlers.onRecordingBannerClose ?? vi.fn()}
      onLeave={handlers.onLeave ?? vi.fn()}
      onPeerVolume={vi.fn()}
      onScreenVolume={onScreenVolume}
      onPeerMute={vi.fn()}
      onModerationMute={vi.fn()}
    />
  );
}

describe('RoomView media layouts', () => {
  it('opens a registered participant profile from an avatar, but not over active video', () => {
    const registeredParticipants: Participant[] = [
      participants[0]!,
      {
        ...participants[1]!,
        accountId: '33333333-3333-4333-8333-333333333333',
        avatar: 'https://example.com/friend.webp',
      },
    ];
    const audio = render(
      view('none', {}, false, vi.fn(), vi.fn(), vi.fn(), {
        viewerId: '44444444-4444-4444-8444-444444444444',
        participants: registeredParticipants,
      }),
    );
    fireEvent.click(audio.getByRole('button', { name: 'Открыть полный профиль Друг' }));
    expect(audio.getByRole('dialog', { name: 'Профиль Друг' })).toBeTruthy();
    audio.unmount();

    const video = render(
      view('none', { [peerId]: { camera: stream } }, false, vi.fn(), vi.fn(), vi.fn(), {
        viewerId: '44444444-4444-4444-8444-444444444444',
        participants: registeredParticipants,
      }),
    );
    expect(video.queryByRole('button', { name: 'Открыть полный профиль Друг' })).toBeNull();
  });

  it('uses compact audio cards without technical TURN copy', () => {
    const { container, queryByText } = render(view());
    expect(container.querySelector('.room-mode-audio')).not.toBeNull();
    expect(container.querySelectorAll('.participant-card.audio-tile')).toHaveLength(2);
    expect(queryByText(/TURN резерв/)).toBeNull();
  });

  it('turns a participant card itself into the camera surface', () => {
    const { container } = render(view('camera'));
    expect(container.querySelector('.room-mode-camera')).not.toBeNull();
    expect(
      container.querySelector('.participant-card.camera-tile > .participant-video'),
    ).not.toBeNull();
    expect(container.textContent).not.toContain('Ваша камера');
  });

  it('uses a primary stage and secondary participant strip for screen sharing', () => {
    const { container, getByText } = render(view('none', { [peerId]: { screen: stream } }));
    expect(container.querySelector('.room-mode-presentation .screen-stage')).not.toBeNull();
    expect(container.querySelectorAll('.participant-strip .participant-card')).toHaveLength(2);
    expect(getByText('Демонстрация экрана')).not.toBeNull();
    expect(container.querySelector('.participants-grid')).toBeNull();
  });

  it('does not detach the active screen stream when speaking state changes', () => {
    const { getByLabelText, rerender } = render(
      view('none', { [peerId]: { screen: stream } }, false),
    );
    const video = getByLabelText('Экран Друг') as HTMLVideoElement;
    let current = video.srcObject;
    const assignments: Array<MediaProvider | null> = [];
    Object.defineProperty(video, 'srcObject', {
      configurable: true,
      get: () => current,
      set: (value: MediaProvider | null) => {
        current = value;
        assignments.push(value);
      },
    });

    rerender(view('none', { [peerId]: { screen: stream } }, true));

    expect(getByLabelText('Экран Друг')).toBe(video);
    expect(assignments).toEqual([]);
  });

  it('keeps screen video muted because dedicated audio playback handles screen sound', () => {
    const remote = render(view('none', { [peerId]: { screen: stream } }));
    const remoteScreen = remote.getByLabelText('Экран Друг') as HTMLVideoElement;
    expect(remoteScreen.muted).toBe(true);
    expect(remoteScreen.volume).toBe(0);
    remote.unmount();

    const local = render(view('screen'));
    expect((local.getByLabelText('Экран Гера') as HTMLVideoElement).muted).toBe(true);
  });

  it('lets the listener adjust screen-share audio independently', () => {
    const onScreenVolume = vi.fn();
    const { getByLabelText } = render(
      view('none', { [peerId]: { screen: stream } }, false, vi.fn(), vi.fn(), onScreenVolume),
    );
    const slider = getByLabelText('Громкость демонстрации Друг');
    fireEvent.change(slider, { target: { value: '0.4' } });
    expect(onScreenVolume).toHaveBeenCalledWith(peerId, 0.4);
  });

  it('keeps the active screen control label compact', () => {
    const { getByRole } = render(view('screen'));
    expect(getByRole('button', { name: 'Остановить демонстрацию экрана' })).not.toBeNull();
  });

  it('opens the native screen chooser immediately without an intermediate dialog', () => {
    const onScreen = vi.fn();
    const { getByRole } = render(view('none', {}, false, onScreen));
    fireEvent.click(getByRole('button', { name: 'Демонстрация экрана' }));
    expect(onScreen).toHaveBeenCalledOnce();
  });

  it('centers call actions in islands and exposes fullscreen and popout controls', () => {
    const { container, getByRole } = render(view());
    expect(container.querySelectorAll('.voice-dock .dock-island')).toHaveLength(2);
    expect(container.querySelectorAll('.dock-split-control.device-on')).toHaveLength(1);
    expect(container.querySelectorAll('.dock-split-control.device-off')).toHaveLength(1);
    expect(getByRole('button', { name: 'Открыть звонок во весь экран' })).not.toBeNull();
    expect(getByRole('button', { name: 'Открыть звонок в отдельном окне' })).not.toBeNull();
  });

  it('moves the active call to a native window and can restore it', async () => {
    const { findByRole, getByRole } = render(view());

    fireEvent.click(getByRole('button', { name: 'Открыть звонок в отдельном окне' }));

    expect(invokeMock).toHaveBeenCalledWith('call_popout_open');
    fireEvent.click(await findByRole('button', { name: 'Вернуть звонок в основное окно' }));
    expect(invokeMock).toHaveBeenCalledWith('call_popout_restore');
  });

  it('quickly selects microphone, output, and camera devices from dock arrows', () => {
    const onInputDevice = vi.fn();
    const onOutputDevice = vi.fn();
    const onCameraDevice = vi.fn();
    const mediaDevice = (kind: MediaDeviceKind, deviceId: string, label: string) =>
      ({ kind, deviceId, label, groupId: 'group', toJSON: () => ({}) }) as MediaDeviceInfo;
    const { getByRole, queryByRole } = render(
      view('none', {}, false, vi.fn(), vi.fn(), vi.fn(), {
        devices: {
          inputs: [mediaDevice('audioinput', 'mic-1', 'Микрофон USB')],
          outputs: [mediaDevice('audiooutput', 'speaker-1', 'Наушники USB')],
          cameras: [mediaDevice('videoinput', 'camera-1', 'Камера USB')],
        },
        onInputDevice,
        onOutputDevice,
        onCameraDevice,
      }),
    );

    fireEvent.click(getByRole('button', { name: 'Выбрать аудиоустройство' }));
    fireEvent.click(getByRole('menuitemradio', { name: 'Микрофон USB' }));
    expect(onInputDevice).toHaveBeenCalledWith('mic-1');

    fireEvent.click(getByRole('button', { name: 'Выбрать аудиоустройство' }));
    fireEvent.click(getByRole('menuitemradio', { name: 'Наушники USB' }));
    expect(onOutputDevice).toHaveBeenCalledWith('speaker-1');

    fireEvent.click(getByRole('button', { name: 'Выбрать камеру' }));
    expect(queryByRole('menuitemradio', { name: 'Камера USB' })).toBeNull();
    fireEvent.click(getByRole('button', { name: 'Системная камера' }));
    fireEvent.click(getByRole('menuitemradio', { name: 'Камера USB' }));
    expect(onCameraDevice).toHaveBeenCalledWith('camera-1');
  });

  it('closes the camera device menu when clicking outside it', () => {
    const { getByRole, queryByRole } = render(view());
    fireEvent.click(getByRole('button', { name: 'Выбрать камеру' }));
    expect(getByRole('menu', { name: 'Камера' })).not.toBeNull();
    fireEvent.mouseDown(document.body);
    expect(queryByRole('menu', { name: 'Камера' })).toBeNull();
  });

  it('opens the same camera preview from the camera device menu', () => {
    const { getByRole, getByText } = render(view());
    fireEvent.click(getByRole('button', { name: 'Выбрать камеру' }));
    fireEvent.click(getByRole('button', { name: 'Предпросмотр камеры' }));
    expect(getByRole('dialog', { name: 'Готовы к видеочату?' })).not.toBeNull();
    expect(getByText('Пусто')).not.toBeNull();
    expect(getByText('Размытие')).not.toBeNull();
    expect(getByText('Свой фон')).not.toBeNull();
    fireEvent.click(getByRole('button', { name: 'Закрыть предпросмотр' }));
  });

  it('shows creator recording controls and a dismissible start banner', () => {
    const onRecording = vi.fn();
    const onRecordingBannerClose = vi.fn();
    const { getByRole, getByText } = render(
      view('none', {}, false, vi.fn(), vi.fn(), vi.fn(), {
        recordingState: { phase: 'recording', startedAt: Date.now() },
        recordingBannerMessage: 'Гера начал(а) запись экрана',
        onRecording,
        onRecordingBannerClose,
      }),
    );
    fireEvent.click(getByRole('button', { name: 'Остановить запись экрана' }));
    expect(onRecording).toHaveBeenCalledOnce();
    expect(getByText('Гера начал(а) запись экрана')).not.toBeNull();
    fireEvent.click(getByRole('button', { name: 'ОК' }));
    expect(onRecordingBannerClose).toHaveBeenCalledOnce();
  });

  it('shows the call timer and sends one of five reactions', () => {
    const onReaction = vi.fn();
    const { getByRole, getByLabelText } = render(view('none', {}, false, vi.fn(), onReaction));
    expect(getByLabelText(/Длительность звонка 01:05/)).not.toBeNull();
    fireEvent.click(getByRole('button', { name: 'Отправить реакцию' }));
    expect(getByRole('menu', { name: 'Реакции' }).querySelectorAll('button')).toHaveLength(5);
    fireEvent.click(getByRole('menuitem', { name: 'Отправить реакцию 🎉' }));
    expect(onReaction).toHaveBeenCalledWith('🎉');
  });

  it('keeps all existing call-control handlers wired through camera preview', async () => {
    const handlers = {
      onMute: vi.fn(),
      onCamera: vi.fn(),
      onSettings: vi.fn(),
      onLeave: vi.fn(),
    };
    const { getByRole } = render(view('none', {}, false, vi.fn(), vi.fn(), vi.fn(), handlers));
    fireEvent.click(getByRole('button', { name: 'Выключить микрофон' }));
    fireEvent.click(getByRole('button', { name: 'Включить камеру' }));
    const preview = getByRole('dialog', { name: 'Готовы к видеочату?' });
    const enableCamera = within(preview).getByText('Включить камеру').closest('button')!;
    await waitFor(() => expect((enableCamera as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(enableCamera);
    fireEvent.click(getByRole('button', { name: 'Настройки аудио и устройств' }));
    fireEvent.click(getByRole('button', { name: 'Выйти из комнаты' }));
    expect(handlers.onMute).toHaveBeenCalledOnce();
    expect(handlers.onCamera).toHaveBeenCalledOnce();
    expect(handlers.onSettings).toHaveBeenCalledOnce();
    expect(handlers.onLeave).toHaveBeenCalledOnce();
  });

  it('opens the ephemeral room chat and sends a message', () => {
    const onRoomChatSend = vi.fn(() => true);
    const { container, getByRole, getByLabelText, queryByLabelText } = render(
      view('none', {}, false, vi.fn(), vi.fn(), vi.fn(), { onRoomChatSend }),
    );
    fireEvent.click(getByRole('button', { name: 'Чат комнаты' }));
    const composer = getByLabelText('Сообщение в чат комнаты');
    fireEvent.change(composer, { target: { value: 'Привет комнате' } });
    fireEvent.keyDown(composer, { key: 'Enter' });
    expect(onRoomChatSend).toHaveBeenCalledWith('Привет комнате');
    fireEvent.click(getByRole('button', { name: 'Чат комнаты' }));
    const panel = container.querySelector('.room-chat-panel') as HTMLElement;
    expect(panel.classList.contains('closing')).toBe(true);
    fireEvent.animationEnd(panel);
    expect(queryByLabelText('Сообщение в чат комнаты')).toBeNull();
  });

  it('counts remote room messages while closed and clears the badge when chat opens', () => {
    const { rerender, getByRole, getByText, queryByText } = render(view());
    rerender(
      view('none', {}, false, vi.fn(), vi.fn(), vi.fn(), {
        roomChatMessages: [
          {
            id: '33333333-3333-4333-8333-333333333333',
            participantId: peerId,
            senderName: 'Друг',
            text: 'Новое сообщение',
            timestamp: Date.now(),
          },
          {
            id: '44444444-4444-4444-8444-444444444444',
            participantId: peerId,
            senderName: 'Друг',
            text: 'Ещё одно сообщение',
            timestamp: Date.now() + 1,
          },
        ],
      }),
    );
    expect(getByText('2').classList.contains('room-chat-badge')).toBe(true);
    fireEvent.click(getByRole('button', { name: 'Чат комнаты, непрочитанных сообщений: 2' }));
    expect(queryByText('2')).toBeNull();
  });

  it('does not count own room messages as unread', () => {
    const { rerender, queryByText } = render(view());
    rerender(
      view('none', {}, false, vi.fn(), vi.fn(), vi.fn(), {
        roomChatMessages: [
          {
            id: '55555555-5555-4555-8555-555555555555',
            participantId: selfId,
            senderName: 'Я',
            text: 'Моё сообщение',
            timestamp: Date.now(),
          },
        ],
      }),
    );
    expect(queryByText('1')).toBeNull();
  });

  it('enters screen focus mode through the existing screen video without an overlay', () => {
    const onScreenFocusChange = vi.fn();
    const { container, getByLabelText, getByRole, queryByRole, rerender } = render(
      view('none', { [peerId]: { screen: stream } }, false, vi.fn(), vi.fn(), vi.fn(), {
        onScreenFocusChange,
      }),
    );
    const screenVideo = getByLabelText('Экран Друг');
    fireEvent.click(getByRole('button', { name: 'Раскрыть демонстрацию экрана Друг' }));
    expect(onScreenFocusChange).toHaveBeenCalledWith(true);
    expect(queryByRole('dialog')).toBeNull();
    rerender(
      view('none', { [peerId]: { screen: stream } }, false, vi.fn(), vi.fn(), vi.fn(), {
        onScreenFocusChange,
        screenFocusMode: true,
      }),
    );
    expect(container.querySelector('.screen-focus-mode')).not.toBeNull();
    expect(getByLabelText('Экран Друг')).toBe(screenVideo);
    fireEvent.click(getByRole('button', { name: 'Свернуть демонстрацию экрана Друг' }));
    expect(onScreenFocusChange).toHaveBeenLastCalledWith(false);
  });

  it('shows screen as the stage and keeps the camera in the participant strip', () => {
    const { container } = render(view('both'));
    expect(container.querySelector('.screen-stage')).not.toBeNull();
    expect(container.querySelector('.participant-strip .camera-tile')).not.toBeNull();
    expect(container.querySelectorAll('video')).toHaveLength(2);
  });

  it('keeps camera expand and participant menu controls separate beside a shared screen', () => {
    const { container, getByRole } = render(view('screen', { [peerId]: { camera: stream } }));
    const compactCamera = container.querySelector('.participant-strip .compact-tile.camera-tile');
    expect(compactCamera).not.toBeNull();
    expect(
      compactCamera?.querySelector('button[aria-label="Раскрыть камеру Друг"]'),
    ).not.toBeNull();
    fireEvent.click(getByRole('button', { name: 'Действия для Друг' }));
    expect(compactCamera?.querySelector('.participant-menu')).not.toBeNull();
  });

  it('mirrors camera video in tiles and expanded view', () => {
    const { container, getByRole } = render(view('camera'));
    const camera = getByRole('button', { name: /Раскрыть камеру Гера/ });
    fireEvent.click(camera);
    const dialog = getByRole('dialog');
    expect(dialog).not.toBeNull();
    expect(container.querySelectorAll('video.mirrored')).toHaveLength(2);
    fireEvent.click(getByRole('button', { name: 'Закрыть раскрытое видео' }));
    expect(dialog.classList.contains('closing')).toBe(true);
    fireEvent.animationEnd(dialog);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('mirrors a remote participant camera too', () => {
    const { getByLabelText } = render(view('none', { [peerId]: { camera: stream } }));
    expect(getByLabelText('Камера Друг').classList.contains('mirrored')).toBe(true);
  });

  it('lets the user switch the primary stage when two screens are shared', () => {
    const remoteScreen = {} as MediaStream;
    const { getByRole, getByLabelText } = render(
      view('both', { [peerId]: { camera: stream, screen: remoteScreen } }),
    );
    expect(getByLabelText('Экран Гера')).not.toBeNull();
    fireEvent.click(getByRole('button', { name: 'Показать экран Друг' }));
    expect(getByLabelText('Экран Друг')).not.toBeNull();
  });
});
