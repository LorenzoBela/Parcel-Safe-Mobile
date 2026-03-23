# Android PRODUCTION Build Script for Parcel Safe App
# This script syncs files, generates a release keystore, and creates production APK/AABs.
#
# ================================================================================================
# KNOWN WORKING BUILD CONFIGURATION (last verified: 2026-02-15)
# ================================================================================================
# See build-last-good.json for full details. Critical versions:
#   - Kotlin:            2.0.21  (must be 2.0.0+ for KSP compatibility)
#   - react-native:      0.81.5
#   - react-native-svg:  15.12.1  (must be 15.12.1+ for RN 0.81 new arch support)
#   - Expo SDK:          54
#   - JDK:               17 (Eclipse Adoptium Temurin)
#   - NDK:               26.1.10909125 (CRITICAL: RN 0.81 requires NDK 26. NDK 27 will fail)
#   - Gradle:            8.14.3
#
# CRITICAL BUILD NOTES:
#   1. expo prebuild --clean wipes android/ entirely. ALL Gradle patches MUST be
#      re-applied AFTER prebuild.
#   2. This script automatically signs the production build with 'release.keystore'.
#   3. The script extracts the SHA-1/SHA-256 for Firebase.
# ================================================================================================

Write-Host "====================================" -ForegroundColor Cyan
Write-Host "Parcel Safe Android PRODUCTION Build Script" -ForegroundColor Cyan
Write-Host "====================================" -ForegroundColor Cyan
Write-Host ""

#region Pre-Flight Check Functions
function Test-ToolVersion {
    param(
        [string]$ToolName,
        [scriptblock]$VersionCommand,
        [string]$RequiredPattern,
        [string]$Description
    )
    try {
        $version = & $VersionCommand 2>&1 | Out-String
        if ($version -match $RequiredPattern) {
            Write-Host "[OK] $ToolName validated: $($matches[0])" -ForegroundColor Green
            return $true
        } else {
            Write-Host "[WARN] $ToolName version mismatch. Found: $version" -ForegroundColor DarkYellow
            Write-Host "      Expected: $Description" -ForegroundColor Gray
            return $false
        }
    } catch {
        Write-Host "[WARN] $ToolName not found or failed to check version" -ForegroundColor DarkYellow
        return $false
    }
}

function Invoke-GradleDaemonCleanup {
    param([string]$ProjectPath)
    Write-Host "[INFO] Stopping Gradle daemons and cleaning old caches..." -ForegroundColor Yellow
    
    try {
        Push-Location (Join-Path $ProjectPath "android")
        .\gradlew --stop 2>&1 | Out-Null
        Pop-Location
        Write-Host "[OK] Gradle daemons stopped" -ForegroundColor Green
    } catch {
        Write-Host "[WARN] Could not stop Gradle daemons: $_" -ForegroundColor DarkYellow
    }
    
    try {
        $gradleCache = Join-Path $env:USERPROFILE ".gradle\caches"
        if (Test-Path $gradleCache) {
            $oldCaches = Get-ChildItem $gradleCache -Directory -ErrorAction SilentlyContinue |
                Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-14) }
            if ($oldCaches) {
                $oldCaches | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
                Write-Host "[OK] Cleaned $($oldCaches.Count) old Gradle cache folders (>14 days)" -ForegroundColor Green
            }
        }
    } catch {
        Write-Host "[WARN] Could not clean old Gradle caches: $_" -ForegroundColor DarkYellow
    }
}

function Test-AndroidEnvironment {
    param([string]$SdkPath)
    
    $issues = @()
    
    $requiredComponents = @(
        @{Path="platform-tools"; Name="Android Platform Tools"},
        @{Path="build-tools"; Name="Android Build Tools"},
        @{Path="platforms"; Name="Android Platforms"}
    )
    
    foreach ($component in $requiredComponents) {
        $componentPath = Join-Path $SdkPath $component.Path
        if (-not (Test-Path $componentPath)) {
            $issues += "$($component.Name) not found at: $componentPath"
        }
    }
    
    if ($issues.Count -gt 0) {
        Write-Host "[WARN] Android SDK issues detected:" -ForegroundColor DarkYellow
        $issues | ForEach-Object { Write-Host "      - $_" -ForegroundColor Gray }
        return $false
    } else {
        Write-Host "[OK] Android SDK components verified" -ForegroundColor Green
        return $true
    }
}

function Invoke-SmartCleanup {
    param(
        [string]$ProjectPath,
        [switch]$DeepClean
    )
    
    Write-Host "[INFO] Cleaning build artifacts..." -ForegroundColor Yellow
    
    $cleanPaths = @(
        "android\.gradle",
        "android\app\build",
        "android\app\.cxx",
        "android\build"
    )
    
    if ($DeepClean) {
        $cleanPaths += @(
            "node_modules\.cache",
            ".expo"
        )
    }
    
    $cleaned = 0
    foreach ($relativePath in $cleanPaths) {
        $fullPath = Join-Path $ProjectPath $relativePath
        if (Test-Path $fullPath) {
            try {
                Remove-Item -Recurse -Force $fullPath -ErrorAction Stop
                $cleaned++
            } catch {
                Write-Host "[WARN] Could not remove $relativePath" -ForegroundColor DarkYellow
            }
        }
    }
    
    Write-Host "[OK] Cleaned $cleaned build artifact folders" -ForegroundColor Green
}
#endregion

# Define source and destination paths
$SOURCE_DIR = "C:\Users\Lorenzo Bela\Downloads\Thesis 24-25 Smart Top Box\mobile"
$DEST_DIR = "C:\Dev\TopBox\mobile"
$OTA_CHANNEL = "thesis"
$EAS_PROFILE = "production"
$FAST_MODE = $true
$FORCE_CLEAN_PREBUILD = $false
$script:GradleMaxWorkers = 2
$script:GradleHeapMb = 8192

function Ensure-OtaChannelInAppJson {
    param(
        [string]$AppJsonPath,
        [string]$ChannelName
    )

    if (-not (Test-Path $AppJsonPath)) {
        Write-Host "[ERROR] app.json not found at $AppJsonPath" -ForegroundColor Red
        exit 1
    }

    try {
        $config = Get-Content -Path $AppJsonPath -Raw | ConvertFrom-Json

        if (-not $config.expo) {
            Write-Host "[ERROR] Invalid app.json: missing top-level 'expo' object" -ForegroundColor Red
            exit 1
        }

        if (-not $config.expo.updates) {
            $config.expo | Add-Member -NotePropertyName updates -NotePropertyValue ([pscustomobject]@{})
        }

        if (-not $config.expo.updates.requestHeaders) {
            $config.expo.updates | Add-Member -NotePropertyName requestHeaders -NotePropertyValue ([pscustomobject]@{})
        }

        $currentChannel = $config.expo.updates.requestHeaders."expo-channel-name"
        if ($null -eq $currentChannel) {
            $config.expo.updates.requestHeaders | Add-Member -NotePropertyName "expo-channel-name" -NotePropertyValue $ChannelName
            $config | ConvertTo-Json -Depth 100 | Set-Content -Path $AppJsonPath -Encoding UTF8
            Write-Host "[OK] Added updates.requestHeaders.expo-channel-name='$ChannelName' to app.json" -ForegroundColor Green
        } elseif ($currentChannel -ne $ChannelName) {
            $config.expo.updates.requestHeaders."expo-channel-name" = $ChannelName
            $config | ConvertTo-Json -Depth 100 | Set-Content -Path $AppJsonPath -Encoding UTF8
            Write-Host "[OK] Updated updates.requestHeaders.expo-channel-name to '$ChannelName' in app.json" -ForegroundColor Green
        } else {
            Write-Host "[OK] app.json already targets OTA channel '$ChannelName'" -ForegroundColor Green
        }
    } catch {
        Write-Host "[ERROR] Failed to enforce OTA channel in app.json: $_" -ForegroundColor Red
        exit 1
    }
}

function Get-FileSha256 {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return $null }
    try {
        return (Get-FileHash -Path $Path -Algorithm SHA256).Hash
    } catch {
        return $null
    }
}

function Get-CombinedHash {
    param([string[]]$Paths)
    $parts = @()
    foreach ($p in $Paths) {
        if (Test-Path $p) {
            $hash = Get-FileSha256 -Path $p
            if ($hash) { $parts += "$p|$hash" }
        }
    }
    if ($parts.Count -eq 0) { return $null }
    $joined = ($parts | Sort-Object) -join "`n"
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($joined)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $hashBytes = $sha.ComputeHash($bytes)
        return ([BitConverter]::ToString($hashBytes)).Replace("-", "")
    } finally {
        $sha.Dispose()
    }
}

# Step 0: Ensure signing secrets are loaded
Write-Host "`nStep 0: Loading signing configuration..." -ForegroundColor Yellow
$KEYSTORE_PATH = Join-Path $SOURCE_DIR "release.keystore"

# Load build secrets from .env.build if it exists
$envFile = Join-Path $SOURCE_DIR ".env.build"
if (Test-Path $envFile) {
    Get-Content $envFile | Where-Object { $_ -match "^[^#]*=" } | ForEach-Object {
        $name, $value = $_.Split('=', 2)
        Set-Item -Path "env:\$name" -Value $value.Trim()
    }
}

$KEYSTORE_PASS = $env:RELEASE_KEYSTORE_PASSWORD
$KEY_ALIAS = $env:RELEASE_KEYSTORE_ALIAS

if ([string]::IsNullOrWhiteSpace($KEYSTORE_PASS) -or [string]::IsNullOrWhiteSpace($KEY_ALIAS)) {
    Write-Host "[ERROR] RELEASE_KEYSTORE_PASSWORD or RELEASE_KEYSTORE_ALIAS missing in .env.build" -ForegroundColor Red
    Write-Host "Please add them to your .env.build file to proceed with the build." -ForegroundColor Yellow
    exit 1
}

if (-not (Test-Path $KEYSTORE_PATH)) {
    Write-Host "[INFO] Generating new release.keystore..." -ForegroundColor Yellow
    & keytool -genkeypair -v -storetype PKCS12 -keystore $KEYSTORE_PATH -alias $KEY_ALIAS -keyalg RSA -keysize 2048 -validity 10000 -storepass $KEYSTORE_PASS -keypass $KEYSTORE_PASS -dname "CN=ParcelSafe, OU=Mobile, O=Thesis, L=Manila, ST=NCR, C=PH"
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[OK] release.keystore generated successfully" -ForegroundColor Green
    } else {
        Write-Host "[ERROR] Failed to generate release.keystore" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "[OK] release.keystore already exists" -ForegroundColor Green
}

# Step 0.1: Sync files from editing location to build location
Write-Host "`nStep 0.1: Syncing files from editing location to build location..." -ForegroundColor Yellow
Write-Host "  Source: $SOURCE_DIR" -ForegroundColor Gray
Write-Host "  Destination: $DEST_DIR" -ForegroundColor Gray

if (-not (Test-Path $DEST_DIR)) {
    Write-Host "  Creating destination directory..." -ForegroundColor Gray
    New-Item -ItemType Directory -Path $DEST_DIR -Force | Out-Null
}

$robocopyArgs = @(
    $SOURCE_DIR,
    $DEST_DIR,
    "/MIR", "/R:2", "/W:3", "/MT:8",
    "/XD", "node_modules", "android", "android\build", "android\app\build", "android\app\.cxx", "android\.gradle", ".expo", ".git", "APK",
    "/XF", "*.log", "*.lock", ".DS_Store",
    "/NFL", "/NDL", "/NP", "/NS", "/NC", "/BYTES"
)

robocopy @robocopyArgs
$robocopyExitCode = $LASTEXITCODE

if ($robocopyExitCode -ge 8) {
    Write-Host "[ERROR] File sync failed with exit code $robocopyExitCode" -ForegroundColor Red
    exit $robocopyExitCode
} else {
    Write-Host "[OK] Files synced successfully (exit code: $robocopyExitCode)" -ForegroundColor Green
}

Set-Location $DEST_DIR
Write-Host "[OK] Switched to build directory: $DEST_DIR" -ForegroundColor Green
Write-Host ""

$BUILD_CACHE_DIR = Join-Path $DEST_DIR ".build-cache"
if (-not (Test-Path $BUILD_CACHE_DIR)) {
    New-Item -ItemType Directory -Path $BUILD_CACHE_DIR -Force | Out-Null
}

Write-Host "`nStep 0.2: Enforcing OTA channel configuration..." -ForegroundColor Yellow
$appJsonPath = Join-Path $DEST_DIR "app.json"
Ensure-OtaChannelInAppJson -AppJsonPath $appJsonPath -ChannelName $OTA_CHANNEL
$env:EAS_BUILD_PROFILE = $EAS_PROFILE
Write-Host "[OK] EAS build profile set to: $env:EAS_BUILD_PROFILE" -ForegroundColor Green
Write-Host "[OK] OTA channel locked to: $OTA_CHANNEL" -ForegroundColor Green

Write-Host "`nStep 1: Checking Windows long path support..." -ForegroundColor Yellow
try {
    $longPathsEnabled = Get-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name "LongPathsEnabled" -ErrorAction SilentlyContinue
    if ($longPathsEnabled.LongPathsEnabled -ne 1) {
        Write-Host "[WARN] Long path support not enabled. This might cause build failures." -ForegroundColor DarkYellow
    } else {
        Write-Host "[OK] Long path support is already enabled" -ForegroundColor Green
    }
} catch {}

$PROJECT_ROOT = $DEST_DIR
$ANDROID_DIR = Join-Path $PROJECT_ROOT "android"

$env:NODE_BINARY = "C:\Program Files\nodejs\node.exe"
Write-Host "[OK] Node binary set to: $env:NODE_BINARY" -ForegroundColor Green

Write-Host "`nStep 2: Pre-Flight Environment Validation..." -ForegroundColor Yellow
Test-ToolVersion -ToolName "Node.js" -VersionCommand { node --version } -RequiredPattern "v(1[6-9]|2\d)\." -Description "Node.js 16.x or higher"
$javaCheck = Test-ToolVersion -ToolName "Java JDK" -VersionCommand { javac -version } -RequiredPattern "javac (11|17|21)\." -Description "JDK 11, 17, or 21"

Invoke-GradleDaemonCleanup -ProjectPath $PROJECT_ROOT

Write-Host "`nStep 2.1: Toolchain sanity (JDK + Android SDK)..." -ForegroundColor Yellow
$env:ANDROID_STL = "c++_shared"
$env:CMAKE_ANDROID_STL_TYPE = "c++_shared"

$localPropsPathEarly = "$ANDROID_DIR\local.properties"
$sdkDirEarly = $null
if (Test-Path $localPropsPathEarly) {
    $sdkLineEarly = Get-Content $localPropsPathEarly | Where-Object { $_ -match '^sdk\.dir=' } | Select-Object -First 1
    if ($sdkLineEarly) {
        $sdkDirEarly = $sdkLineEarly -replace 'ndk\.dir=.*', '' -replace '^sdk\.dir=', '' -replace '\\:', ':' -replace '\\ ', ' ' -replace '\\\\', '\'
    }
}

function Update-LocalPropertiesPaths {
    param([string]$Path, [string]$SdkDir)
    $lines = @()
    if (Test-Path $Path) { $lines = Get-Content $Path }
    $lines = $lines | Where-Object { $_ -notmatch '^sdk\.dir=' -and $_ -notmatch '^ndk\.dir=' }
    if ($SdkDir) { $lines += ("sdk.dir=" + ($SdkDir -replace '\\', '/')) }
    Set-Content -Path $Path -Value $lines
}

function Remove-NdkDirFromLocalProperties {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return }
    $lines = Get-Content $Path | Where-Object { $_ -notmatch '^ndk\.dir=' }
    Set-Content -Path $Path -Value $lines
}

function Get-ResolvedAndroidSdkDir {
    param([string]$LocalPropertiesPath, [string]$SdkFromLocalProperties)
    $candidates = @($env:ANDROID_SDK_ROOT, $env:ANDROID_HOME, $SdkFromLocalProperties, "$env:LOCALAPPDATA\Android\Sdk", "$env:USERPROFILE\AppData\Local\Android\Sdk") | Where-Object { $_ -and $_.Trim().Length -gt 0 }
    foreach ($cand in $candidates) { if (Test-Path $cand) { return $cand } }
    return $null
}

if ((!$env:ANDROID_HOME -or !$env:ANDROID_SDK_ROOT) -and $sdkDirEarly) {
    if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = $sdkDirEarly }
    if (-not $env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT = $sdkDirEarly }
    
    Test-AndroidEnvironment -SdkPath $sdkDirEarly
    Update-LocalPropertiesPaths -Path $localPropsPathEarly -SdkDir $sdkDirEarly
    Remove-NdkDirFromLocalProperties -Path $localPropsPathEarly
}

# --- CRITICAL NDK 26 LOCK ---
$preferredNdkVersion = "26.1.10909125"
$resolvedSdkDir = Get-ResolvedAndroidSdkDir -LocalPropertiesPath $localPropsPathEarly -SdkFromLocalProperties $sdkDirEarly

if ($resolvedSdkDir) {
    $ndkRoot = Join-Path $resolvedSdkDir "ndk"
    $ndkDir = Join-Path $ndkRoot $preferredNdkVersion

    if (-not (Test-Path $ndkDir)) {
        Write-Host "`n[ERROR] CRITICAL: React Native 0.81 strictly requires Android NDK $preferredNdkVersion" -ForegroundColor Red
        Write-Host "NDK 27 breaks C++ compilation and causes 'undefined symbol: operator new' errors." -ForegroundColor Red
        Write-Host "ACTION REQUIRED: Open Android Studio -> SDK Manager -> SDK Tools -> Check 'Show Package Details' -> Install NDK $preferredNdkVersion" -ForegroundColor Magenta
        exit 1
    }

    $env:ANDROID_NDK_HOME = $ndkDir
    $env:NDK_HOME = $ndkDir
    Write-Host "[OK] Enforcing NDK version: $preferredNdkVersion" -ForegroundColor Green
    
    if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = $resolvedSdkDir }
    if (-not $env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT = $resolvedSdkDir }
    Update-LocalPropertiesPaths -Path $localPropsPathEarly -SdkDir $resolvedSdkDir
    Remove-NdkDirFromLocalProperties -Path $localPropsPathEarly
}

$candidateJdks = @("$env:ProgramFiles\Android\Android Studio\jbr", "$env:ProgramFiles\Android\Android Studio\jre", "$env:ProgramFiles\Android\Android Studio\jre\jre")
$chosenJavaHome = $null
foreach ($j in $candidateJdks) { if ($j -and (Test-Path "$j\bin\java.exe")) { $chosenJavaHome = $j; break } }
if (-not $env:JAVA_HOME) { if ($chosenJavaHome) { $env:JAVA_HOME = $chosenJavaHome } }
if ($env:JAVA_HOME -and (Test-Path "$env:JAVA_HOME\bin")) { if ($env:Path -notlike "*$env:JAVA_HOME\bin*") { $env:Path = "$env:JAVA_HOME\bin;$env:Path" } }


Write-Host "`nStep 3: Cleaning build directories..." -ForegroundColor Yellow
Invoke-SmartCleanup -ProjectPath $PROJECT_ROOT
Write-Host "`nStep 4: Cleaning Gradle cache..." -ForegroundColor Yellow
Set-Location $ANDROID_DIR
if (Test-Path ".\gradlew.bat") {
    if ($FAST_MODE) {
        Write-Host "[INFO] FAST_MODE enabled: skipping gradlew clean for faster iteration" -ForegroundColor Gray
    } else {
        .\gradlew.bat clean
    }
}
Set-Location $PROJECT_ROOT

Write-Host "`nStep 5: Ensuring node_modules are up to date..." -ForegroundColor Yellow
$nodeModulesDir = Join-Path $PROJECT_ROOT "node_modules"
$lockFile = Join-Path $PROJECT_ROOT "package-lock.json"
$depsStampPath = Join-Path $BUILD_CACHE_DIR "deps.lock.sha256"
$didRunNpmInstall = $false

if (-not (Test-Path $nodeModulesDir)) {
    Write-Host "[INFO] node_modules not found, running full install..." -ForegroundColor Gray
    npm install --prefer-offline --no-audit --no-fund
    $didRunNpmInstall = $true
} elseif ($FAST_MODE) {
    $currentLockHash = Get-FileSha256 -Path $lockFile
    $previousLockHash = $null
    if (Test-Path $depsStampPath) {
        $previousLockHash = (Get-Content -Path $depsStampPath -Raw).Trim()
    }

    if ($currentLockHash -and $previousLockHash -and $currentLockHash -eq $previousLockHash) {
        Write-Host "[INFO] FAST_MODE: lockfile unchanged, skipping npm install" -ForegroundColor Gray
    } else {
        Write-Host "[INFO] FAST_MODE: lockfile changed or stamp missing, running npm install" -ForegroundColor Gray
        npm install --prefer-offline --no-audit --no-fund
        $didRunNpmInstall = $true
    }
} else {
    npm install --prefer-offline --no-audit --no-fund
    $didRunNpmInstall = $true
}

if ($didRunNpmInstall -and $LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] npm install failed" -ForegroundColor Red
    exit $LASTEXITCODE
}

if ($didRunNpmInstall) {
    $installedLockHash = Get-FileSha256 -Path $lockFile
    if ($installedLockHash) { Set-Content -Path $depsStampPath -Value $installedLockHash }
}

Write-Host "`nStep 6: Regenerating native Android project (Prebuild)..." -ForegroundColor Yellow
$env:CI = "1"
$prebuildStampPath = Join-Path $BUILD_CACHE_DIR "expo-prebuild.sha256"
$prebuildInputs = @(
    (Join-Path $PROJECT_ROOT "app.json"),
    (Join-Path $PROJECT_ROOT "package.json"),
    (Join-Path $PROJECT_ROOT "package-lock.json"),
    (Join-Path $PROJECT_ROOT "eas.json"),
    (Join-Path $PROJECT_ROOT "babel.config.js"),
    (Join-Path $PROJECT_ROOT "metro.config.js")
)
$currentPrebuildHash = Get-CombinedHash -Paths $prebuildInputs
$previousPrebuildHash = $null
if (Test-Path $prebuildStampPath) {
    $previousPrebuildHash = (Get-Content -Path $prebuildStampPath -Raw).Trim()
}

$shouldRunPrebuild = $true
if ($FAST_MODE -and -not $FORCE_CLEAN_PREBUILD -and (Test-Path $ANDROID_DIR) -and $currentPrebuildHash -and $previousPrebuildHash -and $currentPrebuildHash -eq $previousPrebuildHash) {
    $shouldRunPrebuild = $false
    Write-Host "[INFO] FAST_MODE: native inputs unchanged, skipping expo prebuild" -ForegroundColor Gray
}

if ($shouldRunPrebuild) {
    $prebuildArgs = @("expo", "prebuild", "--platform", "android")
    if ($FORCE_CLEAN_PREBUILD) { $prebuildArgs += "--clean" }
    if ($FAST_MODE -and -not $FORCE_CLEAN_PREBUILD) {
        Write-Host "[INFO] FAST_MODE enabled: prebuild without --clean" -ForegroundColor Gray
    }

    npx @prebuildArgs
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERROR] npx expo prebuild failed" -ForegroundColor Red
        exit $LASTEXITCODE
    }

    if ($currentPrebuildHash) {
        Set-Content -Path $prebuildStampPath -Value $currentPrebuildHash
    }
}

# ============================================
# Step 6.1: Post-Prebuild Gradle / Signing / CMake STL fixes
# CRITICAL: expo prebuild --clean wipes android/ entirely, so ALL patches must be re-applied here
# Ported from proven working build-android.ps1
# ============================================
Write-Host "`nStep 6.1: Applying post-prebuild Gradle / Signing / CMake STL fixes..." -ForegroundColor Yellow

# --- Re-apply local.properties after prebuild wiped android/ ---
$localPropsPost = Join-Path $ANDROID_DIR "local.properties"
if ($resolvedSdkDir) {
    Update-LocalPropertiesPaths -Path $localPropsPost -SdkDir $resolvedSdkDir
    Remove-NdkDirFromLocalProperties -Path $localPropsPost
    Write-Host "[OK] Re-applied local.properties (sdk.dir) post-prebuild" -ForegroundColor Green
}

# --- Fix kotlinVersion in gradle.properties ---
$gradleProps = Join-Path $ANDROID_DIR "gradle.properties"
if (Test-Path $gradleProps) {
    $propsContent = Get-Content $gradleProps -Raw
    $kVersion = "2.0.21"
    if ($propsContent -match 'android\.kotlinVersion=([^\r\n]+)') { $kVersion = $matches[1].Trim() }
    if ($propsContent -notmatch '(?m)^kotlinVersion=') { Add-Content -Path $gradleProps -Value "`nkotlinVersion=$kVersion" }
}

# --- Re-enforce NDK env vars post-prebuild ---
if ($resolvedSdkDir) {
    $ndkDirPost = Join-Path (Join-Path $resolvedSdkDir "ndk") $preferredNdkVersion
    if (Test-Path $ndkDirPost) {
        $env:ANDROID_NDK_HOME = $ndkDirPost
        $env:NDK_HOME = $ndkDirPost
        $env:ANDROID_NDK = $ndkDirPost
        Write-Host "[OK] NDK env vars set to $preferredNdkVersion" -ForegroundColor Green
    }
}

$rootBuildGradle = Join-Path $ANDROID_DIR "build.gradle"
$appBuildGradle = Join-Path $ANDROID_DIR "app\build.gradle"

# ============================================
# C++ STL / CMake linking fix functions (from working build-android.ps1)
# These fix the "undefined symbol: operator new/delete/__cxa_throw" errors
# ============================================

function Ensure-LineInFile {
    param([string]$Path, [string]$MatchRegex, [string]$LineToSet)
    if (-not (Test-Path $Path)) { return }
    $content = Get-Content -Path $Path
    $matched = $false
    $newContent = @()
    foreach ($line in $content) {
        if ($line -match $MatchRegex) { $newContent += $LineToSet; $matched = $true }
        else { $newContent += $line }
    }
    if (-not $matched) { $newContent += $LineToSet }
    Set-Content -Path $Path -Value $newContent
}

function Ensure-GradleMemorySettings {
    param([string]$GradlePropsPath)
    if (-not (Test-Path $GradlePropsPath)) { return }

    $logicalCores = [Environment]::ProcessorCount
    $totalRamGb = 16
    try {
        $totalRamGb = [math]::Round(((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB), 1)
    } catch {
        Write-Host "[WARN] Could not read total RAM. Falling back to safe defaults." -ForegroundColor DarkYellow
    }

    $heapMb = [int][math]::Floor([math]::Min(12288, [math]::Max(6144, $totalRamGb * 1024 * 0.5)))
    $metaMb = [int][math]::Floor([math]::Min(1536, [math]::Max(768, $heapMb * 0.125)))
    $kotlinMb = [int][math]::Floor([math]::Min(4096, [math]::Max(2048, $heapMb * 0.3)))

    $workersByCore = [math]::Max(2, $logicalCores - 2)
    $workersByRam = [math]::Max(2, [int][math]::Floor($totalRamGb / 4))
    $maxWorkers = [math]::Min(8, [math]::Min($workersByCore, $workersByRam))

    $parallelEnabled = if ($maxWorkers -ge 4) { "true" } else { "false" }
    $script:GradleMaxWorkers = $maxWorkers
    $script:GradleHeapMb = $heapMb

    Ensure-LineInFile -Path $GradlePropsPath -MatchRegex '^org\.gradle\.jvmargs=' -LineToSet "org.gradle.jvmargs=-Xmx${heapMb}m -XX:MaxMetaspaceSize=${metaMb}m -Dfile.encoding=UTF-8 -XX:+HeapDumpOnOutOfMemoryError"
    Ensure-LineInFile -Path $GradlePropsPath -MatchRegex '^kotlin\.daemon\.jvm\.options=' -LineToSet "kotlin.daemon.jvm.options=-Xmx${kotlinMb}m"
    Ensure-LineInFile -Path $GradlePropsPath -MatchRegex '^org\.gradle\.workers\.max=' -LineToSet "org.gradle.workers.max=$maxWorkers"
    Ensure-LineInFile -Path $GradlePropsPath -MatchRegex '^org\.gradle\.parallel=' -LineToSet "org.gradle.parallel=$parallelEnabled"

    Write-Host "[OK] Auto-tuned build profile: RAM=${totalRamGb}GB, cores=${logicalCores}, heap=${heapMb}MB, workers=${maxWorkers}, parallel=${parallelEnabled}" -ForegroundColor Green
}

function Ensure-BlockAfterLine {
    param([string]$Path, [string]$AnchorRegex, [string]$BlockText, [string]$BlockMarker)
    if (-not (Test-Path $Path)) { return }
    $raw = Get-Content -Path $Path -Raw
    if ($raw -match [regex]::Escape($BlockMarker)) { return }
    $lines = Get-Content -Path $Path
    $output = @()
    foreach ($line in $lines) {
        $output += $line
        if ($line -match $AnchorRegex) { $output += $BlockText }
    }
    Set-Content -Path $Path -Value $output
}

function Ensure-AppCmakeArguments {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return }
    $raw = Get-Content -Path $Path -Raw
    if ($raw -match 'BEGIN app-cmake-libcxx-fix') { return }
    $block = @(
        '        // BEGIN app-cmake-libcxx-fix',
        '        externalNativeBuild {',
        '            cmake {',
        '                arguments "-DANDROID_STL=c++_shared",',
        '                          "-DCMAKE_ANDROID_STL_TYPE=c++_shared",',
        '                          "-DCMAKE_SHARED_LINKER_FLAGS=-lc++_shared",',
        '                          "-DCMAKE_EXE_LINKER_FLAGS=-lc++_shared",',
        '                          "-DANDROID_LD=lld"',
        '            }',
        '        }',
        '        // END app-cmake-libcxx-fix'
    )
    $lines = Get-Content -Path $Path
    $output = @()
    foreach ($line in $lines) {
        $output += $line
        if ($line -match 'buildConfigField\s+"String"\s*,\s*"REACT_NATIVE_RELEASE_LEVEL"') {
            $output += $block
        }
    }
    Set-Content -Path $Path -Value $output
}

function Ensure-CMakeLibCppShared {
    param([string]$Path, [string]$TargetName)
    if (-not (Test-Path $Path)) { return }
    $raw = Get-Content -Path $Path -Raw
    $raw = $raw -replace '`cmake_minimum_required', 'cmake_minimum_required'

    if ($raw -notmatch 'find_library\(CPP_SHARED_LIB c\+\+_shared\)') {
        if ($raw -match 'find_library\([^\n]*log[^\n]*\)') {
             $raw = $raw -replace '(find_library\([^\n]*log[^\n]*\)\s*)', "`$1`nfind_library(CPP_SHARED_LIB c++_shared)`n`nif(NOT CPP_SHARED_LIB)`n  set(CPP_SHARED_LIB c++_shared)`nendif()`n"
        } else {
             $raw = [regex]::Replace($raw, '(cmake_minimum_required\([^\)]*\)\s*)', { $args[0].Groups[1].Value + "`nfind_library(CPP_SHARED_LIB c++_shared)`n`nif(NOT CPP_SHARED_LIB)`n  set(CPP_SHARED_LIB c++_shared)`nendif()`n" })
        }
    }

    $escapedTarget = [regex]::Escape($TargetName)
    $definesLink = $raw -match "target_link_libraries\s*\(\s*[^\)]*${escapedTarget}[^\)]*(\`$\{CPP_SHARED_LIB\}|c\+\+_shared)"
    if (-not $definesLink) {
        $raw += "`n`ntarget_link_libraries(${TargetName} `${CPP_SHARED_LIB})`n"
    }
    Set-Content -Path $Path -Value $raw
}

# --- Apply global CMake c++_shared STL flags (CRITICAL: fixes undefined symbol errors) ---

# 1. gradle.properties: CMake arguments
Ensure-LineInFile -Path $gradleProps -MatchRegex '^android\.cmake\.arguments=' -LineToSet 'android.cmake.arguments=-DANDROID_STL=c++_shared -DCMAKE_ANDROID_STL_TYPE=c++_shared -DCMAKE_SHARED_LINKER_FLAGS=-lc++_shared -DCMAKE_EXE_LINKER_FLAGS=-lc++_shared'
Ensure-GradleMemorySettings -GradlePropsPath $gradleProps

# Reinforce memory defaults in the current shell to avoid daemon/client mismatch.
$env:GRADLE_OPTS = "-Xmx$($script:GradleHeapMb)m -XX:MaxMetaspaceSize=1024m -Dfile.encoding=UTF-8"
$env:JAVA_TOOL_OPTIONS = "-Xmx$($script:GradleHeapMb)m -XX:MaxMetaspaceSize=1024m -Dfile.encoding=UTF-8"
Write-Host "[OK] Gradle/JVM memory limits applied for current shell" -ForegroundColor Green

# 2. root build.gradle: subproject CMake args for ALL native modules
$cmakeBlock = @(
    '// BEGIN libcxx-shared-fix',
    'def configureAndroidCmake = { Project project ->',
    '  project.android.defaultConfig {',
    '    externalNativeBuild {',
    '      cmake {',
    '        arguments "-DANDROID_STL=c++_shared",',
    '                  "-DCMAKE_ANDROID_STL_TYPE=c++_shared",',
    '                  "-DCMAKE_SHARED_LINKER_FLAGS=-lc++_shared",',
    '                  "-DCMAKE_EXE_LINKER_FLAGS=-lc++_shared"',
    '      }',
    '    }',
    '  }',
    '}',
    'subprojects { project ->',
    '  project.plugins.withId("com.android.application") {',
    '    configureAndroidCmake(project)',
    '  }',
    '  project.plugins.withId("com.android.library") {',
    '    configureAndroidCmake(project)',
    '  }',
    '}',
    '// END libcxx-shared-fix'
)
Ensure-BlockAfterLine -Path $rootBuildGradle -AnchorRegex 'apply plugin: "com.facebook.react.rootproject"' -BlockText $cmakeBlock -BlockMarker '// BEGIN libcxx-shared-fix'

# 3. app/build.gradle: CMake arguments in defaultConfig
Ensure-AppCmakeArguments -Path $appBuildGradle

# 4. AUTO-DISCOVER and patch ALL native module CMakeLists.txt files to link c++_shared
# This future-proofs against adding new native packages that use CMake
$knownTargets = @{
    'expo-modules-core'           = '${PACKAGE_NAME}'
    'react-native-screens'        = 'rnscreens'
    'react-native-worklets'       = 'worklets'
    'react-native-reanimated'     = 'reanimated'
}
$cmakePatchCount = 0

$cmakePatchStampPath = Join-Path $BUILD_CACHE_DIR "cmake-patch.sha256"
$cmakePatchKey = Get-FileSha256 -Path $lockFile
$skipCmakeScan = $false
if ($FAST_MODE -and $cmakePatchKey -and (Test-Path $cmakePatchStampPath)) {
    $previousCmakePatchKey = (Get-Content -Path $cmakePatchStampPath -Raw).Trim()
    if ($previousCmakePatchKey -eq $cmakePatchKey) {
        $skipCmakeScan = $true
    }
}

# Scan node_modules for all CMakeLists.txt under android/ directories
$cmakeFiles = @()
if ($skipCmakeScan) {
    Write-Host "[INFO] FAST_MODE: node_modules unchanged, skipping CMake scan" -ForegroundColor Gray
} else {
    $cmakeFiles = Get-ChildItem -Path (Join-Path $PROJECT_ROOT "node_modules") -Filter "CMakeLists.txt" -Recurse -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match 'android' -and $_.FullName -notmatch '\.cxx' -and $_.FullName -notmatch 'build\\' }

    foreach ($cmakeFile in $cmakeFiles) {
        $raw = Get-Content -Path $cmakeFile.FullName -Raw -ErrorAction SilentlyContinue
        if (-not $raw) { continue }
        # Only patch files that have target_link_libraries (actual native build files)
        if ($raw -notmatch 'target_link_libraries') { continue }

        # Determine target name from known map or extract from add_library
        $moduleName = ($cmakeFile.FullName -replace '.*node_modules\\', '' -replace '\\android.*', '')
        $targetName = $null
        if ($knownTargets.ContainsKey($moduleName)) {
            $targetName = $knownTargets[$moduleName]
        } elseif ($raw -match 'add_library\(\s*([\w${}]+)') {
            $targetName = $matches[1]
        }
        if (-not $targetName) { continue }

        Ensure-CMakeLibCppShared -Path $cmakeFile.FullName -TargetName $targetName
        $cmakePatchCount++
    }

    if ($cmakePatchKey) {
        Set-Content -Path $cmakePatchStampPath -Value $cmakePatchKey
    }
}

Write-Host "[OK] Patched $cmakePatchCount CMakeLists.txt files with c++_shared linking" -ForegroundColor Green

# --- INJECT RELEASE SIGNING FIX ---
function Invoke-ReleaseSigningFix {
    param([string]$ProjectRoot)
    $gradlePath = Join-Path $ProjectRoot "android\app\build.gradle"
    if (-not (Test-Path $gradlePath)) { return }
    
    $raw = Get-Content -Path $gradlePath -Raw

    if ($raw -notmatch 'signingConfigs\s*\{\s*(debug\s*\{[^}]+\}\s*)release\s*\{') {
        $replacement = "signingConfigs {`n        debug {`n            storeFile file('debug.keystore')`n            storePassword 'android'`n            keyAlias 'androiddebugkey'`n            keyPassword 'android'`n        }`n        release {`n            storeFile file('../../release.keystore')`n            storePassword '$KEYSTORE_PASS'`n            keyAlias '$KEY_ALIAS'`n            keyPassword '$KEYSTORE_PASS'`n        }"
        $raw = $raw -replace 'signingConfigs\s*\{\s*debug\s*\{([^{}]|\{[^{}]*\})*\}\s*', $replacement
    }

    $raw = $raw -replace 'signingConfig signingConfigs\.debug', 'signingConfig signingConfigs.release'

    Set-Content -Path $gradlePath -Value $raw
    Write-Host "[OK] Applied release signing config to app/build.gradle" -ForegroundColor Green
}
Invoke-ReleaseSigningFix -ProjectRoot $PROJECT_ROOT

# Apply existing patches for expo-barcode-scanner and RN background actions 
$interfaceRoot = Join-Path $PROJECT_ROOT "node_modules\expo-barcode-scanner-interface"
if (Test-Path $interfaceRoot) {
    $manifestPath = Join-Path $interfaceRoot "android\src\main\AndroidManifest.xml"
    if (Test-Path $manifestPath) {
        $manifestRaw = Get-Content -Path $manifestPath -Raw
        $manifestUpdated = $manifestRaw -replace '\s*package="expo\.interfaces\.barcodescanner"', ''
        Set-Content -Path $manifestPath -Value $manifestUpdated
    }
}
$bgActionsTask = Join-Path $PROJECT_ROOT "node_modules\react-native-background-actions\android\src\main\java\com\asterinet\react\bgactions\RNBackgroundActionsTask.java"
if (Test-Path $bgActionsTask) {
    $rawBg = Get-Content -Path $bgActionsTask -Raw
    $modified = $false

    # Patch 1: Remove DATA_SYNC flag if present (older library versions)
    if ($rawBg -match 'FOREGROUND_SERVICE_TYPE_DATA_SYNC') {
        $rawBg = $rawBg -replace 'ServiceInfo\.FOREGROUND_SERVICE_TYPE_DATA_SYNC \| ServiceInfo\.FOREGROUND_SERVICE_TYPE_LOCATION', 'ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION'
        $modified = $true
        Write-Host "[OK] Removed FOREGROUND_SERVICE_TYPE_DATA_SYNC from RNBackgroundActionsTask" -ForegroundColor Green
    }

    # Patch 2: Make service sticky so Android restarts it after kill
    if ($rawBg -match 'return super\.onStartCommand\(intent, flags, startId\);') {
        $rawBg = $rawBg -replace 'return super\.onStartCommand\(intent, flags, startId\);', 'return START_STICKY;'
        $modified = $true
        Write-Host "[OK] Applied START_STICKY patch to RNBackgroundActionsTask" -ForegroundColor Green
    } else {
        Write-Host "[WARN] RNBackgroundActionsTask.java: onStartCommand pattern not found (library may have changed)" -ForegroundColor DarkYellow
    }

    if ($modified) { Set-Content -Path $bgActionsTask -Value $rawBg }
}

# Apply patch for react-native-worklets Release C++ linker error (RN 0.81 Compatibility)
$workletsCMakePatch = Join-Path $PROJECT_ROOT "node_modules\react-native-worklets\android\CMakeLists.txt"
if (Test-Path $workletsCMakePatch) {
    $rawWorklets = Get-Content -Path $workletsCMakePatch -Raw
    
    # FIX 1: Safely add exceptions and RTTI (WITHOUT c++_static)
    if ($rawWorklets -notmatch 'target_compile_options\(worklets PRIVATE -fexceptions -frtti\)') {
        $searchStr = 'target_compile_reactnative_options(worklets PUBLIC)'
        $replaceStr = "target_compile_reactnative_options(worklets PUBLIC)`n  target_compile_options(worklets PRIVATE -fexceptions -frtti)"
        $rawWorklets = $rawWorklets -replace [regex]::Escape($searchStr), $replaceStr
        Write-Host "[OK] Applied -fexceptions and -frtti to react-native-worklets" -ForegroundColor Green
    }

    # FIX 2: Patch the deprecated RN 0.81 CMake target
    if ($rawWorklets -match 'ReactAndroid::jscexecutor') {
        $rawWorklets = $rawWorklets -replace 'ReactAndroid::jscexecutor', 'ReactAndroid::jsctooling'
        Write-Host "[OK] Patched jscexecutor to jsctooling for RN 0.81 linking" -ForegroundColor Green
    }

    Set-Content -Path $workletsCMakePatch -Value $rawWorklets
}

# Apply patch for react-native-screens CMake target_link_libraries error (RN 0.81 Compatibility)
# Bug: Last line uses bare 'rnscreens' instead of ${LIB_TARGET_NAME} (react_codegen_rnscreens)
$screensCMake = Join-Path $PROJECT_ROOT "node_modules\react-native-screens\android\src\main\jni\CMakeLists.txt"
if (Test-Path $screensCMake) {
    $rawScreens = Get-Content -Path $screensCMake -Raw
    if ($rawScreens -match 'target_link_libraries\(rnscreens') {
        $rawScreens = $rawScreens -replace 'target_link_libraries\(rnscreens', 'target_link_libraries(${LIB_TARGET_NAME}'
        Set-Content -Path $screensCMake -Value $rawScreens
        Write-Host "[OK] Patched react-native-screens CMake: rnscreens -> LIB_TARGET_NAME" -ForegroundColor Green
    } else {
        Write-Host "[OK] react-native-screens CMake already patched or pattern changed" -ForegroundColor Green
    }
}
# ============================================
# Step 6.2: Verify all critical patches were applied (FAIL-FAST)
# ============================================
Write-Host "`nStep 6.2: Verifying build patches..." -ForegroundColor Yellow

function Test-FileContains {
    param([string]$Path, [string]$Pattern, [string]$Label)
    if (-not (Test-Path $Path)) {
        Write-Host "[SKIP] $Label (file not found)" -ForegroundColor DarkGray
        return $true  # non-critical if file doesn't exist
    }
    $raw = Get-Content -Path $Path -Raw
    if ($raw -match $Pattern) {
        Write-Host "[OK] $Label" -ForegroundColor Green
        return $true
    } else {
        Write-Host "[FAIL] $Label" -ForegroundColor Red
        return $false
    }
}

$allChecksPass = $true
$allChecksPass = (Test-FileContains -Path $gradleProps -Pattern 'android\.cmake\.arguments=.*ANDROID_STL=c\+\+_shared' -Label 'gradle.properties: CMake STL args') -and $allChecksPass
$allChecksPass = (Test-FileContains -Path $rootBuildGradle -Pattern 'BEGIN libcxx-shared-fix' -Label 'root build.gradle: libcxx-shared-fix block') -and $allChecksPass
$allChecksPass = (Test-FileContains -Path $appBuildGradle -Pattern 'signingConfig signingConfigs\.release' -Label 'app build.gradle: release signing') -and $allChecksPass

$expoCmakeCheck = Join-Path $PROJECT_ROOT "node_modules\expo-modules-core\android\CMakeLists.txt"
$allChecksPass = (Test-FileContains -Path $expoCmakeCheck -Pattern 'c\+\+_shared' -Label 'expo-modules-core: c++_shared linked') -and $allChecksPass

$screensCmakeCheck = Join-Path $PROJECT_ROOT "node_modules\react-native-screens\android\CMakeLists.txt"
$allChecksPass = (Test-FileContains -Path $screensCmakeCheck -Pattern 'c\+\+_shared' -Label 'react-native-screens: c++_shared linked') -and $allChecksPass

$androidManifestPath = Join-Path $ANDROID_DIR "app\src\main\AndroidManifest.xml"
$allChecksPass = (Test-FileContains -Path $androidManifestPath -Pattern 'expo\.modules\.updates\.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY' -Label 'AndroidManifest: updates request headers meta-data') -and $allChecksPass
$allChecksPass = (Test-FileContains -Path $androidManifestPath -Pattern "expo-channel-name.*$([regex]::Escape($OTA_CHANNEL))" -Label "AndroidManifest: OTA channel is '$OTA_CHANNEL'") -and $allChecksPass

if (-not $allChecksPass) {
    Write-Host "`n[ERROR] Critical build patches are missing. Build will likely fail." -ForegroundColor Red
    Write-Host "This may indicate a new Expo SDK version changed the file structure." -ForegroundColor Yellow
    Write-Host "Compare with the working build-android.ps1 for reference." -ForegroundColor Yellow
    exit 1
}

Write-Host "[OK] All critical patches verified" -ForegroundColor Green

Write-Host "`nStep 7: Running pre-build checks..." -ForegroundColor Yellow
if ($env:ANDROID_HOME) { Write-Host "[OK] ANDROID_HOME: $env:ANDROID_HOME" -ForegroundColor Green }
if ($env:ANDROID_NDK_HOME) { Write-Host "[OK] ANDROID_NDK_HOME: $env:ANDROID_NDK_HOME" -ForegroundColor Green }
Write-Host "`nJava version:" -ForegroundColor Gray
& java -version 2>&1 | ForEach-Object { Write-Host $_ }


Write-Host "`n====================================" -ForegroundColor Cyan
Write-Host "Starting Android PRODUCTION Build..." -ForegroundColor Cyan
Write-Host "====================================" -ForegroundColor Cyan
Write-Host ""

Set-Location $ANDROID_DIR

Write-Host "`nBuilding APK..." -ForegroundColor Yellow
$gradleBuildArgs = @(
    "assembleRelease",
    "--stacktrace",
    "--max-workers=$($script:GradleMaxWorkers)",
    "--build-cache",
    "-x", "lintVitalReportRelease",
    "-x", "lintVitalRelease"
)
if (-not $FAST_MODE) {
    $gradleBuildArgs += "--no-daemon"
}
Write-Host "[INFO] Gradle args: $($gradleBuildArgs -join ' ')" -ForegroundColor Gray
.\gradlew @gradleBuildArgs
$overallExit = $LASTEXITCODE

Set-Location $PROJECT_ROOT

Write-Host "`n====================================" -ForegroundColor Cyan
Write-Host "Build process completed!" -ForegroundColor Cyan
Write-Host "====================================" -ForegroundColor Cyan

if ($overallExit -eq 0) {
    Write-Host "`n[OK] Release Build succeeded!" -ForegroundColor Green

    # Save last-good build config for future debugging
    $lastGoodPath = Join-Path $PROJECT_ROOT "build-last-good.json"
    try {
        [ordered]@{
            timestamp      = (Get-Date).ToString("o")
            ndkVersion     = $preferredNdkVersion
            androidHome    = $env:ANDROID_HOME
            ndkHome        = $env:ANDROID_NDK_HOME
            javaHome       = $env:JAVA_HOME
            nodeBinary     = $env:NODE_BINARY
            androidStl     = $env:ANDROID_STL
        } | ConvertTo-Json -Depth 3 | Set-Content -Path $lastGoodPath -Encoding UTF8
        Write-Host "[OK] Saved last-good config to $lastGoodPath" -ForegroundColor Green
    } catch {
        Write-Host "[WARN] Could not save last-good config" -ForegroundColor DarkYellow
    }

    # Display APKs
    $apkSearchPaths = @("$ANDROID_DIR\app\build\outputs\apk\release\*.apk")
    $foundApks = @()
    foreach ($pattern in $apkSearchPaths) {
        $apks = Get-ChildItem -Path $pattern -ErrorAction SilentlyContinue
        if ($apks) {
            foreach ($apk in $apks) {
                if ($apk.Name -eq "production.apk") {
                    $foundApks += $apk
                    continue
                }
                
                $newName = "production.apk"
                try {
                    $renamedApk = Rename-Item -Path $apk.FullName -NewName $newName -PassThru -Force
                    $foundApks += $renamedApk
                } catch {
                    Write-Host "[WARN] Failed to rename $($apk.Name) to $newName" -ForegroundColor DarkYellow
                    $foundApks += $apk
                }
            }
        }
    }

    if ($foundApks.Count -gt 0) {
        $CENTRAL_APK_DIR = "C:\Dev\TopBox\mobile\APK"
        if (-not (Test-Path $CENTRAL_APK_DIR)) {
            New-Item -ItemType Directory -Path $CENTRAL_APK_DIR -Force | Out-Null
        }
        Write-Host "`nGenerated Release Artifacts (Saved to $CENTRAL_APK_DIR):" -ForegroundColor Green
        foreach ($apk in $foundApks) {
            $centralPath = Join-Path $CENTRAL_APK_DIR $apk.Name
            Copy-Item -Path $apk.FullName -Destination $centralPath -Force -ErrorAction SilentlyContinue
            
            $sizeInMB = [math]::Round($apk.Length / 1MB, 2)
            Write-Host "  - $($apk.Name) ($sizeInMB MB)" -ForegroundColor Gray
            Write-Host "    Original: $($apk.FullName)" -ForegroundColor DarkGray
        }
    }

    Write-Host "`n=================================================" -ForegroundColor Magenta
    Write-Host " Uploading APK to GitHub releases... 🚀" -ForegroundColor Magenta
    try {
        $repo = "LorenzoBela/Parcel-Safe-Mobile"
        
        # Load build secrets from .env.build if it exists
        $envFile = Join-Path $SOURCE_DIR ".env.build"
        if (Test-Path $envFile) {
            Get-Content $envFile | Where-Object { $_ -match "^[^#]*=" } | ForEach-Object {
                $name, $value = $_.Split('=', 2)
                Set-Item -Path "env:\$name" -Value $value.Trim()
            }
        }

        $token = $env:GITHUB_TOKEN
        if ([string]::IsNullOrWhiteSpace($token)) {
            Write-Host "`n[ERROR] GitHub Token (GITHUB_TOKEN) is not provided." -ForegroundColor Red
            Write-Host "Please create a '.env.build' file in the mobile directory with GITHUB_TOKEN=your_token" -ForegroundColor Yellow
            exit 1
        }

        $apkFileName = "Parcel Safe.apk"
        $productionApk = Join-Path $CENTRAL_APK_DIR "production.apk"
        $apkToUpload = Join-Path $CENTRAL_APK_DIR $apkFileName

        if (Test-Path $productionApk) {
            Write-Host "Copying production.apk to '$apkFileName' locally..." -ForegroundColor Gray
            Copy-Item -Path $productionApk -Destination $apkToUpload -Force
        }

        if (Test-Path $apkToUpload) {
            # 1. Get the latest commit SHA from 'master'
            Write-Host "Fetching latest commit..." -ForegroundColor Gray
            $commitResponse = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/commits/master" -Headers @{ "Authorization" = "Bearer $token" }
            $sha = $commitResponse.sha

            # 2. Update the 'latest' tag
            Write-Host "Updating 'latest' tag..." -ForegroundColor Gray
            $tagBody = @{ ref = "refs/tags/latest"; sha = $sha } | ConvertTo-Json
            try {
                Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/git/refs" -Method Post -Headers @{ "Authorization" = "Bearer $token" } -Body $tagBody | Out-Null
            } catch {
                Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/git/refs/tags/latest" -Method Patch -Headers @{ "Authorization" = "Bearer $token" } -Body (@{ sha = $sha; force = $true } | ConvertTo-Json) | Out-Null
            }

            # 3. Create or Fetch Release
            Write-Host "Configuring GitHub Release..." -ForegroundColor Gray
            $releaseBody = @{
                tag_name = "latest"
                target_commitish = "master"
                name = "Latest App Release"
                body = "Automated upload of the latest Android production build."
                draft = $false
                prerelease = $false
            } | ConvertTo-Json

            try {
                $response = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases" -Method Post -Headers @{ "Authorization" = "Bearer $token"; "Accept" = "application/vnd.github.v3+json" } -Body $releaseBody
                $releaseId = $response.id
            } catch {
                $releases = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/tags/latest" -Headers @{ "Authorization" = "Bearer $token"; "Accept" = "application/vnd.github.v3+json" }
                $releaseId = $releases.id
            }

            if ($releaseId) {
                # Delete old asset
                $assets = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/$releaseId/assets" -Headers @{ "Authorization" = "Bearer $token" }
                # GitHub automatically replaces spaces with dots in asset names, so we check both
                $expectedAssetName = $apkFileName -replace ' ', '.'
                $existingAsset = $assets | Where-Object { $_.name -eq $apkFileName -or $_.name -eq $expectedAssetName }
                if ($existingAsset) {
                    Write-Host "Removing previous APK..." -ForegroundColor Gray
                    Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/assets/$($existingAsset.id)" -Method Delete -Headers @{ "Authorization" = "Bearer $token" }
                }

                # Upload new asset
                Write-Host "Uploading new APK..." -ForegroundColor Gray
                $fileNameUrl = [uri]::EscapeDataString($apkFileName)
                Invoke-RestMethod -Uri "https://uploads.github.com/repos/$repo/releases/$releaseId/assets?name=$fileNameUrl" -Method Post -Headers @{ "Authorization" = "Bearer $token"; "Content-Type" = "application/vnd.android.package-archive" } -InFile $apkToUpload
                Write-Host "`n[OK] Successfully uploaded APK to GitHub Releases!" -ForegroundColor Green
            } else {
                Write-Host "`n[ERROR] Failed to determine GitHub Release ID." -ForegroundColor Red
            }
        } else {
            Write-Host "[WARN] Could not find production.apk for upload." -ForegroundColor DarkYellow
        }

    } catch {
        Write-Host "[WARN] Failed to upload APK to GitHub. You can upload it manually." -ForegroundColor DarkYellow
        Write-Host $_.Exception.Message -ForegroundColor Gray
    }

    Write-Host "`n=================================================" -ForegroundColor Magenta
    Write-Host "�🔥 IMPORTANT: Firebase and Google Sign-In Setup 🔥" -ForegroundColor Magenta
    Write-Host "=================================================" -ForegroundColor Magenta
    Write-Host "To ensure Google Sign-In works in your production app, you MUST add these" -ForegroundColor White
    Write-Host "SHA-1 and SHA-256 fingerprints to both:" -ForegroundColor White
    Write-Host "  1. Firebase Console -> Project Settings -> Your Android App" -ForegroundColor White
    Write-Host "  2. Google Cloud Console -> Credentials -> Android OAuth Client" -ForegroundColor White
    Write-Host ""
    
    # Extract keys
    $keytoolOutput = & keytool -list -v -keystore (Join-Path $SOURCE_DIR "release.keystore") -alias $KEY_ALIAS -storepass $KEYSTORE_PASS 
    $keytoolOutput | Select-String -Pattern "SHA1:|SHA256:" | ForEach-Object { Write-Host "  $($_)" -ForegroundColor Yellow }
    
    Write-Host "`n(If you update these in Firebase, don't forget to re-download google-services.json)" -ForegroundColor DarkGray
    Write-Host "=================================================" -ForegroundColor Magenta

} else {
    Write-Host "`n[ERROR] Production build failed with exit code $overallExit" -ForegroundColor Red
    exit $overallExit
}