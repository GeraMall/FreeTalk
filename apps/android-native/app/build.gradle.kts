plugins {
    id("com.google.gms.google-services")
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val repositoryRoot = rootDir.parentFile.parentFile
val turnstileSiteKey = File(repositoryRoot, "apps/desktop/.env.production").useLines { lines ->
    lines.first { it.startsWith("VITE_TURNSTILE_SITE_KEY=") }.substringAfter('=').trim()
}
require(turnstileSiteKey.matches(Regex("[A-Za-z0-9_-]+")))
val sourceCommit = providers.exec {
    workingDir = repositoryRoot
    commandLine("git", "rev-parse", "--short=12", "HEAD")
}.standardOutput.asText.get().trim()

android {
    namespace = "io.freetalk.mobile"
    compileSdk = 36

    defaultConfig {
        applicationId = "io.freetalk.mobile"
        minSdk = 29
        targetSdk = 36
        versionCode = 228
        versionName = "0.4.0-beta.228"
        buildConfigField("String", "BUILD_COMMIT", "\"$sourceCommit\"")
        buildConfigField("String", "TURNSTILE_SITE_KEY", "\"$turnstileSiteKey\"")
        testInstrumentationRunner = providers.gradleProperty("callProbeRunner")
            .orElse("androidx.test.runner.AndroidJUnitRunner").get()
    }

    buildTypes {
        release {
            // Preserve upgrades from the native previews already installed by testers.
            signingConfig = signingConfigs.getByName("debug")
            isMinifyEnabled = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    buildFeatures { compose = true; buildConfig = true }
    composeOptions { kotlinCompilerExtensionVersion = "1.5.15" }
    kotlinOptions { jvmTarget = "17" }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

val bundleTablet by tasks.registering(Exec::class) {
    workingDir = repositoryRoot
    commandLine(if (System.getProperty("os.name").startsWith("Windows")) "pnpm.cmd" else "pnpm",
        "--filter", "@freetalk/desktop", "exec", "vite", "build", "--config", "vite.android-tablet.config.ts")
    inputs.dir(File(repositoryRoot, "apps/desktop/src"))
    inputs.dir(File(repositoryRoot, "apps/desktop/public/sounds"))
    inputs.dir(File(repositoryRoot, "packages/protocol/src"))
    inputs.file(File(repositoryRoot, "apps/desktop/vite.android-tablet.config.ts"))
    inputs.file(File(repositoryRoot, "apps/desktop/vite.config.ts"))
    inputs.file(File(repositoryRoot, "apps/desktop/android-tablet.html"))
    inputs.file(File(repositoryRoot, "pnpm-lock.yaml"))
    inputs.property("sourceCommit", sourceCommit)
    outputs.dir("src/main/assets/tablet")
}
val bundleNativeTranslations by tasks.registering(Exec::class) {
    workingDir = repositoryRoot
    commandLine("node", "scripts/android/export-native-translations.mjs")
    inputs.dir(File(repositoryRoot, "apps/desktop/src/lib"))
    inputs.file(File(repositoryRoot, "apps/android-native/native-language-overrides.json"))
    inputs.file(File(repositoryRoot, "scripts/android/export-native-translations.mjs"))
    inputs.file(File(repositoryRoot, "packages/protocol/src/registration-legal.ts"))
    outputs.file("src/main/assets/native-translations.json")
    outputs.file("src/main/assets/registration-legal.json")
}
tasks.named("preBuild") { dependsOn(bundleTablet, bundleNativeTranslations) }

dependencies {
    implementation("io.github.webrtc-sdk:android:144.7559.09")
    implementation(platform("com.google.firebase:firebase-bom:34.2.0"))
    implementation("com.google.firebase:firebase-messaging")
    val composeBom = platform("androidx.compose:compose-bom:2024.09.03")
    implementation(composeBom)
    androidTestImplementation(composeBom)

    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.9.1")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.1")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("io.coil-kt:coil-compose:2.7.0")
    implementation("io.coil-kt:coil-gif:2.7.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")

    debugImplementation("androidx.compose.ui:ui-tooling")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.6.1")
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}
