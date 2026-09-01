const invoke = (command, args = {}) => window.__TAURI_INTERNALS__?.invoke(command, args);
const windowCommand = (command) =>
  invoke(`plugin:window|${command}`, { label: 'call-placeholder-window' });

document
  .querySelector('#restore')
  ?.addEventListener('click', () => void invoke('call_popout_restore'));
document
  .querySelector('#minimize')
  ?.addEventListener('click', () => void windowCommand('minimize'));
document
  .querySelector('#maximize')
  ?.addEventListener('click', () => void windowCommand('toggle_maximize'));
document
  .querySelector('#close')
  ?.addEventListener('click', () => void invoke('call_popout_restore'));

const titlebar = document.querySelector('#titlebar');
titlebar?.addEventListener('mousedown', (event) => {
  if (event.button !== 0 || event.target.closest('button')) return;
  void windowCommand('start_dragging');
});

titlebar?.addEventListener('dblclick', (event) => {
  if (event.target.closest('button')) return;
  void windowCommand('toggle_maximize');
});
document.addEventListener('contextmenu', (event) => event.preventDefault(), { capture: true });
