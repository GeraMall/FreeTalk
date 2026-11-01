export const CALL_ACTIVITY_EVENT = 'trlka:call-activity-changed';
let callActive = false;

export function isCallActive() {
  return callActive;
}

export function setCallActive(active: boolean) {
  if (callActive === active) return;
  callActive = active;
  window.dispatchEvent(new Event(CALL_ACTIVITY_EVENT));
}
