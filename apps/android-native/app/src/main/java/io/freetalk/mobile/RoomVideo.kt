package io.freetalk.mobile

import android.content.Context
import android.graphics.Color
import android.graphics.SurfaceTexture
import android.view.Gravity
import android.view.TextureView
import android.widget.FrameLayout
import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import org.webrtc.EglBase
import org.webrtc.EglRenderer
import org.webrtc.GlRectDrawer
import org.webrtc.VideoFrame
import org.webrtc.VideoSink
import org.webrtc.VideoTrack

@Composable
internal fun RoomVideo(track: VideoTrack, engine: NativeCallMedia, mirror: Boolean, modifier: Modifier = Modifier,
    fit: Boolean = false, visible: Boolean = true) {
    // The Java wrapper can be replaced without the string ID changing.
    key(track) {
        AndroidView(
            factory = { context ->
                RoomVideoView(context, engine.egl.eglBaseContext, track, fit).apply { configure(mirror, visible) }
            },
            modifier = modifier,
            update = { it.configure(mirror, visible) },
            onRelease = RoomVideoView::close,
        )
    }
}

/** Texture-backed video follows Compose clip, layer order, and tile animations. */
private class RoomVideoView(context: Context, eglContext: EglBase.Context, private val track: VideoTrack,
    private val fit: Boolean) : FrameLayout(context), VideoSink {
    private val renderer = EglRenderer("trlka-room-video")
    @Volatile private var closed = false
    private var renderVisible = true
    @Volatile private var frameWidth = 0
    @Volatile private var frameHeight = 0
    @Volatile private var frameRendered = false
    private val texture = object : TextureView(context) {
        override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
            if (w > 0 && h > 0) renderer.setLayoutAspectRatio(w.toFloat() / h)
        }
    }

    init {
        if (fit) setBackgroundColor(Color.BLACK)
        renderer.init(eglContext, EglBase.CONFIG_PLAIN, GlRectDrawer())
        texture.alpha = 0f
        renderer.addRenderListener {
            if (!frameRendered) {
                frameRendered = true
                post { if (!closed) texture.animate().alpha(1f).setDuration(160L).start() }
            }
        }
        texture.surfaceTextureListener = object : TextureView.SurfaceTextureListener {
            override fun onSurfaceTextureAvailable(surface: SurfaceTexture, width: Int, height: Int) =
                renderer.createEglSurface(surface)
            override fun onSurfaceTextureSizeChanged(surface: SurfaceTexture, width: Int, height: Int) = Unit
            override fun onSurfaceTextureUpdated(surface: SurfaceTexture) = Unit
            override fun onSurfaceTextureDestroyed(surface: SurfaceTexture): Boolean {
                renderer.releaseEglSurface(surface::release)
                return false
            }
        }
        addView(texture, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT, Gravity.CENTER))
        track.addSink(this)
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val width = MeasureSpec.getSize(widthMeasureSpec)
        val height = MeasureSpec.getSize(heightMeasureSpec)
        val aspect = frameWidth.toFloat() / frameHeight
        val params = texture.layoutParams
        if (fit && aspect.isFinite() && aspect > 0f) {
            params.width = minOf(width, (height * aspect).toInt()).coerceAtLeast(1)
            params.height = minOf(height, (width / aspect).toInt()).coerceAtLeast(1)
        }
        super.onMeasure(widthMeasureSpec, heightMeasureSpec)
    }

    override fun onFrame(frame: VideoFrame) {
        if (closed) return
        if (fit && (frameWidth != frame.rotatedWidth || frameHeight != frame.rotatedHeight)) {
            frameWidth = frame.rotatedWidth
            frameHeight = frame.rotatedHeight
            post { if (!closed) requestLayout() }
        }
        renderer.onFrame(frame)
    }

    fun configure(mirror: Boolean, visible: Boolean) {
        renderer.setMirror(mirror)
        if (renderVisible == visible) return
        renderVisible = visible
        if (visible) renderer.disableFpsReduction() else renderer.pauseVideo()
    }

    fun close() {
        if (closed) return
        closed = true
        texture.animate().cancel()
        texture.surfaceTextureListener = null
        runCatching { track.removeSink(this) }
        renderer.release()
    }
}
