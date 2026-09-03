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

const DATABASE_NAME = 'freetalk-chat-images-v1';
const STORE_NAME = 'images';
const MAX_CACHE_BYTES = 384 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 800;
const memoryCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<Blob>>();
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
