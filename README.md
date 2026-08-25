# FreeTalk

FreeTalk — бесплатное desktop-приложение для голосовых комнат на 2–6 человек. Один код, без аккаунтов, рекламы, телеметрии и записи разговоров. Клиент: Tauri 2 + React/TypeScript; аудио: WebRTC mesh + Opus; сигналинг: WebSocket. В desktop-сборке production WSS работает в нативной Rust-части Tauri, поэтому больше не зависит от сетевого маршрута WebView2.

> Статус: функциональный MVP. Автоматически подтверждены два WebRTC peers, состояние `connected` и получение удалённых аудиотреков. Фактическая слышимость через реальные микрофоны/динамики ещё требует ручной проверки.

## Быстрый локальный запуск

Нужны Node.js 22+ и pnpm 11.19.0.

```powershell
pnpm install --frozen-lockfile
pnpm dev:signaling
```

Во втором терминале:

```powershell
pnpm dev:desktop
```

Откройте `http://127.0.0.1:1420` в двух отдельных браузерных профилях. В первом задайте имя и нажмите «Создать комнату», во втором вставьте 12-символьный код или `freetalk://join/CODE`. При входе запрашивается только микрофон; доступ к камере запрашивается отдельно при нажатии кнопки «Камера».

Для нативного окна после установки [Rust](https://rustup.rs/) и [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/):

```powershell
pnpm tauri:dev
```

Локальный сигналинг слушает только `127.0.0.1:8787`, хранит комнаты в памяти и запускается без облачного аккаунта. Development URL задан в `apps/desktop/.env.development`, а production-сборка использует WSS на отдельном VPS из `apps/desktop/.env.production`.

## Реализовано

- создание и вход по криптографически случайному 12-символьному коду/ссылке;
- mesh WebRTC, perfect negotiation (offer glare), ICE deduplication, Opus 64 kbit/s, STUN и опциональный TURN;
- список до 6 участников, connection/audio-ready states и индикатор говорящего;
- независимые видеопотоки камеры и демонстрации экрана: камера запрашивает до 1080p60 и адаптирует детализацию ради низкой задержки, для выбранного окна передаётся его звук без общего системного звука и звуков FreeTalk, поддерживаются одновременные camera + screen, раскрытие медиа внутри приложения и переключение между несколькими демонстрациями;
- встроенные звуковые уведомления о входе и выходе друзей с выровненной громкостью;
- владелец комнаты с короной, автоматическая передача владения и серверно проверяемое удалённое выключение микрофона участника;
- режимы VAD/PTT/постоянной передачи, изменяемая PTT-клавиша и настраиваемый порог голоса;
- input/output device selection, общая и индивидуальная громкость, local mute;
- WebRTC echo cancellation, noise suppression, AGC, output ducking, подавление щелчков клавиатуры, комфортный шум и тестовая запись;
- нативный WSS-транспорт desktop-клиента, exponential reconnect 0.5–30 s, heartbeat, session replacement и краткий reconnect grace;
- сохранение имени, устройств и всех аудиопараметров в localStorage;
- встроенная проверка подписанных обновлений Tauri, уведомление, прогресс и установка из приложения;
- понятные ошибки permission/no device/network/room full/NAT;
- закрытие tracks, audio contexts, peer connections и WebSocket при выходе/закрытии;
- локальный Node signaling и Cloudflare Durable Object production adapter;
- строгая validation/size/rate/participant limits и Tauri CSP;
- полностью переработанный midnight navy/mint интерфейс: анимированная aurora, карточки участников, premium voice dock и desktop-панель настроек;
- русская responsive UI для 900×600 с keyboard focus, reduced-motion и достаточным контрастом.

## Команды

| Команда                                            | Назначение                                        |
| -------------------------------------------------- | ------------------------------------------------- |
| `pnpm install --frozen-lockfile`                   | воспроизводимая установка                         |
| `pnpm dev:signaling`                               | локальный WebSocket server                        |
| `pnpm dev:desktop`                                 | React/Vite client                                 |
| `pnpm tauri:dev`                                   | native development window                         |
| `pnpm check`                                       | format, lint, TS, tests, frontend/server builds   |
| `pnpm tauri:build`                                 | platform release bundles                          |
| `pnpm package:windows`                             | fallback NSIS installer + portable Windows `.exe` |
| `pnpm --filter @freetalk/cloudflare-signaling dev` | локальный Miniflare/Worker                        |

## Windows 10/11

Установите [Microsoft C++ Build Tools + Windows SDK и WebView2 prerequisites](https://v2.tauri.app/start/prerequisites/#windows), затем:

```powershell
pnpm install --frozen-lockfile
pnpm --filter @freetalk/desktop tauri build --no-bundle
pnpm package:windows
```

Результаты:

- официальный NSIS installer: `apps/desktop/src-tauri/target/release/bundle/nsis/`;
- fallback installer и portable executable: `outputs/`.

NSIS использует WebView2 download bootstrapper и показывает установку runtime, если Evergreen WebView2 отсутствует. Portable `.exe` не устанавливает runtime: при его отсутствии сначала установите официальный [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/).

## Обновления из приложения

FreeTalk использует официальный Tauri Updater: клиент принимает только bundles с корректной minisign-подписью, а отключить проверку подписи нельзя. При запуске выполняется тихая проверка; найденная версия показывается баннером и в настройках, после подтверждения пользователя приложение загружает и устанавливает обновление.

Production-сборки проверяют подписанный манифест `latest.json` в публичном GitHub Release. При появлении более новой версии FreeTalk показывает подсказку, а пользователь может скачать и установить обновление из настроек приложения. Закрытый ключ хранится только локально и в зашифрованном GitHub Actions secret; он не входит в исходники или установщик. Инструкция выпуска: [docs/UPDATES.md](docs/UPDATES.md).

## macOS

Сборку выполняют `.github/workflows/build-desktop.yml` и настоящий Mac:

```bash
pnpm install --frozen-lockfile
pnpm --filter @freetalk/desktop tauri build --bundles app,dmg
```

CI отдельно создаёт Intel (`x86_64-apple-darwin`) и Apple Silicon (`aarch64-apple-darwin`) `.app/.dmg` и загружает их как artifacts. Включены описания доступа к микрофону и камере, необходимые entitlements и ad-hoc подпись (`signingIdentity: "-"`). Сборки 0.3.18 создаются на GitHub macOS runners, а наличие `_CodeSignature/CodeResources` проверяется в CI. Фактический первый запуск, видео и слышимость на физическом Mac ещё должен подтвердить пользователь Mac.

Ad-hoc подпись предотвращает ошибку macOS «app is damaged» у полностью неподписанного bundle, но не заменяет платные Developer ID и notarization. Для первого безопасного запуска: перетащите FreeTalk в Applications, затем в Finder сделайте Control-click по FreeTalk → «Открыть» → «Открыть». Альтернатива: System Settings → Privacy & Security → сообщение о FreeTalk → «Open Anyway». Не отключайте Gatekeeper целиком.

Для будущего signed/notarized release используйте Apple Developer ID Application certificate, App Store Connect issuer/key и переменные CI `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_API_ISSUER`, `APPLE_API_KEY`, `APPLE_API_KEY_PATH`, затем включите signing/notarization по [Tauri macOS signing guide](https://v2.tauri.app/distribute/sign/macos/). Платная Apple account для локальной unsigned разработки не нужна.

## Production signaling и TURN

Production-сигналинг работает на Node.js-сервисе в VPS Санкт-Петербурга за Caddy/WSS. Комнаты находятся только в памяти, аудио на VPS не передаётся. Cloudflare Worker оставлен как закрытый server-to-server broker краткоживущих TURN-данных: клиенты к `workers.dev` больше не подключаются. Развёртывание описано в [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

Production WSS развёрнут и проверен по адресу `wss://freetalk.191-44-38-60.sslip.io/ws`. Production build:

```powershell
pnpm tauri:build
```

Проверка сетевых точек через обычный Ethernet без VPN и ограничения для сложных NAT описаны в [docs/RUSSIA-NETWORK.md](docs/RUSSIA-NETWORK.md).

Основные TURN secrets задаются только Worker:

- `TURN_KEY_ID`;
- `TURN_KEY_API_TOKEN`;
- `TURN_CREDENTIAL_TTL_SECONDS` (например, `86400`).

Worker и VPS дополнительно используют одинаковый `TURN_BROKER_TOKEN`; он не попадает в клиент или репозиторий. На VPS задаётся `TURN_BROKER_URL`. Сам VPS является платным ресурсом пользователя, поэтому production-сценарий больше не заявляется как полностью бесплатный.

Без TURN FreeTalk продолжает использовать бесплатный STUN, но не обещает соединение через symmetric NAT и строгие корпоративные firewalls. В репозитории есть только `.env.example` без ключей.

## Проверки

Локально выполнены 24.08.2026 на Windows:

- TypeScript всех workspace packages — пройден;
- ESLint и Prettier check — пройдены;
- unit tests protocol/validation/rooms/limit/cleanup/reconnect/audio gate/owner moderation — пройдены;
- signaling/protocol/frontend production builds — пройдены;
- `cargo check` (Rust 1.98.0, Tauri 2.11.5) — пройден;
- `cargo test --lib` — пройдены ограничения нативного WSS URL и размера/формата сообщений;
- звонок между двумя реальными устройствами без VPN подтверждён пользователем: звук работал в обе стороны;
- исправлены ложные переподключения из-за изменения оценки сети WebView и запоздалые дублирующие WebRTC answer; диагностический журнал соединения сохраняется из настроек на рабочий стол;
- принудительный TURN relay без VPN отдельно прошёл через UDP, TCP и TLS, включая ненулевой синтетический аудиосигнал;
- два Chromium clients с fake microphone — оба connected и получили remote track; владелец принудительно выключил микрофон второго клиента, состояние синхронизировалось в обеих вкладках;
- PTT keydown — UI pressed gate и unit-level `MediaStreamTrack.enabled` проверены;
- сложный NAT/TURN и macOS на физическом Mac — не проверены.

Подробнее: [docs/TESTING.md](docs/TESTING.md).

## Безопасность и ограничения

Сервер не получает звук, но видит IP/connection metadata и сигналинг. Код комнаты — capability-like locator, не пароль; имя не удостоверяется. Transport защищён WebRTC DTLS-SRTP, но MVP не имеет проверяемых identity keys или отдельного E2EE слоя. Не публикуйте код комнаты. Полная модель угроз: [docs/SECURITY.md](docs/SECURITY.md).

Основные известные ограничения: mesh расходует исходящий bandwidth/CPU пропорционально числу peers; нет host approval/password; room state теряется при полном перезапуске локального signaling server; output selection зависит от WebView `setSinkId`; глобальный system-wide PTT намеренно отсутствует; без TURN соединяются не все NAT.

## Структура

```text
apps/desktop              React + Tauri
apps/signaling            local Node WebSocket signaling
apps/cloudflare-signaling Cloudflare Worker/Durable Object
packages/protocol         shared Zod schemas/types
packages/config           shared limits/defaults
docs                      architecture/deployment/security/testing
.github/workflows         checks + Windows/macOS bundles
```

Код FreeTalk распространяется по [MIT](LICENSE). Встроенный шрифт Geist распространяется по SIL Open Font License 1.1; текст лицензии включён в `apps/desktop/public/licenses` и попадает в каждую сборку приложения.
