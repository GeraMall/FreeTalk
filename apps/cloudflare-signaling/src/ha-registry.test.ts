import { expect, it } from 'vitest';
import { transitionHa } from './ha-registry';

it('starts with no eligible reserve and refuses uninitialized promotion', () => {
  expect(() => transitionHa(undefined, 'petersburg', 'claim', { epoch: 1, fenced: true })).toThrow(
    'NOT_INITIALIZED',
  );
  const state = transitionHa(undefined, 'admin', 'bootstrap', {});
  expect(state.reserveEligible).toBe(false);
  expect(() => transitionHa(state, 'petersburg', 'claim', { epoch: 1, fenced: true })).toThrow(
    'FENCING_AND_SYNC_REQUIRED',
  );
});
it('requires a synchronous WAL barrier and fencing before transfer of ownership', () => {
  const state = transitionHa(undefined, 'admin', 'bootstrap', {});
  expect(() => transitionHa(state, 'moscow', 'eligibility', { epoch: 1, eligible: true })).toThrow(
    'SYNC_BARRIER_REQUIRED',
  );
  const ready = transitionHa(state, 'moscow', 'eligibility', {
    epoch: 1,
    eligible: true,
    lsn: '0/5400100',
  });
  expect(() => transitionHa(ready, 'petersburg', 'claim', { epoch: 1 })).toThrow(
    'FENCING_AND_SYNC_REQUIRED',
  );
  const pending = transitionHa(ready, 'petersburg', 'begin-fence', { epoch: 1 });
  expect(() =>
    transitionHa(pending, 'moscow', 'eligibility', { epoch: 1, eligible: false }),
  ).toThrow('FENCE_IN_PROGRESS');
  const promoted = transitionHa(pending, 'petersburg', 'claim', { epoch: 1, fenced: true });
  expect(promoted).toEqual({
    epoch: 2,
    owner: 'petersburg',
    reserveEligible: false,
    syncLsn: null,
    fencePending: false,
  });
  expect(transitionHa(promoted, 'petersburg', 'claim', { epoch: 1, fenced: true })).toEqual(
    promoted,
  );
  expect(() =>
    transitionHa(promoted, 'moscow', 'eligibility', { epoch: 1, eligible: true, lsn: '0/5400100' }),
  ).toThrow('STALE_EPOCH');
});
it('revokes eligibility before allowing the primary to operate without its reserve', () => {
  const state = transitionHa(undefined, 'admin', 'bootstrap', {});
  const ready = transitionHa(state, 'moscow', 'eligibility', {
    epoch: 1,
    eligible: true,
    lsn: '0/5400100',
  });
  const degraded = transitionHa(ready, 'moscow', 'eligibility', { epoch: 1, eligible: false });
  expect(() => transitionHa(degraded, 'petersburg', 'claim', { epoch: 1, fenced: true })).toThrow(
    'FENCING_AND_SYNC_REQUIRED',
  );
  expect(() =>
    transitionHa(ready, 'petersburg', 'eligibility', { epoch: 1, eligible: false }),
  ).toThrow('FORBIDDEN_TRANSITION');
  expect(() => transitionHa(ready, 'admin', 'bootstrap', {})).toThrow();
});
