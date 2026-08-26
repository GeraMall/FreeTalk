# Account beta 0.4.0

## Граница компонентов

- `apps/desktop` хранит access token только в памяти, refresh token — в Windows Credential Manager или macOS Keychain. В browser-dev refresh token остаётся только в памяти процесса страницы.
- `apps/api` обслуживает HTTPS auth/users/friends/chats/history/guest endpoints и хранит durable state в PostgreSQL.
- `apps/signaling` остаётся отдельным WSS-сервисом. При наличии `ACCOUNT_API_URL` он проверяет create/join через закрытый server-to-server endpoint. SDP, ICE и media не попадают в account API.
- Существующие `PeerManager`, TURN/STUN, Perfect Negotiation и reconnect не заменяются.

## Локальный запуск

Нужен PostgreSQL 15+. Создайте БД и задайте переменные из `.env.example`, затем:

```powershell
pnpm install --frozen-lockfile
pnpm --filter @freetalk/api migrate
pnpm --filter @freetalk/api dev
pnpm dev:signaling
pnpm dev:desktop
```

Для локальной разработки без Cloudflare account разрешается только явная комбинация `NODE_ENV=development`, `CAPTCHA_BYPASS_LOCAL=true` и клиентская кнопка с токеном `local-development`. Production API не принимает этот обход.

## Production beta

1. Создать отдельного PostgreSQL user/database без superuser-прав после установки расширений `pgcrypto` и `citext`.
2. Сгенерировать независимо `TOKEN_PEPPER`, `IP_HASH_SALT` и `INTERNAL_SIGNALING_SECRET` (не менее 32 случайных байт).
3. Установить SMTP и Cloudflare Turnstile secret/site keys.
4. Выполнить миграцию один раз, запустить `freetalk-api.service` и добавить `ACCOUNT_API_URL`/тот же internal secret в signaling service.
5. Caddy публикует API только за HTTPS `/api`; внутренний signaling secret никогда не передаётся клиенту.

В production Caddy явно отвечает `404` на `/api/v1/internal/*`; signaling обращается к этим маршрутам напрямую через `127.0.0.1:8790`. В `ALLOWED_ORIGIN` перечислите реальные origins desktop WebView (`http://tauri.localhost`, `tauri://localhost`) и локальный Vite origin, не используйте `*`.

Beta не должна заменять production signaling до отдельного теста миграции, auth и двух физических WebRTC-клиентов.
