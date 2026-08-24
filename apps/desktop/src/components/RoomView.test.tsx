// @vitest-environment jsdom

import { render } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
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

function view(
  localSource: 'none' | 'camera' | 'screen' = 'none',
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
        source: localSource,
        cameraEnabled: localSource === 'camera',
        screenEnabled: localSource === 'screen',
        previewStream: localSource === 'none' ? undefined : stream,
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
    const { container, getByText } = render(
      view('none', { [peerId]: { source: 'screen', stream } }),
    );
    expect(container.querySelector('.room-mode-presentation .screen-stage')).not.toBeNull();
    expect(container.querySelectorAll('.participant-strip .participant-card')).toHaveLength(2);
    expect(getByText('Демонстрация экрана')).not.toBeNull();
    expect(container.querySelector('.participants-grid')).toBeNull();
  });

  it('keeps the active screen control label compact', () => {
    const { getByRole } = render(view('screen'));
    expect(getByRole('button', { name: /Стоп/ })).not.toBeNull();
  });
});
