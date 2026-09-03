# FreeTalk Android

Native Android client built with Kotlin and Jetpack Compose. It reuses the existing FreeTalk
account API, signaling protocol and production infrastructure; it does not embed the desktop
frontend or a WebView.

Current native foundation:

- Compose mobile shell and bottom navigation;
- production HTTPS login;
- Android Keystore-backed refresh-token storage;
- production WSS room creation;
- bounded 384 MB on-device media cache with size reporting and manual clearing;
- Android deep-link declarations and runtime permission declarations.

The native WebRTC media engine, complete chats/friends/history screens, registration and
background call service are the next implementation layer before this client is release-ready.

Build from the repository root using the shared Gradle wrapper:

```powershell
apps\desktop\src-tauri\gen\android\gradlew.bat -p apps\android-native :app:assembleDebug
```
