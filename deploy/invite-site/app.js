(() => {
  const roomCode =
    globalThis.location.pathname.split('/').filter(Boolean).at(-1)?.toUpperCase() ?? '';
  const valid = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{12}$/.test(roomCode);
  const openButton = globalThis.document.querySelector('#open-app');
  const status = globalThis.document.querySelector('#status');
  globalThis.document.querySelector('#room-code').textContent = valid ? roomCode : 'не найдена';
  if (!valid) {
    openButton.hidden = true;
    status.textContent = 'Ссылка повреждена или содержит неправильный код комнаты.';
    return;
  }
  const deepLink = `freetalk://join/${roomCode}`;
  openButton.href = deepLink;
  globalThis.setTimeout(() => {
    globalThis.location.href = deepLink;
  }, 250);
})();
