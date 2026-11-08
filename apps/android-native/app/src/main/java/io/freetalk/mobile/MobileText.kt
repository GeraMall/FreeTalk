package io.freetalk.mobile

import android.content.Context
import androidx.compose.material3.LocalTextStyle
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.TextUnit
import org.json.JSONObject

internal object MobileTranslations {
    @Volatile private var catalog: JSONObject? = null
    @Synchronized fun load(context: Context) {
        if (catalog == null) catalog = runCatching {
            JSONObject(context.assets.open("native-translations.json").bufferedReader().use { it.readText() })
        }.getOrNull()
    }
    fun text(source: String, language: String): String {
        if (language == "ru") return source
        return catalog?.optJSONObject(source)?.optString(language)?.takeIf { it.isNotEmpty() } ?: source
    }
}

@Composable
internal fun MobileText(
    text: String, modifier: Modifier = Modifier, color: Color = Color.Unspecified,
    fontSize: TextUnit = TextUnit.Unspecified, fontWeight: FontWeight? = null,
    letterSpacing: TextUnit = TextUnit.Unspecified, lineHeight: TextUnit = TextUnit.Unspecified,
    textAlign: TextAlign? = null, overflow: TextOverflow = TextOverflow.Clip,
    maxLines: Int = Int.MAX_VALUE, style: TextStyle = LocalTextStyle.current, localize: Boolean = true,
) {
    val context = LocalContext.current
    remember { MobileTranslations.load(context.applicationContext); true }
    androidx.compose.material3.Text(if (localize) MobileTranslations.text(text, MobilePreferences.language) else text, modifier = modifier,
        color = color, fontSize = fontSize, fontWeight = fontWeight, letterSpacing = letterSpacing,
        lineHeight = lineHeight, textAlign = textAlign, overflow = overflow, maxLines = maxLines, style = style)
}
