import nodemailer from 'nodemailer';
import { env } from './env.js';

const transport =
  env.EMAIL_DELIVERY_MODE === 'smtp'
    ? nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 30_000,
        auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
      })
    : undefined;

async function deliver(to: string, subject: string, text: string, messageId?: string) {
  if (!transport) {
    console.info(JSON.stringify({ event: 'development-email', to, subject, text }));
    return;
  }
  await transport.sendMail({ from: env.EMAIL_FROM, to, subject, text, messageId });
}

export function sendSupportReport(input: {
  id: string;
  kind: string;
  body: string;
  userId: string;
  username: string;
  version: string;
}) {
  if (!env.SUPPORT_EMAIL) throw new Error('Support delivery is not configured');
  return deliver(
    env.SUPPORT_EMAIL,
    `TRLKA: ${input.kind === 'bug' ? 'ошибка' : 'предложение'} #${input.id}`,
    `Обращение: ${input.id}\nПользователь: @${input.username}\nID: ${input.userId}\nВерсия: ${input.version}\n\n${input.body}`,
    `<trlka-support-${input.id}@trlka.com>`,
  );
}

export function sendVerification(email: string, token: string) {
  return deliver(
    email,
    'Подтверждение Trlka',
    `Ваш код Trlka: ${token}\n\nКод действует 30 минут. Введите шесть цифр в приложении. Если вы не создавали аккаунт, просто проигнорируйте письмо.`,
  );
}

export function sendPasswordReset(email: string, token: string) {
  return deliver(
    email,
    'Сброс пароля Trlka',
    `Код сброса пароля Trlka: ${token}\n\nКод действует 20 минут и используется один раз. Введите его в приложении. Никому не сообщайте код. Если вы не запрашивали сброс, проигнорируйте письмо.`,
  );
}
