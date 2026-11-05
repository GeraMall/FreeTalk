import { t } from '../lib/app-language';
import { useEffect, useId, useRef, useState } from 'react';
import {
  AudioLines,
  Camera,
  CameraOff,
  Check,
  ChevronDown,
  Headphones,
  Mic,
  MonitorUp,
  PhoneOff,
  SmilePlus,
  Wifi,
  type LucideIcon,
} from 'lucide-react';
import type { Reaction } from '@freetalk/protocol';

export interface CallDockState {
  active: boolean;
  muted: boolean;
  deafened: boolean;
  strength: number;
  pingMs?: number;
  title: string;
  camera: boolean;
  screen: boolean;
  noiseSuppression: boolean;
  busy: boolean;
  inputs: MediaDeviceInfo[];
  outputs: MediaDeviceInfo[];
  inputId: string;
  outputId: string;
  onMute(): void;
  onDeafen(): void;
  onCamera(): void;
  onScreen(): void;
  onNoise(): void;
  onLeave(): void;
  onOpen(): void;
  onReaction(reaction: Reaction): void;
  onInput(id: string): void;
  onOutput(id: string): void;
  onDevices(): void;
}

export function CallDock({ state }: { state: CallDockState }) {
  const [reactions, setReactions] = useState(false);
  if (!state.active) return null;
  const tone =
    state.strength >= 75
      ? 'good'
      : state.strength >= 55
        ? 'fair'
        : state.strength >= 30
          ? 'poor'
          : 'offline';
  return (
    <div className="sidebar-call-dock">
      <div className={`sidebar-call-status ${tone}`}>
        <div
          className="sidebar-call-location"
          data-tooltip={state.title}
          aria-label={t('Состояние звонка')}
        >
          <Wifi size={18} />
          <span>
            <strong>
              {state.pingMs ? t('Пинг · {p0} мс', { p0: state.pingMs }) : t('Пинг · —')}
            </strong>
            <small>{state.title}</small>
          </span>
        </div>
        <button className="dock-hangup" onClick={state.onLeave} aria-label={t('Завершить звонок')}>
          <PhoneOff size={18} />
        </button>
      </div>
      <div className="sidebar-call-tools">
        <button
          aria-label={state.camera ? t('Выключить камеру') : t('Включить камеру')}
          aria-pressed={state.camera}
          disabled={state.busy}
          onClick={state.onCamera}
        >
          {state.camera ? <Camera /> : <CameraOff />}
        </button>
        <button
          aria-label={state.screen ? t('Остановить демонстрацию') : t('Демонстрация экрана')}
          aria-pressed={state.screen}
          disabled={state.busy}
          onClick={state.onScreen}
        >
          <MonitorUp />
        </button>
        <button
          aria-label={t('Отправить реакцию')}
          aria-expanded={reactions}
          onClick={() => setReactions(!reactions)}
        >
          <SmilePlus />
        </button>
        <button
          aria-label={t('Шумоподавление')}
          aria-pressed={state.noiseSuppression}
          data-tooltip={t('Шумоподавление')}
          onClick={state.onNoise}
        >
          <AudioLines />
        </button>
      </div>
      {reactions && (
        <div className="dock-reactions">
          {(['👍', '❤️', '😂', '🔥', '🎉'] as const).map((reaction) => (
            <button
              key={reaction}
              aria-label={t('Реакция {p0}', { p0: reaction })}
              onClick={() => {
                state.onReaction(reaction);
                setReactions(false);
              }}
            >
              {reaction}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function DeviceControlIcon({ icon: Icon, off }: { icon: LucideIcon; off: boolean }) {
  const maskId = useId();
  const slash = 'M2 2l20 20';
  return (
    <span className="device-control-icon" data-off={off} aria-hidden="true">
      <Icon mask={`url(#${maskId})`} />
      <svg viewBox="0 0 24 24" fill="none">
        <defs>
          <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
            <rect width="24" height="24" fill="white" />
            <path
              className="profile-audio-cut"
              d={slash}
              pathLength="1"
              stroke="black"
              strokeWidth="4.5"
            />
          </mask>
        </defs>
        <path className="profile-audio-cut profile-audio-slash" d={slash} pathLength="1" />
      </svg>
    </span>
  );
}

export function ProfileAudioControls({ state }: { state: CallDockState }) {
  const [deviceMenu, setDeviceMenu] = useState<'input' | 'output'>();
  const controlsRef = useRef<HTMLDivElement>(null);
  const inputTrigger = useRef<HTMLButtonElement>(null);
  const outputTrigger = useRef<HTMLButtonElement>(null);
  const selectedId = (deviceMenu === 'input' ? state.inputId : state.outputId) || 'default';
  const devices = deviceMenu === 'input' ? state.inputs : state.outputs;
  const deviceLabel = deviceMenu === 'input' ? 'Микрофон' : 'Наушники / динамики';
  useEffect(() => {
    if (!deviceMenu) return;
    const dismissOutside = (event: Event) => {
      if (!controlsRef.current?.contains(event.target as Node)) setDeviceMenu(undefined);
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setDeviceMenu(undefined);
      (deviceMenu === 'input' ? inputTrigger : outputTrigger).current?.focus();
    };
    const menu = controlsRef.current?.querySelector('.profile-device-menu');
    (
      menu?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]') ??
      menu?.querySelector<HTMLButtonElement>('button')
    )?.focus({ preventScroll: true });
    document.addEventListener('pointerdown', dismissOutside);
    document.addEventListener('focusin', dismissOutside);
    document.addEventListener('keydown', dismissOnEscape);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside);
      document.removeEventListener('focusin', dismissOutside);
      document.removeEventListener('keydown', dismissOnEscape);
    };
  }, [deviceMenu]);
  return (
    <div className="profile-audio-controls" ref={controlsRef}>
      <span
        className={`profile-audio-device${state.muted ? ' is-muted' : ''}${deviceMenu === 'input' ? ' is-open' : ''}`}
      >
        <button
          aria-label={state.muted ? t('Включить микрофон') : t('Выключить микрофон')}
          aria-pressed={state.muted}
          onClick={state.onMute}
        >
          <DeviceControlIcon icon={Mic} off={state.muted} />
        </button>
        <button
          className="audio-device-chevron"
          ref={inputTrigger}
          aria-label={t('Выбор микрофона')}
          aria-expanded={deviceMenu === 'input'}
          onClick={() => {
            state.onDevices();
            setDeviceMenu(deviceMenu === 'input' ? undefined : 'input');
          }}
        >
          <ChevronDown />
        </button>
      </span>
      <span
        className={`profile-audio-device${state.deafened ? ' is-muted' : ''}${deviceMenu === 'output' ? ' is-open' : ''}`}
      >
        <button
          aria-label={
            state.deafened ? t('Включить звук собеседников') : t('Выключить звук собеседников')
          }
          aria-pressed={state.deafened}
          onClick={state.onDeafen}
        >
          <DeviceControlIcon icon={Headphones} off={state.deafened} />
        </button>
        <button
          className="audio-device-chevron"
          ref={outputTrigger}
          aria-label={t('Выбор наушников')}
          aria-expanded={deviceMenu === 'output'}
          onClick={() => {
            state.onDevices();
            setDeviceMenu(deviceMenu === 'output' ? undefined : 'output');
          }}
        >
          <ChevronDown />
        </button>
      </span>
      {deviceMenu && (
        <div className="dock-device-menu profile-device-menu" role="group" aria-label={deviceLabel}>
          <strong>{deviceLabel}</strong>
          {[
            { id: 'default', label: 'Системное устройство' },
            ...devices
              .filter((device) => device.deviceId && device.deviceId !== 'default')
              .map((device, index) => ({
                id: device.deviceId,
                label: device.label || `Устройство ${index + 1}`,
              })),
          ].map(({ id, label }) => (
            <button
              key={id}
              type="button"
              aria-pressed={selectedId === id}
              onClick={() => {
                (deviceMenu === 'input' ? state.onInput : state.onOutput)(id);
                setDeviceMenu(undefined);
                (deviceMenu === 'input' ? inputTrigger : outputTrigger).current?.focus();
              }}
            >
              <span>{label}</span>
              {selectedId === id && <Check size={15} aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
