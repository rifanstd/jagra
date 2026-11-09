package dev.jagra.sample.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import dev.jagra.sample.R

// Outfit is a variable font, so each weight sets the wght axis of the same file.
private val Outfit = FontFamily(
    listOf(FontWeight.Normal, FontWeight.Medium, FontWeight.SemiBold).map { weight ->
        Font(
            R.font.outfit,
            weight = weight,
            variationSettings = FontVariation.Settings(FontVariation.weight(weight.weight)),
        )
    },
)

/** Jagra's tokens that Material has no role for, such as `success`. */
internal val LocalTokens = staticCompositionLocalOf { LightTokens }

@Composable
fun SampleTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    val tokens = if (dark) DarkTokens else LightTokens
    CompositionLocalProvider(LocalTokens provides tokens) {
        MaterialTheme(
            colorScheme = colorScheme(tokens, dark),
            typography = typography(),
            shapes = Shapes(
                extraSmall = RoundedCornerShape(RadiusSm),
                small = RoundedCornerShape(RadiusMd),
                medium = RoundedCornerShape(RadiusLg),
                large = RoundedCornerShape(RadiusXl),
                extraLarge = RoundedCornerShape(RadiusXl),
            ),
            content = content,
        )
    }
}

// Every surface role points at a Jagra token, so no Material tonal color shows through.
private fun colorScheme(t: Tokens, dark: Boolean): ColorScheme {
    val base = if (dark) darkColorScheme() else lightColorScheme()
    return base.copy(
        primary = t.primary,
        onPrimary = t.primaryForeground,
        primaryContainer = t.accent,
        onPrimaryContainer = t.accentForeground,
        secondary = t.secondary,
        onSecondary = t.secondaryForeground,
        secondaryContainer = t.accent,
        onSecondaryContainer = t.accentForeground,
        tertiary = t.secondary,
        onTertiary = t.secondaryForeground,
        background = t.background,
        onBackground = t.foreground,
        surface = t.card,
        onSurface = t.cardForeground,
        surfaceVariant = t.muted,
        onSurfaceVariant = t.mutedForeground,
        surfaceTint = t.card,
        surfaceBright = t.card,
        surfaceDim = t.card,
        surfaceContainerLowest = t.card,
        surfaceContainerLow = t.card,
        surfaceContainer = t.card,
        surfaceContainerHigh = t.card,
        surfaceContainerHighest = t.card,
        error = t.destructive,
        onError = t.destructiveForeground,
        errorContainer = t.destructive,
        onErrorContainer = t.destructiveForeground,
        outline = t.border,
        outlineVariant = t.border,
    )
}

private fun typography(): Typography {
    val base = Typography()
    fun TextStyle.outfit() = copy(fontFamily = Outfit)
    return base.copy(
        displayLarge = base.displayLarge.outfit(),
        displayMedium = base.displayMedium.outfit(),
        displaySmall = base.displaySmall.outfit(),
        headlineLarge = base.headlineLarge.outfit(),
        headlineMedium = base.headlineMedium.outfit(),
        headlineSmall = base.headlineSmall.outfit(),
        titleLarge = base.titleLarge.outfit(),
        titleMedium = base.titleMedium.outfit(),
        titleSmall = base.titleSmall.outfit(),
        bodyLarge = base.bodyLarge.outfit(),
        bodyMedium = base.bodyMedium.outfit(),
        bodySmall = base.bodySmall.outfit(),
        labelLarge = base.labelLarge.outfit(),
        labelMedium = base.labelMedium.outfit(),
        labelSmall = base.labelSmall.outfit(),
    )
}
