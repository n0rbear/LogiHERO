param(
    [string]$AvdName = $env:LOGIHERO_AVD_NAME,
    [string]$GradleTask = "connectedAndroidTest",
    [int]$BootTimeoutSeconds = 480,
    [string]$LogFile = "build\android-connected-test.log",
    [switch]$UseRunningDevice,
    [switch]$ShutdownAfter
)

$ErrorActionPreference = "Stop"
$lockFile = Join-Path $env:TEMP "logihero-android-connected-test.lock"

function Write-Step([string]$Message) {
    $line = "[$(Get-Date -Format o)] $Message"
    Write-Host $line
    Add-Content -LiteralPath $LogFile -Value $line
}

function Find-AndroidSdk {
    $rawCandidates = @($env:ANDROID_HOME, $env:ANDROID_SDK_ROOT, "$env:LOCALAPPDATA\Android\Sdk")
    $candidates = @($rawCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) })
    if (-not $candidates) { throw "Android SDK not found. Install Android Studio SDK or set ANDROID_HOME." }
    return (Resolve-Path -LiteralPath $candidates[0]).Path
}

function Run-Adb($adb, [string[]]$Args) {
    & $adb @Args
}

if (Test-Path -LiteralPath $lockFile) { throw "Another LogiHERO connected Android test appears to be running: $lockFile" }
New-Item -ItemType File -Path $lockFile -Force | Out-Null
New-Item -ItemType Directory -Path (Split-Path -Parent $LogFile) -Force | Out-Null
Set-Content -LiteralPath $LogFile -Value ""

$startedEmulator = $false
try {
    $sdk = Find-AndroidSdk
    $adb = Join-Path $sdk "platform-tools\adb.exe"
    $emulator = Join-Path $sdk "emulator\emulator.exe"
    $avdManager = Join-Path $sdk "cmdline-tools\latest\bin\avdmanager.bat"
    $sdkManager = Join-Path $sdk "cmdline-tools\latest\bin\sdkmanager.bat"

    if (-not (Test-Path -LiteralPath $adb)) { throw "adb not found at $adb" }
    if (-not (Test-Path -LiteralPath $emulator)) { throw "emulator not found at $emulator" }

    Write-Step "Using Android SDK: $sdk"
    Run-Adb $adb @("start-server") | Out-Null
    $devices = @()
    $detectDeadline = (Get-Date).AddSeconds(30)
    do {
        $devices = Run-Adb $adb @("devices")
        if ($devices | Select-String -Pattern "^emulator-\d+\s+") { break }
        if ($devices | Select-String -Pattern "`tdevice$") { break }
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $detectDeadline)
    $emulatorSeen = $devices | Select-String -Pattern "^emulator-\d+\s+"
    $booted = $devices | Select-String -Pattern "`tdevice$"

    if ($UseRunningDevice) {
        Write-Step "UseRunningDevice enabled; no AVD launch will be attempted."
    } elseif (-not $booted -and -not $emulatorSeen) {
        $avds = & $emulator -list-avds
        if (-not $AvdName) { $AvdName = ($avds | Select-Object -First 1) }
        if (-not $AvdName) {
            if (-not (Test-Path -LiteralPath $sdkManager) -or -not (Test-Path -LiteralPath $avdManager)) {
                throw "No AVD found and Android command-line tools are missing. Install cmdline-tools;latest."
            }
            Write-Step "No AVD found. Creating LogiHERO_API_35, API 35, google_apis, x86_64."
            & $sdkManager "system-images;android-35;google_apis;x86_64" "platforms;android-35" | Out-Host
            "no" | & $avdManager create avd --force --name "LogiHERO_API_35" --package "system-images;android-35;google_apis;x86_64" --device "pixel_6" | Out-Host
            $AvdName = "LogiHERO_API_35"
        }
        Write-Step "Starting AVD: $AvdName"
        Start-Process -FilePath $emulator -ArgumentList @("-avd", $AvdName, "-no-snapshot-save") -WindowStyle Hidden
        $startedEmulator = $true
    } else {
        Write-Step "Using already running emulator/device."
    }

    $deadline = (Get-Date).AddSeconds($BootTimeoutSeconds)
    $ready = ""
    Run-Adb $adb @("wait-for-device") | Out-Null
    if ($UseRunningDevice) {
        try {
            $ready = (& $adb shell getprop sys.boot_completed 2>$null)
            Write-Step "Boot property before wait: $(($ready -join '').Trim())"
        } catch {
            $ready = ""
        }
    }
    do {
        if (($ready -join "").Trim() -eq "1") { break }
        Start-Sleep -Seconds 5
        try { $ready = Run-Adb $adb @("shell", "getprop", "sys.boot_completed") } catch { $ready = "" }
        if (($ready -join "").Trim() -eq "1") { break }
    } while ((Get-Date) -lt $deadline)

    if ((($ready -join "").Trim()) -ne "1") { throw "Android emulator did not finish booting before timeout." }

    Write-Step "ADB devices:"
    (& $adb devices) | Tee-Object -FilePath $LogFile -Append | Out-Host
    $env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
    Write-Step "Running Gradle task: $GradleTask"
    & .\gradlew.bat $GradleTask 2>&1 | Tee-Object -FilePath $LogFile -Append
    $exitCode = $LASTEXITCODE
    Write-Step "Gradle exit code: $exitCode"
    exit $exitCode
} finally {
    if ($ShutdownAfter -and $startedEmulator) {
        try {
            $sdk = Find-AndroidSdk
            & (Join-Path $sdk "platform-tools\adb.exe") emu kill | Out-Null
            Write-Step "Requested emulator shutdown."
        } catch {}
    }
    Remove-Item -LiteralPath $lockFile -Force -ErrorAction SilentlyContinue
}
