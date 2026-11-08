package io.freetalk.mobile

import java.net.URI
import java.net.URLDecoder

internal fun roomCodeFromLink(value: String): String? = runCatching {
    val raw = value.trim()
    val pattern = Regex("^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{12}$")
    if (pattern.matches(raw.uppercase())) return raw.uppercase()
    val url = URI(raw)
    if (url.userInfo != null) return null
    val allowed = (url.scheme == "https" && url.host in listOf("trlka.com", "www.trlka.com") && url.port in listOf(-1, 443)) ||
        (url.scheme == "freetalk" && url.host in listOf("room", "join"))
    if (!allowed) return null
    val query = url.rawQuery.orEmpty().split('&').map { it.split('=', limit = 2) }
        .firstOrNull { it.firstOrNull() == "room" }?.getOrNull(1)?.let { URLDecoder.decode(it, "UTF-8") }
    val code = (query ?: url.path.orEmpty().trimEnd('/').substringAfterLast('/')).uppercase()
    code.takeIf { pattern.matches(it) }
}.getOrNull()
