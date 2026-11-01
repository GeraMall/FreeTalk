import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { PoolClient } from 'pg';
import type { AuthenticatedUser } from './auth-service.js';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { chatGifMetadataSchema } from '@freetalk/protocol';
import { db, transaction } from './db.js';
import { env, publicApiUrl } from './env.js';
import { GifFileError, inspectGif, MAX_GIF_BYTES } from './gif-file.js';
import { safeImageDimensions } from './image-dimensions.js';
import { inspectRemoteGif } from './remote-gif.js';
import {
  beginGifUpload,
  chargeGifDownload,
  enforceGifStorage,
  gifDownloads,
  gifUploads,
  GIF_STORAGE_LOCK,
  GIF_LIMITS,
  pruneUnusedGifs,
  recordGifUploadBytes,
  MAX_GIF_UPLOAD_BYTES,
} from './gif-limits.js';

interface Asset {
  id: string;
  width: number;
  height: number;
  title: string;
  full_bytes: number;
  thumbnail_bytes: number;
  thumbnail_mime: string;
}
export function privateGif(asset: Pick<Asset, 'id' | 'width' | 'height' | 'title'>) {
  return {
    assetId: asset.id,
    url: publicApiUrl(`/v1/gifs/assets/${asset.id}`),
    previewUrl: publicApiUrl(`/v1/gifs/assets/${asset.id}?variant=thumbnail`),
    width: asset.width,
    height: asset.height,
    alt: asset.title,
    attribution: {
      provider: 'TRLKA' as const,
      title: asset.title,
      pageUrl: publicApiUrl(`/v1/gifs/assets/${asset.id}`),
    },
  };
}
export async function accessibleGif(assetId: string, userId: string, touch = false) {
  const result = await db.query<Asset>(
    `SELECT asset.id,asset.width,asset.height,
    COALESCE((SELECT favorite.gif->>'alt' FROM gif_favorites favorite WHERE favorite.asset_id=asset.id AND favorite.user_id=$2 LIMIT 1),'GIF') AS title,
    octet_length(asset.data) AS full_bytes,octet_length(asset.thumbnail_data) AS thumbnail_bytes,asset.thumbnail_mime
    FROM gif_assets asset WHERE asset.id=$1 AND (
      asset.created_by=$2 OR EXISTS(SELECT 1 FROM gif_favorites f WHERE f.asset_id=asset.id AND f.user_id=$2)
      OR EXISTS(SELECT 1 FROM messages message JOIN chat_members member ON member.chat_id=message.chat_id
        AND member.user_id=$2 AND member.left_at IS NULL
        WHERE message.metadata->'gif'->>'assetId'=asset.id::text AND (message.expires_at IS NULL OR message.expires_at>now()))
    )`,
    [assetId, userId],
  );
  const asset = result.rows[0];
  // A short lease prevents cleanup racing an authorized send/favorite operation.
  if (asset && touch) {
    const leased = await db.query(
      'UPDATE gif_assets SET last_used_at=now() WHERE id=$1 RETURNING id',
      [assetId],
    );
    if (!leased.rowCount) return undefined;
  }
  return asset;
}
type SavedGif = Record<string, unknown> & { assetId?: string; url?: string };
async function saveFavorite(userId: string, gif: SavedGif, existingClient?: PoolClient) {
  const key = gif.assetId
    ? `asset:${gif.assetId}`
    : `remote:${createHash('sha256').update(String(gif.url)).digest('hex')}`;
  const work = async (client: PoolClient) => {
    await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId]);
    const count = await client.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM gif_favorites WHERE user_id=$1 AND source_key!=$2',
      [userId, key],
    );
    if (count.rows[0]!.count >= 200)
      throw new GifFileError(
        'GIF_LIBRARY_FULL',
        'В избранном уже 200 GIF. Уберите ненужные, чтобы добавить новые.',
        409,
      );
    const result = await client.query<{ id: string }>(
      `INSERT INTO gif_favorites(user_id,source_key,asset_id,gif) VALUES($1,$2,$3,$4)
      ON CONFLICT(user_id,source_key) DO UPDATE SET gif=EXCLUDED.gif RETURNING id`,
      [userId, key, gif.assetId ?? null, gif],
    );
    return { ...gif, favoriteId: result.rows[0]!.id };
  };
  return existingClient ? work(existingClient) : transaction(work);
}
function gifError(reply: FastifyReply, error: unknown) {
  if (error instanceof GifFileError) {
    if (error.status === 429)
      reply.header('retry-after', error.code === 'GIF_UPLOAD_BUSY' ? '3' : '60');
    return reply
      .type('application/json')
      .code(error.status)
      .send({ code: error.code, message: error.message });
  }
  throw error;
}
export function registerGifLibraryRoutes(
  app: FastifyInstance,
  requireUser: (request: FastifyRequest, reply: FastifyReply) => Promise<AuthenticatedUser | null>,
) {
  let cleaning = false;
  const cleanup = () => {
    if (cleaning) return;
    cleaning = true;
    void pruneUnusedGifs()
      .catch((error) => app.log.warn({ err: error }, 'GIF cleanup failed'))
      .finally(() => {
        cleaning = false;
      });
  };
  const cleanupTimer = setInterval(cleanup, 15 * 60_000);
  cleanupTimer.unref();
  app.addHook('onClose', async () => clearInterval(cleanupTimer));
  app.get('/v1/gifs/config', async (request, reply) => {
    if (!(await requireUser(request, reply))) return;
    return { provider: env.KLIPY_API_KEY ? 'KLIPY' : null, apiKey: env.KLIPY_API_KEY || undefined };
  });
  app.get('/v1/gifs/favorites', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const rows = await db.query<{ id: string; gif: Record<string, unknown> }>(
      'SELECT id,gif FROM gif_favorites WHERE user_id=$1 ORDER BY created_at DESC LIMIT 200',
      [user.id],
    );
    return { gifs: rows.rows.map((row) => ({ ...row.gif, favoriteId: row.id })) };
  });
  app.get(
    '/v1/gifs/assets/:id',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const { variant } = z
        .object({ variant: z.enum(['full', 'thumbnail']).default('full') })
        .parse(request.query);
      const asset = await accessibleGif(id, user.id);
      if (!asset) return reply.code(404).send({ code: 'GIF_NOT_FOUND' });
      const size = variant === 'thumbnail' ? asset.thumbnail_bytes : asset.full_bytes;
      const mime = variant === 'thumbnail' ? asset.thumbnail_mime : 'image/gif';
      reply
        .header('cache-control', 'private, no-store')
        .header('x-content-type-options', 'nosniff')
        .type(mime);
      if (request.method === 'HEAD') return reply.header('content-length', size).send();
      const release = gifDownloads.acquire(size);
      if (!release)
        return reply.header('retry-after', '2').type('application/json').code(429).send({
          code: 'GIF_DOWNLOAD_BUSY',
          message: 'GIF загружаются. Повторите попытку через несколько секунд.',
        });
      try {
        await chargeGifDownload(user.id, size);
        const result = await db.query<{ data: Buffer }>(
          `SELECT ${variant === 'thumbnail' ? 'thumbnail_data' : 'data'} AS data FROM gif_assets WHERE id=$1`,
          [id],
        );
        if (!result.rows[0]) {
          release();
          return reply.type('application/json').code(404).send({ code: 'GIF_NOT_FOUND' });
        }
        if (reply.raw.destroyed) {
          release();
          return reply;
        }
        reply.raw.once('finish', release);
        reply.raw.once('close', release);
        return reply.send(result.rows[0].data);
      } catch (error) {
        release();
        return gifError(reply, error);
      }
    },
  );
  app.post(
    '/v1/gifs/uploads',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      const release = gifUploads.acquire(MAX_GIF_BYTES);
      if (!release)
        return gifError(
          reply,
          new GifFileError(
            'GIF_UPLOAD_BUSY',
            'Сейчас загружается другой GIF. Повторите попытку через несколько секунд.',
            429,
          ),
        );
      let attemptId: string | undefined,
        received = 0;
      const deadline = setTimeout(() => request.raw.destroy(), 120_000);
      deadline.unref();
      request.raw.setTimeout?.(20_000, () => request.raw.destroy());
      try {
        const contentLength = Number(request.headers['content-length']);
        if (Number.isFinite(contentLength) && contentLength > MAX_GIF_UPLOAD_BYTES)
          throw new GifFileError('GIF_TOO_LARGE', 'GIF превышает 30 МБ.', 413);
        const reservation =
          Number.isSafeInteger(contentLength) && contentLength > 0
            ? contentLength
            : MAX_GIF_UPLOAD_BYTES;
        attemptId = await beginGifUpload(user.id, reservation);
        let bytes: Buffer | undefined,
          thumbnail: Buffer | undefined,
          mime = '',
          filename = 'Мой GIF';
        for await (const part of request.parts()) {
          if (part.type !== 'file') continue;
          if (!['gif', 'thumbnail'].includes(part.fieldname))
            throw new GifFileError('INVALID_GIF_UPLOAD', 'Выберите один GIF.');
          if ((part.fieldname === 'gif' && bytes) || (part.fieldname === 'thumbnail' && thumbnail))
            throw new GifFileError('INVALID_GIF_UPLOAD', 'Выберите один GIF.');
          const max = part.fieldname === 'thumbnail' ? 64 * 1024 : MAX_GIF_BYTES;
          const chunks: Buffer[] = [];
          let length = 0;
          for await (const chunk of part.file) {
            received += chunk.length;
            length += chunk.length;
            if (length > max)
              throw new GifFileError(
                'GIF_TOO_LARGE',
                part.fieldname === 'thumbnail'
                  ? 'Слишком большая миниатюра GIF.'
                  : 'GIF превышает 30 МБ.',
                413,
              );
            chunks.push(chunk);
          }
          if (part.file.truncated)
            throw new GifFileError('GIF_TOO_LARGE', 'GIF превышает 30 МБ.', 413);
          const file = Buffer.concat(chunks);
          if (part.fieldname === 'gif') {
            bytes = file;
            filename =
              part.filename
                .split('')
                .filter((character) => {
                  const code = character.charCodeAt(0);
                  return (
                    code >= 32 &&
                    code !== 127 &&
                    !(code >= 0x202a && code <= 0x202e) &&
                    !(code >= 0x2066 && code <= 0x2069)
                  );
                })
                .join('')
                .replace(/\.gif$/i, '')
                .trim()
                .slice(0, 200) || 'Мой GIF';
          } else {
            thumbnail = file;
            mime = part.mimetype;
          }
        }
        if (!bytes) throw new GifFileError('INVALID_GIF', 'Выберите файл GIF.');
        const dimensions = inspectGif(bytes);
        const thumb = thumbnail && safeImageDimensions(thumbnail);
        const magicMatches =
          thumbnail &&
          ((mime === 'image/png' &&
            thumbnail.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
            (mime === 'image/jpeg' && thumbnail[0] === 0xff && thumbnail[1] === 0xd8) ||
            (mime === 'image/webp' &&
              thumbnail.toString('ascii', 0, 4) === 'RIFF' &&
              thumbnail.toString('ascii', 8, 12) === 'WEBP'));
        if (
          !thumbnail ||
          !magicMatches ||
          !thumb?.width ||
          !thumb.height ||
          thumb.width > 360 ||
          thumb.height > 360
        )
          throw new GifFileError(
            'INVALID_GIF_THUMBNAIL',
            'Не удалось подготовить миниатюру GIF. Выберите файл ещё раз.',
          );
        const daily = await db.query<{ bytes: string }>(
          "SELECT COALESCE(sum(bytes),0)::text AS bytes FROM gif_upload_attempts WHERE user_id=$1 AND created_at>now()-interval '24 hours'",
          [user.id],
        );
        if (Number(daily.rows[0]!.bytes) + received > GIF_LIMITS.dailyUpload)
          throw new GifFileError(
            'GIF_UPLOAD_DAILY_LIMIT',
            'Дневной лимит загрузки GIF исчерпан. Попробуйте завтра.',
            429,
          );
        const digest = createHash('sha256').update(bytes).digest();
        const favorite = await transaction(async (client) => {
          await client.query('SELECT pg_advisory_xact_lock($1)', [GIF_STORAGE_LOCK]);
          let asset = (
            await client.query<Asset>('SELECT id,width,height FROM gif_assets WHERE sha256=$1', [
              digest,
            ])
          ).rows[0];
          if (!asset) {
            await enforceGifStorage(client, user.id, bytes.length + thumbnail.length);
            asset = (
              await client.query<Asset>(
                `INSERT INTO gif_assets(created_by,sha256,data,width,height,thumbnail_mime,thumbnail_data)
            VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,width,height`,
                [user.id, digest, bytes, dimensions.width, dimensions.height, mime, thumbnail],
              )
            ).rows[0]!;
          }
          return saveFavorite(user.id, privateGif({ ...asset, title: filename }), client);
        });
        return reply.code(201).send({ gif: favorite });
      } catch (error) {
        return gifError(reply, error);
      } finally {
        clearTimeout(deadline);
        request.raw.setTimeout?.(0);
        try {
          if (attemptId) await recordGifUploadBytes(attemptId, received);
        } catch (error) {
          app.log.warn({ err: error }, 'Could not account GIF upload bytes');
        } finally {
          release();
        }
      }
    },
  );
  app.post(
    '/v1/gifs/favorites',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      const input = z
        .object({
          messageId: z.string().uuid().optional(),
          assetId: z.string().uuid().optional(),
          gif: chatGifMetadataSchema.optional(),
        })
        .refine((value) => [value.messageId, value.assetId, value.gif].filter(Boolean).length === 1)
        .parse(request.body);
      let gif: SavedGif;
      if (input.messageId) {
        const result = await db.query<{ gif: SavedGif }>(
          `SELECT message.metadata->'gif' AS gif FROM messages message
        JOIN chat_members member ON member.chat_id=message.chat_id AND member.user_id=$2 AND member.left_at IS NULL
        WHERE message.id=$1 AND message.metadata->'gif' IS NOT NULL AND (message.expires_at IS NULL OR message.expires_at>now())`,
          [input.messageId, user.id],
        );
        if (!result.rows[0]) return reply.code(404).send({ code: 'GIF_NOT_FOUND' });
        gif = result.rows[0].gif;
        if (gif.assetId && !(await accessibleGif(gif.assetId, user.id, true)))
          return reply.code(404).send({ code: 'GIF_NOT_FOUND' });
      } else if (input.assetId) {
        const asset = await accessibleGif(input.assetId, user.id, true);
        if (!asset) return reply.code(404).send({ code: 'GIF_NOT_FOUND' });
        gif = privateGif(asset);
      } else {
        gif = input.gif!;
        if ((gif.attribution as { provider: string }).provider === 'Wikimedia Commons') {
          const inspection = await inspectRemoteGif(String(gif.url));
          if (!inspection.ok)
            return reply.code(400).send({ code: inspection.code, message: inspection.message });
        }
      }
      try {
        return reply.code(201).send({ gif: await saveFavorite(user.id, gif) });
      } catch (error) {
        return gifError(reply, error);
      }
    },
  );
  app.delete('/v1/gifs/favorites/:id', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await db.query('DELETE FROM gif_favorites WHERE id=$1 AND user_id=$2', [id, user.id]);
    return reply.code(204).send();
  });
}
