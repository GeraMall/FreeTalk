#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
mode=${1:-run}
case "$mode" in
  run|--debug|--logs|--telemetry|--verify) ;;
  *) echo "Usage: $0 [--debug|--logs|--telemetry|--verify]" >&2; exit 2 ;;
esac

if [[ $(uname -s) != Darwin ]]; then
  echo "This entrypoint requires macOS." >&2
  exit 1
fi

app=${TRLKA_MAC_BUNDLE:-}
if [[ -z "$app" ]]; then
  case "$(uname -m)" in
    arm64) target=aarch64-apple-darwin ;;
    x86_64) target=x86_64-apple-darwin ;;
    *) echo "Unsupported Mac architecture" >&2; exit 1 ;;
  esac
  pnpm --filter @freetalk/desktop tauri build --target "$target" --bundles app \
    --config '{"bundle":{"createUpdaterArtifacts":false}}'
  app="apps/desktop/src-tauri/target/$target/release/bundle/macos/Trlka.app"
fi

binary="$app/Contents/MacOS/freetalk"
test -x "$binary"
pkill -x freetalk >/dev/null 2>&1 || true
if [[ "$mode" == --debug ]]; then
  exec lldb -- "$binary"
fi

/usr/bin/open -n "$app"
case "$mode" in
  --logs|--telemetry)
    exec /usr/bin/log stream --info --style compact --predicate 'process == "freetalk"'
    ;;
  --verify)
    for _ in {1..20}; do
      if pgrep -x freetalk >/dev/null; then
        sleep 3
        pgrep -x freetalk >/dev/null
        echo "TRLKA started and remained running."
        exit 0
      fi
      sleep 1
    done
    echo "TRLKA did not start." >&2
    exit 1
    ;;
esac
