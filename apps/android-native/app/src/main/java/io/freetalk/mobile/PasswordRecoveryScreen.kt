package io.freetalk.mobile

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

@Composable
internal fun PasswordRecoveryScreen(api: FreeTalkApi, onBack: () -> Unit) {
    var email by remember { mutableStateOf("") }; var token by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }; var message by remember { mutableStateOf("") }
    var sent by remember { mutableStateOf(false) }; var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    BackHandler(onBack = onBack)
    Column(Modifier.fillMaxSize().background(androidx.compose.ui.graphics.Color(0xFF060C14)).safeDrawingPadding().imePadding().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        TextButton(onClick = onBack) { MobileText("Назад ко входу") }
        MobileText("Восстановление пароля", fontSize = 26.sp, fontWeight = FontWeight.Bold)
        OutlinedTextField(email, { email = it }, label = { MobileText("Почта") }, singleLine = true, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp))
        Button(onClick = { busy = true; scope.launch {
            try { api.forgotPassword(email); sent = true; message = "Если аккаунт существует, код отправлен на почту." }
            catch (e: CancellationException) { throw e } catch (e: Exception) { message = e.message.orEmpty() } finally { busy = false }
        } }, enabled = !busy && AuthValidation.email(email)) { MobileText(if (sent) "Отправить новый код" else "Отправить код") }
        TextButton(onClick = { sent = true }, enabled = !busy && AuthValidation.email(email)) { MobileText("У меня уже есть код") }
        if (sent) {
            MobileText("Код действует 20 минут. Новый код заменяет предыдущий.", fontSize = 13.sp, color = androidx.compose.ui.graphics.Color(0xFF9AABC1))
            OutlinedTextField(token, { token = it.filter { c -> c in '0'..'9' }.take(6) }, label = { MobileText("Код из письма") }, singleLine = true, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp))
            OutlinedTextField(password, { password = it }, label = { MobileText("Новый пароль") }, visualTransformation = PasswordVisualTransformation(), singleLine = true, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp))
            Button(onClick = { busy = true; scope.launch {
                try { api.resetPassword(email, token, password); password = ""; message = "Пароль обновлён. Можно вернуться ко входу." }
                catch (e: CancellationException) { throw e } catch (e: Exception) {
                    message = if (e is ApiException && e.code == "INVALID_TOKEN")
                        "Код неверный, истёк или исчерпаны попытки. Запросите новый код." else e.message.orEmpty()
                } finally { busy = false }
            } }, enabled = !busy && AuthValidation.email(email) && AuthValidation.password(password) && token.length == 6) { MobileText("Сохранить пароль") }
            MobileText("От 10 символов, хотя бы одна буква и цифра.", fontSize = 13.sp, color = androidx.compose.ui.graphics.Color(0xFF9AABC1))
        }
        if (message.isNotBlank()) MobileText(message, color = androidx.compose.ui.graphics.Color(0xFF9AABC1), fontSize = 13.sp)
    }
}
