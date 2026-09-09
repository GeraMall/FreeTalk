import { describe, expect, it } from 'vitest';
import {
  EMPTY_CONVERSATION_CALL_TIMEOUT_MS,
  clampConversationCallHeight,
  isAbandonedConversationCall,
  remainingConversationWaitMs,
  WAITING_PARTICIPANT_CARD_MS,
} from './conversation-call-lifecycle';

describe('conversation call lifecycle', () => {
  it('keeps invited cards for exactly 30 seconds', () => {
    expect(remainingConversationWaitMs(1_000, WAITING_PARTICIPANT_CARD_MS, 30_999)).toBe(1);
    expect(remainingConversationWaitMs(1_000, WAITING_PARTICIPANT_CARD_MS, 31_000)).toBe(0);
  });

  it('ends an empty conversation call after eight minutes', () => {
    expect(remainingConversationWaitMs(10_000, EMPTY_CONVERSATION_CALL_TIMEOUT_MS, 489_999)).toBe(
      1,
    );
    expect(remainingConversationWaitMs(10_000, EMPTY_CONVERSATION_CALL_TIMEOUT_MS, 490_000)).toBe(
      0,
    );
  });

  it('marks only solo calls older than eight minutes as abandoned', () => {
    const startedAt = '2026-09-08T10:00:00.000Z';
    const beforeTimeout = Date.parse(startedAt) + EMPTY_CONVERSATION_CALL_TIMEOUT_MS - 1;
    const atTimeout = Date.parse(startedAt) + EMPTY_CONVERSATION_CALL_TIMEOUT_MS;
    expect(isAbandonedConversationCall(startedAt, 1, beforeTimeout)).toBe(false);
    expect(isAbandonedConversationCall(startedAt, 1, atTimeout)).toBe(true);
    expect(isAbandonedConversationCall(startedAt, 2, atTimeout)).toBe(false);
  });

  it('restarts the eight-minute grace period when the other participant leaves', () => {
    const startedAt = '2026-09-08T10:00:00.000Z';
    const aloneSince = '2026-09-08T10:20:00.000Z';
    expect(
      isAbandonedConversationCall(startedAt, 1, Date.parse(aloneSince) + 30_000, aloneSince),
    ).toBe(false);
    expect(
      isAbandonedConversationCall(
        startedAt,
        1,
        Date.parse(aloneSince) + EMPTY_CONVERSATION_CALL_TIMEOUT_MS,
        aloneSince,
      ),
    ).toBe(true);
  });

  it('does not extend a timeout when the local clock is behind the start time', () => {
    expect(remainingConversationWaitMs(2_000, WAITING_PARTICIPANT_CARD_MS, 1_000)).toBe(
      WAITING_PARTICIPANT_CARD_MS,
    );
  });

  it('lets the call boundary move down while preserving a compact chat area', () => {
    expect(clampConversationCallHeight(620, 900)).toBe(620);
    expect(clampConversationCallHeight(760, 900)).toBe(648);
    expect(clampConversationCallHeight(860, 900)).toBe(648);
    expect(clampConversationCallHeight(40, 900)).toBe(324);
  });
});
