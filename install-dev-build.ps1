param(
    [string]$SourceDir = "C:\Users\Lorenzo Bela\Downloads\Thesis 24-25 Smart Top Box\mobile",
    [string]$BuildDir = "C:\Dev\TopBox\mobile",
    [switch]$StartEmulatorIfNeeded,
    [int]$EmulatorBootTimeoutSeconds = 180,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

Write-Host "====================================" -ForegroundColor Cyan
Write-Host "Parcel Safe Dev Build Installer" -ForegroundColor Cyan
Write-Host "====================================" -ForegroundColor Cyan
Write-Host ""

function Get-AdbPath {
    param(
        [string]$PrimaryRoot,
        [string]$SecondaryRoot
    )

    $candidates = @()

    $localPropsCandidates = @(
        (Join-Path $PrimaryRoot "android\local.properties"),
        (Join-Path $SecondaryRoot "android\local.properties")
    )

    foreach ($propsPath in $localPropsCandidates) {
        if (Test-Path $propsPath) {
            $sdkLine = Get-Content $propsPath | Where-Object { $_ -match '^sdk\.dir=' } | Select-Object -First 1
            if ($sdkLine) {
                $sdkDir = ($sdkLine -replace '^sdk\.dir=', '').Trim()
                $sdkDir = $sdkDir -replace '\\:', ':'
                $sdkDir = $sdkDir -replace '\\\\', '\'
                $candidates += (Join-Path $sdkDir "platform-tools\adb.exe")
            }
        }
    }

    if ($env:ANDROID_SDK_ROOT) {
        $candidates += (Join-Path $env:ANDROID_SDK_ROOT "platform-tools\adb.exe")
    }
    if ($env:ANDROID_HOME) {
        $candidates += (Join-Path $env:ANDROID_HOME "platform-tools\adb.exe")
    }

    $cmd = Get-Command adb -ErrorAction SilentlyContinue
    if ($cmd) {
        return $cmd.Source
    }

    $defaultSdk = Join-Path $env:LOCALAPPDATA "Android\Sdk"
    $candidates += (Join-Path $defaultSdk "platform-tools\adb.exe")

    if ($env:USERPROFILE) {
        $candidates += (Join-Path $env:USERPROFILE "AppData\Local\Android\Sdk\platform-tools\adb.exe")
    }

    foreach ($path in $candidates) {
        if (Test-Path $path) {
            return $path
        }
    }

    throw "adb not found. Install Android SDK Platform-Tools or add adb to PATH."
}

function Get-EmulatorPath {
    $candidates = @()

    if ($env:ANDROID_SDK_ROOT) {
        $candidates += (Join-Path $env:ANDROID_SDK_ROOT "emulator\emulator.exe")
    }
    if ($env:ANDROID_HOME) {
        $candidates += (Join-Path $env:ANDROID_HOME "emulator\emulator.exe")
    }

    foreach ($path in $candidates) {
        if (Test-Path $path) {
            return $path
        }
    }

    return $null
}

function Get-DeviceCount {
    param([string]$AdbPath)

    $lines = & $AdbPath devices
    $deviceLines = $lines | Where-Object {
        $_ -match "\sdevice$" -and $_ -notmatch "^List of devices"
    }

    return ($deviceLines | Measure-Object).Count
}

function Get-LatestDevApk {
    param(
        [string]$PrimaryRoot,
        [string]$SecondaryRoot
    )

    $explicitCandidates = @(
        (Join-Path $PrimaryRoot "android\app\build\outputs\apk\debug\app-debug.apk"),
        (Join-Path $PrimaryRoot "android\app\build\outputs\apk\debug\app-arm64-v8a-debug.apk"),
        (Join-Path $SecondaryRoot "android\app\build\outputs\apk\debug\app-debug.apk"),
        (Join-Path $SecondaryRoot "android\app\build\outputs\apk\debug\app-arm64-v8a-debug.apk")
    )

    foreach ($apk in $explicitCandidates) {
        if (Test-Path $apk) {
            return (Get-Item $apk)
        }
    }

    $searchRoots = @(
        "C:\Dev\TopBox\mobile\APK",
        (Join-Path $PrimaryRoot "APK"),
        (Join-Path $SecondaryRoot "APK"),
        (Join-Path $PrimaryRoot "android\app\build\outputs\apk"),
        (Join-Path $SecondaryRoot "android\app\build\outputs\apk"),
        (Join-Path $PrimaryRoot "apk_backup"),
        (Join-Path $SecondaryRoot "apk_backup")
    )

    $preferredApks = @()
    $fallbackApks = @()
    foreach ($root in $searchRoots) {
        if (Test-Path $root) {
            $preferredApks += Get-ChildItem -Path $root -Recurse -Filter "*debug*.apk" -File -ErrorAction SilentlyContinue
            $preferredApks += Get-ChildItem -Path $root -Recurse -Filter "*dev*.apk" -File -ErrorAction SilentlyContinue
            $fallbackApks += Get-ChildItem -Path $root -Recurse -Filter "*.apk" -File -ErrorAction SilentlyContinue
        }
    }

    if ($preferredApks -and $preferredApks.Count -gt 0) {
        return $preferredApks | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    }

    if (-not $fallbackApks -or $fallbackApks.Count -eq 0) {
        return $null
    }

    return $fallbackApks | Sort-Object LastWriteTime -Descending | Select-Object -First 1
}

$apk = Get-LatestDevApk -PrimaryRoot $BuildDir -SecondaryRoot $SourceDir
if (-not $apk) {
    Write-Host "[ERROR] No debug APK found." -ForegroundColor Red
    Write-Host "Run .\build-android.ps1 first, then retry." -ForegroundColor Yellow
    exit 1
}

Write-Host "[OK] Using APK: $($apk.FullName)" -ForegroundColor Green
Write-Host "     Last modified: $($apk.LastWriteTime)" -ForegroundColor Gray

if ($DryRun) {
    Write-Host "[DRY RUN] Skipping adb/device checks and install." -ForegroundColor Yellow
    exit 0
}

$adb = Get-AdbPath -PrimaryRoot $BuildDir -SecondaryRoot $SourceDir
Write-Host "[OK] adb: $adb" -ForegroundColor Green

$deviceCount = Get-DeviceCount -AdbPath $adb

if ($deviceCount -eq 0 -and $StartEmulatorIfNeeded) {
    $emulatorExe = Get-EmulatorPath
    if (-not $emulatorExe) {
        throw "No connected device and emulator.exe not found. Install Android Emulator or connect a device."
    }

    Write-Host "[INFO] No connected device. Trying to launch an Android Studio AVD..." -ForegroundColor Yellow
    $avdList = & $emulatorExe -list-avds
    $avdName = $avdList | Select-Object -First 1

    if (-not $avdName) {
        throw "No AVD found. Create one in Android Studio Device Manager first."
    }

    Write-Host "[INFO] Starting AVD: $avdName" -ForegroundColor Yellow
    Start-Process -FilePath $emulatorExe -ArgumentList "-avd", $avdName | Out-Null

    $deadline = (Get-Date).AddSeconds($EmulatorBootTimeoutSeconds)
    do {
        Start-Sleep -Seconds 5
        $deviceCount = Get-DeviceCount -AdbPath $adb
        Write-Host "[INFO] Waiting for emulator..." -ForegroundColor DarkGray
    } while ($deviceCount -eq 0 -and (Get-Date) -lt $deadline)
}

if ($deviceCount -eq 0) {
    Write-Host "[ERROR] No Android device/emulator connected." -ForegroundColor Red
    Write-Host "Connect a phone (USB debugging on) or run with -StartEmulatorIfNeeded." -ForegroundColor Yellow
    exit 1
}

Write-Host "[INFO] Installing APK..." -ForegroundColor Yellow
& $adb install -r -d "$($apk.FullName)"
$installExit = $LASTEXITCODE

if ($installExit -ne 0) {
    Write-Host "[ERROR] APK install failed (exit code: $installExit)." -ForegroundColor Red
    exit $installExit
}

Write-Host ""
Write-Host "[OK] Development build installed successfully." -ForegroundColor Green
Write-Host "Tip: run with -StartEmulatorIfNeeded to auto-boot AVD when nothing is connected." -ForegroundColor Gray
