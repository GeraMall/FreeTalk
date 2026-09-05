package io.freetalk.mobile

import android.app.*
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder

// Capture starts only after Android permission/consent and this foreground notification.
class CallService : Service() {
    companion object { var afterStart: (() -> Unit)? = null; var onEnd: (() -> Unit)? = null }
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == "end") { onEnd?.invoke(); stopSelf(); return START_NOT_STICKY }
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel("active-call", "Текущий звонок", NotificationManager.IMPORTANCE_LOW))
        val open = PendingIntent.getActivity(this, 80, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val end = PendingIntent.getService(this, 81, Intent(this, CallService::class.java).setAction("end"), PendingIntent.FLAG_IMMUTABLE)
        val notification = Notification.Builder(this, "active-call").setSmallIcon(R.drawable.notification_message)
            .setContentTitle("FreeTalk · текущий звонок").setContentText("Нажмите, чтобы вернуться")
            .setContentIntent(open).setOngoing(true).addAction(Notification.Action.Builder(null, "Завершить", end).build()).build()
        startForeground(80, notification, intent?.getIntExtra("types", ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE) ?: ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
        afterStart?.also { afterStart = null; it() }
        return START_NOT_STICKY
    }
}
