# Обновления FreeTalk

## Как это работает

Клиент использует `tauri-plugin-updater` 2.10.1. При запуске он тихо проверяет статический `latest.json`; ручная проверка доступна в настройках. Если сервер возвращает более новую SemVer-версию, пользователь видит уведомление, описание и кнопку установки. На Windows официальный NSIS updater завершает приложение и запускает пассивную установку; на macOS приложение перезапускается после установки.

Подпись обязательна и проверяется публичным ключом, встроенным в `tauri.conf.json`. Закрытый ключ нельзя менять или терять: иначе уже установленные клиенты не смогут принять новые версии.

## Что требуется для production

1. HTTPS-адрес для `latest.json` и release bundles. Текущая конфигурация использует публичные GitHub Releases репозитория `GeraMall/FreeTalk`.
2. Не менять `plugins.updater.endpoints` без выпуска переходной версии: уже установленные клиенты должны продолжать видеть манифест.
3. Задать `TAURI_SIGNING_PRIVATE_KEY` содержимым приватного minisign-ключа и, если используется, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. В CI ключ хранится как secret `FREETALK_UPDATER_PRIVATE_KEY`; путь к файлу текущий Tauri CLI 2.11.1 при release-сборке не принял.
4. Выполнить `pnpm tauri:build`. При `createUpdaterArtifacts: true` Tauri создаст installer/archive и `.sig`.
5. Опубликовать bundles, подписи и manifest только после проверки хешей.

Пример `latest.json`:

```json
{
  "version": "0.3.0",
  "notes": "Исправления связи и интерфейса",
  "pub_date": "2026-08-23T12:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "СОДЕРЖИМОЕ ФАЙЛА .sig",
      "url": "https://updates.example/FreeTalk_0.3.0_x64-setup.exe"
    },
    "darwin-aarch64": {
      "signature": "СОДЕРЖИМОЕ ФАЙЛА .sig",
      "url": "https://updates.example/FreeTalk.app.aarch64.tar.gz"
    },
    "darwin-x86_64": {
      "signature": "СОДЕРЖИМОЕ ФАЙЛА .sig",
      "url": "https://updates.example/FreeTalk.app.x64.tar.gz"
    }
  }
}
```

URL обязан использовать HTTPS. В manifest помещается содержимое `.sig`, а не ссылка на файл подписи. Закрытый ключ, пароль и TURN-секреты не должны попадать в manifest, клиент или логи.

## Текущий статус

Механизм проверки при запуске, ручная проверка, уведомление, прогресс установки, Tauri permissions и подписываемые updater-artifacts реализованы. Актуальная beta-версия исходников — 0.4.0-beta.106. Production endpoint: `https://github.com/GeraMall/FreeTalk/releases/latest/download/latest.json`. CI собирает Windows x64, macOS Apple Silicon и macOS Intel, присваивает updater-архивам уникальные имена и автоматически формирует `latest.json`. Манифест и bundles публикуются в GitHub Release; подпись проверяется встроенным публичным ключом. При недоступности GitHub текущая версия продолжает работать, а интерфейс показывает понятную ошибку.

Начиная с 0.4.0-beta.18 установщик регистрирует системную схему `freetalk://`. Пользовательские приглашения копируются как обычные HTTPS-ссылки вида `https://freetalk.191-44-38-60.sslip.io/join/<ROOM_CODE>`: безопасная промежуточная страница открывает установленное приложение либо предлагает скачать подходящий установщик. Переносная Windows-версия не регистрирует протокол в системе, поэтому для переходов по ссылке нужен NSIS-установщик.
