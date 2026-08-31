# Архитектура FreeTalk

## Поток данных

1. Desktop общается с `apps/api` по HTTPS для auth/profile/friends/chats/history. Durable account state хранится в PostgreSQL; access token живёт в памяти клиента, refresh token — в системном secure storage. После входа отдельный WSS `/api/v1/chats/realtime` доставляет события чатов моментально; создание сообщений по-прежнему идёт через проверяемый и ограниченный HTTP API.
   Для новых изображений клиент загружает оригинал и WebP-миниатюру. Лента лениво получает миниатюру, полноразмерный файл — только при открытии. Приватные ответы кэшируются в IndexedDB отдельно для каждого аккаунта с LRU-лимитом 384 МиБ/800 объектов и сроком жизни сообщения.
2. WSS signaling проверяет create/join через закрытый server-to-server API. Registered identity и guest quota определяет API, а не клиентский display name или boolean.
3. Клиент получает локальные media tracks и передаёт через signaling только presence, mute, SDP и ICE. Account API не получает SDP/ICE, аудио, видео или экран.
4. `PeerManager` создаёт один `RTCPeerConnection` на каждого удалённого участника. Mesh из восьми человек означает до семи исходящих наборов tracks на клиент.
5. После SDP/ICE клиенты передают DTLS-SRTP media напрямую либо через TURN.

`PeerManager` изолирован от React и от протокола комнаты, поэтому позднее его можно заменить адаптером SFU, сохранив UI, аудиоменеджер и signaling state.

## Модули

- `packages/protocol` — Zod-схемы и общие типы client/server сообщений.
- `packages/config` — лимиты, STUN и backoff.
- `apps/signaling` — локальный Node.js/WebSocket server и `RoomManager`.
- `apps/api` — Fastify API, Argon2id, session lifecycle, social policy и PostgreSQL migrations.
- `apps/cloudflare-signaling` — production Durable Object с WebSocket Hibernation API.
- `apps/desktop/src/lib/audio-manager.ts` — захват, mute/PTT и voice activity.
- `peer-manager.ts` — perfect negotiation, ICE deduplication, Opus и peer lifecycle.
- `signaling-client.ts` — heartbeat и ограниченный exponential backoff до 30 секунд.
- `signaling-transport.ts` и `src-tauri/src/signaling.rs` — взаимозаменяемые browser/native WSS-транспорты; нативный транспорт разрешает только production FreeTalk WSS и локальный development server, ограничивает сообщения 32 КБ и проверяет исходящий JSON.
- `remote-audio.ts` — output sink, индивидуальные volume/mute и удалённый voice activity.
- `chat-image-cache.ts` — дедупликация загрузок и ограниченный локальный кэш приватных изображений; очищается при выходе, очистке истории, блокировке или выходе из чата.

## Протокол

Клиент: `create-room`, `join-room` (с account/guest token), `leave-room`, `offer`, `answer`, `ice-candidate`, `mute-changed`, `update-profile`, `reaction`, `moderation-mute`, `ping`.

Сервер: `room-created`, `joined-room`, `participants`, `participant-joined`, `participant-left`, `offer`, `answer`, `ice-candidate`, `mute-changed`, `ice-config`, `pong`, `error`, `room-closed`, `participant-disconnected`.

Комнатный код содержит 12 символов из алфавита без неоднозначных `0/O/1/I` и создаётся `crypto.getRandomValues`. Это примерно 60 бит энтропии, но не пароль и не доказательство личности.
