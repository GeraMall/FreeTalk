#!/usr/bin/env bash
set -euo pipefail

report_dir=$(realpath "${1:?Provide a writable directory for startup results}")
app=/usr/bin/freetalk
test -x "$app"

profile=$(mktemp -d)
export XDG_CONFIG_HOME="$profile/config"
export XDG_DATA_HOME="$profile/data"
export XDG_CACHE_HOME="$profile/cache"
export FREETALK_WEBVIEW_DATA_DIR="$profile/webview"
mkdir -p "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" "$XDG_CACHE_HOME"

"$app" > "$report_dir/app.log" 2>&1 &
app_pid=$!
trap 'kill "$app_pid" 2>/dev/null || true; wait "$app_pid" 2>/dev/null || true' EXIT

deadline=$((SECONDS + 25))
while (( SECONDS < deadline )); do
  if ! kill -0 "$app_pid" 2>/dev/null; then
    cat "$report_dir/app.log" >&2
    exit 1
  fi
  window_id=$(xdotool search --onlyvisible --all --pid "$app_pid" --name '^Trlka$' 2>/dev/null | head -n 1 || true)
  if [[ -n "$window_id" ]] && import -silent -window "$window_id" "$report_dir/startup.png"; then
    read -r width height colors < <(identify -format '%w %h %k\n' "$report_dir/startup.png")
    if (( width >= 640 && height >= 480 && colors >= 20 )); then
      printf 'Installed TRLKA rendered a %dx%d window with %s colors.\n' "$width" "$height" "$colors"
      exit 0
    fi
  fi
  sleep 1
done

cat "$report_dir/app.log" >&2
echo "Installed TRLKA did not render its window within 25 seconds." >&2
exit 1
