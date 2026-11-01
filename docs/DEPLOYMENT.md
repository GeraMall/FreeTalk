# Развёртывание сигналинга

## Текущий production

С 24.08.2026 клиент использует `wss://freetalk.191-44-38-60.sslip.io/ws` на VPS в Санкт-Петербурге. Caddy принимает HTTPS/WSS на TCP 443 и передаёт запросы Node.js-сервису на `127.0.0.1:8787`. Публичный health endpoint: `https://freetalk.191-44-38-60.sslip.io/health`.

Комнаты и присутствие хранятся только в памяти. Аудио через VPS не проходит. После перезапуска службы комнаты очищаются.

Файлы установки находятся в `deploy/vps`: Caddyfile, systemd unit и SSH hardening drop-in. Служба работает от отдельного непривилегированного пользователя `freetalk`; firewall разрешает только SSH, HTTP для выпуска сертификата и HTTPS/WSS. Вход по SSH-паролю отключён после проверки отдельного ключа.

Сборка server bundle:

```powershell
pnpm install --frozen-lockfile
pnpm --filter @freetalk/signaling bundle
```

Bundle устанавливается как `/opt/freetalk/server.bundle.mjs`, затем перезапускается `freetalk-signaling.service`. Production signaling требует `ACCOUNT_API_URL` и `INTERNAL_SIGNALING_SECRET` и отказывается запускаться без них. Accountless-режим доступен только локально при явном `SIGNALING_ALLOW_INSECURE_DEVELOPMENT=true`. Секреты находятся в `/etc/freetalk/signaling.env` с режимом `0600` и не копируются в Git.

## TURN broker

Cloudflare Worker больше не обслуживает клиентский signaling. Он используется только как закрытый HTTPS broker, который обменивает серверные Cloudflare TURN keys на краткоживущую ICE-конфигурацию. Клиент получает эту конфигурацию от VPS через уже установленный WSS.

Основные секреты хранятся только в Worker:

```powershell
pnpm --filter @freetalk/cloudflare-signaling exec wrangler secret put TURN_KEY_ID
pnpm --filter @freetalk/cloudflare-signaling exec wrangler secret put TURN_KEY_API_TOKEN
pnpm --filter @freetalk/cloudflare-signaling exec wrangler secret put TURN_CREDENTIAL_TTL_SECONDS
pnpm --filter @freetalk/cloudflare-signaling exec wrangler secret put TURN_BROKER_TOKEN
pnpm --filter @freetalk/cloudflare-signaling run deploy
```

На VPS задаются только `TURN_BROKER_URL` и тот же случайный `TURN_BROKER_TOKEN`. При недоступности broker сервер отдаёт STUN fallback, но соединение через symmetric NAT или строгий firewall тогда не гарантируется.

01.11.2026 обнаружен сброс исходящего TLS 1.3 из Node.js к broker на текущем
сетевом маршруте VPS. С теми же URL, токеном и проверкой сертификата TLS 1.2
возвращает корректные TURN credentials. Для текущего VPS установлен отдельный
systemd drop-in `deploy/vps/freetalk-signaling.service.d/40-turn-broker-tls.conf`.
Он ограничивает исходящий TLS только процесса сигналинга; публичный HTTPS/WSS
через Caddy сохраняет свою конфигурацию. Нельзя переносить этот сетевой обход
на другие серверы без проверки. После устранения причины в сети override можно
удалить и повторно проверить принудительное соединение через TURN.

Изменения служб применять в период без активных комнат, проверяя защищённый
`/internal/active-rooms` непосредственно перед перезапуском. Публикация статических
файлов сайта перезапуска API и сигналинга не требует.

24.08.2026 production-проверка подтвердила валидный TLS-сертификат, WSS upgrade 101, корреляционные заголовки, создание комнаты, ping/pong и выдачу UDP/TCP/TLS TURN URLs без вывода credentials. Сам VPS является платным ресурсом пользователя; нулевая стоимость production больше не заявляется.
