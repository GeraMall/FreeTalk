# Работа без VPN в России

Проверено 23.08.2026 на обычном Ethernet-подключении текущего ПК, принудительно
исключив VPN-маршрут для тестовых сокетов:

- production signaling и WSS Cloudflare Workers доступны на TCP 443;
- updater manifest на GitHub Releases доступен по HTTPS (HTTP 200);
- Cloudflare STUN вернул корректный Binding Response по UDP 3478;
- `turn.cloudflare.com` доступен по TCP 443, 80 и 3478.

Эти результаты подтверждают доступность сетевых точек через проверенного российского
провайдера, но не гарантируют одинаковую маршрутизацию у всех операторов и во всех
регионах. FreeTalk 0.3.4 дополнительно перезапускает ICE после получения серверной
TURN-конфигурации и ограничивает автоматические ICE restart тремя попытками.

## Что уже работает без TURN

Сигналинг, комнаты, присутствие и прямой WebRTC через STUN работают без VPN там, где
NAT двух участников допускает прямую пару. Сервер комнат не получает аудио.

## Что требуется для сложных NAT

Для symmetric NAT, части мобильных операторов и строгих корпоративных сетей нужен TURN.
Worker уже умеет выдавать только краткоживущие credentials и не передаёт долгосрочный
секрет клиенту. До добавления `TURN_KEY_ID` и `TURN_KEY_API_TOKEN` приложение честно
показывает «WebRTC · прямое» и «Прямой WebRTC (STUN)».

Cloudflare на дату проверки указывает 1000 GB в месяц бесплатно для общего использования
Realtime SFU/TURN, затем тарификацию $0.05/GB. Это usage-based сервис, поэтому включать его
без согласия владельца на возможные расходы нельзя. Официальные источники:
[TURN pricing](https://developers.cloudflare.com/realtime/sfu/pricing/),
[TURN endpoints](https://developers.cloudflare.com/realtime/turn/),
[short-lived credentials](https://developers.cloudflare.com/realtime/turn/generate-credentials/).

После настройки TURN интерфейс показывает «TURN готов» и «WebRTC · TURN резерв».
