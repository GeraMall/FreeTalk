import { db, transaction } from './db.js';
import type { PoolClient } from 'pg';
import { GifFileError } from './gif-file.js';
export const GIF_STORAGE_LOCK = 714027;
export const MAX_GIF_UPLOAD_BYTES = 30 * 1024 * 1024 + 320 * 1024;
const MiB = 1024 * 1024;
export const GIF_LIMITS = {
  accountStorage: 128 * MiB,
  totalStorage: 512 * MiB,
  dailyUpload: 128 * MiB,
  hourlyUploads: 12,
  totalHourlyUploads: 120,
  totalDailyUpload: 1024 * MiB,
  accountDailyDownload: 1024 * MiB,
  totalDailyDownload: 10 * 1024 * MiB,
};

export class GifTransferBudget {
  private used = 0;
  private active = 0;
  constructor(
    private readonly bytes: number,
    private readonly transfers: number,
  ) {}
  acquire(size: number) {
    if (
      !Number.isSafeInteger(size) ||
      size <= 0 ||
      this.used + size > this.bytes ||
      this.active >= this.transfers
    )
      return undefined;
    this.used += size;
    this.active++;
    let released = false;
    return () => {
      if (!released) {
        released = true;
        this.used -= size;
        this.active--;
      }
    };
  }
}
export const gifDownloads = new GifTransferBudget(64 * MiB, 8);
export const gifUploads = new GifTransferBudget(30 * MiB, 1);

export async function beginGifUpload(userId: string, reservation = MAX_GIF_UPLOAD_BYTES) {
  return transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock($1)', [GIF_STORAGE_LOCK + 1]);
    const result = await client.query<{
      attempts: number;
      bytes: string;
      total_bytes: string;
      total_attempts: number;
    }>(
      `SELECT
      count(*) FILTER(WHERE created_at>now()-interval '1 hour')::int AS attempts,
      COALESCE(sum(bytes+reserved_bytes),0)::text AS bytes,
      (SELECT COALESCE(sum(bytes+reserved_bytes),0)::text FROM gif_upload_attempts WHERE created_at>now()-interval '24 hours') AS total_bytes,
      (SELECT count(*)::int FROM gif_upload_attempts WHERE created_at>now()-interval '1 hour') AS total_attempts
      FROM gif_upload_attempts
      WHERE user_id=$1 AND created_at>now()-interval '24 hours'`,
      [userId],
    );
    if (result.rows[0]!.attempts >= GIF_LIMITS.hourlyUploads)
      throw new GifFileError(
        'GIF_UPLOAD_RATE_LIMIT',
        'Слишком много загрузок GIF. Попробуйте через час.',
        429,
      );
    if (Number(result.rows[0]!.bytes) + reservation > GIF_LIMITS.dailyUpload)
      throw new GifFileError(
        'GIF_UPLOAD_DAILY_LIMIT',
        'Дневной лимит загрузки своих GIF исчерпан. Попробуйте завтра.',
        429,
      );
    if (
      Number(result.rows[0]!.total_bytes ?? 0) + reservation > GIF_LIMITS.totalDailyUpload ||
      Number(result.rows[0]!.total_attempts ?? 0) >= GIF_LIMITS.totalHourlyUploads
    )
      throw new GifFileError(
        'GIF_GLOBAL_UPLOAD_LIMIT',
        'Загрузка новых GIF временно приостановлена. Попробуйте позже.',
        429,
      );
    const attempt = await client.query<{ id: string }>(
      'INSERT INTO gif_upload_attempts(user_id,reserved_bytes) VALUES($1,$2) RETURNING id',
      [userId, reservation],
    );
    return attempt.rows[0]!.id;
  });
}
export async function enforceGifStorage(client: PoolClient, userId: string, size: number) {
  const result = await client.query<{ total: string; owned: string }>(
    `SELECT COALESCE(sum(byte_size),0)::text AS total,
    COALESCE(sum(byte_size) FILTER(WHERE created_by=$1),0)::text AS owned FROM gif_assets`,
    [userId],
  );
  const usage = result.rows[0]!;
  if (Number(usage.owned) + size > GIF_LIMITS.accountStorage)
    throw new GifFileError(
      'GIF_ACCOUNT_STORAGE_FULL',
      'Достигнут лимит своих GIF — 128 МБ. Уберите неиспользуемые GIF и их сообщения.',
      409,
    );
  if (Number(usage.total) + size > GIF_LIMITS.totalStorage)
    throw new GifFileError(
      'GIF_STORAGE_FULL',
      'Загрузка новых GIF временно приостановлена: хранилище заполнено. Сохранённые GIF продолжают работать.',
      507,
    );
}
export async function chargeGifDownload(userId: string, bytes: number) {
  await transaction(async (client) => {
    for (const [scope, limit] of [
      ['all', GIF_LIMITS.totalDailyDownload],
      [`user:${userId}`, GIF_LIMITS.accountDailyDownload],
    ] as const) {
      const result = await client.query(
        `INSERT INTO gif_bandwidth_usage(scope,day,bytes) VALUES($1,current_date,$2)
        ON CONFLICT(scope,day) DO UPDATE SET bytes=gif_bandwidth_usage.bytes+EXCLUDED.bytes
        WHERE gif_bandwidth_usage.bytes+EXCLUDED.bytes<=$3 RETURNING scope`,
        [scope, bytes, limit],
      );
      if (!result.rowCount)
        throw new GifFileError(
          'GIF_DOWNLOAD_LIMIT',
          'Достигнут дневной лимит загрузки GIF. Попробуйте позже.',
          429,
        );
    }
  });
}
export async function pruneUnusedGifs() {
  await transaction(async (client) => {
    const lock = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_xact_lock($1) AS locked',
      [GIF_STORAGE_LOCK],
    );
    if (!lock.rows[0]?.locked) return;
    await client.query(`DELETE FROM gif_assets asset WHERE asset.last_used_at<now()-interval '1 hour'
      AND NOT EXISTS(SELECT 1 FROM gif_favorites favorite WHERE favorite.asset_id=asset.id)
      AND NOT EXISTS(SELECT 1 FROM messages message WHERE message.metadata->'gif'->>'assetId'=asset.id::text
        AND (message.expires_at IS NULL OR message.expires_at>now()))`);
    await client.query("DELETE FROM gif_upload_attempts WHERE created_at<now()-interval '2 days'");
    await client.query('DELETE FROM gif_bandwidth_usage WHERE day<current_date-2');
  });
}
export async function recordGifUploadBytes(attemptId: string, bytes: number) {
  await db.query('UPDATE gif_upload_attempts SET bytes=$2,reserved_bytes=0 WHERE id=$1', [
    attemptId,
    Math.min(bytes, MAX_GIF_UPLOAD_BYTES),
  ]);
}
