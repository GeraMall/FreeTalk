export const CALL_ACTIVITY_EVENT = 'trlka:call-activity-changed';
export const VOICE_ACTIVITY_EVENT = 'trlka:voice-activity';
export const ACCOUNT_PRESENCE_EVENT = 'trlka:account-presence';
let callActive = false;

export function isCallActive() {
  return callActive;
}

export function setCallActive(active: boolean) {
  if (callActive === active) return;
  callActive = active;
  window.dispatchEvent(new Event(CALL_ACTIVITY_EVENT));
}

export function markVoiceActivity() {
  if (callActive) window.dispatchEvent(new Event(VOICE_ACTIVITY_EVENT));
}
