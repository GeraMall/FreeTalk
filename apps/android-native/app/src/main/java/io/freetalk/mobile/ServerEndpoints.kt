package io.freetalk.mobile

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

/** Health probes carry no credentials. Only packaged endpoints can receive account requests. */
internal class ServerEndpoints(
    private val bases: List<String>,
    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS).readTimeout(20, TimeUnit.SECONDS)
        .followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false).build(),
    private val now: () -> Long = System::currentTimeMillis,
) {
    init { require(bases.isNotEmpty()) }
    @Volatile var current: String = bases.first(); private set
    private var checkedUntil = 0L
    private val healthClient = client.newBuilder().callTimeout(3, TimeUnit.SECONDS).build()

    @Synchronized fun failed(base: String) {
        if (base !in bases || current != base) return
        checkedUntil = 0
        current = bases.firstOrNull { it != base } ?: base
    }

    @Synchronized fun ready(): String {
        if (checkedUntil > now()) return current
        for (base in listOf(current) + bases.filter { it != current }) {
            val healthy = try {
                healthClient.newCall(Request.Builder().url("$base/health").build()).execute().use {
                    val health = if (it.isSuccessful) JSONObject(it.body?.string().orEmpty()) else null
                    health?.optBoolean("ok") == true && health.optString("service") == "freetalk-api"
                }
            } catch (_: Exception) { false }
            if (healthy) {
                current = base
                checkedUntil = now() + 15_000
                return base
            }
        }
        checkedUntil = 0
        throw IOException("Серверы TRLKA временно недоступны. Повторите попытку.")
    }

    fun execute(path: String, build: (Request.Builder) -> Request): Response {
        require(path.startsWith("/") && !path.startsWith("//"))
        val base = ready()
        val request = build(Request.Builder().url(base + path))
        val safe = request.method in listOf("GET", "HEAD")
        try {
            val response = client.newCall(request).execute()
            if (response.code !in listOf(502, 503, 504)) return response
            failed(base)
            if (!safe) return response
            response.close()
        } catch (error: IOException) {
            failed(base)
            // A mutation may have committed even when its response was lost.
            if (!safe) throw error
        }
        return client.newCall(build(Request.Builder().url(ready() + path))).execute()
    }

    fun socketUrl(path: String): String {
        require(path.startsWith("/"))
        return current.removeSuffix("/api").replaceFirst("https://", "wss://") + path
    }
}

internal val androidServers = ServerEndpoints(listOf(
    "https://freetalk.185-225-201-129.sslip.io/api",
    "https://freetalk.191-44-38-60.sslip.io/api",
))
