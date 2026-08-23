# Развёртывание сигналинга

## Текущий production Worker

23.08.2026 Worker развёрнут по адресу
`https://freetalk-signaling.freetalk-cloudflare-signaling.workers.dev`.
Клиент использует `wss://freetalk-signaling.freetalk-cloudflare-signaling.workers.dev/ws`.
Аудио через Worker не проходит; он передаёт только сигналинг и состояние комнаты.

Актуальность тарифов проверена 23.08.2026 по официальной документации Cloudflare.

## Бесплатный сценарий

Cloudflare Durable Objects с SQLite backend доступны на Workers Free. На Free plan указано 100 000 DO requests/day и 13 000 GB-s/day; при превышении операции прекращаются, а не создают гарантированно бесплатный безлимит. WebSocket Hibernation не тарифицирует время простоя как active duration. Источники: [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [WebSocket Hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/).

```powershell
pnpm install --frozen-lockfile
pnpm --filter @freetalk/cloudflare-signaling exec wrangler login
pnpm --filter @freetalk/cloudflare-signaling deploy
```

`wrangler login` и `deploy` создают/изменяют внешний ресурс и требуют явного разрешения. Для новой сборки используйте адрес Worker в `VITE_SIGNALING_URL`.

## TURN

Cloudflare указывает бесплатный unlimited STUN `stun.cloudflare.com` и 1000 GB free tier для Realtime TURN, затем $0.05/GB; стоимость не является бессрочной гарантией. Источники: [TURN FAQ](https://developers.cloudflare.com/realtime/turn/faq/), [credential generation](https://developers.cloudflare.com/realtime/turn/generate-credentials/).

Создайте TURN key в Cloudflare и сохраните secrets только в Worker:

```powershell
pnpm --filter @freetalk/cloudflare-signaling exec wrangler secret put TURN_KEY_ID
pnpm --filter @freetalk/cloudflare-signaling exec wrangler secret put TURN_KEY_API_TOKEN
pnpm --filter @freetalk/cloudflare-signaling exec wrangler secret put TURN_CREDENTIAL_TTL_SECONDS
```

Worker обменивает server-side key на краткоживущие ICE credentials. В клиент и Git они не попадают. Без этих переменных выдаётся только STUN-конфигурация и прямое соединение может не пройти через symmetric NAT/строгий корпоративный firewall.

`ALLOWED_ORIGIN` опционально ограничивает WebSocket Origin. Для Tauri production origin зависит от платформы; проверяйте фактический origin перед включением строгого значения.
