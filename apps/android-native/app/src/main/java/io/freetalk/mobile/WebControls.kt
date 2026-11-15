package io.freetalk.mobile

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.toggleableState
import androidx.compose.ui.state.ToggleableState
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private data class WebPalette(val text: Color, val muted: Color, val header: Color, val input: Color, val stroke: Color, val accent: Color)
private val LocalWebPalette = staticCompositionLocalOf<WebPalette?> { null }
private val darkAuthPalette = WebPalette(Color(0xFFF4F8FF), Color(0xFF9AABC1), Color(0xFF0A1623),
    Color(0xFF050D18), Color(0xFF29384E), Color(0xFF8DA6DC))

@Composable
internal fun DarkAuthControls(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = colors, typography = freeTalkTypography, shapes = freeTalkShapes) {
        CompositionLocalProvider(LocalWebPalette provides darkAuthPalette, LocalContentColor provides darkAuthPalette.text, content = content)
    }
}

@Composable
private fun webPalette(): WebPalette = LocalWebPalette.current ?: WebPalette(MobileDesign.text, MobileDesign.muted,
    MobileDesign.header, MobileDesign.input, MobileDesign.stroke, MobileDesign.accent)

// Web dimensions are CSS px; Compose dp keeps the same geometry at device density.
private val buttonShape = RoundedCornerShape(10.dp)

@Composable
internal fun WebButton(onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true,
    shape: Shape = buttonShape, colors: ButtonColors? = null, border: BorderStroke? = null,
    contentPadding: PaddingValues = PaddingValues(horizontal = 16.dp, vertical = 10.dp),
    content: @Composable RowScope.() -> Unit) {
    val palette = webPalette()
    val ink = if (enabled) colors?.contentColor ?: Color(0xFF01050D) else colors?.disabledContentColor ?: palette.muted
    val fill = if (enabled) colors?.containerColor ?: Color.Transparent else colors?.disabledContainerColor ?: palette.stroke
    Surface(onClick, modifier.defaultMinSize(minWidth = 64.dp, minHeight = 40.dp)
        .semantics { role = Role.Button }
        .then(if (colors == null && enabled) Modifier.background(MobileDesign.gradient, shape) else Modifier),
        enabled = enabled, shape = shape, color = fill, contentColor = ink,
        border = border ?: BorderStroke(1.dp, palette.accent.copy(alpha = .35f))) {
        ProvideTextStyle(MaterialTheme.typography.labelLarge.copy(fontSize = 14.sp, lineHeight = 20.sp, fontWeight = FontWeight.SemiBold)) {
            Row(Modifier.padding(contentPadding), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically, content = content)
        }
    }
}

@Composable
internal fun WebOutlinedButton(onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true,
    shape: Shape = buttonShape, border: BorderStroke? = null, colors: ButtonColors? = null,
    contentPadding: PaddingValues = PaddingValues(horizontal = 14.dp, vertical = 9.dp),
    content: @Composable RowScope.() -> Unit) {
    val palette = webPalette()
    WebButton(onClick, modifier, enabled, shape,
        colors ?: ButtonDefaults.buttonColors(containerColor = palette.header,
            contentColor = palette.text, disabledContainerColor = palette.header,
            disabledContentColor = palette.muted),
        border ?: BorderStroke(1.dp, palette.stroke), contentPadding, content)
}

@Composable
internal fun WebTextButton(onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true,
    colors: ButtonColors? = null, shape: Shape = RoundedCornerShape(8.dp),
    contentPadding: PaddingValues = PaddingValues(horizontal = 10.dp, vertical = 6.dp),
    content: @Composable RowScope.() -> Unit) {
    val palette = webPalette()
    Surface(onClick, modifier.defaultMinSize(minHeight = 32.dp).semantics { role = Role.Button },
        enabled = enabled, shape = shape, color = Color.Transparent,
        contentColor = if (enabled) colors?.contentColor ?: palette.accent else palette.muted.copy(alpha = .5f)) {
        ProvideTextStyle(MaterialTheme.typography.labelLarge.copy(fontSize = 13.sp, fontWeight = FontWeight.SemiBold)) {
            Row(Modifier.padding(contentPadding), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically, content = content)
        }
    }
}

@Composable
internal fun WebIconButton(onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true,
    colors: IconButtonColors? = null, content: @Composable () -> Unit) {
    val palette = webPalette()
    Surface(onClick, modifier.size(40.dp).semantics { role = Role.Button }, enabled = enabled,
        shape = RoundedCornerShape(9.dp), color = colors?.containerColor ?: Color.Transparent,
        contentColor = if (enabled) colors?.contentColor ?: palette.muted else palette.muted.copy(alpha = .4f)) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center, content = { content() })
    }
}

@Composable
internal fun WebIcon(imageVector: ImageVector, contentDescription: String?, modifier: Modifier = Modifier.size(18.dp),
    tint: Color = LocalContentColor.current) {
    Icon(imageVector, contentDescription, modifier, tint)
}

@Composable
internal fun WebTextField(value: String, onValueChange: (String) -> Unit, modifier: Modifier = Modifier,
    enabled: Boolean = true, readOnly: Boolean = false, textStyle: TextStyle = LocalTextStyle.current,
    label: (@Composable () -> Unit)? = null, placeholder: (@Composable () -> Unit)? = null,
    leadingIcon: (@Composable () -> Unit)? = null, trailingIcon: (@Composable () -> Unit)? = null,
    prefix: (@Composable () -> Unit)? = null, suffix: (@Composable () -> Unit)? = null,
    supportingText: (@Composable () -> Unit)? = null, isError: Boolean = false,
    visualTransformation: VisualTransformation = VisualTransformation.None,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default, keyboardActions: KeyboardActions = KeyboardActions.Default,
    singleLine: Boolean = false, maxLines: Int = if (singleLine) 1 else Int.MAX_VALUE, minLines: Int = 1,
    shape: Shape = RoundedCornerShape(12.dp), colors: TextFieldColors? = null) {
    val palette = webPalette()
    var focused by remember { mutableStateOf(false) }
    val fill = colors?.let { if (focused) it.focusedContainerColor else it.unfocusedContainerColor } ?: palette.input
    val stroke = when {
        isError -> colors?.errorIndicatorColor ?: MobileDesign.red
        focused -> colors?.focusedIndicatorColor ?: palette.accent
        else -> colors?.unfocusedIndicatorColor ?: palette.stroke
    }
    val ink = colors?.let { if (focused) it.focusedTextColor else it.unfocusedTextColor } ?: palette.text
    Column(modifier, verticalArrangement = Arrangement.spacedBy(7.dp)) {
        if (label != null) ProvideTextStyle(MaterialTheme.typography.labelMedium.copy(fontSize = 13.sp, fontWeight = FontWeight.SemiBold)) { label() }
        BasicTextField(value, onValueChange, Modifier.fillMaxWidth().heightIn(min = 48.dp)
            .onFocusChanged { focused = it.isFocused }.clip(shape).background(fill)
            .border(1.dp, stroke, shape).padding(horizontal = 14.dp, vertical = 12.dp),
            enabled = enabled, readOnly = readOnly, singleLine = singleLine, minLines = minLines, maxLines = maxLines,
            textStyle = textStyle.copy(color = ink, fontSize = 16.sp),
            cursorBrush = SolidColorBrush(), visualTransformation = visualTransformation,
            keyboardOptions = keyboardOptions, keyboardActions = keyboardActions,
            decorationBox = { inner ->
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    leadingIcon?.invoke(); prefix?.invoke()
                    Box(Modifier.weight(1f)) {
                        if (value.isEmpty() && placeholder != null) CompositionLocalProvider(LocalContentColor provides palette.muted) { placeholder() }
                        inner()
                    }
                    suffix?.invoke()
                    if (trailingIcon != null) Box(Modifier.size(24.dp), contentAlignment = Alignment.Center) { trailingIcon() }
                }
            })
        supportingText?.invoke()
    }
}

@Composable
private fun SolidColorBrush() = SolidColor(webPalette().accent)

@Composable
internal fun WebSwitch(checked: Boolean, onCheckedChange: ((Boolean) -> Unit)?, modifier: Modifier = Modifier,
    enabled: Boolean = true) {
    val palette = webPalette()
    val offset by animateDpAsState(if (checked) 20.dp else 2.dp, label = "Web switch")
    Box(modifier.size(48.dp, 40.dp).toggleable(checked, enabled && onCheckedChange != null, Role.Switch) { onCheckedChange?.invoke(it) }, contentAlignment = Alignment.Center) {
        Box(Modifier.size(40.dp, 22.dp).clip(RoundedCornerShape(12.dp))
            .background(if (checked) palette.accent.copy(alpha = .4f) else palette.header)
            .border(1.dp, palette.stroke, RoundedCornerShape(12.dp))) {
            Box(Modifier.offset(x = offset, y = 2.dp).size(18.dp).background(if (checked) palette.accent else palette.muted, CircleShape))
        }
    }
}

@Composable
internal fun WebCheckbox(checked: Boolean, onCheckedChange: ((Boolean) -> Unit)?, modifier: Modifier = Modifier,
    enabled: Boolean = true) {
    val palette = webPalette()
    val interaction = if (onCheckedChange != null) Modifier.toggleable(checked, enabled, Role.Checkbox, onCheckedChange)
        else Modifier.semantics { role = Role.Checkbox; toggleableState = ToggleableState(checked) }
    Box(modifier.size(36.dp).then(interaction), contentAlignment = Alignment.Center) {
        Box(Modifier.size(18.dp).clip(RoundedCornerShape(4.dp)).background(if (checked) palette.accent else palette.input)
            .border(1.dp, if (checked) palette.accent else palette.stroke, RoundedCornerShape(4.dp)), contentAlignment = Alignment.Center) {
            if (checked) WebIcon(WebIcons.Check, null, Modifier.size(14.dp), Color(0xFF01050D))
        }
    }
}

@Composable
internal fun WebRadioButton(selected: Boolean, onClick: (() -> Unit)?, modifier: Modifier = Modifier, enabled: Boolean = true) {
    val palette = webPalette()
    Box(modifier.size(36.dp).selectable(selected, enabled && onClick != null, Role.RadioButton) { onClick?.invoke() }, contentAlignment = Alignment.Center) {
        Box(Modifier.size(17.dp).border(1.dp, if (selected) palette.accent else palette.stroke, CircleShape), contentAlignment = Alignment.Center) {
            if (selected) Box(Modifier.size(9.dp).background(palette.accent, CircleShape))
        }
    }
}
