// Session-only snapshots survive call/home remounts, never an account logout.
const snapshots = new Map<string, unknown>();
export function readAccountView<T>(accountId: string): T | undefined {
  return snapshots.get(accountId) as T | undefined;
}
export function retainAccountView<T>(accountId: string, snapshot: T) {
  snapshots.delete(accountId);
  snapshots.set(accountId, snapshot);
  while (snapshots.size > 2) snapshots.delete(snapshots.keys().next().value!);
}
export function clearAccountView(accountId: string) {
  snapshots.delete(accountId);
}
