package io.freetalk.mobile

import android.annotation.SuppressLint
import android.net.Uri
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebMessage
import android.webkit.WebMessagePort
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView

internal class CaptchaDismissed : Exception()

internal suspend fun <T> withAuthCaptcha(
    requestToken: suspend () -> String?,
    submit: suspend (String?) -> T,
): T {
    try {
        return submit(null)
    } catch (error: ApiException) {
        if (error.code != "CAPTCHA_REQUIRED") throw error
    }
    // Tokens are single-use. A failed retry returns control to the form.
    return submit(requestToken() ?: throw CaptchaDismissed())
}

private const val captchaOrigin = "https://trlka.com"
private const val captchaPage = "$captchaOrigin/native-captcha/"

@SuppressLint("SetJavaScriptEnabled")
@Composable
internal fun NativeCaptchaDialog(onResult: (String?) -> Unit) {
    val finish by rememberUpdatedState(onResult)
    var attempt by remember { mutableIntStateOf(0) }
    var failed by remember(attempt) { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = { finish(null) },
        title = { MobileText("Проверка CAPTCHA") },
        text = {
            if (failed) {
                MobileText("Не удалось загрузить проверку")
            } else key(attempt) {
                var responsePort: WebMessagePort? by remember { mutableStateOf(null) }
                AndroidView(
                    modifier = Modifier.fillMaxWidth().height(150.dp),
                    factory = { context ->
                        WebView(context).apply {
                            setBackgroundColor(android.graphics.Color.TRANSPARENT)
                            settings.javaScriptEnabled = true
                            settings.domStorageEnabled = true
                            settings.allowFileAccess = false
                            settings.allowContentAccess = false
                            settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                            webViewClient = object : WebViewClient() {
                                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                                    if (request.isForMainFrame) return true
                                    val url = request.url
                                    return url.toString() !in setOf("about:blank", "about:srcdoc") &&
                                        !(url.scheme == "https" && url.host == "challenges.cloudflare.com")
                                }

                                override fun onPageFinished(view: WebView, url: String) {
                                    if (url != captchaPage || responsePort != null) return
                                    val (receive, send) = view.createWebMessageChannel()
                                    responsePort = receive
                                    receive.setWebMessageCallback(object : WebMessagePort.WebMessageCallback() {
                                        override fun onMessage(port: WebMessagePort, message: WebMessage) {
                                            if (responsePort !== port) return
                                            port.close()
                                            responsePort = null
                                            val token = message.data
                                            if (token.isNullOrBlank() || token.length > 2048) failed = true
                                            else finish(token)
                                        }
                                    })
                                    // Only the app-owned top document receives this one-shot channel.
                                    view.postWebMessage(WebMessage("challenge", arrayOf(send)), Uri.parse(captchaOrigin))
                                }

                                override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                                    failed = true
                                    return true
                                }
                            }
                            loadDataWithBaseURL(captchaPage, captchaHtml, "text/html", "UTF-8", null)
                        }
                    },
                    onRelease = { view ->
                        responsePort?.close()
                        responsePort = null
                        view.destroy()
                    },
                    update = {},
                )
            }
        },
        confirmButton = { TextButton(onClick = { attempt++ }) { MobileText("Повторить") } },
        dismissButton = { TextButton(onClick = { finish(null) }) { MobileText("Отмена") } },
    )
}

private val captchaHtml = """
    <!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-widget' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src https://challenges.cloudflare.com; style-src 'unsafe-inline'">
    <style>body{margin:0;display:grid;justify-content:center;color-scheme:dark}</style></head>
    <body><div id="widget"></div><script nonce="widget">
    window.addEventListener('message', function start(event) {
      const port = event.ports[0];
      if (!port || event.data !== 'challenge') return;
      window.removeEventListener('message', start);
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.onerror = () => port.postMessage('');
      script.onload = () => turnstile.ready(() => turnstile.render('#widget', {
        sitekey: '${BuildConfig.TURNSTILE_SITE_KEY}', theme: 'dark', size: 'compact',
        callback: token => port.postMessage(token),
        'error-callback': () => { port.postMessage(''); return true; }
      }));
      document.head.appendChild(script);
    });
    </script></body></html>
""".trimIndent()
