import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import argon2 from 'argon2';
import { z } from 'zod';
import { env } from './env.js';

export const RESERVED_USERNAMES = new Set([
  'admin',
  'administrator',
  'moderator',
  'freetalk',
  'support',
  'system',
  'security',
  'root',
  'staff',
]);

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(5, 'Username должен содержать минимум 5 символов')
  .max(24)
  .regex(
    /^[a-z0-9_]+$/,
    'Username может содержать только латинские буквы, цифры и нижнее подчёркивание',
  )
  .refine((value) => !RESERVED_USERNAMES.has(value), 'Это имя зарезервировано');

export const emailSchema = z.string().trim().toLowerCase().email().max(254);
export const displayNameSchema = z.string().trim().min(1).max(48);
export const passwordSchema = z
  .string()
  .min(10, 'Пароль должен содержать не менее 10 символов')
  .max(256)
  .refine((value) => /[A-Za-zА-Яа-я]/.test(value) && /\d/.test(value), {
    message: 'Добавьте букву и цифру',
  });

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

export function randomVerificationCode() {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export function tokenHash(token: string) {
  return createHash('sha256').update(env.TOKEN_PEPPER).update('\0').update(token).digest();
}

export function hashIp(ip: string) {
  return createHash('sha256').update(env.IP_HASH_SALT).update('\0').update(ip).digest();
}

export async function hashPassword(password: string) {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65_536,
    timeCost: 3,
    parallelism: 1,
  });
}

export async function verifyPassword(hash: string, password: string) {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export function secureSecretEqual(actual: string, expected: string) {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function verifyCaptcha(token: string, remoteIp?: string) {
  if (env.NODE_ENV === 'test' && token === 'test-captcha-pass') return true;
  if (env.NODE_ENV === 'development' && env.CAPTCHA_BYPASS_LOCAL && token === 'local-development')
    return true;
  const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token });
  if (remoteIp) body.set('remoteip', remoteIp);
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body,
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) return false;
  const result = (await response.json()) as { success?: boolean };
  return result.success === true;
}

export function bearerToken(header?: string) {
  const match = /^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(header ?? '');
  return match?.[1];
}
