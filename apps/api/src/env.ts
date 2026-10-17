import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_HOST: z.string().default('127.0.0.1'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(8790),
    API_PUBLIC_URL: z.string().url().default('http://127.0.0.1:8790'),
    ALLOWED_ORIGIN: z.string().default('http://127.0.0.1:1420'),
    DATABASE_URL: z.string().min(1),
    DATABASE_SSL: booleanString,
    TOKEN_PEPPER: z.string().min(32),
    INTERNAL_SIGNALING_SECRET: z.string().min(32),
    TURNSTILE_SECRET_KEY: z.string().min(1),
    CAPTCHA_BYPASS_LOCAL: booleanString,
    EMAIL_DELIVERY_MODE: z.enum(['smtp', 'log']).default('log'),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
    SMTP_SECURE: booleanString,
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    EMAIL_FROM: z.string().default('Trlka <noreply@localhost>'),
    IP_HASH_SALT: z.string().min(16),
    WEB_PUSH_VAPID_PUBLIC_KEY: z.string().min(40).optional(),
    WEB_PUSH_VAPID_PRIVATE_KEY: z.string().min(20).optional(),
    WEB_PUSH_SUBJECT: z.string().default('mailto:support@trlka.com'),
  })
  .superRefine((value, context) => {
    if (value.NODE_ENV === 'production' && value.EMAIL_DELIVERY_MODE !== 'smtp') {
      context.addIssue({
        code: 'custom',
        path: ['EMAIL_DELIVERY_MODE'],
        message: 'Production requires SMTP email delivery',
      });
    }
    if (value.EMAIL_DELIVERY_MODE === 'smtp' && (!value.SMTP_HOST || !value.SMTP_USER)) {
      context.addIssue({
        code: 'custom',
        path: ['SMTP_HOST'],
        message: 'SMTP_HOST and SMTP_USER are required in smtp mode',
      });
    }
    if (Boolean(value.WEB_PUSH_VAPID_PUBLIC_KEY) !== Boolean(value.WEB_PUSH_VAPID_PRIVATE_KEY)) {
      context.addIssue({
        code: 'custom',
        path: ['WEB_PUSH_VAPID_PUBLIC_KEY'],
        message: 'Both WEB_PUSH_VAPID_PUBLIC_KEY and WEB_PUSH_VAPID_PRIVATE_KEY are required',
      });
    }
  });

export type ApiEnv = z.infer<typeof envSchema>;
export const env = envSchema.parse(process.env);

export function publicApiUrl(path: string) {
  const base = `${env.API_PUBLIC_URL.replace(/\/$/, '')}/`;
  return new URL(path.replace(/^\//, ''), base).toString();
}

export function publicAvatarUrl(userId: string, hasAvatar: boolean) {
  return hasAvatar ? publicApiUrl(`/v1/users/${encodeURIComponent(userId)}/avatar`) : undefined;
}
