import { describe, expect, it } from 'vitest';
import { serviceCommand } from '../src/service-chat-commands.js';
describe('service chat commands', () => {
  it('takes a report only after an explicit category or command', () => {
    expect(serviceCommand('звонок завис')).toEqual({ type: 'unknown' });
    expect(serviceCommand('/bug')).toEqual({ type: 'prompt', kind: 'bug' });
    expect(serviceCommand('звонок завис', 'bug')).toEqual({
      type: 'report',
      kind: 'bug',
      body: 'звонок завис',
    });
    expect(serviceCommand('/idea добавить тему')).toEqual({
      type: 'report',
      kind: 'idea',
      body: 'добавить тему',
    });
  });
  it('recognizes commands during a draft and does not turn them into reports', () => {
    expect(serviceCommand('/cancel', 'bug')).toEqual({ type: 'cancel' });
    expect(serviceCommand('/subscription', 'bug')).toEqual({ type: 'subscription' });
    expect(serviceCommand('/unknown', 'idea')).toEqual({ type: 'unknown' });
  });
});
