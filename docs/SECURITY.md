# Безопасность и модель угроз

## Границы доверия

- Desktop считается потенциально модифицируемым клиентом: сервер не доверяет `isRegistered`, display name, owner flag или CAPTCHA-флагу.
- HTTPS API удостоверяет registered session, проверяет membership/block/ownership и хранит durable state в PostgreSQL.
- WSS signaling принимает room create/join только после server-to-server авторизации API, если задан `ACCOUNT_API_URL`. SDP/ICE проходят через signaling, но не пишутся в логи; media туда не попадает.
- WebRTC использует DTLS-SRTP напрямую или через TURN. TURN видит сетевые метаданные и зашифрованные пакеты, но FreeTalk beta не имеет проверяемых identity keys или отдельного E2EE-протокола.

## Реализованные контроли 0.4 beta

- Argon2id (64 MiB, 3 прохода), одноразовые verification/reset tokens, 15-минутный access token и 30-дневный rotating refresh token;
- refresh token хранится в Windows Credential Manager/macOS Keychain; browser development держит его только в памяти;
- server-side Turnstile, login throttling, общие и route-specific rate limits;
- параметризованные SQL-запросы, Zod validation, API body limit 64 KiB, avatar limit 1 MiB, magic bytes и dimensions;
- membership/role checks для сообщений, голосований и invite lifecycle; direct chat блокируется при block relationship; в новый чат можно добавить только принятых друзей;
- chat realtime WebSocket принимает access token только первым сообщением поверх WSS, проверяет Origin и подтверждённую сессию, ограничен 8 КиБ, использует heartbeat и отключает медленных потребителей; события рассылаются только текущим участникам соответствующего чата;
- invite/session tokens создаются CSPRNG и хранятся в БД только как SHA-256 hash с server pepper; случайный код комнаты остаётся короткоживущим locator и не считается секретом уровня пароля;
- React escaping; `dangerouslySetInnerHTML`, shell plugin и remote code отсутствуют;
- Tauri CSP, минимальная capability, подписанный Tauri updater и фиксированный native WSS host;
- signaling message size/rate limits, максимум 8 участников, server-controlled owner moderation и guest expiration.

## Privacy

API хранит account/social data, текст временных сообщений до их expiration, историю факта звонка и псевдонимизированные security events. Он не получает и не хранит аудио, видео, экран или содержимое разговора. Development email mode пишет одноразовые коды в локальный серверный журнал; production-конфигурация с таким режимом не запускается.

Desktop сохраняет просмотренные изображения чатов в локальном профиле WebView, разделяя записи по account ID. Кэш ограничен 384 МиБ и 800 объектами, учитывает `expires_at` и очищается при выходе из аккаунта, очистке истории, блокировке пользователя или выходе из чата. Он ускоряет повторный просмотр, но остаётся локальной копией приватных данных, защищённой средствами учётной записи ОС, а не отдельным E2EE-хранилищем.

## Ограничения beta

- Код комнаты остаётся capability-like locator, а не паролем; знающий код registered/authorized пользователь может попытаться войти.
- Client-controlled `anonymousUserId` — best-effort quota identity, не hardware identity; CAPTCHA и rate limits снижают простой abuse, но полностью исключить смену локального ID без аккаунта невозможно.
- Запрет камеры, экрана, профиля и социальных функций для FreeUser обеспечивается официальным desktop-клиентом. Модифицированный peer-to-peer клиент технически может попытаться добавить собственный media track; это не серверная DRM-граница и не защита от злоумышленника с изменённым бинарным файлом.
- Mesh повышает bandwidth/CPU с каждым peer; отсутствие TURN не гарантирует работу через любой NAT.
- Cloudflare Worker adapter оставлен для стабильной ветки и не реализует account authorization; account beta предназначена для Node signaling на VPS.
- Draft Terms/Privacy должны пройти юридическую проверку до production.
- Ad-hoc macOS build не заменяет Developer ID и notarization.

Сообщайте о найденной уязвимости приватно владельцу репозитория; не публикуйте рабочие токены, SDP, ICE credentials или персональные данные.
