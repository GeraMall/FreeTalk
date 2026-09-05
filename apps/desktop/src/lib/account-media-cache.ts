interface AccountMediaEntry {
  key: string;
  accountId: string;
  sourceUrl: string;
  blob: Blob;
  size: number;
  accessedAt: number;
}

interface MemoryEntry extends AccountMediaEntry {
  displayUrl: string;
}

const DATABASE_NAME = 'freetalk-account-media-v1';
const STORE_NAME = 'media';
const MAX_CACHE_BYTES = 128 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 600;
const MAX_SINGLE_MEDIA_BYTES = 20 * 1024 * 1024;
const MAX_MEMORY_CACHE_BYTES = 64 * 1024 * 1024;
const MAX_MEMORY_CACHE_ENTRIES = 600;
const memoryCache = new Map<string, MemoryEntry>();
const inFlight = new Map<string, Promise<string>>();
let memoryCacheBytes = 0;
let databasePromise: Promise<IDBDatabase | undefined> | undefined;
let activeAccountId: string | undefined;

function mediaKey(accountId: string, sourceUrl: string) {
  return `${accountId}:${sourceUrl}`;
}

function isRemoteMedia(sourceUrl?: string | null) {
  return Boolean(sourceUrl && /^https?:\/\//i.test(sourceUrl));
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
  return requestResult(
    transaction.objectStore(STORE_NAME).get(key) as IDBRequest<AccountMediaEntry>,
  );
}

async function removePersistent(keys: string[]) {
  if (!keys.length) return;
  const database = await openDatabase();
  if (!database) return;
  const transaction = database.transaction(STORE_NAME, 'readwrite');
  const store = transaction.objectStore(STORE_NAME);
  keys.forEach((key) => store.delete(key));
  await new Promise<void>((resolve) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => resolve();
    transaction.onabort = () => resolve();
  });
}

async function prunePersistent(database: IDBDatabase) {
  const transaction = database.transaction(STORE_NAME, 'readonly');
  const entries =
    (await requestResult(
      transaction.objectStore(STORE_NAME).getAll() as IDBRequest<AccountMediaEntry[]>,
    )) ?? [];
  entries.sort((left, right) => right.accessedAt - left.accessedAt);
  let total = 0;
  const stale: string[] = [];
  entries.forEach((entry, index) => {
    total += entry.size;
    if (index >= MAX_CACHE_ENTRIES || total > MAX_CACHE_BYTES) stale.push(entry.key);
  });
  await removePersistent(stale);
}

async function persist(entry: AccountMediaEntry) {
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

function revokeMemoryEntry(entry: MemoryEntry) {
  if (entry.displayUrl.startsWith('blob:') && typeof URL.revokeObjectURL === 'function')
    URL.revokeObjectURL(entry.displayUrl);
}

function removeMemoryEntry(key: string) {
  const entry = memoryCache.get(key);
  if (!entry) return;
  memoryCache.delete(key);
  memoryCacheBytes = Math.max(0, memoryCacheBytes - entry.size);
  revokeMemoryEntry(entry);
}

function touchMemoryEntry(key: string, entry: MemoryEntry) {
  entry.accessedAt = Date.now();
  memoryCache.delete(key);
  memoryCache.set(key, entry);
  return entry.displayUrl;
}

function pruneMemory() {
  while (memoryCacheBytes > MAX_MEMORY_CACHE_BYTES || memoryCache.size > MAX_MEMORY_CACHE_ENTRIES) {
    const oldestKey = memoryCache.keys().next().value;
    if (!oldestKey) break;
    removeMemoryEntry(oldestKey);
  }
}

function remember(entry: AccountMediaEntry) {
  const existing = memoryCache.get(entry.key);
  if (existing) return touchMemoryEntry(entry.key, existing);
  const displayUrl =
    typeof URL.createObjectURL === 'function' ? URL.createObjectURL(entry.blob) : entry.sourceUrl;
  const memoryEntry = { ...entry, size: entry.blob.size, displayUrl };
  memoryCache.set(entry.key, memoryEntry);
  memoryCacheBytes += memoryEntry.size;
  pruneMemory();
  return displayUrl;
}

export function setActiveAccountMediaScope(accountId?: string) {
  activeAccountId = accountId;
}

export function getActiveAccountMediaScope() {
  return activeAccountId;
}

export function peekAccountMedia(sourceUrl?: string | null, accountId = activeAccountId) {
  if (!sourceUrl || !isRemoteMedia(sourceUrl) || !accountId) return sourceUrl ?? undefined;
  const key = mediaKey(accountId, sourceUrl);
  const entry = memoryCache.get(key);
  return entry ? touchMemoryEntry(key, entry) : undefined;
}

export async function loadAccountMedia(sourceUrl: string, accountId = activeAccountId) {
  if (!isRemoteMedia(sourceUrl) || !accountId) return sourceUrl;
  const key = mediaKey(accountId, sourceUrl);
  const memory = memoryCache.get(key);
  if (memory) return touchMemoryEntry(key, memory);
  const pending = inFlight.get(key);
  if (pending) return pending;

  const request = (async () => {
    const persistent = await readPersistent(key);
    if (persistent) {
      persistent.accessedAt = Date.now();
      void persist(persistent);
      return remember(persistent);
    }
    const response = await fetch(sourceUrl, { cache: 'force-cache', credentials: 'omit' });
    if (!response.ok) throw new Error(`Не удалось загрузить изображение (${response.status})`);
    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_SINGLE_MEDIA_BYTES)
      throw new Error('Изображение превышает допустимый размер');
    const blob = await response.blob();
    if (!blob.type.startsWith('image/')) throw new Error('Сервер вернул не изображение');
    if (blob.size > MAX_SINGLE_MEDIA_BYTES)
      throw new Error('Изображение превышает допустимый размер');
    const entry: AccountMediaEntry = {
      key,
      accountId,
      sourceUrl,
      blob,
      size: blob.size,
      accessedAt: Date.now(),
    };
    const displayUrl = remember(entry);
    void persist(entry);
    return displayUrl;
  })().finally(() => inFlight.delete(key));
  inFlight.set(key, request);
  return request;
}

async function decodeMedia(displayUrl: string) {
  if (typeof Image === 'undefined') return;
  const image = new Image();
  image.src = displayUrl;
  if (typeof image.decode === 'function') await image.decode().catch(() => undefined);
}

export async function warmAccountMediaCache(
  accountId: string,
  sourceUrls: Iterable<string>,
  timeoutMs = 8_000,
) {
  setActiveAccountMediaScope(accountId);
  const queue = [...new Set(sourceUrls)].filter(isRemoteMedia);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(6, queue.length) }, async () => {
    while (cursor < queue.length) {
      const sourceUrl = queue[cursor++];
      try {
        const displayUrl = await loadAccountMedia(sourceUrl, accountId);
        await decodeMedia(displayUrl);
      } catch {
        // A failed image must not prevent the application from starting.
      }
    }
  });
  await Promise.race([
    Promise.all(workers),
    new Promise<void>((resolve) => globalThis.setTimeout(resolve, timeoutMs)),
  ]);
}

export function collectAccountMediaUrls(...values: unknown[]) {
  const urls = new Set<string>();
  const seen = new WeakSet<object>();
  const visit = (value: unknown, property = '') => {
    if (typeof value === 'string') {
      if (/(?:avatar|cover)(?:Url|_url)$/i.test(property) && isRemoteMedia(value)) urls.add(value);
      return;
    }
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) value.forEach((item) => visit(item));
    else Object.entries(value).forEach(([key, item]) => visit(item, key));
  };
  values.forEach((value) => visit(value));
  return urls;
}

export async function clearAccountMediaCache(accountId: string) {
  for (const [key, entry] of memoryCache) {
    if (entry.accountId !== accountId) continue;
    removeMemoryEntry(key);
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

export async function getAccountMediaCacheStats(accountId: string) {
  const database = await openDatabase();
  if (!database) return { bytes: 0, entries: 0 };
  const transaction = database.transaction(STORE_NAME, 'readonly');
  const entries =
    ((await requestResult(
      transaction.objectStore(STORE_NAME).index('accountId').getAll(accountId),
    )) as AccountMediaEntry[] | undefined) ?? [];
  return {
    bytes: entries.reduce((total, entry) => total + entry.size, 0),
    entries: entries.length,
  };
}
