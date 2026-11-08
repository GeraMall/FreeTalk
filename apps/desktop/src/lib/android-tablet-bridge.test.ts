import { describe, expect, it } from 'vitest';
import { parseAndroidTabletState } from './android-tablet-bridge';

const selfId = '11111111-1111-4111-8111-111111111111';
const snapshot = {
  activity: { revision: 4, open: true, region: 'RU', canPlayPoker: false },
  selfId,
  participants: [
    { id: selfId, name: 'Игрок', muted: false, isOwner: true, connectedAt: 0, speaking: true },
  ],
  language: 'en',
  theme: 'light',
  muted: false,
  deafened: false,
};
describe('isolated Android game renderer', () => {
  it('keeps server age restrictions and participant-specific state', () => {
    const state = parseAndroidTabletState(JSON.stringify(snapshot))!;
    expect(state.activity.canPlayPoker).toBe(false);
    expect(state.language).toBe('en');
    expect(state.theme).toBe('light');
    expect(state.participants[0].speaking).toBe(true);
  });
  it('rejects malformed snapshots and unknown self identities', () => {
    expect(parseAndroidTabletState('{')).toBeUndefined();
    expect(
      parseAndroidTabletState(JSON.stringify({ ...snapshot, selfId: 'someone-else' })),
    ).toBeUndefined();
    expect(
      parseAndroidTabletState(JSON.stringify({ ...snapshot, activity: { open: true } })),
    ).toBeUndefined();
  });
  it('never turns participant image links into account requests from the renderer', () => {
    const participants = [
      {
        ...snapshot.participants[0],
        avatar: 'https://trlka.com/api/v1/users/' + selfId + '/avatar',
      },
    ];
    expect(
      parseAndroidTabletState(JSON.stringify({ ...snapshot, participants }))?.participants[0]
        .avatar,
    ).toBeUndefined();
  });
});
