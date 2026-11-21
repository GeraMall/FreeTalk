const { ipcRenderer } = require('electron');

window.addEventListener('DOMContentLoaded', () => {
  const choices = document.querySelector('.capture-sources');
  const cancel = document.querySelector('.capture-cancel');
  let selected = false;
  const choose = (index) => {
    if (selected) return;
    selected = true;
    ipcRenderer.send('trlka:capture-choice', index);
  };
  cancel.addEventListener('click', () => choose(-1));
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') choose(-1);
  });
  ipcRenderer.once('trlka:capture-options', (_event, sources) => {
    for (const source of sources) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'capture-source';
      button.title = source.name;
      const preview = document.createElement('span');
      preview.className = 'preview';
      if (source.thumbnail) {
        const image = document.createElement('img');
        image.src = source.thumbnail;
        image.alt = '';
        preview.append(image);
      }
      const label = document.createElement('span');
      label.className = 'source-name';
      label.textContent = source.name;
      button.append(preview, label);
      button.addEventListener('click', () => choose(source.index));
      choices.append(button);
    }
    cancel.focus();
  });
  ipcRenderer.send('trlka:capture-ready');
});
