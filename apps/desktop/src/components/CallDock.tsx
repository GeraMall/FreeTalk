import { useState } from 'react';
import {
  AudioLines,
  Camera,
  CameraOff,
  ChevronDown,
  Headphones,
  HeadphoneOff,
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  SmilePlus,
  Wifi,
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
        <div className="sidebar-call-location" title={state.title} aria-label="Состояние звонка">
          <Wifi size={18} />
          <span>
            <strong>{state.pingMs ? `Пинг · ${state.pingMs} мс` : 'Пинг · —'}</strong>
            <small>{state.title}</small>
          </span>
        </div>
        <button className="dock-hangup" onClick={state.onLeave} aria-label="Завершить звонок">
          <PhoneOff size={18} />
        </button>
      </div>
      <div className="sidebar-call-tools">
        <button
          aria-label={state.camera ? 'Выключить камеру' : 'Включить камеру'}
          aria-pressed={state.camera}
          disabled={state.busy}
          onClick={state.onCamera}
        >
          {state.camera ? <Camera /> : <CameraOff />}
        </button>
        <button
          aria-label={state.screen ? 'Остановить демонстрацию' : 'Демонстрация экрана'}
          aria-pressed={state.screen}
          disabled={state.busy}
          onClick={state.onScreen}
        >
          <MonitorUp />
        </button>
        <button
          aria-label="Отправить реакцию"
          aria-expanded={reactions}
          onClick={() => setReactions(!reactions)}
        >
          <SmilePlus />
        </button>
        <button
          aria-label="Шумоподавление"
          aria-pressed={state.noiseSuppression}
          data-tooltip="Шумоподавление"
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
              aria-label={`Реакция ${reaction}`}
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

export function ProfileAudioControls({ state }: { state: CallDockState }) {
  const [deviceMenu, setDeviceMenu] = useState<'input' | 'output'>();
  return (
    <div className="profile-audio-controls">
      <span className="profile-audio-device">
        <button
          aria-label={state.muted ? 'Включить микрофон' : 'Выключить микрофон'}
          aria-pressed={state.muted}
          onClick={state.onMute}
        >
          {state.muted ? <MicOff /> : <Mic />}
        </button>
        <button
          className="audio-device-chevron"
          aria-label="Выбор микрофона"
          aria-expanded={deviceMenu === 'input'}
          onClick={() => {
            state.onDevices();
            setDeviceMenu(deviceMenu === 'input' ? undefined : 'input');
          }}
        >
          <ChevronDown />
        </button>
      </span>
      <span className="profile-audio-device">
        <button
          aria-label={state.deafened ? 'Включить звук собеседников' : 'Выключить звук собеседников'}
          aria-pressed={state.deafened}
          onClick={state.onDeafen}
        >
          {state.deafened ? <HeadphoneOff /> : <Headphones />}
        </button>
        <button
          className="audio-device-chevron"
          aria-label="Выбор наушников"
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
        <div
          className="dock-device-menu"
          onKeyDown={(event) => {
            if (event.key === 'Escape') setDeviceMenu(undefined);
          }}
        >
          <label>
            {deviceMenu === 'input' ? 'Микрофон' : 'Наушники / динамики'}
            <select
              value={deviceMenu === 'input' ? state.inputId : state.outputId}
              onChange={(event) => {
                (deviceMenu === 'input' ? state.onInput : state.onOutput)(event.target.value);
                setDeviceMenu(undefined);
              }}
            >
              <option value="default">Системное устройство</option>
              {(deviceMenu === 'input' ? state.inputs : state.outputs)
                .filter((device) => device.deviceId !== 'default')
                .map((device, index) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `Устройство ${index + 1}`}
                  </option>
                ))}
            </select>
          </label>
          <button onClick={() => setDeviceMenu(undefined)}>Закрыть</button>
        </div>
      )}
    </div>
  );
}
