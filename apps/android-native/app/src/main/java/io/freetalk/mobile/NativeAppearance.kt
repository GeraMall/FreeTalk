package io.freetalk.mobile

import android.content.Context
import androidx.activity.enableEdgeToEdge
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.graphics.Color
import kotlinx.coroutines.CancellationException

@Composable internal fun MobileSystemBars(dark: Boolean) {
    val context = androidx.compose.ui.platform.LocalContext.current
    DisposableEffect(context, dark) {
        val activity = generateSequence(context) { (it as? android.content.ContextWrapper)?.baseContext }
            .filterIsInstance<androidx.activity.ComponentActivity>().firstOrNull()
        val transparent = android.graphics.Color.TRANSPARENT
        val style = if (dark) androidx.activity.SystemBarStyle.dark(transparent) else androidx.activity.SystemBarStyle.light(transparent, transparent)
        activity?.enableMobileEdgeToEdge(style)
        onDispose {}
    }
}
private fun androidx.activity.ComponentActivity.enableMobileEdgeToEdge(style: androidx.activity.SystemBarStyle) {
    enableEdgeToEdge(statusBarStyle = style, navigationBarStyle = style)
}

@Composable internal fun mobileColorScheme(): ColorScheme = if (MobilePreferences.theme == "light") lightColorScheme(
    primary = MobileDesign.accent, background = MobileDesign.background,
    surface = MobileDesign.incoming, surfaceVariant = MobileDesign.outgoing,
    outline = MobileDesign.stroke, secondary = MobileDesign.accent, onSurfaceVariant = MobileDesign.muted,
    onPrimary = Color.White, onBackground = MobileDesign.text, onSurface = MobileDesign.text,
) else darkColorScheme(
    primary = MobileDesign.accent, background = MobileDesign.background,
    surface = MobileDesign.incoming, surfaceVariant = MobileDesign.outgoing,
    outline = MobileDesign.stroke, secondary = MobileDesign.accent, onSurfaceVariant = MobileDesign.muted,
    onPrimary = Color(0xFF02101A), onBackground = MobileDesign.text, onSurface = MobileDesign.text,
)

internal class NativeAppearance(private val context: Context) {
    var syncEnabled by mutableStateOf(false); private set
    var available by mutableStateOf(false); private set
    var busy by mutableStateOf(false); private set
    var error by mutableStateOf(false); private set
    private var disposed = false
    private var edits = 0
    private var dirty = false
    fun close() { disposed = true }
    suspend fun refresh(api: FreeTalkApi) {
        if (busy || disposed || dirty) return
        val before = edits
        try {
            val remote = api.appearance()
            if (disposed || busy || edits != before) return
            val theme = remote.optString("theme")
            if (theme !in listOf("default", "light", "black") || !remote.has("syncEnabled")) return
            syncEnabled = remote.getBoolean("syncEnabled")
            available = true; error = false
            if (syncEnabled) { MobilePreferences.theme = theme; MobilePreferences.save(context) }
        } catch (e: CancellationException) { throw e }
        catch (_: Exception) { if (!disposed) error = true }
    }
    suspend fun choose(api: FreeTalkApi, theme: String) {
        if (busy || disposed || theme !in listOf("default", "light", "black")) return
        edits++
        MobilePreferences.theme = theme; MobilePreferences.save(context)
        if (syncEnabled) { dirty = true; write(api, true) }
    }
    suspend fun toggle(api: FreeTalkApi, enabled: Boolean) {
        if (busy || disposed || !available) return
        edits++
        write(api, enabled)
    }
    private suspend fun write(api: FreeTalkApi, enabled: Boolean) {
        busy = true; error = false
        try {
            api.saveAppearance(MobilePreferences.theme, enabled)
            if (!disposed) { syncEnabled = enabled; dirty = false }
        } catch (e: CancellationException) { throw e }
        catch (_: Exception) { if (!disposed) error = true }
        finally { if (!disposed) busy = false }
    }
}
