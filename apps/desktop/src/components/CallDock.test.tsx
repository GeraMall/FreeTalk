// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CallDock, ProfileAudioControls, type CallDockState } from './CallDock';

afterEach(cleanup);
function state(): CallDockState {
  return {
    active: true,
    muted: false,
    deafened: false,
    strength: 91,
    pingMs: 47,
    title: 'Алексей, Мария',
    camera: false,
    screen: false,
    noiseSuppression: true,
    busy: false,
    inputs: [],
    outputs: [],
    inputId: '',
    outputId: '',
    onMute: vi.fn(),
    onDeafen: vi.fn(),
    onCamera: vi.fn(),
    onScreen: vi.fn(),
    onNoise: vi.fn(),
    onLeave: vi.fn(),
    onOpen: vi.fn(),
    onReaction: vi.fn(),
    onInput: vi.fn(),
    onOutput: vi.fn(),
    onDevices: vi.fn(),
  };
}
describe('CallDock', () => {
  it('keeps microphone and output controls outside a call but hides call-only controls', () => {
    const props = { ...state(), active: false };
    const view = render(
      <>
        <CallDock state={props} />
        <ProfileAudioControls state={props} />
      </>,
    );
    expect(view.queryByLabelText('Завершить звонок')).toBeNull();
    fireEvent.click(view.getByLabelText('Выключить микрофон'));
    fireEvent.click(view.getByLabelText('Выключить звук собеседников'));
    expect(props.onMute).toHaveBeenCalledOnce();
    expect(props.onDeafen).toHaveBeenCalledOnce();
  });
  it('wires camera, screen, noise, hangup and valid reactions to shared call handlers', () => {
    const props = state();
    const view = render(<CallDock state={props} />);
    for (const label of [
      'Включить камеру',
      'Демонстрация экрана',
      'Шумоподавление',
      'Завершить звонок',
    ])
      fireEvent.click(view.getByLabelText(label));
    expect(props.onCamera).toHaveBeenCalledOnce();
    expect(props.onScreen).toHaveBeenCalledOnce();
    expect(props.onNoise).toHaveBeenCalledOnce();
    expect(props.onLeave).toHaveBeenCalledOnce();
    fireEvent.click(view.getByLabelText('Отправить реакцию'));
    fireEvent.click(view.getByLabelText('Реакция 👍'));
    expect(props.onReaction).toHaveBeenCalledWith('👍');
    expect(view.queryByLabelText('Реакция 👍')).toBeNull();
    expect(view.getByText('Пинг · 47 мс')).toBeTruthy();
  });
  it('selects devices and closes the device menu', () => {
    const props = state();
    props.inputs = [{ deviceId: 'mic-2', label: 'USB Mic' } as MediaDeviceInfo];
    const view = render(<ProfileAudioControls state={props} />);
    fireEvent.click(view.getByLabelText('Выбор микрофона'));
    fireEvent.change(view.getByRole('combobox'), { target: { value: 'mic-2' } });
    expect(props.onInput).toHaveBeenCalledWith('mic-2');
    expect(view.queryByRole('combobox')).toBeNull();
  });
});
