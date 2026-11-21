package io.freetalk.mobile

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.compose.material3.AlertDialog
import androidx.compose.runtime.*
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

internal fun scannedLoginChallenge(value: String): String? =
    Regex("trlka:qr-login:v1:([A-Za-z0-9_-]{43})").matchEntire(value)?.groupValues?.get(1)

@Composable
internal fun rememberComputerLoginScan(api: FreeTalkApi, preview: Boolean = false): () -> Unit {
    var pending by remember { mutableStateOf<String?>(null) }
    var feedback by remember { mutableStateOf<String?>(null) }
    var approving by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val scanner = rememberLauncherForActivityResult(ScanContract()) { result ->
        result.contents?.let { payload ->
            pending = scannedLoginChallenge(payload)
            if (pending == null) feedback = "Наведите камеру на QR-код на экране компьютера."
        }
    }
    pending?.let { challenge ->
        AlertDialog(onDismissRequest = { if (!approving) pending = null },
            title = { MobileText("QR-код для входа") },
            text = {
                androidx.compose.foundation.layout.Column {
                    MobileText("Сверьте код на своём компьютере и подтвердите вход.")
                    MobileText(challenge.take(5).uppercase(java.util.Locale.ROOT), localize = false)
                }
            },
            confirmButton = { WebTextButton(enabled = !approving, onClick = {
                if (!approving) {
                    approving = true
                    scope.launch {
                        try {
                            api.approveComputerLogin(challenge)
                            feedback = "Вход на компьютере подтверждён."
                        } catch (cancelled: CancellationException) {
                            throw cancelled
                        } catch (error: Exception) {
                            feedback = if (error is ApiException && error.status == 409)
                                "Срок действия QR-кода истёк."
                            else "Не удалось подтвердить вход. Откройте новый QR-код на компьютере."
                        } finally { approving = false; pending = null }
                    }
                }
            }) { MobileText("Подтвердить вход") } },
            dismissButton = { WebTextButton(enabled = !approving, onClick = { pending = null }) { MobileText("Отмена") } })
    }
    feedback?.let { text ->
        AlertDialog(onDismissRequest = { feedback = null }, text = { MobileText(text) },
            confirmButton = { WebTextButton(onClick = { feedback = null }) { MobileText("Готово") } })
    }
    return {
        if (preview) feedback = "Наведите камеру на QR-код на экране компьютера."
        else if (!approving && pending == null) {
            scanner.launch(ScanOptions().setDesiredBarcodeFormats(ScanOptions.QR_CODE)
                .setBeepEnabled(false).setBarcodeImageEnabled(false).setOrientationLocked(false)
                .setPrompt(MobileTranslations.text("Наведите камеру на QR-код на экране компьютера.", MobilePreferences.language)))
        }
    }
}
