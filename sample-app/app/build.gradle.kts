plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "dev.jagra.sample"
    compileSdk = 37

    defaultConfig {
        applicationId = "dev.jagra.sample"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        debug {
            // The debug build tries Mockoon first (SMP-2). adb reverse makes this reach the computer.
            buildConfigField("String", "MOCK_SERVER_URL", "\"http://localhost:3000\"")
        }
        release {
            buildConfigField("String", "MOCK_SERVER_URL", "\"\"")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }
}

dependencies {
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.material3)
    implementation(libs.activity.compose)
    implementation(libs.lifecycle.viewmodel.compose)
}
