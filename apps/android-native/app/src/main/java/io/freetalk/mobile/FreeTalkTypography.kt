package io.freetalk.mobile

import androidx.compose.material3.Typography
import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

// Bundle every supported weight locally so Cyrillic and Latin use the same
// FreeTalk typeface without a network request or synthetic bold text.
@OptIn(ExperimentalTextApi::class)
private val geist = FontFamily(
    *(100..900 step 100).map { weight ->
        Font(
            resId = R.font.geist,
            weight = FontWeight(weight),
            variationSettings = FontVariation.Settings(FontVariation.weight(weight)),
        )
    }.toTypedArray(),
)

private val defaults = Typography()
val freeTalkTypography = Typography(
    displayLarge = defaults.displayLarge.copy(fontFamily = geist, letterSpacing = 0.sp),
    displayMedium = defaults.displayMedium.copy(fontFamily = geist, letterSpacing = 0.sp),
    displaySmall = defaults.displaySmall.copy(fontFamily = geist, letterSpacing = 0.sp),
    headlineLarge = defaults.headlineLarge.copy(fontFamily = geist, letterSpacing = 0.sp),
    headlineMedium = defaults.headlineMedium.copy(fontFamily = geist, letterSpacing = 0.sp),
    headlineSmall = defaults.headlineSmall.copy(fontFamily = geist, letterSpacing = 0.sp),
    titleLarge = defaults.titleLarge.copy(fontFamily = geist, letterSpacing = 0.sp),
    titleMedium = defaults.titleMedium.copy(fontFamily = geist, letterSpacing = 0.sp),
    titleSmall = defaults.titleSmall.copy(fontFamily = geist, letterSpacing = 0.sp),
    bodyLarge = defaults.bodyLarge.copy(fontFamily = geist, letterSpacing = 0.sp),
    bodyMedium = defaults.bodyMedium.copy(fontFamily = geist, letterSpacing = 0.sp),
    bodySmall = defaults.bodySmall.copy(fontFamily = geist, letterSpacing = 0.sp),
    labelLarge = defaults.labelLarge.copy(fontFamily = geist, letterSpacing = 0.sp),
    labelMedium = defaults.labelMedium.copy(fontFamily = geist, letterSpacing = 0.sp),
    labelSmall = defaults.labelSmall.copy(fontFamily = geist, letterSpacing = 0.sp),
)
