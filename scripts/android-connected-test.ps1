param(
    [string]$AvdName = $env:LOGIHERO_AVD_NAME,
    [string]$GradleTask = "connectedAndroidTest"
)

$ErrorActionPreference = "Stop"

function Find-AndroidSdk {
    $rawCandidates = @(
        $env:ANDROID_HOME,
        $env:ANDROID_SDK_ROOT,
        "$env:LOCALAPPDATA\Android\Sdk"
    )
    $candidates = @($rawCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) })
    if (-not $candidates) {
        throw "Android SDK not found. Install Android Studio SDK or set ANDROID_HOME."
    }
    return (Resolve-Path -LiteralPath $candidates[0]).Path
}

$sdk = Find-AndroidSdk
$adb = Join-Path $sdk "platform-tools\adb.exe"
$emulator = Join-Path $sdk "emulator\emulator.exe"
$avdManager = Join-Path $sdk "cmdline-tools\latest\bin\avdmanager.bat"
$sdkManager = Join-Path $sdk "cmdline-tools\latest\bin\sdkmanager.bat"

if (-not (Test-Path $adb)) { throw "adb not found at $adb" }
if (-not (Test-Path $emulator)) { throw "emulator not found at $emulator" }

& $adb start-server | Out-Host
$devices = & $adb devices
$booted = $devices | Select-String -Pattern "`tdevice$"

if (-not $booted) {
    $avds = & $emulator -list-avds
    if (-not $AvdName) { $AvdName = ($avds | Select-Object -First 1) }
    if (-not $AvdName) {
        if (-not (Test-Path $sdkManager) -or -not (Test-Path $avdManager)) {
            throw "No AVD found and Android command-line tools are missing. Install cmdline-tools;latest."
        }
        & $sdkManager "system-images;android-35;google_apis;x86_64" "platforms;android-35" | Out-Host
        "no" | & $avdManager create avd --force --name "LogiHERO_API_35" --package "system-images;android-35;google_apis;x86_64" --device "pixel_6" | Out-Host
        $AvdName = "LogiHERO_API_35"
    }
    Start-Process -FilePath $emulator -ArgumentList @("-avd", $AvdName, "-no-snapshot-save") -WindowStyle Hidden
}

$deadline = (Get-Date).AddMinutes(8)
do {
    Start-Sleep -Seconds 5
    $ready = ""
    try {
        $ready = & $adb shell getprop sys.boot_completed 2>$null
    } catch {
        $ready = ""
    }
    if (($ready -join "").Trim() -eq "1") { break }
} while ((Get-Date) -lt $deadline)

if ((($ready -join "").Trim()) -ne "1") {
    throw "Android emulator did not finish booting before timeout."
}

& $adb devices | Out-Host
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
& .\gradlew.bat $GradleTask
exit $LASTEXITCODE
