# Архитектура FreeTalk

## Поток данных

1. Клиент получает `MediaStream` только с аудиотреком и применяет echo cancellation, noise suppression, automatic gain control, mono/48 kHz.
2. WebSocket-сигналинг передаёт присутствие, mute, SDP и ICE. В Tauri production WSS открывает нативный Rust-модуль; браузерная разработка использует стандартный `WebSocket`. Аудиоданные через сигналинг не проходят.
3. `PeerManager` создаёт один `RTCPeerConnection` на каждого удалённого участника. Mesh из шести человек означает до пяти исходящих Opus-потоков на клиент.
4. После SDP/ICE браузеры передают DTLS-SRTP аудио напрямую либо через TURN. Opus получает ограничение 64 kbit/s на sender.

`PeerManager` изолирован от React и от протокола комнаты, поэтому позднее его можно заменить адаптером SFU, сохранив UI, аудиоменеджер и signaling state.

## Модули

- `packages/protocol` — Zod-схемы и общие типы client/server сообщений.
- `packages/config` — лимиты, STUN и backoff.
- `apps/signaling` — локальный Node.js/WebSocket server и `RoomManager`.
- `apps/cloudflare-signaling` — production Durable Object с WebSocket Hibernation API.
- `apps/desktop/src/lib/audio-manager.ts` — захват, mute/PTT и voice activity.
- `peer-manager.ts` — perfect negotiation, ICE deduplication, Opus и peer lifecycle.
- `signaling-client.ts` — heartbeat и ограниченный exponential backoff до 30 секунд.
- `signaling-transport.ts` и `src-tauri/src/signaling.rs` — взаимозаменяемые browser/native WSS-транспорты; нативный транспорт разрешает только production FreeTalk WSS и локальный development server, ограничивает сообщения 32 КБ и проверяет исходящий JSON.
- `remote-audio.ts` — output sink, индивидуальные volume/mute и удалённый voice activity.

## Протокол

Клиент: `create-room`, `join-room`, `leave-room`, `offer`, `answer`, `ice-candidate`, `mute-changed`, `ping`.

Сервер: `room-created`, `joined-room`, `participants`, `participant-joined`, `participant-left`, `offer`, `answer`, `ice-candidate`, `mute-changed`, `ice-config`, `pong`, `error`, `room-closed`, `participant-disconnected`.

Комнатный код содержит 12 символов из алфавита без неоднозначных `0/O/1/I` и создаётся `crypto.getRandomValues`. Это примерно 60 бит энтропии, но не пароль и не доказательство личности.
