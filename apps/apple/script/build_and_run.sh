#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
[[ "$(uname -s)" == Darwin ]] || { echo 'macOS with Xcode is required.' >&2; exit 1; }
command -v xcodegen >/dev/null || { echo 'Install XcodeGen: brew install xcodegen' >&2; exit 1; }
PLATFORM="${1:-macos}"
MODE="${2:-run}"
BUILD_SETTINGS=()
case "$PLATFORM" in
  macos)
    SCHEME=TRLKA-macOS
    DESTINATION='generic/platform=macOS'
    BUILD_SETTINGS=('ARCHS=arm64 x86_64' 'ONLY_ACTIVE_ARCH=NO')
    ;;
  ios) SCHEME=TRLKA-iOS; DESTINATION="platform=iOS Simulator,id=${SIMULATOR_UDID:?Set SIMULATOR_UDID using xcrun simctl list devices available}" ;;
  *) echo 'usage: build_and_run.sh [macos|ios] [run|--build-only|--verify|--logs|--debug]' >&2; exit 2 ;;
esac
case "$MODE" in run|--build-only|--verify|--logs|--debug) ;; *) echo 'Unknown mode' >&2; exit 2 ;; esac
xcodegen generate --spec project.yml
xcodebuild -project TRLKA.xcodeproj -scheme "$SCHEME" -destination "$DESTINATION" \
  -derivedDataPath "build/$PLATFORM" "${BUILD_SETTINGS[@]}" CODE_SIGNING_ALLOWED=NO build
[[ "$MODE" != --build-only ]] || exit 0
if [[ "$PLATFORM" == macos ]]; then
  APP="$ROOT/build/macos/Build/Products/Debug/TRLKA.app"
  pkill -x TRLKA >/dev/null 2>&1 || true
  # Local ad-hoc signature gives the preview its declared sandbox entitlements.
  codesign --force --sign - --entitlements Configuration/macOS.entitlements "$APP"
  if [[ "$MODE" == --debug ]]; then lldb -- "$APP/Contents/MacOS/TRLKA"; exit; fi
  /usr/bin/open -n "$APP"
  if [[ "$MODE" == --verify ]]; then sleep 2; pgrep -x TRLKA >/dev/null; fi
  if [[ "$MODE" == --logs ]]; then /usr/bin/log stream --info --predicate 'process == "TRLKA"'; fi
else
  [[ "$MODE" != --debug && "$MODE" != --logs ]] || { echo 'Use Xcode debugger/logs for iOS.' >&2; exit 2; }
  xcrun simctl boot "$SIMULATOR_UDID" 2>/dev/null || true
  xcrun simctl bootstatus "$SIMULATOR_UDID" -b
  open -a Simulator
  xcrun simctl install "$SIMULATOR_UDID" "$ROOT/build/ios/Build/Products/Debug-iphonesimulator/TRLKA.app"
  xcrun simctl terminate "$SIMULATOR_UDID" com.trlka.ios 2>/dev/null || true
  xcrun simctl launch "$SIMULATOR_UDID" com.trlka.ios
fi
