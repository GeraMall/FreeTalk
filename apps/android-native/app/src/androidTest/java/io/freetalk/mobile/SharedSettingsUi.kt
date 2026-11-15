package io.freetalk.mobile

import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.json.JSONTokener
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Exercise the bundled production React controls and their real Kotlin bridge. */
internal object SharedSettingsUi {
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private fun find(view: View): WebView? {
        if (view is WebView) return view
        if (view is ViewGroup) for (index in 0 until view.childCount) find(view.getChildAt(index))?.let { return it }
        return null
    }
    fun evaluate(script: String): String {
        val done = CountDownLatch(1)
        var result = "null"
        instrumentation.runOnMainSync {
            val resumed = androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry.getInstance()
                .getActivitiesInStage(androidx.test.runner.lifecycle.Stage.RESUMED).firstOrNull()
            val web = resumed?.window?.decorView?.let(::find)
            if (web == null) done.countDown() else web.evaluateJavascript(script) { result = it; done.countDown() }
        }
        check(done.await(5, TimeUnit.SECONDS)) { "WebView did not answer" }
        return JSONTokener(result).nextValue().toString()
    }
    private fun selector(label: String, editable: Boolean = false) = """
        [...document.querySelectorAll('${if (editable) "input,textarea" else "button,label,h1,h2,h3,h4,p,small,strong,span,div"}')]
        .find(e => [e.getAttribute('aria-label'),e.value,e.textContent].some(v => v?.replace(/\s+/g,' ').trim() === ${JSONObject.quote(label)}))
    """.trimIndent()
    fun wait(label: String, editable: Boolean = false) {
        val until = System.currentTimeMillis() + 20_000
        while (System.currentTimeMillis() < until) {
            if (evaluate("Boolean(${selector(label, editable)})") == "true") return
            Thread.sleep(100)
        }
        throw AssertionError("Missing settings control: $label")
    }
    fun back() { instrumentation.uiAutomation.executeShellCommand("input keyevent 4").close(); Thread.sleep(300) }
    fun closeKeyboard() {
        var visible = false
        instrumentation.runOnMainSync {
            val resumed = androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry.getInstance()
                .getActivitiesInStage(androidx.test.runner.lifecycle.Stage.RESUMED).firstOrNull()
            visible = resumed?.window?.decorView?.rootWindowInsets?.isVisible(android.view.WindowInsets.Type.ime()) == true
        }
        if (visible) back() else evaluate("document.activeElement?.blur(); true")
    }
    fun click(label: String) {
        wait(label)
        check(evaluate("(()=>{const e=${selector(label)}; const b=e?.closest('button,label')??e; b?.scrollIntoView({block:'center'}); b?.click(); return !!b})()") == "true")
    }
    fun enter(existing: String, value: String) {
        wait(existing, editable = true)
        check(evaluate("""(()=>{const e=${selector(existing, true)}; e.scrollIntoView({block:'center'}); e.focus();
            Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSONObject.quote(value)});
            e.dispatchEvent(new Event('input',{bubbles:true})); return true})()""") == "true")
    }
}
