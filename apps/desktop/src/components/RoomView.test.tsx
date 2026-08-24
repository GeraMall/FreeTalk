// @vitest-environment jsdom

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Participant } from '@freetalk/protocol';
import { defaultSettings } from '../lib/settings';
import { RoomView, type RemoteVideoUiState } from './RoomView';

const selfId = '11111111-1111-4111-8111-111111111111';
const peerId = '22222222-2222-4222-8222-222222222222';
const participants: Participant[] = [
  { id: selfId, name: 'Гера', muted: false, isOwner: true, connectedAt: 1 },
  { id: peerId, name: 'Друг', muted: false, isOwner: false, connectedAt: 2 },
];
const stream = {} as MediaStream;

beforeAll(() => {
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    configurable: true,
    value: vi.fn().mockResolvedValue(undefined),
  });
});

afterEach(cleanup);

function view(
  localSource: 'none' | 'camera' | 'screen' | 'both' = 'none',
  remoteVideos: RemoteVideoUiState = {},
) {
  return (
    <RoomView
      roomId="ABCDEF123456"
      selfId={selfId}
      participants={participants}
      peerState={{
        [peerId]: { connection: 'connected', speaking: false, hasAudio: true },
      }}
      localSpeaking={false}
      localVideo={{
        source: localSource === 'both' ? 'screen' : localSource,
        cameraEnabled: localSource === 'camera' || localSource === 'both',
        screenEnabled: localSource === 'screen' || localSource === 'both',
        previewStream: localSource === 'none' ? undefined : stream,
        cameraStream: localSource === 'camera' || localSource === 'both' ? stream : undefined,
        screenStream: localSource === 'screen' || localSource === 'both' ? stream : undefined,
      }}
      remoteVideos={remoteVideos}
      videoBusy={false}
      muted={false}
      pttPressed={false}
      signalingState="connected"
      reconnectAttempt={0}
      settings={defaultSettings()}
      inviteCopied={false}
      turnAvailable
      onCopyInvite={vi.fn()}
      onMute={vi.fn()}
      onCamera={vi.fn()}
      onScreen={vi.fn()}
      onTransmissionMode={vi.fn()}
      onSettings={vi.fn()}
      onLeave={vi.fn()}
      onPeerVolume={vi.fn()}
      onPeerMute={vi.fn()}
      onModerationMute={vi.fn()}
    />
  );
}

describe('RoomView media layouts', () => {
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

  it('keeps the active screen control label compact', () => {
    const { getByRole } = render(view('screen'));
    expect(getByRole('button', { name: /Стоп/ })).not.toBeNull();
  });

  it('shows screen as the stage and keeps the camera in the participant strip', () => {
    const { container } = render(view('both'));
    expect(container.querySelector('.screen-stage')).not.toBeNull();
    expect(container.querySelector('.participant-strip .camera-tile')).not.toBeNull();
    expect(container.querySelectorAll('video')).toHaveLength(2);
  });

  it('opens camera tiles in the shared expanded media viewer without mirroring', () => {
    const { container, getByRole } = render(view('camera'));
    const camera = getByRole('button', { name: /Раскрыть камеру Гера/ });
    fireEvent.click(camera);
    const dialog = getByRole('dialog');
    expect(dialog).not.toBeNull();
    fireEvent.click(getByRole('button', { name: 'Закрыть раскрытое видео' }));
    expect(dialog.classList.contains('closing')).toBe(true);
    fireEvent.animationEnd(dialog);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    for (const video of container.querySelectorAll('video'))
      expect(video.style.transform).not.toContain('scaleX(-1)');
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
