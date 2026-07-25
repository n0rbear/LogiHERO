package com.example.driverassistant.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val LogiHeroLightColorScheme = lightColorScheme(
    primary = LogiHeroGreen,
    onPrimary = Color.White,
    primaryContainer = LogiHeroGreenSoft,
    onPrimaryContainer = LogiHeroInk,
    secondary = LogiHeroGreenHover,
    onSecondary = Color.White,
    secondaryContainer = LogiHeroGreenSoft,
    onSecondaryContainer = LogiHeroInk,
    tertiary = LogiHeroHeader,
    onTertiary = Color.White,
    background = LogiHeroBackground,
    onBackground = LogiHeroInk,
    surface = LogiHeroSurface,
    onSurface = LogiHeroInk,
    surfaceVariant = LogiHeroGreenSoft,
    onSurfaceVariant = LogiHeroMuted,
    outline = LogiHeroBorder,
    error = LogiHeroError
)

private val LogiHeroDarkColorScheme = darkColorScheme(
    primary = LogiHeroGreen,
    onPrimary = Color.White,
    primaryContainer = Color(0xFF123D28),
    onPrimaryContainer = Color.White,
    secondary = Color(0xFF71D99F),
    onSecondary = LogiHeroInk,
    secondaryContainer = Color(0xFF172720),
    onSecondaryContainer = Color.White,
    tertiary = Color.White,
    onTertiary = LogiHeroInk,
    background = LogiHeroHeader,
    onBackground = Color.White,
    surface = Color(0xFF18221E),
    onSurface = Color.White,
    surfaceVariant = Color(0xFF203029),
    onSurfaceVariant = Color(0xFFE4F1DF),
    outline = Color(0xFF5E7569),
    error = Color(0xFFFFB4AB)
)

@Composable
fun DriverAssistantTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit
) {
    val colorScheme = if (darkTheme) LogiHeroDarkColorScheme else LogiHeroLightColorScheme

    MaterialTheme(
        colorScheme = colorScheme,
        typography = Typography,
        shapes = Shapes,
        content = content
    )
}
