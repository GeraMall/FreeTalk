export type HaNode = 'moscow' | 'petersburg';
export interface HaRegistry {
  epoch: number;
  owner: HaNode;
  reserveEligible: boolean;
  syncLsn: string | null;
  fencePending: boolean;
}

/** Pure state transition; storage transaction serializes competing callers. */
export function transitionHa(
  current: HaRegistry | undefined,
  actor: HaNode | 'admin',
  operation: string,
  input: { epoch?: number; eligible?: boolean; lsn?: string; fenced?: boolean; target?: HaNode },
): HaRegistry {
  if (operation === 'bootstrap' && actor === 'admin' && !current)
    return {
      epoch: 1,
      owner: 'moscow',
      reserveEligible: false,
      syncLsn: null,
      fencePending: false,
    };
  if (!current) throw new Error('NOT_INITIALIZED');
  if (operation === 'claim' && actor === 'petersburg' && current.owner === 'petersburg')
    return current;
  if (input.epoch !== current.epoch) throw new Error('STALE_EPOCH');
  // Operator-only repair after a failed provider operation. The candidate must
  // be paused and still in recovery; eligibility is revoked until a new barrier.
  if (operation === 'cancel-fence' && actor === 'admin' && current.owner === 'moscow')
    return { ...current, fencePending: false, reserveEligible: false, syncLsn: null };
  if (operation === 'eligibility' && actor === 'moscow' && current.owner === 'moscow') {
    if (current.fencePending) throw new Error('FENCE_IN_PROGRESS');
    if (typeof input.eligible !== 'boolean') throw new Error('INVALID_ELIGIBILITY');
    if (input.eligible && !/^[0-9A-F]+\/[0-9A-F]+$/i.test(input.lsn ?? ''))
      throw new Error('SYNC_BARRIER_REQUIRED');
    return {
      ...current,
      reserveEligible: input.eligible,
      syncLsn: input.eligible ? input.lsn! : null,
    };
  }
  if (operation === 'begin-fence' && actor === 'petersburg' && current.owner === 'moscow') {
    if (!current.reserveEligible) throw new Error('FENCING_AND_SYNC_REQUIRED');
    return { ...current, fencePending: true };
  }
  if (operation === 'claim' && actor === 'petersburg' && current.owner === 'moscow') {
    if (!current.reserveEligible || !current.fencePending || input.fenced !== true)
      throw new Error('FENCING_AND_SYNC_REQUIRED');
    return {
      epoch: current.epoch + 1,
      owner: 'petersburg',
      reserveEligible: false,
      syncLsn: null,
      fencePending: false,
    };
  }
  if (
    operation === 'handoff' &&
    actor === 'admin' &&
    input.fenced === true &&
    ['moscow', 'petersburg'].includes(input.target ?? '') &&
    input.target !== current.owner &&
    /^[0-9A-F]+\/[0-9A-F]+$/i.test(input.lsn ?? '')
  )
    return {
      epoch: current.epoch + 1,
      owner: input.target!,
      reserveEligible: false,
      syncLsn: null,
      fencePending: false,
    };
  throw new Error('FORBIDDEN_TRANSITION');
}
