export type ChatImageVariant = 'thumbnail' | 'full';

interface CacheEntry {
  key: string;
  accountId: string;
  blob: Blob;
  size: number;
  accessedAt: number;
  expiresAt: number | null;
}

interface LoadChatImageOptions {
  accountId: string;
  messageId: string;
  variant: ChatImageVariant;
  expiresAt?: string | null;
  fetcher(): Promise<Blob>;
}

export interface ChatImageDisplay {
  src: string;
  width?: number;
  height?: number;
}
type ImageIdentity = Pick<
  LoadChatImageOptions,
  'accountId' | 'messageId' | 'variant' | 'expiresAt'
>;

const DATABASE_NAME = 'freetalk-chat-images-v1';
const STORE_NAME = 'images';
const MAX_CACHE_BYTES = 384 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 800;
const memoryCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<Blob>>();
// Keep the same browser image resource across chat navigation, bounded separately
// from persistent blobs. Object URLs never enter IndexedDB.
const displayCache = new Map<
  string,
  { display: ChatImageDisplay; size: number; accountId: string }
>();
const MAX_DISPLAY_ENTRIES = 64;
const MAX_DISPLAY_BYTES = 32 * 1024 * 1024;
let databasePromise: Promise<IDBDatabase | undefined> | undefined;

function cacheKey(accountId: string, messageId: string, variant: ChatImageVariant) {
  return `${accountId}:${messageId}:${variant}`;
}

function expiryTime(value?: string | null) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function openDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(undefined);
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      const store = database.createObjectStore(STORE_NAME, { keyPath: 'key' });
      store.createIndex('accountId', 'accountId');
      store.createIndex('accessedAt', 'accessedAt');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(undefined);
    request.onblocked = () => resolve(undefined);
  });
  return databasePromise;
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T | undefined>((resolve) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(undefined);
  });
}

async function readPersistent(key: string) {
  const database = await openDatabase();
  if (!database) return undefined;
  const transaction = database.transaction(STORE_NAME, 'readonly');
  return requestResult(transaction.objectStore(STORE_NAME).get(key) as IDBRequest<CacheEntry>);
}

async function removePersistent(keys: string[]) {
  if (keys.length === 0) return;
  const database = await openDatabase();
  if (!database) return;
  const transaction = database.transaction(STORE_NAME, 'readwrite');
  const store = transaction.objectStore(STORE_NAME);
  for (const key of keys) store.delete(key);
}

async function prunePersistent(database: IDBDatabase) {
  const readTransaction = database.transaction(STORE_NAME, 'readonly');
  const entries = (
    (await requestResult(
      readTransaction.objectStore(STORE_NAME).getAll() as IDBRequest<CacheEntry[]>,
    )) ?? []
  ).sort((left, right) => right.accessedAt - left.accessedAt);
  let total = 0;
  const now = Date.now();
  const expiredKeys: string[] = [];
  entries.forEach((entry, index) => {
    total += entry.size;
    if (
      (entry.expiresAt !== null && entry.expiresAt <= now) ||
      index >= MAX_CACHE_ENTRIES ||
      total > MAX_CACHE_BYTES
    ) {
      expiredKeys.push(entry.key);
      memoryCache.delete(entry.key);
    }
  });
  await removePersistent(expiredKeys);
}

async function persist(entry: CacheEntry) {
  const database = await openDatabase();
  if (!database) return;
  const transaction = database.transaction(STORE_NAME, 'readwrite');
  transaction.objectStore(STORE_NAME).put(entry);
  await new Promise<void>((resolve) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => resolve();
    transaction.onabort = () => resolve();
  });
  await prunePersistent(database);
}

function isFresh(entry: CacheEntry) {
  return entry.expiresAt === null || entry.expiresAt > Date.now();
}

function removeDisplay(key: string) {
  const entry = displayCache.get(key);
  if (!entry) return;
  URL.revokeObjectURL(entry.display.src);
  displayCache.delete(key);
}

export function peekChatImageDisplay(identity: ImageIdentity): ChatImageDisplay | undefined {
  const key = cacheKey(identity.accountId, identity.messageId, identity.variant);
  const entry = memoryCache.get(key);
  const expiresAt = expiryTime(identity.expiresAt);
  if (!entry || !isFresh(entry) || (expiresAt !== null && expiresAt <= Date.now())) {
    removeDisplay(key);
    return undefined;
  }
  entry.accessedAt = Date.now();
  let retained = displayCache.get(key);
  if (!retained) {
    retained = {
      display: { src: URL.createObjectURL(entry.blob) },
      size: entry.size,
      accountId: identity.accountId,
    };
  }
  displayCache.delete(key);
  displayCache.set(key, retained);
  let bytes = 0;
  for (const value of displayCache.values()) bytes += value.size;
  for (const [oldKey, value] of displayCache) {
    if (displayCache.size <= MAX_DISPLAY_ENTRIES && bytes <= MAX_DISPLAY_BYTES) break;
    // A single oversized image remains usable but is replaced on the next load.
    if (oldKey === key) break;
    bytes -= value.size;
    removeDisplay(oldKey);
  }
  return retained.display;
}

export async function loadChatImageDisplay(options: LoadChatImageOptions) {
  await loadChatImage(options);
  const display = peekChatImageDisplay(options);
  if (!display) throw new Error('Image expired or cache cleared');
  return display;
}

export function rememberChatImageDimensions(
  identity: ImageIdentity,
  width: number,
  height: number,
) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
  const entry = displayCache.get(
    cacheKey(identity.accountId, identity.messageId, identity.variant),
  );
  if (entry) Object.assign(entry.display, { width, height });
}

export async function loadChatImage({
  accountId,
  messageId,
  variant,
  expiresAt,
  fetcher,
}: LoadChatImageOptions) {
  const key = cacheKey(accountId, messageId, variant);
  const memory = memoryCache.get(key);
  if (memory && isFresh(memory)) {
    memory.accessedAt = Date.now();
    return memory.blob;
  }
  if (memory) memoryCache.delete(key);

  const existingRequest = inFlight.get(key);
  if (existingRequest) return existingRequest;

  const request = (async () => {
    const persistent = await readPersistent(key);
    if (persistent && isFresh(persistent)) {
      persistent.accessedAt = Date.now();
      memoryCache.set(key, persistent);
      void persist(persistent);
      return persistent.blob;
    }
    if (persistent) await removePersistent([key]);

    const blob = await fetcher();
    const entry: CacheEntry = {
      key,
      accountId,
      blob,
      size: blob.size,
      accessedAt: Date.now(),
      expiresAt: expiryTime(expiresAt),
    };
    memoryCache.set(key, entry);
    void persist(entry);
    return blob;
  })().finally(() => inFlight.delete(key));
  inFlight.set(key, request);
  return request;
}

export function seedChatImageCache(
  accountId: string,
  messageId: string,
  variant: ChatImageVariant,
  blob: Blob,
  expiresAt?: string | null,
) {
  const key = cacheKey(accountId, messageId, variant);
  removeDisplay(key);
  const entry: CacheEntry = {
    key,
    accountId,
    blob,
    size: blob.size,
    accessedAt: Date.now(),
    expiresAt: expiryTime(expiresAt),
  };
  memoryCache.set(key, entry);
  void persist(entry);
}

export async function clearChatImageCache(accountId: string) {
  for (const [key, entry] of displayCache) if (entry.accountId === accountId) removeDisplay(key);
  for (const [key, entry] of memoryCache) {
    if (entry.accountId === accountId) memoryCache.delete(key);
  }
  const database = await openDatabase();
  if (!database) return;
  const transaction = database.transaction(STORE_NAME, 'readonly');
  const keys =
    ((await requestResult(
      transaction.objectStore(STORE_NAME).index('accountId').getAllKeys(accountId),
    )) as IDBValidKey[] | undefined) ?? [];
  await removePersistent(keys.map(String));
}

export async function getChatImageCacheStats(accountId: string) {
  const database = await openDatabase();
  if (!database) return { bytes: 0, entries: 0 };
  const transaction = database.transaction(STORE_NAME, 'readonly');
  const entries =
    ((await requestResult(
      transaction.objectStore(STORE_NAME).index('accountId').getAll(accountId),
    )) as CacheEntry[] | undefined) ?? [];
  return {
    bytes: entries.reduce((total, entry) => total + entry.size, 0),
    entries: entries.length,
  };
}
