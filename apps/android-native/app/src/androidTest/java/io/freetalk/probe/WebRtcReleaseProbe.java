package io.freetalk.probe;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Bundle;
import org.webrtc.PeerConnectionFactory;
import org.webrtc.audio.JavaAudioDeviceModule;

/** Runs against either the original or corrected same-key release APK. */
public final class WebRtcReleaseProbe extends Instrumentation {
    @Override public void onCreate(Bundle arguments) { super.onCreate(arguments); start(); }

    @Override public void onStart() {
        Bundle result = new Bundle();
        Context context = getTargetContext();
        Intent service = new Intent().setClassName(context.getPackageName(), "io.freetalk.mobile.CallService")
            .putExtra("types", ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
        try {
            Intent main = new Intent(Intent.ACTION_MAIN).setClassName(context.getPackageName(), "io.freetalk.mobile.MainActivity")
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            Activity activity = startActivitySync(main);
            runOnMainSync(() -> activity.startForegroundService(service));
            waitForIdleSync();
            runOnMainSync(() -> {
                PeerConnectionFactory.initialize(PeerConnectionFactory.InitializationOptions.builder(context).createInitializationOptions());
                JavaAudioDeviceModule module = JavaAudioDeviceModule.builder(context).createAudioDeviceModule();
                try { PeerConnectionFactory.builder().setAudioDeviceModule(module).createPeerConnectionFactory().dispose(); }
                finally { module.release(); }
            });
            result.putString("nativeCallStartup", "passed");
            finish(Activity.RESULT_OK, result);
        } catch (Throwable error) {
            result.putString("nativeCallStartup", "failed: " + error.getClass().getName() + ": " + error.getMessage());
            finish(Activity.RESULT_CANCELED, result);
        } finally { context.stopService(service); }
    }
}
