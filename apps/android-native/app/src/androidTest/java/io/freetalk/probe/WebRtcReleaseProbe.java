package io.freetalk.probe;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Bundle;
import org.webrtc.PeerConnectionFactory;
import org.webrtc.PeerConnection;
import org.webrtc.MediaConstraints;
import org.webrtc.AudioSource;
import org.webrtc.AudioTrack;
import org.webrtc.IceCandidate;
import org.webrtc.MediaStream;
import org.webrtc.DataChannel;
import org.webrtc.RtpReceiver;
import org.webrtc.SdpObserver;
import org.webrtc.SessionDescription;
import org.webrtc.audio.JavaAudioDeviceModule;
import java.util.Collections;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

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
                try {
                    PeerConnectionFactory factory = PeerConnectionFactory.builder().setAudioDeviceModule(module).createPeerConnectionFactory();
                    AudioSource source = factory.createAudioSource(new MediaConstraints());
                    AudioTrack track = factory.createAudioTrack("probe-microphone", source);
                    PeerConnection.RTCConfiguration config = new PeerConnection.RTCConfiguration(Collections.emptyList());
                    config.sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN;
                    PeerConnection peer = factory.createPeerConnection(config, new PeerConnection.Observer() {
                        public void onSignalingChange(PeerConnection.SignalingState state) {}
                        public void onIceConnectionChange(PeerConnection.IceConnectionState state) {}
                        public void onIceConnectionReceivingChange(boolean receiving) {}
                        public void onIceGatheringChange(PeerConnection.IceGatheringState state) {}
                        public void onIceCandidate(IceCandidate candidate) {}
                        public void onIceCandidatesRemoved(IceCandidate[] candidates) {}
                        public void onAddStream(MediaStream stream) {}
                        public void onRemoveStream(MediaStream stream) {}
                        public void onDataChannel(DataChannel channel) {}
                        public void onRenegotiationNeeded() {}
                        public void onAddTrack(RtpReceiver receiver, MediaStream[] streams) {}
                    });
                    if (peer == null) throw new AssertionError("Missing native peer connection");
                    try {
                        peer.addTrack(track, Collections.singletonList("audio"));
                        track.setEnabled(false); track.setEnabled(true);
                        CountDownLatch offered = new CountDownLatch(1);
                        AtomicReference<String> failure = new AtomicReference<>();
                        peer.createOffer(new SdpObserver() {
                            public void onCreateSuccess(SessionDescription description) { if (!description.description.contains("m=audio")) failure.set("No audio SDP"); offered.countDown(); }
                            public void onCreateFailure(String error) { failure.set(error); offered.countDown(); }
                            public void onSetSuccess() {}
                            public void onSetFailure(String error) {}
                        }, new MediaConstraints());
                        try { if (!offered.await(10, TimeUnit.SECONDS)) throw new AssertionError("Native SDP timeout"); }
                        catch (InterruptedException error) { Thread.currentThread().interrupt(); throw new AssertionError(error); }
                        if (failure.get() != null) throw new AssertionError(failure.get());
                    } finally { peer.dispose(); track.dispose(); source.dispose(); factory.dispose(); }
                }
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
