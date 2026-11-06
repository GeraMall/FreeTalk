export interface VideoPlayback {
  ready: boolean;
  playing: boolean;
  current: number;
  duration: number;
  volume: number;
  muted: boolean;
}
export interface VideoController {
  play(): void;
  pause(): void;
  seek(time: number): void;
  volume(value: number): void;
  destroy(): void;
}
interface YoutubePlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(time: number, allowSeekAhead: boolean): void;
  setVolume(volume: number): void;
  unMute(): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  getVolume(): number;
  isMuted(): boolean;
  destroy(): void;
}
interface YoutubeApi {
  Player: new (
    frame: HTMLIFrameElement,
    options: { events: { onReady(): void; onStateChange(): void; onError(): void } },
  ) => YoutubePlayer;
}
declare global {
  interface Window {
    YT?: YoutubeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}
let youtubeApi: Promise<YoutubeApi> | undefined;
function loadYoutubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (youtubeApi) return youtubeApi;
  youtubeApi = new Promise<YoutubeApi>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    const timeout = window.setTimeout(() => {
      youtubeApi = undefined;
      script.remove();
      reject(new Error('YouTube API timeout'));
    }, 12000);
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      window.clearTimeout(timeout);
      if (window.YT) resolve(window.YT);
      else reject(new Error('YouTube API unavailable'));
    };
    script.onerror = () => {
      window.clearTimeout(timeout);
      youtubeApi = undefined;
      script.remove();
      reject(new Error('YouTube API unavailable'));
    };
    document.head.append(script);
  });
  return youtubeApi;
}
const cleanTime = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
export function attachVideoController(
  frame: HTMLIFrameElement,
  provider: string,
  changed: (state: VideoPlayback) => void,
): VideoController {
  let apiFailed = false;
  let disposed = false,
    player: YoutubePlayer | undefined,
    timer: number | undefined;
  let state: VideoPlayback = {
    ready: false,
    playing: false,
    current: 0,
    duration: 0,
    volume: 1,
    muted: false,
  };
  const update = (next: Partial<VideoPlayback>) => {
    if (!disposed) {
      state = { ...state, ...next };
      changed(state);
    }
  };
  const rutube = (type: string, data: Record<string, unknown> = {}) =>
    frame.contentWindow?.postMessage(JSON.stringify({ type, data }), 'https://rutube.ru');
  const message = (event: MessageEvent) => {
    if (
      provider !== 'Rutube' ||
      event.source !== frame.contentWindow ||
      event.origin !== 'https://rutube.ru'
    )
      return;
    let value: { type?: string; data?: Record<string, unknown> };
    try {
      value = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
    } catch {
      return;
    }
    if (!value || typeof value !== 'object') return;
    const data = value.data ?? {};
    switch (value.type) {
      case 'player:ready':
        update({ ready: true });
        rutube('player:hideControls');
        break;
      case 'player:changeState':
        update({ playing: data.state === 'playing' });
        break;
      case 'player:currentTime':
        update({ current: cleanTime(data.time) });
        break;
      case 'player:durationChange':
        update({ duration: cleanTime(data.duration) });
        break;
      case 'player:playOptionsLoaded':
      case 'player:playOptionLoaded':
        update({ duration: cleanTime(data.duration) });
        break;
      case 'player:volumeChange':
        update({ volume: Math.min(1, cleanTime(Number(data.volume))), muted: data.muted === true });
        break;
      case 'player:adStart':
        update({ ready: false });
        break;
      case 'player:adEnd':
        update({ ready: true });
        break;
      case 'player:error':
        update({ playing: false, ready: false });
        break;
      case 'player:playComplete':
        update({ playing: false });
        break;
    }
  };
  window.addEventListener('message', message);
  if (provider === 'YouTube')
    void loadYoutubeApi()
      .then((api) => {
        if (disposed) return;
        const sample = () => {
          if (!player || disposed) return;
          try {
            update({
              ready: !apiFailed,
              current: cleanTime(player.getCurrentTime()),
              duration: cleanTime(player.getDuration()),
              playing: player.getPlayerState() === 1,
              volume: Math.min(1, cleanTime(player.getVolume() / 100)),
              muted: player.isMuted(),
            });
          } catch {
            /* SDK can be between video states. */
          }
        };
        player = new api.Player(frame, {
          events: {
            onReady: () => {
              sample();
              timer = window.setInterval(sample, 250);
            },
            onStateChange: () => {
              if (player?.getPlayerState() === 1) apiFailed = false;
              sample();
            },
            onError: () => {
              apiFailed = true;
              update({ ready: false, playing: false });
            },
          },
        });
      })
      .catch(() => update({ ready: false }));
  return {
    play() {
      if (provider === 'YouTube') player?.playVideo();
      else rutube('player:play');
    },
    pause() {
      if (provider === 'YouTube') player?.pauseVideo();
      else rutube('player:pause');
    },
    seek(time) {
      const target = Math.max(0, Math.min(state.duration, time));
      if (provider === 'YouTube') player?.seekTo(target, true);
      else rutube('player:setCurrentTime', { time: target });
      update({ current: target });
    },
    volume(value) {
      const volume = Math.max(0, Math.min(1, value));
      if (provider === 'YouTube') {
        player?.unMute();
        player?.setVolume(volume * 100);
      } else {
        rutube('player:unMute');
        rutube('player:setVolume', { volume });
      }
      update({ volume, muted: false });
    },
    destroy() {
      disposed = true;
      window.removeEventListener('message', message);
      if (timer) window.clearInterval(timer);
      const parent = frame.parentNode;
      const sibling = frame.nextSibling;
      try {
        player?.destroy();
      } catch {
        /* React may already have detached the iframe. */
      }
      if (parent?.isConnected && !frame.isConnected)
        parent.insertBefore(frame, sibling?.parentNode === parent ? sibling : null);
    },
  };
}
