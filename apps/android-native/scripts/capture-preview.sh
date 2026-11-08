#!/usr/bin/env bash
set -euo pipefail
wrapper=apps/desktop/src-tauri/gen/android/gradlew
test_status=0
"$wrapper" -p apps/android-native :app:connectedDebugAndroidTest --console=plain || test_status=$?
adb install -r apps/android-native/app/build/outputs/apk/debug/app-debug.apk
mkdir -p apps/android-native/build/previews
for mode in login home chats conversation bot settings friends history call video; do
  adb shell am force-stop io.freetalk.mobile
  adb shell am start -W -n io.freetalk.mobile/.DesignPreviewActivity --es mode "$mode"
  sleep 2
  adb exec-out screencap -p > "apps/android-native/build/previews/phone-$mode.png"
done
for config in 'small 960x1704 480' 'tablet 1600x2560 320' 'landscape 1600x1000 240'; do
  read -r name size density <<< "$config"
  adb shell wm size "$size"
  adb shell wm density "$density"
  for mode in home conversation bot settings video; do
    adb shell am force-stop io.freetalk.mobile
    adb shell am start -W -n io.freetalk.mobile/.DesignPreviewActivity --es mode "$mode"
    sleep 2
    adb exec-out screencap -p > "apps/android-native/build/previews/$name-$mode.png"
  done
done
adb shell wm size reset
adb shell wm density reset
exit "$test_status"
