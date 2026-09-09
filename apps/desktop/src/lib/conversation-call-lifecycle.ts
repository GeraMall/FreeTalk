export const WAITING_PARTICIPANT_CARD_MS = 30_000;
export const EMPTY_CONVERSATION_CALL_TIMEOUT_MS = 8 * 60_000;
export const CONVERSATION_CALL_MIN_HEIGHT = 180;
export const CONVERSATION_CALL_MIN_RATIO = 0.36;
export const CONVERSATION_CHAT_MIN_HEIGHT = 112;
export const CONVERSATION_CALL_MAX_RATIO = 0.72;

export function remainingConversationWaitMs(
  startedAt: number,
  timeoutMs: number,
  now = Date.now(),
) {
  return Math.max(0, timeoutMs - Math.max(0, now - startedAt));
}

export function isAbandonedConversationCall(
  startedAt: string | undefined,
  participantCount: number,
  now = Date.now(),
  aloneSince?: string,
) {
  if (!startedAt || participantCount > 1) return false;
  const abandonmentStartedAt = Date.parse(aloneSince || startedAt);
  return (
    Number.isFinite(abandonmentStartedAt) &&
    now - abandonmentStartedAt >= EMPTY_CONVERSATION_CALL_TIMEOUT_MS
  );
}

export function clampConversationCallHeight(height: number, workspaceHeight: number) {
  const minimumHeight = Math.max(
    CONVERSATION_CALL_MIN_HEIGHT,
    workspaceHeight * CONVERSATION_CALL_MIN_RATIO,
  );
  const maximumHeight = Math.min(
    workspaceHeight - CONVERSATION_CHAT_MIN_HEIGHT,
    workspaceHeight * CONVERSATION_CALL_MAX_RATIO,
  );
  return Math.max(minimumHeight, Math.min(maximumHeight, height));
}
