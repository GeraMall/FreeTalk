# FreeTalk Android

Native Android client built with Kotlin and Jetpack Compose. It reuses the existing FreeTalk
account API, signaling protocol and production infrastructure; it does not embed the desktop
frontend or a WebView.

Current native foundation:

- Compose mobile shell and bottom navigation;
- production HTTPS login, registration and email confirmation;
- Android Keystore-backed refresh-token storage and automatic session restore;
- real chats, text messages, friends, call history and account-device data;
- shared FreeTalk mobile design system with the production logo, mascot, gradients,
  navigation, room hero, recent-room cards and cached remote avatars;
- production WSS room creation;
- native room navigation after create/join and an initial mobile room controls screen;
- bounded 384 MB on-device media cache with size reporting and manual clearing;
- Android deep-link declarations and runtime permission declarations.

The native WebRTC media engine, chat realtime transport, image messages, profile editing and
background call service are the next implementation layer before this client is release-ready.

Build from the repository root using the shared Gradle wrapper:

```powershell
apps\desktop\src-tauri\gen\android\gradlew.bat -p apps\android-native :app:assembleDebug
```
