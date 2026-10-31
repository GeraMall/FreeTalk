import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { selectNativeScreen, type NativeScreenSource } from './native-screen-picker';
export { cancelNativeScreenSelection } from './native-screen-picker';
import { screenEncodingProfile, type VideoPreferences } from './video-quality';

export const NATIVE_SCREEN_CHANNEL = 'trlka-native-screen-v1';
type Signal =
  | { kind: 'offer' | 'answer'; sdp: string }
  | { kind: 'ice'; candidate: RTCIceCandidateInit }
  | { kind: 'stop' }
  | { kind: 'restart' }
  | { kind: 'ready' };
interface IceEvent {
  sessionId: string;
  peerId: string;
  candidate: string;
  mid: string;
  mline: number;
}
interface LifecycleEvent {
  sessionId: string;
  reason: string;
}
export interface NativeScreenCapture {
  stream: MediaStream;
  stop(): Promise<void>;
}
let active: NativeScreenSession | undefined;

export function usesNativeWindowsCapture() {
  return '__TAURI_INTERNALS__' in window && /Windows/i.test(navigator.userAgent);
}
export function isNativeScreenTrack(track: MediaStreamTrack | null | undefined) {
  return Boolean(track && active?.stream.getVideoTracks().includes(track));
}

export async function startNativeWindowsScreen(
  preferences: VideoPreferences,
  audio: boolean,
  notice: (message: string) => void,
): Promise<NativeScreenCapture> {
  await active?.stop();
  const sources = await invoke<NativeScreenSource[]>('windows_screen_sources');
  const source = await selectNativeScreen(sources);
  const session = new NativeScreenSession(notice);
  try {
    await session.start(source, preferences, audio);
    active = session;
    return { stream: session.stream, stop: () => session.stop() };
  } catch (error) {
    await session.stop();
    throw error;
  }
}

function iceServersForNative(servers: RTCIceServer[]) {
  return servers.map((server) => ({
    urls: typeof server.urls === 'string' ? [server.urls] : server.urls,
    username: server.username,
    credential: typeof server.credential === 'string' ? server.credential : undefined,
  }));
}

class NativeScreenSession {
  servers: RTCIceServer[] = [];
  id = '';
  stream = new MediaStream();
  private disposed = false;
  private unlisten: (() => void)[] = [];
  private iceHandlers = new Map<string, (candidate: RTCIceCandidateInit) => void>();
  private peerQueues = new Map<string, Promise<void>>();
  private preview?: ScreenReceiver;
  private closers = new Set<() => void>();
  constructor(private readonly notice: (message: string) => void) {}

  async start(source: NativeScreenSource, preferences: VideoPreferences, audio: boolean) {
    this.unlisten.push(
      await listen<IceEvent>('windows-screen-ice', ({ payload }) => {
        if (payload.sessionId === this.id)
          this.iceHandlers.get(payload.peerId)?.({
            candidate: payload.candidate,
            sdpMid: payload.mid,
            sdpMLineIndex: payload.mline,
          });
      }),
    );
    this.unlisten.push(
      await listen<LifecycleEvent>('windows-screen-ended', ({ payload }) => {
        if (payload.sessionId !== this.id) return;
        this.notice(payload.reason);
        const track = this.stream.getVideoTracks()[0];
        // stop() does not fire ended, so explicitly notify VideoManager first.
        track?.dispatchEvent(new Event('ended'));
        void this.stop();
      }),
    );
    this.unlisten.push(
      await listen<LifecycleEvent>('windows-screen-audio-error', ({ payload }) => {
        if (payload.sessionId === this.id) {
          for (const track of this.stream.getAudioTracks()) {
            this.stream.removeTrack(track);
            track.stop();
            this.stream.dispatchEvent(new Event('removetrack'));
          }
          this.notice('Экран передаётся, но Windows не запустила звук. ' + payload.reason);
        }
      }),
    );
    const sizes = { '720p': [1280, 720], '1080p': [1920, 1080], '1440p': [2560, 1440] } as const;
    const [width, height] = sizes[preferences.screenResolution];
    this.id = await invoke<string>('windows_screen_start', {
      options: {
        sourceId: source.id,
        kind: source.kind,
        fps: preferences.screenFrameRate,
        width,
        height,
        bitrate: screenEncodingProfile(preferences).maxBitrate,
        audio,
      },
    });
    let readyResolve!: () => void;
    const ready = new Promise<void>((resolve) => {
      readyResolve = resolve;
    });
    this.preview = new ScreenReceiver(
      [],
      async (message) => {
        await this.acceptSignal('preview', message);
      },
      (stream, track) => {
        this.stream = stream;
        if (track.kind === 'video') readyResolve();
      },
      () => {
        this.notice('Локальный видеопоток демонстрации прерван. Запустите демонстрацию повторно.');
        this.stream.getVideoTracks()[0]?.dispatchEvent(new Event('ended'));
        void this.stop();
      },
    );
    this.iceHandlers.set('preview', (candidate) => {
      void this.preview?.receive({ kind: 'ice', candidate }).catch(() => undefined);
    });
    const sdp = await invoke<string>('windows_screen_offer', {
      sessionId: this.id,
      peerId: 'preview',
      iceServers: [],
    });
    await this.preview.receive({ kind: 'offer', sdp });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        ready,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Нативная демонстрация не вернула видеопоток')),
            12_000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    if (this.disposed) throw new Error('Демонстрация остановлена');
  }

  async addIce(peerId: string, candidate: RTCIceCandidateInit) {
    await invoke('windows_screen_ice', {
      sessionId: this.id,
      peerId,
      candidate: candidate.candidate || '',
      mid: candidate.sdpMid || '0',
      mline: candidate.sdpMLineIndex || 0,
    });
  }

  private acceptSignal(peerId: string, message: Signal) {
    const operation = (this.peerQueues.get(peerId) || Promise.resolve()).then(async () => {
      if (this.disposed) return;
      if (peerId === 'preview' && message.kind === 'restart')
        throw new Error('Local preview interrupted');
      if (message.kind === 'answer')
        await invoke('windows_screen_answer', { sessionId: this.id, peerId, sdp: message.sdp });
      else if (message.kind === 'ice') await this.addIce(peerId, message.candidate);
    });
    this.peerQueues.set(
      peerId,
      operation.catch(() => undefined),
    );
    return operation;
  }

  attach(
    peerId: string,
    channel: RTCDataChannel,
    servers: RTCIceServer[],
    onUnsupported: () => void,
  ) {
    this.servers = servers;
    let closed = false;
    let offered = false;
    let starting = false;
    let restarts = 0;
    let negotiation = Promise.resolve();
    let compatibilityTimer: ReturnType<typeof setTimeout> | undefined;
    const pending: RTCIceCandidateInit[] = [];
    const key = `peer-${peerId}`;
    const send = (message: Signal) => {
      if (!closed && channel.readyState === 'open') channel.send(JSON.stringify(message));
    };
    this.iceHandlers.set(key, (candidate) => {
      if (offered) send({ kind: 'ice', candidate });
      else pending.push(candidate);
    });
    const close = () => {
      if (closed) return;
      send({ kind: 'stop' });
      closed = true;
      clearTimeout(compatibilityTimer);
      this.iceHandlers.delete(key);
      this.closers.delete(close);
      channel.close();
      void invoke('windows_screen_close_peer', { sessionId: this.id, peerId: key }).catch(
        () => undefined,
      );
    };
    this.closers.add(close);
    channel.onmessage = ({ data }) => {
      const message = parseSignal(data);
      if (!message || closed) return;
      negotiation = negotiation
        .then(async () => {
          if (closed) return;
          if (message.kind === 'ready' && !starting) {
            clearTimeout(compatibilityTimer);
            starting = true;
            {
              const sdp = await invoke<string>('windows_screen_offer', {
                sessionId: this.id,
                peerId: key,
                iceServers: iceServersForNative(servers),
              });
              if (closed) return;
              send({ kind: 'offer', sdp });
              offered = true;
              pending.splice(0).forEach((candidate) => send({ kind: 'ice', candidate }));
            }
          } else if (message.kind === 'restart' && starting && restarts < 3) {
            restarts += 1;
            offered = false;
            const sdp = await invoke<string>('windows_screen_restart_peer', {
              sessionId: this.id,
              peerId: key,
              iceServers: iceServersForNative(this.servers),
            });
            send({ kind: 'offer', sdp });
            offered = true;
            pending.splice(0).forEach((candidate) => send({ kind: 'ice', candidate }));
          } else if (message.kind === 'answer') {
            await this.acceptSignal(key, message);
          } else if (message.kind === 'ice') {
            await this.acceptSignal(key, message);
          }
        })
        .catch((error) => {
          this.notice('Не удалось восстановить демонстрацию: ' + String(error));
          close();
        });
    };
    channel.onopen = () => {
      compatibilityTimer = setTimeout(() => {
        if (!closed && !starting) {
          close();
          onUnsupported();
        }
      }, 2_500);
    };
    if (channel.readyState === 'open') channel.onopen(new Event('open'));
    channel.onclose = () => {
      if (closed || this.disposed) return;
      close();
      onUnsupported();
    };
    return close;
  }

  async stop() {
    if (this.disposed) return;
    this.disposed = true;
    if (active === this) active = undefined;
    for (const close of [...this.closers]) close();
    this.preview?.close();
    this.stream.getTracks().forEach((track) => track.stop());
    this.unlisten.splice(0).forEach((unlisten) => unlisten());
    if (this.id) await invoke('windows_screen_stop', { sessionId: this.id }).catch(() => undefined);
  }
}

export function attachNativeScreenSender(
  peerId: string,
  channel: RTCDataChannel,
  servers: RTCIceServer[],
  onUnsupported: () => void,
) {
  return active?.attach(peerId, channel, servers, onUnsupported) ?? (() => channel.close());
}

export function updateNativeScreenIceServers(servers: RTCIceServer[]) {
  if (active) active.servers = servers;
}

export function receiveNativeScreen(
  channel: RTCDataChannel,
  servers: RTCIceServer[],
  onTrack: (stream: MediaStream, track: MediaStreamTrack) => void,
  onStop: () => void,
) {
  const receiver = new ScreenReceiver(
    servers,
    async (message) => {
      if (channel.readyState === 'open') channel.send(JSON.stringify(message));
    },
    onTrack,
    () => close(),
  );
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    receiver.close();
    channel.close();
    onStop();
  };
  channel.onmessage = ({ data }) => {
    const message = parseSignal(data);
    if (!message) return;
    if (message.kind === 'stop') close();
    else void receiver.receive(message).catch(close);
  };
  channel.onopen = () => channel.send(JSON.stringify({ kind: 'ready' }));
  channel.onclose = close;
  if (channel.readyState === 'open') channel.onopen(new Event('open'));
  return close;
}

export class ScreenReceiver {
  private readonly connection: RTCPeerConnection;
  private readonly pending: RTCIceCandidateInit[] = [];
  private queue = Promise.resolve();
  private stream = new MediaStream();
  private restartTimer: ReturnType<typeof setTimeout> | undefined;
  private restarts = 0;
  constructor(
    servers: RTCIceServer[],
    private readonly send: (message: Signal) => Promise<void>,
    onTrack: (stream: MediaStream, track: MediaStreamTrack) => void,
    private readonly onFailure: () => void = () => undefined,
  ) {
    this.connection = new RTCPeerConnection({ iceServers: servers, bundlePolicy: 'max-bundle' });
    this.connection.onicecandidate = ({ candidate }) => {
      if (candidate)
        void send({ kind: 'ice', candidate: candidate.toJSON() }).catch(() => undefined);
    };
    this.connection.ontrack = ({ track }) => {
      this.stream.addTrack(track);
      onTrack(this.stream, track);
    };
    this.connection.onconnectionstatechange = () => {
      const state = this.connection.connectionState;
      clearTimeout(this.restartTimer);
      if (state === 'disconnected' || state === 'failed')
        this.scheduleRestart(state === 'failed' ? 500 : 3_000);
    };
  }
  private scheduleRestart(delay: number) {
    this.restartTimer = setTimeout(() => {
      if (
        this.connection.connectionState === 'connected' ||
        this.connection.signalingState === 'closed'
      )
        return;
      if (this.restarts >= 3) {
        this.onFailure();
        return;
      }
      this.restarts += 1;
      void this.send({ kind: 'restart' }).catch(() => this.onFailure());
      this.scheduleRestart(8_000);
    }, delay);
  }
  receive(message: Signal): Promise<void> {
    const operation = this.queue.then(async () => {
      if (this.connection.signalingState === 'closed') return;
      if (message.kind === 'offer') {
        await this.connection.setRemoteDescription({ type: 'offer', sdp: message.sdp });
        for (const candidate of this.pending.splice(0))
          await this.connection.addIceCandidate(candidate);
        const answer = await this.connection.createAnswer();
        await this.connection.setLocalDescription(answer);
        await this.send({ kind: 'answer', sdp: answer.sdp! });
      } else if (message.kind === 'ice') {
        if (this.connection.remoteDescription)
          await this.connection.addIceCandidate(message.candidate);
        else if (this.pending.length < 128) this.pending.push(message.candidate);
      }
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }
  close() {
    clearTimeout(this.restartTimer);
    this.connection.close();
    this.stream.getTracks().forEach((track) => track.stop());
  }
}

export function parseSignal(raw: unknown): Signal | null {
  if (typeof raw !== 'string' || raw.length > 128_000) return null;
  try {
    const value = JSON.parse(raw);
    if (value?.kind === 'ready' || value?.kind === 'stop' || value?.kind === 'restart')
      return { kind: value.kind };
    if ((value?.kind === 'offer' || value?.kind === 'answer') && typeof value.sdp === 'string')
      return value;
    if (
      value?.kind === 'ice' &&
      typeof value.candidate?.candidate === 'string' &&
      value.candidate.candidate.length < 8192
    )
      return value;
  } catch {
    /* Ignore malformed messages from a remote participant. */
  }
  return null;
}
