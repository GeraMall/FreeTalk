param(
    [ValidateSet("arm64", "armv7", "x86", "x86_64")]
    [string]$Target = "arm64",
    [switch]$Debug
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$toolchainRoot = Join-Path $repoRoot ".toolchains"
$javaRoot = Join-Path $toolchainRoot "jdk"
$javaHome = (Get-ChildItem -LiteralPath $javaRoot -Directory | Select-Object -First 1).FullName
$androidHome = Join-Path $toolchainRoot "android-sdk"
$tauriRoot = Join-Path $repoRoot "apps\desktop\src-tauri"
$androidRoot = Join-Path $tauriRoot "gen\android"
$signingRoot = Join-Path $toolchainRoot "android-signing"
$keyStore = Join-Path $signingRoot "freetalk-beta.jks"
$keyProperties = Join-Path $androidRoot "keystore.properties"

if (!$javaHome -or !(Test-Path -LiteralPath (Join-Path $javaHome "bin\java.exe")) -or !(Test-Path -LiteralPath $androidHome)) {
    throw "Android toolchain is missing under $toolchainRoot"
}

$env:JAVA_HOME = $javaHome
$env:ANDROID_HOME = $androidHome
$env:ANDROID_SDK_ROOT = $androidHome
$env:NDK_HOME = Join-Path $androidHome "ndk\27.0.12077973"
$cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
$env:Path = "$(Join-Path $javaHome 'bin');$(Join-Path $androidHome 'platform-tools');$cargoBin;$env:Path"

$targetMap = @{
    arm64 = @{ rust = "aarch64"; triple = "aarch64-linux-android"; abi = "arm64-v8a"; gradle = "Arm64" }
    armv7 = @{ rust = "armv7"; triple = "armv7-linux-androideabi"; abi = "armeabi-v7a"; gradle = "Armv7" }
    x86 = @{ rust = "i686"; triple = "i686-linux-android"; abi = "x86"; gradle = "X86" }
    x86_64 = @{ rust = "x86_64"; triple = "x86_64-linux-android"; abi = "x86_64"; gradle = "X86_64" }
}
$selected = $targetMap[$Target]
$profile = if ($Debug) { "debug" } else { "release" }
$gradleVariant = if ($Debug) { "Debug" } else { "Release" }

Push-Location $repoRoot
try {
    pnpm --filter @freetalk/desktop build
    if ($LASTEXITCODE -ne 0) { throw "Web build failed" }

    $tauriArgs = @("--filter", "@freetalk/desktop", "tauri", "android", "build", "--apk", "--target", $selected.rust, "--ci")
    if ($Debug) { $tauriArgs += "--debug" }
    pnpm @tauriArgs

    # On Windows without Developer Mode Tauri may fail only while creating the
    # jniLibs symlink. The native library is already complete, so copy it and
    # let Gradle package the APK directly.
    $nativeLibrary = Join-Path $tauriRoot "target\$($selected.triple)\$profile\libfreetalk_lib.so"
    if (!(Test-Path -LiteralPath $nativeLibrary)) {
        throw "Rust Android library was not produced: $nativeLibrary"
    }
    $jniDirectory = Join-Path $androidRoot "app\src\main\jniLibs\$($selected.abi)"
    New-Item -ItemType Directory -Path $jniDirectory -Force | Out-Null
    Copy-Item -LiteralPath $nativeLibrary -Destination (Join-Path $jniDirectory "libfreetalk_lib.so") -Force

    if (!$Debug) {
        New-Item -ItemType Directory -Path $signingRoot -Force | Out-Null
        $passwordFile = Join-Path $signingRoot "freetalk-beta.password"
        if (!(Test-Path -LiteralPath $keyStore)) {
            $password = ([guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N")).Substring(0, 48)
            Set-Content -LiteralPath $passwordFile -Value $password -NoNewline
            & (Join-Path $javaHome "bin\keytool.exe") -genkeypair -v -keystore $keyStore -storepass $password -keypass $password -alias freetalk-beta -keyalg RSA -keysize 4096 -validity 10000 -dname "CN=FreeTalk Beta, O=FreeTalk, C=RU"
            if ($LASTEXITCODE -ne 0) { throw "Beta signing key generation failed" }
        } else {
            $password = Get-Content -LiteralPath $passwordFile -Raw
        }
        $relativeKeyStore = [IO.Path]::GetRelativePath($androidRoot, $keyStore).Replace("\", "/")
        @(
            "storeFile=$relativeKeyStore"
            "storePassword=$password"
            "keyAlias=freetalk-beta"
            "keyPassword=$password"
        ) | Set-Content -LiteralPath $keyProperties
    }

    Push-Location $androidRoot
    try {
        & ".\gradlew.bat" ":app:assemble$($selected.gradle)$gradleVariant" "-x" ":app:rustBuild$($selected.gradle)$gradleVariant" "--no-daemon"
        if ($LASTEXITCODE -ne 0) { throw "Gradle APK build failed" }
    } finally {
        Pop-Location
    }
} finally {
    Pop-Location
}
