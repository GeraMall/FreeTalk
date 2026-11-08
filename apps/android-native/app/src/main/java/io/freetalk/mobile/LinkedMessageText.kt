package io.freetalk.mobile

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.text.ClickableText
import androidx.compose.material3.LocalTextStyle
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.sp

@Suppress("DEPRECATION")
@Composable
internal fun LinkedMessageText(text: String, onLink: ((String) -> Boolean)? = null) {
    val context = LocalContext.current
    val color = MobileDesign.accent
    val annotated = remember(text, color) { buildAnnotatedString {
        append(text)
        Regex("(?:https?://|freetalk://)[^\\s<>]+", RegexOption.IGNORE_CASE).findAll(text).forEach {
            val url = it.value.trimEnd('.', ',', ';', ')', ']')
            addStringAnnotation("URL", url, it.range.first, it.range.first + url.length)
            addStyle(SpanStyle(color = color, textDecoration = TextDecoration.Underline), it.range.first, it.range.first + url.length)
        }
    } }
    ClickableText(annotated, style = LocalTextStyle.current.copy(color = MobileDesign.text,
        fontSize = (14 * MobilePreferences.textScale).sp, lineHeight = (20 * MobilePreferences.textScale).sp)) { offset ->
        annotated.getStringAnnotations("URL", offset, offset).firstOrNull()?.let { link ->
            if (onLink?.invoke(link.item) != true && Uri.parse(link.item).scheme?.lowercase() in listOf("https", "http"))
                runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(link.item))) }
        }
    }
}
