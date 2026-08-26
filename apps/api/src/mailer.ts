import nodemailer from 'nodemailer';
import { env } from './env.js';

const transport =
  env.EMAIL_DELIVERY_MODE === 'smtp'
    ? nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
      })
    : undefined;

async function deliver(to: string, subject: string, text: string) {
  if (!transport) {
    console.info(JSON.stringify({ event: 'development-email', to, subject, text }));
    return;
  }
  await transport.sendMail({ from: env.EMAIL_FROM, to, subject, text });
}

export function sendVerification(email: string, token: string) {
  return deliver(
    email,
    'Подтверждение FreeTalk',
    `Ваш код FreeTalk: ${token}\n\nКод действует 30 минут. Введите шесть цифр в приложении. Если вы не создавали аккаунт, просто проигнорируйте письмо.`,
  );
}

export function sendPasswordReset(email: string, token: string) {
  return deliver(
    email,
    'Сброс пароля FreeTalk',
    `Код сброса: ${token}\nКод действует 20 минут. Если вы не запрашивали сброс, ничего не делайте.`,
  );
}
