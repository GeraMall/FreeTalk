import { useCallback, useReducer } from 'react';

export interface CallAudioControls {
  muted: boolean;
  deafened: boolean;
  mutedBeforeDeafen: boolean;
}
export type CallAudioAction =
  { type: 'mute'; muted: boolean } | { type: 'deafen'; deafened: boolean };
export const INITIAL_CALL_AUDIO: CallAudioControls = {
  muted: false,
  deafened: false,
  mutedBeforeDeafen: false,
};

export function callAudioReducer(
  state: CallAudioControls,
  action: CallAudioAction,
): CallAudioControls {
  if (action.type === 'mute') {
    // Explicitly enabling the mic also restores hearing. A moderator mute stays muted on restore.
    return {
      ...state,
      muted: action.muted,
      deafened: action.muted && state.deafened,
      mutedBeforeDeafen: action.muted,
    };
  }
  if (action.deafened === state.deafened) return state;
  return action.deafened
    ? { muted: true, deafened: true, mutedBeforeDeafen: state.muted }
    : { ...state, muted: state.mutedBeforeDeafen, deafened: false };
}

export function useCallAudioControls() {
  const [state, dispatch] = useReducer(callAudioReducer, INITIAL_CALL_AUDIO);
  const setMuted = useCallback((muted: boolean) => dispatch({ type: 'mute', muted }), []);
  const setDeafened = useCallback(
    (deafened: boolean) => dispatch({ type: 'deafen', deafened }),
    [],
  );
  return { ...state, setMuted, setDeafened };
}
