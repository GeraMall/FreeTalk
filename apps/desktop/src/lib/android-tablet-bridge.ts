import { serverMessageSchema, type RoomActivity } from '@freetalk/protocol';
import { isAppLanguage, type AppLanguage } from './app-language';
import type { TableParticipant } from '../components/activity-table-ui';

export interface AndroidTabletState {
  activity: RoomActivity;
  selfId: string;
  participants: TableParticipant[];
  muted: boolean;
  deafened: boolean;
  language: AppLanguage;
  theme: 'default' | 'light' | 'black';
}

/** Room snapshots are already filtered by the server for this one authenticated participant. */
export function parseAndroidTabletState(raw: string): AndroidTabletState | undefined {
  if (raw.length > 1_000_000) return undefined;
  try {
    const input = JSON.parse(raw);
    const state = serverMessageSchema.safeParse({
      type: 'activity-state',
      activity: input.activity,
    });
    const peers = serverMessageSchema.safeParse({
      type: 'participants',
      participants: input.participants,
    });
    if (
      !state.success ||
      state.data.type !== 'activity-state' ||
      !peers.success ||
      peers.data.type !== 'participants'
    )
      return undefined;
    if (!peers.data.participants.some((p) => p.id === input.selfId)) return undefined;
    return {
      activity: state.data.activity,
      selfId: input.selfId,
      participants: peers.data.participants.map((p) => ({
        ...p,
        // Only embedded images can be displayed; the isolated renderer cannot make account requests.
        avatar: p.avatar?.startsWith('data:image/') ? p.avatar : undefined,
        speaking:
          input.participants.find((candidate: { id: string }) => candidate.id === p.id)
            ?.speaking === true,
      })),
      muted: input.muted === true,
      deafened: input.deafened === true,
      language: isAppLanguage(input.language) ? input.language : 'ru',
      theme: ['light', 'black'].includes(input.theme) ? input.theme : 'default',
    };
  } catch {
    return undefined;
  }
}
