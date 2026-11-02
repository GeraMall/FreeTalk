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
    Column(Modifier.fillMaxSize().background(MobileDesign.background).safeDrawingPadding().imePadding().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        TextButton(onClick = onBack) { Text("Назад ко входу") }
        Text("Восстановление пароля", fontSize = 26.sp, fontWeight = FontWeight.Bold)
        OutlinedTextField(email, { email = it }, label = { Text("Почта") }, singleLine = true, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp))
        Button(onClick = { busy = true; scope.launch {
            try { api.forgotPassword(email); sent = true; message = "Если аккаунт существует, код отправлен на почту." }
            catch (e: CancellationException) { throw e } catch (e: Exception) { message = e.message.orEmpty() } finally { busy = false }
        } }, enabled = !busy && email.contains('@')) { Text("Отправить код") }
        TextButton(onClick = { sent = true }) { Text("У меня уже есть код") }
        if (sent) {
            OutlinedTextField(token, { token = it.take(6) }, label = { Text("Код из письма") }, singleLine = true, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp))
            OutlinedTextField(password, { password = it }, label = { Text("Новый пароль") }, visualTransformation = PasswordVisualTransformation(), singleLine = true, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp))
            Button(onClick = { busy = true; scope.launch {
                try { api.resetPassword(email, token, password); password = ""; message = "Пароль обновлён. Можно вернуться ко входу." }
                catch (e: CancellationException) { throw e } catch (e: Exception) { message = e.message.orEmpty() } finally { busy = false }
            } }, enabled = !busy && password.length >= 8 && token.length == 6) { Text("Сохранить пароль") }
        }
        if (message.isNotBlank()) Text(message, color = MobileDesign.muted, fontSize = 13.sp)
    }
}
