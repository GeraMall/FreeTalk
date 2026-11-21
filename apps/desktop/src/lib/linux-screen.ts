export function captureLinuxScreen() {
  if (typeof navigator.mediaDevices?.getDisplayMedia !== 'function')
    throw new DOMException('Screen capture unavailable', 'NotSupportedError');
  return navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
}

export function linuxScreenCaptureError(error: unknown) {
  if (!(error instanceof DOMException)) return undefined;
  if (error.name === 'NotSupportedError')
    return 'Демонстрация недоступна в этом сеансе Linux. Проверьте WebKitGTK, PipeWire и портал захвата экрана.';
  if (error.name === 'NotAllowedError')
    return 'Демонстрация отменена или недоступна в текущем сеансе Linux.';
  return undefined;
}
