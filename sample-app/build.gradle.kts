plugins {
    alias(libs.plugins.android.application) apply false
    // AGP compiles Kotlin itself (built-in Kotlin). Declaring the plugin here only pins the Kotlin version.
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.compose) apply false
}
