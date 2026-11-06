import { leaveWindowFullscreen, toggleMediaFullscreen } from '../lib/fullscreen';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Maximize2, Minimize2, Pause, Play, Volume2, VolumeX } from 'lucide-react';
import {
  attachVideoController,
  type VideoController,
  type VideoPlayback,
} from '../lib/embedded-video-controller';
import { t } from '../lib/app-language';

function time(value: number) {
  const seconds = Math.floor(Math.max(0, value));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
export function EmbeddedVideo({
  embed,
  provider,
  title,
}: {
  embed: string;
  provider: string;
  title: string;
}) {
  const [prepared, setPrepared] = useState(!isTauri());
  useEffect(() => {
    let alive = true;
    if (isTauri() && /Windows/i.test(navigator.userAgent))
      void invoke('prepare_video_player')
        .catch(console.error)
        .finally(() => {
          if (alive) setPrepared(true);
        });
    else setPrepared(true);
    return () => {
      alive = false;
    };
  }, []);
  const frame = useRef<HTMLIFrameElement>(null),
    controller = useRef<VideoController | undefined>(undefined);
  const [state, setState] = useState<VideoPlayback>({
    ready: false,
    playing: false,
    current: 0,
    duration: 0,
    volume: 1,
    muted: false,
  });
  const [scrub, setScrub] = useState<number>(),
    [fullscreen, setFullscreen] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const nativeFullscreen = useRef(false);
  useEffect(
    () => () => {
      void leaveWindowFullscreen(nativeFullscreen.current);
    },
    [],
  );
  useEffect(() => {
    if (!frame.current || !prepared) return;
    const handle = attachVideoController(frame.current, provider, setState);
    controller.current = handle;
    return () => {
      handle.destroy();
      if (controller.current === handle) controller.current = undefined;
    };
  }, [embed, provider, prepared]);
  useEffect(() => {
    const update = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);
  const seek = () => {
    if (scrub === undefined) return;
    controller.current?.seek(scrub);
    setScrub(undefined);
  };
  const toggleFullscreen = async () => {
    const target = stage.current?.parentElement;
    if (!target) return;
    try {
      if (isTauri()) {
        const mode = await toggleMediaFullscreen(target);
        nativeFullscreen.current = mode === 'window';
        setFullscreen(mode !== 'none');
      } else if (document.fullscreenElement) await document.exitFullscreen();
      else await target.requestFullscreen();
    } catch {
      /* The provider also exposes its own fullscreen command. */
    }
  };
  return (
    <>
      <div ref={stage} className="message-video-frame">
        <iframe
          ref={frame}
          src={prepared ? embed : undefined}
          title={title}
          sandbox="allow-scripts allow-same-origin allow-presentation"
          allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
      <div className="message-video-controls" role="group" aria-label={t('Управление видео')}>
        <div className="message-video-controls-top">
          <div className="message-video-volume">
            <button
              type="button"
              disabled={!state.ready}
              aria-label={t(state.muted || !state.volume ? 'Включить звук' : 'Выключить звук')}
              onClick={() => controller.current?.volume(state.muted || !state.volume ? 1 : 0)}
            >
              {state.muted || !state.volume ? <VolumeX size={18} /> : <Volume2 size={18} />}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={state.muted ? 0 : state.volume}
              style={
                {
                  '--video-position': `${(state.muted ? 0 : state.volume) * 100}%`,
                } as CSSProperties
              }
              disabled={!state.ready}
              aria-label={t('Громкость видео')}
              onChange={(event) => controller.current?.volume(Number(event.target.value))}
            />
          </div>
          <button
            type="button"
            className="message-video-play-toggle"
            aria-label={t(state.playing ? 'Пауза' : 'Воспроизвести')}
            disabled={!state.ready}
            onClick={() =>
              state.playing ? controller.current?.pause() : controller.current?.play()
            }
          >
            {state.playing ? (
              <Pause size={22} fill="currentColor" />
            ) : (
              <Play size={22} fill="currentColor" />
            )}
          </button>
          <button
            type="button"
            aria-label={t(fullscreen ? 'Выйти из полноэкранного режима' : 'На весь экран')}
            onClick={() => void toggleFullscreen()}
          >
            {fullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
        </div>
        <div className="message-video-timeline">
          <span>{time(scrub ?? state.current)}</span>
          <input
            type="range"
            min="0"
            max={state.duration || 1}
            step="0.1"
            value={scrub ?? Math.min(state.current, state.duration || 1)}
            style={
              {
                '--video-position': `${state.duration ? Math.min(100, ((scrub ?? state.current) / state.duration) * 100) : 0}%`,
              } as CSSProperties
            }
            disabled={!state.ready || !state.duration}
            aria-label={t('Перемотка видео')}
            aria-valuetext={`${time(scrub ?? state.current)} / ${time(state.duration)}`}
            onChange={(event) => setScrub(Number(event.target.value))}
            onPointerUp={seek}
            onKeyUp={seek}
            onBlur={seek}
          />
          <span>
            {state.duration
              ? `−${time(Math.max(0, state.duration - (scrub ?? state.current)))}`
              : '—:—'}
          </span>
        </div>
      </div>
    </>
  );
}
