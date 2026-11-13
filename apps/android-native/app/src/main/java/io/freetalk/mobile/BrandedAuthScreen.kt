package io.freetalk.mobile

import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.platform.LocalContext
import org.json.JSONObject
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

private val authCyan = Color(0xFF8DA6DC)
private val authMuted = Color(0xFF9AABC1)
private val authBorder = Color(0xFF29384E)
private val authGradient = Brush.linearGradient(listOf(authCyan, Color(0xFF8DA6DC), Color(0xFF4B7FFF)))

@Composable
internal fun BrandedStartupScreen() {
    val transition = rememberInfiniteTransition(label = "Trlka startup")
    val pulse by transition.animateFloat(
        initialValue = 0.38f, targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(850, easing = FastOutSlowInEasing), RepeatMode.Reverse),
        label = "Mascot pulse",
    )
    Box(
        Modifier.fillMaxSize().background(Color(0xFF030A15)).safeDrawingPadding()
            .semantics { contentDescription = "Trlka загружается" },
        contentAlignment = Alignment.Center,
    ) {
        Box(Modifier.size(180.dp).graphicsLayer(alpha = pulse).background(
            Brush.radialGradient(listOf(Color(0x228DA6DC), Color.Transparent)),
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
    onRegister: (String, String, String, String, String, String) -> Unit,
    onVerify: (String, String) -> Unit,
    onResend: (String) -> Unit,
    onRecovery: () -> Unit = {},
) {
    val context = LocalContext.current
    val documents = remember(context) {
        context.assets.open("registration-legal.json").bufferedReader().use { JSONObject(it.readText()) }
    }
    var login by rememberSaveable { mutableStateOf("") }
    var email by rememberSaveable(verificationEmail) { mutableStateOf(verificationEmail) }
    var username by rememberSaveable { mutableStateOf("") }
    var name by rememberSaveable { mutableStateOf("") }
    var birthDay by rememberSaveable { mutableStateOf("") }
    var birthMonth by rememberSaveable { mutableStateOf("") }
    var birthYear by rememberSaveable { mutableStateOf("") }
    val birthDate = AuthValidation.birthDate(birthDay, birthMonth, birthYear)
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
            Brush.verticalGradient(listOf(Color(0xFF060C14), Color(0xFF060C14))),
        ).safeDrawingPadding().imePadding(),
    ) {
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
                    MobileText(
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
                            ) { MobileText(title, color = if (selected) Color(0xFFF6F7FA) else authMuted, fontSize = 16.sp) }
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
                            TextButton(onClick = onRecovery, enabled = !busy) { MobileText("Забыли пароль?") }
                        }
                        AuthPage.Register -> {
                            Surface(
                                shape = RoundedCornerShape(18.dp), color = Color(0x88030E19),
                                border = BorderStroke(1.dp, authBorder), modifier = Modifier.fillMaxWidth(),
                            ) {
                                Column(Modifier.padding(16.dp)) {
                                    MobileText("Создайте аккаунт", fontSize = 22.sp, fontWeight = FontWeight.Bold)
                                    MobileText("Один профиль для друзей, звонков и истории общения.",
                                        color = authMuted, fontSize = 14.sp, modifier = Modifier.padding(top = 6.dp, bottom = 18.dp))
                                    BrandedField(email, { email = it }, "Почта", "name@example.com", KeyboardType.Email)
                                    BrandedField(username, { username = it }, "Уникальный @username", "username")
                                    BrandedField(name, { name = it }, "Отображаемое имя", "Как вас увидят другие")
                                    MobileText("Необязательно. Если оставить пустым, используется @username.", color = authMuted, fontSize = 12.sp)
                                    BrandedField(password, { password = it }, "Пароль", password = true)
                                    MobileText("От 10 символов, хотя бы одна буква и цифра.", color = authMuted, fontSize = 12.sp)
                                    BrandedField(repeatedPassword, { repeatedPassword = it }, "Повторите пароль", password = true)
                                    if (repeatedPassword.isNotEmpty() && repeatedPassword != password) {
                                        MobileText("Пароли не совпадают", color = Color(0xFFFF8096), fontSize = 12.sp)
                                    }
                                    MobileText("Дата рождения", color = authMuted, fontSize = 14.sp, modifier = Modifier.padding(top = 8.dp))
                                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                        BrandedField(birthDay, { birthDay = it.filter { c -> c in '0'..'9' }.take(2) }, "День", "ДД", KeyboardType.Number, modifier = Modifier.weight(1f))
                                        BrandedField(birthMonth, { birthMonth = it.filter { c -> c in '0'..'9' }.take(2) }, "Месяц", "ММ", KeyboardType.Number, modifier = Modifier.weight(1f))
                                        BrandedField(birthYear, { birthYear = it.filter { c -> c in '0'..'9' }.take(4) }, "Год", "ГГГГ", KeyboardType.Number, modifier = Modifier.weight(1.3f))
                                    }
                                    LegalAcceptance(terms, { terms = it }, "Пользовательское соглашение") { legal = "terms" }
                                    LegalAcceptance(privacy, { privacy = it }, "Политику конфиденциальности") { legal = "privacy" }
                                    Spacer(Modifier.height(14.dp))
                                    AuthAction(
                                        if (busy) "Создаём аккаунт…" else "Создать аккаунт",
                                        !busy && terms && privacy && AuthValidation.email(email) && AuthValidation.username(username) &&
                                            name.trim().length <= 48 && AuthValidation.password(password) && password == repeatedPassword && birthDate != null,
                                    ) { birthDate?.let { onRegister(email, username, name, password, it, documents.getString("version")) } }
                                    MobileText("После регистрации подтвердите почту кодом из письма",
                                        color = authMuted, fontSize = 12.sp, modifier = Modifier.padding(top = 12.dp))
                                }
                            }
                        }
                        AuthPage.Verify -> {
                            MobileText("Подтвердите почту", fontSize = 23.sp, fontWeight = FontWeight.Bold)
                            MobileText("Введите шестизначный код из письма", color = authMuted,
                                modifier = Modifier.padding(top = 8.dp, bottom = 18.dp))
                            BrandedField(email, { email = it }, "Почта", keyboardType = KeyboardType.Email)
                            BrandedField(code, { code = it.filter(Char::isDigit).take(6) }, "Код", keyboardType = KeyboardType.Number)
                            AuthAction("Подтвердить", !busy && email.isNotBlank() && code.length == 6) { onVerify(email, code) }
                            TextButton(onClick = { onResend(email) }, enabled = !busy && email.isNotBlank()) { MobileText("Отправить ещё раз") }
                        }
                    }
                    if (status.isNotBlank()) MobileText(status,
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
            title = { MobileText(documents.getJSONObject(key).getString("title")) },
            text = { Column(Modifier.verticalScroll(rememberScrollState())) { val paragraphs = documents.getJSONObject(key).getJSONArray("paragraphs")
                Text((0 until paragraphs.length()).joinToString("\n\n") { paragraphs.getString(it) }) } },
            confirmButton = { TextButton(onClick = { legal = null }) { MobileText("Закрыть") } },
        )
    }
}

@Composable
private fun AuthBrand(iconSize: Int, textSize: Int) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Image(painterResource(R.drawable.freetalk_mascot), null, Modifier.size(iconSize.dp))
        MobileText("TRLKA", fontSize = textSize.sp, fontWeight = FontWeight.Bold, letterSpacing = (-1).sp,
            modifier = Modifier.padding(start = 10.dp))
    }
}

@Composable
private fun BrandedField(
    value: String, onChange: (String) -> Unit, label: String, placeholder: String = "",
    keyboardType: KeyboardType = KeyboardType.Text, password: Boolean = false,
    modifier: Modifier = Modifier,
) {
    var visible by remember { mutableStateOf(false) }
    Column(modifier.fillMaxWidth().padding(bottom = 16.dp)) {
        MobileText(label, color = Color(0xFFC3CEDC), fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
        OutlinedTextField(
            value, onChange, singleLine = true, placeholder = { MobileText(placeholder, fontSize = 14.sp) },
            modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
            shape = RoundedCornerShape(12.dp),
            keyboardOptions = KeyboardOptions(keyboardType = if (password) KeyboardType.Password else keyboardType),
            visualTransformation = if (password && !visible) PasswordVisualTransformation() else VisualTransformation.None,
            trailingIcon = if (password) { { IconButton(onClick = { visible = !visible }) { Icon(if (visible) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility, if (visible) "Скрыть пароль" else "Показать пароль") } } } else null,
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
    ) { MobileText(label, fontSize = 17.sp, fontWeight = FontWeight.Bold) }
}

@Composable
private fun LegalAcceptance(checked: Boolean, onChecked: (Boolean) -> Unit, title: String, onOpen: () -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Checkbox(checked, onChecked)
        Column(Modifier.weight(1f)) {
            MobileText("Я принимаю", color = authMuted, fontSize = 13.sp)
            TextButton(onClick = onOpen, contentPadding = PaddingValues(0.dp)) {
                MobileText(title, color = Color(0xFFC3CEDC), fontSize = 13.sp)
            }
        }
    }
}
