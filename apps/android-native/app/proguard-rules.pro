-keepattributes Signature
-dontwarn org.conscrypt.**
-keep class org.webrtc.** { *; }
# WebRTC 144 uses JNI Zero during JNI_OnLoad. These classes are referenced by
# native code, so R8 cannot see their reachability. Removing/renaming JniInit
# aborts the entire process before a Kotlin exception can be handled.
-keep class org.jni_zero.** { *; }
-keepclassmembers class * { @android.webkit.JavascriptInterface <methods>; }
