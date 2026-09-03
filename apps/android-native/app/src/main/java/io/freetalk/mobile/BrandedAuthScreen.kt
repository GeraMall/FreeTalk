package io.freetalk.mobile

import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private val authCyan = Color(0xFF4EF3F2)
private val authMuted = Color(0xFF7F91A8)
private val authBorder = Color(0xFF183345)
private val authGradient = Brush.linearGradient(listOf(authCyan, Color(0xFF59BEF9), Color(0xFF3D7BFF)))

@Composable
internal fun BrandedStartupScreen() {
    val transition = rememberInfiniteTransition(label = "FreeTalk startup")
    val pulse by transition.animateFloat(
        initialValue = 0.38f, targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(850, easing = FastOutSlowInEasing), RepeatMode.Reverse),
        label = "Mascot pulse",
    )
    Box(
        Modifier.fillMaxSize().background(Color(0xFF030A15)).safeDrawingPadding()
            .semantics { contentDescription = "FreeTalk загружается" },
        contentAlignment = Alignment.Center,
    ) {
        Box(Modifier.size(180.dp).graphicsLayer(alpha = pulse).background(
            Brush.radialGradient(listOf(Color(0x224EF3F2), Color.Transparent)),
        ))
        Image(
            painterResource(R.drawable.freetalk_mascot), null,
            Modifier.size(108.dp).graphicsLayer {
                alpha = pulse
                scaleX = 0.96f + pulse * 0.04f
                scaleY = scaleX
            },
        )
    }
}

@Composable
internal fun BrandedAuthScreen(
    page: AuthPage,
    status: String,
    verificationEmail: String,
    onPage: (AuthPage) -> Unit,
    onLogin: (String, String) -> Unit,
    onRegister: (String, String, String, String) -> Unit,
    onVerify: (String, String) -> Unit,
    onResend: (String) -> Unit,
) {
    var login by rememberSaveable { mutableStateOf("") }
    var email by rememberSaveable(verificationEmail) { mutableStateOf(verificationEmail) }
    var username by rememberSaveable { mutableStateOf("") }
    var name by rememberSaveable { mutableStateOf("") }
    // Passwords deliberately remain in memory, outside saved instance state.
    var password by remember { mutableStateOf("") }
    var repeatedPassword by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var terms by rememberSaveable { mutableStateOf(false) }
    var privacy by rememberSaveable { mutableStateOf(false) }
    var legal by remember { mutableStateOf<String?>(null) }
    val busy = status in listOf("Входим…", "Создаём аккаунт…", "Проверяем код…")
    val scroll = rememberScrollState()
    LaunchedEffect(page) { scroll.scrollTo(0) }

    Column(
        Modifier.fillMaxSize().background(
            Brush.verticalGradient(listOf(Color(0xFF071D29), Color(0xFF030A15))),
        ).safeDrawingPadding().imePadding(),
    ) {
        Row(Modifier.fillMaxWidth().background(Color(0xFF030B14)).padding(14.dp),
            verticalAlignment = Alignment.CenterVertically) {
            AuthBrand(34, 22)
        }
        HorizontalDivider(color = authBorder)
        Column(
            Modifier.weight(1f).verticalScroll(scroll).padding(horizontal = 12.dp, vertical = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Surface(
                modifier = Modifier.widthIn(max = 500.dp).fillMaxWidth(),
                shape = RoundedCornerShape(22.dp), color = Color(0xF2051421),
                border = BorderStroke(1.dp, authBorder),
            ) {
                Column(Modifier.padding(18.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Spacer(Modifier.height(12.dp))
                    AuthBrand(70, 38)
                    Text(
                        "СТАБИЛЬНАЯ СВЯЗЬ И РАБОТА БЕЗ VPN!",
                        color = authCyan, fontSize = 10.sp, letterSpacing = 1.5.sp,
                        fontWeight = FontWeight.Bold, modifier = Modifier.padding(vertical = 22.dp),
                    )
                    Row(
                        Modifier.fillMaxWidth().background(Color(0xFF030A15), RoundedCornerShape(14.dp))
                            .border(1.dp, authBorder, RoundedCornerShape(14.dp)).padding(4.dp),
                    ) {
                        listOf(AuthPage.Login to "Войти", AuthPage.Register to "Регистрация").forEach { (tab, title) ->
                            val selected = page == tab
                            TextButton(
                                onClick = { onPage(tab) }, enabled = !busy,
                                modifier = Modifier.weight(1f).heightIn(min = 44.dp)
                                    .background(if (selected) Color(0xFF09232E) else Color.Transparent, RoundedCornerShape(11.dp))
                                    .border(1.dp, if (selected) Color(0xFF32606C) else Color.Transparent, RoundedCornerShape(11.dp)),
                            ) { Text(title, color = if (selected) Color(0xFFF6F7FA) else authMuted, fontSize = 16.sp) }
                        }
                    }
                    Spacer(Modifier.height(20.dp))
                    when (page) {
                        AuthPage.Login -> {
                            BrandedField(login, { login = it }, "Почта или @username")
                            BrandedField(password, { password = it }, "Пароль", password = true)
                            AuthAction(if (busy) "Входим…" else "Войти", !busy && login.isNotBlank() && password.isNotBlank()) {
                                onLogin(login.trim(), password)
                            }
                        }
                        AuthPage.Register -> {
                            Surface(
                                shape = RoundedCornerShape(18.dp), color = Color(0x88030E19),
                                border = BorderStroke(1.dp, authBorder), modifier = Modifier.fillMaxWidth(),
                            ) {
                                Column(Modifier.padding(16.dp)) {
                                    Text("Создайте аккаунт", fontSize = 22.sp, fontWeight = FontWeight.Bold)
                                    Text("Один профиль для друзей, звонков и истории общения.",
                                        color = authMuted, fontSize = 14.sp, modifier = Modifier.padding(top = 6.dp, bottom = 18.dp))
                                    BrandedField(email, { email = it }, "Почта", "name@example.com", KeyboardType.Email)
                                    BrandedField(username, { username = it }, "Уникальный @username", "username")
                                    BrandedField(name, { name = it }, "Отображаемое имя", "Как вас увидят другие")
                                    BrandedField(password, { password = it }, "Пароль", password = true)
                                    BrandedField(repeatedPassword, { repeatedPassword = it }, "Повторите пароль", password = true)
                                    if (repeatedPassword.isNotEmpty() && repeatedPassword != password) {
                                        Text("Пароли не совпадают", color = Color(0xFFFF8096), fontSize = 12.sp)
                                    }
                                    LegalAcceptance(terms, { terms = it }, "Пользовательское соглашение") { legal = "terms" }
                                    LegalAcceptance(privacy, { privacy = it }, "Политику конфиденциальности") { legal = "privacy" }
                                    Spacer(Modifier.height(14.dp))
                                    AuthAction(
                                        if (busy) "Создаём аккаунт…" else "Создать аккаунт",
                                        !busy && terms && privacy && email.isNotBlank() && username.trim().length >= 3 &&
                                            name.isNotBlank() && password.length >= 8 && password == repeatedPassword,
                                    ) { onRegister(email, username, name, password) }
                                    Text("После регистрации подтвердите почту кодом из письма",
                                        color = authMuted, fontSize = 12.sp, modifier = Modifier.padding(top = 12.dp))
                                }
                            }
                        }
                        AuthPage.Verify -> {
                            Text("Подтвердите почту", fontSize = 23.sp, fontWeight = FontWeight.Bold)
                            Text("Введите шестизначный код из письма", color = authMuted,
                                modifier = Modifier.padding(top = 8.dp, bottom = 18.dp))
                            BrandedField(email, { email = it }, "Почта", keyboardType = KeyboardType.Email)
                            BrandedField(code, { code = it.filter(Char::isDigit).take(6) }, "Код", keyboardType = KeyboardType.Number)
                            AuthAction("Подтвердить", !busy && email.isNotBlank() && code.length == 6) { onVerify(email, code) }
                            TextButton(onClick = { onResend(email) }, enabled = !busy && email.isNotBlank()) { Text("Отправить ещё раз") }
                        }
                    }
                    if (status.isNotBlank()) Text(status,
                        color = if (status.contains("отправ", true) || busy) authCyan else Color(0xFFFF8096),
                        modifier = Modifier.fillMaxWidth().padding(top = 14.dp), fontSize = 13.sp)
                    Spacer(Modifier.height(12.dp))
                }
            }
        }
    }
    legal?.let { key ->
        AlertDialog(
            onDismissRequest = { legal = null },
            title = { Text(if (key == "terms") "Пользовательское соглашение FreeTalk" else "Политика конфиденциальности FreeTalk") },
            text = { Column(Modifier.verticalScroll(rememberScrollState())) { Text(if (key == "terms") termsText else privacyText) } },
            confirmButton = { TextButton(onClick = { legal = null }) { Text("Закрыть") } },
        )
    }
}

@Composable
private fun AuthBrand(iconSize: Int, textSize: Int) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Image(painterResource(R.drawable.freetalk_mascot), null, Modifier.size(iconSize.dp))
        Text("FreeTalk", fontSize = textSize.sp, fontWeight = FontWeight.Bold, letterSpacing = (-1).sp,
            modifier = Modifier.padding(start = 10.dp))
    }
}

@Composable
private fun BrandedField(
    value: String, onChange: (String) -> Unit, label: String, placeholder: String = "",
    keyboardType: KeyboardType = KeyboardType.Text, password: Boolean = false,
) {
    Column(Modifier.fillMaxWidth().padding(bottom = 16.dp)) {
        Text(label, color = Color(0xFFC3CEDC), fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
        OutlinedTextField(
            value, onChange, singleLine = true, placeholder = { Text(placeholder, fontSize = 14.sp) },
            modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
            shape = RoundedCornerShape(12.dp),
            keyboardOptions = KeyboardOptions(keyboardType = if (password) KeyboardType.Password else keyboardType),
            visualTransformation = if (password) PasswordVisualTransformation() else VisualTransformation.None,
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = authCyan, unfocusedBorderColor = authBorder,
                focusedContainerColor = Color(0xFF030A15), unfocusedContainerColor = Color(0xFF030A15),
                cursorColor = authCyan, unfocusedPlaceholderColor = Color(0xFF61758D),
            ),
        )
    }
}

@Composable
private fun AuthAction(label: String, enabled: Boolean, onClick: () -> Unit) {
    Button(
        onClick, enabled = enabled, shape = RoundedCornerShape(12.dp),
        modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)
            .background(if (enabled) authGradient else Brush.linearGradient(listOf(Color(0xFF426D77), Color(0xFF405C74))), RoundedCornerShape(12.dp)),
        colors = ButtonDefaults.buttonColors(containerColor = Color.Transparent,
            disabledContainerColor = Color.Transparent, contentColor = Color(0xFF031018),
            disabledContentColor = Color(0xFF19323D)),
    ) { Text(label, fontSize = 17.sp, fontWeight = FontWeight.Bold) }
}

@Composable
private fun LegalAcceptance(checked: Boolean, onChecked: (Boolean) -> Unit, title: String, onOpen: () -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Checkbox(checked, onChecked)
        Column(Modifier.weight(1f)) {
            Text("Я принимаю", color = authMuted, fontSize = 13.sp)
            TextButton(onClick = onOpen, contentPadding = PaddingValues(0.dp)) {
                Text(title, color = Color(0xFFC3CEDC), fontSize = 13.sp)
            }
        }
    }
}

// Same beta documents shown by the desktop WelcomeScreen, not new legal terms.
private const val termsText = "Проект находится на стадии закрытого beta-тестирования. Перед публичным production-релизом документ должен быть проверен владельцем продукта и юристом применимой юрисдикции.\n\nFreeTalk предоставляет средства голосовой и видеосвязи, демонстрации экрана и временного обмена сообщениями. Пользователь обязан соблюдать применимое законодательство, не злоупотреблять сервисом и не пытаться обходить ограничения безопасности.\n\nСервис предоставляется без гарантии абсолютной доступности. Содержимое разговоров не записывается сервером FreeTalk."
private const val privacyText = "Проект находится на стадии закрытого beta-тестирования. Документ не является обещанием защиты от любых юридических рисков.\n\nДля работы аккаунта обрабатываются email, username, отображаемое имя, аватар, данные сессий и безопасности, друзья, членство в чатах и история факта звонков. Текст сообщений удаляется после установленного срока.\n\nАудио, видео и содержимое экрана не передаются account API и не используются для аналитики. Пароли хранятся только как Argon2id-хеш, а токены сессий — только в виде серверного SHA-256-хеша с секретным pepper."
