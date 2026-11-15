# FreeTalk Android

Native Android client built with Kotlin and Jetpack Compose. It reuses the existing FreeTalk
account API, signaling protocol and production infrastructure. Navigation, chat and
calls use native Android views. Shared tablet games run in an isolated WebView
with bundled assets and the same game protocol as the desktop client.

Beta.228 adds paginated cached chat history, read receipts, reactions, GIFs and
stickers, group creation, password recovery/CAPTCHA, QR approval of computer
sign-in, notification/deep-link routing, shared tablet games, appearance themes
and opt-in account theme sync. Native WebRTC calls run in a foreground service.
Screen sharing offers content, resolution and frame-rate controls. Device calls,
Bluetooth and background/network transitions require physical-device testing.

Current native foundation:

- Compose mobile shell and bottom navigation;
- adaptive launcher icon using the FreeTalk mascot and bundled Geist typography
  across all Compose text roles (Latin/Cyrillic, weights 100–900, offline);
- production HTTPS login, registration and email confirmation;
- Android Keystore-backed refresh-token storage and automatic session restore;
- real chats, text messages, friends, call history and account-device data;
- styled native conversation bubbles with avatars, timestamps, selectable text and
  account-wide authenticated WebSocket delivery (no five-second polling),
  reconnect backoff and snapshot recovery after reconnection;
- authenticated image thumbnails and full-size viewing on tap, with account-isolated
  disk caching, expiry checks, two concurrent downloads and LRU eviction;
- shared FreeTalk mobile design system with the production logo, mascot, gradients,
  navigation, room hero, recent-room cards and cached remote avatars;
- production WSS room creation;
- native room navigation after create/join and an initial mobile room controls screen;
- bounded 384 MB on-device media cache with size reporting and manual clearing;
- Android deep-link declarations and runtime permission declarations.

Native WebRTC, attachment uploading, profile editing and the foreground call
service are implemented. This remains a private preview pending device validation.

Alpha.9 integrates Firebase Messaging for project trlka-b5d34, alongside foreground
WebSocket notifications. Android 13+ requests notification permission.
Production server push was enabled on 2026-09-04 and passed an FCM dry-run.
Real-phone delivery remains to be verified; see FIREBASE_SETUP.md for limitations
and the device test checklist.
Never put server credentials into the APK or repository.
Downloaded chat photos use the 384 MB cache, clearable under History → Storage.
Alpha.9 is a debug build; on-device visual and network testing is still required.

The bundled Geist variable TTF comes from `google/fonts/ofl/geist/Geist[wght].ttf`.
Its SIL Open Font License is included in `app/src/main/assets/licenses`.

Build from the repository root using the shared Gradle wrapper:

```powershell
apps\desktop\src-tauri\gen\android\gradlew.bat -p apps\android-native :app:assembleDebug
```
