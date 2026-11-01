import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const query = vi.hoisted(() => vi.fn());
vi.mock('../src/db.js', () => ({
  db: { query },
  transaction: async (work: (client: { query: typeof query }) => unknown) => work({ query }),
}));
vi.mock('../src/env.js', () => ({
  env: {},
  publicApiUrl: (path: string) => `https://api.example.test${path}`,
}));
import { registerGifLibraryRoutes } from '../src/gif-library.js';
import { gifDownloads, gifUploads } from '../src/gif-limits.js';
const self = '11111111-1111-4111-8111-111111111111',
  assetId = '22222222-2222-4222-8222-222222222222';
const favoriteId = '33333333-3333-4333-8333-333333333333';
const result = (rows: unknown[] = []) => ({ rows, rowCount: rows.length });
const header = Buffer.from('47494638396101000100800000000000ffffff', 'hex');
const frame = Buffer.from('21f904000a0000002c0000000001000100000202440100', 'hex');
const gif = Buffer.concat([header, frame, frame, Buffer.from([0x3b])]);
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=',
  'base64',
);
function uploadPayload() {
  const boundary = 'trlka-gif-test';
  return {
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="gif"; filename="reaction.gif"\r\nContent-Type: image/gif\r\n\r\n`,
      ),
      gif,
      Buffer.from(
        `\r\n--${boundary}\r\nContent-Disposition: form-data; name="thumbnail"; filename="preview.png"\r\nContent-Type: image/png\r\n\r\n`,
      ),
      png,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  };
}
let authenticated = true;
let app: ReturnType<typeof Fastify>;
beforeEach(async () => {
  authenticated = true;
  query.mockReset();
  query.mockImplementation(async (sql: string) => {
    if (sql.includes('AS attempts')) return result([{ attempts: 0, bytes: '0' }]);
    if (sql.startsWith('INSERT INTO gif_upload_attempts')) return result([{ id: favoriteId }]);
    if (sql.includes('AS bytes FROM gif_upload_attempts')) return result([{ bytes: '0' }]);
    if (sql.includes('AS total')) return result([{ total: '0', owned: '0' }]);
    if (sql.startsWith('INSERT INTO gif_assets'))
      return result([{ id: assetId, width: 1, height: 1 }]);
    if (sql.includes('count(*)::int AS count FROM gif_favorites')) return result([{ count: 0 }]);
    if (sql.startsWith('INSERT INTO gif_favorites')) return result([{ id: favoriteId }]);
    return result();
  });
  app = Fastify();
  await app.register(multipart, { limits: { files: 2, fileSize: 30 * 1024 * 1024 } });
  registerGifLibraryRoutes(app, async (_request, reply) => {
    if (!authenticated) {
      reply.code(401).send({ code: 'UNAUTHORIZED' });
      return null;
    }
    return { id: self } as never;
  });
});
afterEach(async () => {
  await app.close();
  vi.restoreAllMocks();
});
describe('private GIF library', () => {
  it('stores the original animation unchanged and saves a small, separate preview', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/gifs/uploads',
      ...uploadPayload(),
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().gif).toMatchObject({
      assetId,
      favoriteId,
      alt: 'reaction',
      previewUrl: `https://api.example.test/v1/gifs/assets/${assetId}?variant=thumbnail`,
    });
    const insert = query.mock.calls.find(([sql]) =>
      String(sql).startsWith('INSERT INTO gif_assets'),
    )!;
    expect(insert[1][2]).toEqual(gif);
    expect(insert[1][6]).toEqual(png);
  });
  it('deduplicates bytes without disclosing another uploader filename', async () => {
    const normal = query.getMockImplementation()!;
    query.mockImplementation(async (sql: string, ...args: unknown[]) =>
      sql.startsWith('SELECT id,width,height FROM gif_assets')
        ? result([{ id: assetId, width: 1, height: 1 }])
        : normal(sql, ...args),
    );
    const response = await app.inject({
      method: 'POST',
      url: '/v1/gifs/uploads',
      ...uploadPayload(),
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().gif.alt).toBe('reaction');
    expect(query.mock.calls.some(([sql]) => String(sql).startsWith('INSERT INTO gif_assets'))).toBe(
      false,
    );
  });
  it('refuses unauthenticated reads and never fetches bytes for an inaccessible asset', async () => {
    authenticated = false;
    expect((await app.inject(`/v1/gifs/assets/${assetId}`)).statusCode).toBe(401);
    expect(query).not.toHaveBeenCalled();
    authenticated = true;
    expect((await app.inject(`/v1/gifs/assets/${assetId}`)).statusCode).toBe(404);
    expect(query.mock.calls.some(([sql]) => String(sql).startsWith('SELECT data AS data'))).toBe(
      false,
    );
  });
  it('returns a small thumbnail, with private caching and MIME sniffing protection', async () => {
    query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM gif_assets asset'))
        return result([
          {
            id: assetId,
            width: 1,
            height: 1,
            title: 'GIF',
            full_bytes: gif.length,
            thumbnail_bytes: png.length,
            thumbnail_mime: 'image/png',
          },
        ]);
      if (sql.includes('gif_bandwidth_usage')) return result([{ scope: 'user' }]);
      if (sql.startsWith('SELECT thumbnail_data')) return result([{ data: png }]);
      return result();
    });
    const response = await app.inject(`/v1/gifs/assets/${assetId}?variant=thumbnail`);
    expect(response.statusCode).toBe(200);
    expect(response.rawPayload).toEqual(png);
    expect(response.headers['content-type']).toBe('image/png');
    expect(response.headers['cache-control']).toContain('private');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });
  it('refuses a busy upload before any database work or body buffering', async () => {
    const release = gifUploads.acquire(30 * 1024 * 1024)!;
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/gifs/uploads',
        ...uploadPayload(),
      });
      expect(response.statusCode).toBe(429);
      expect(response.json().code).toBe('GIF_UPLOAD_BUSY');
      expect(query).not.toHaveBeenCalled();
    } finally {
      release();
    }
  });
  it('refuses large response buffering while the transfer budget is full', async () => {
    query.mockResolvedValue(
      result([
        {
          id: assetId,
          width: 1,
          height: 1,
          title: 'GIF',
          full_bytes: gif.length,
          thumbnail_bytes: png.length,
          thumbnail_mime: 'image/png',
        },
      ]),
    );
    const release = gifDownloads.acquire(64 * 1024 * 1024)!;
    try {
      const response = await app.inject(`/v1/gifs/assets/${assetId}`);
      expect(response.statusCode).toBe(429);
      expect(response.json().code).toBe('GIF_DOWNLOAD_BUSY');
      expect(query.mock.calls).toHaveLength(1);
    } finally {
      release();
    }
  });
  it('does not make favorite uploads public', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/gifs/favorites',
      payload: { assetId },
    });
    expect(response.statusCode).toBe(404);
    expect(
      query.mock.calls.some(([sql]) => String(sql).startsWith('INSERT INTO gif_favorites')),
    ).toBe(false);
  });
});
