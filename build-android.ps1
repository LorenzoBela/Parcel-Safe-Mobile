# Android Build Script for Parcel Safe App
# This script cleans and builds the Android app

Write-Host "====================================" -ForegroundColor Cyan
Write-Host "Parcel Safe Android Build Script" -ForegroundColor Cyan
Write-Host "====================================" -ForegroundColor Cyan
Write-Host ""

# Check and enable Windows long path support if needed
Write-Host "`nStep 0a: Checking Windows long path support..." -ForegroundColor Yellow
try {
    $longPathsEnabled = Get-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name "LongPathsEnabled" -ErrorAction SilentlyContinue
    if ($longPathsEnabled.LongPathsEnabled -ne 1) {
        Write-Host "[INFO] Attempting to enable long path support (requires admin)..." -ForegroundColor Yellow
        try {
            Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name "LongPathsEnabled" -Value 1 -ErrorAction Stop
            Write-Host "[OK] Long path support enabled. This will take effect for new processes." -ForegroundColor Green
        } catch {
            Write-Host "[WARN] Could not enable long path support (requires admin privileges)" -ForegroundColor DarkYellow
            Write-Host "[INFO] Please run this command as Administrator to enable:" -ForegroundColor DarkYellow
            Write-Host '      New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name "LongPathsEnabled" -Value 1 -PropertyType DWORD -Force' -ForegroundColor Gray
        }
    } else {
        Write-Host "[OK] Long path support is already enabled" -ForegroundColor Green
    }
} catch {
    Write-Host "[WARN] Could not check long path support status" -ForegroundColor DarkYellow
}

# Set project root (derived from script location so the repo can be moved/renamed safely)
$PROJECT_ROOT = $PSScriptRoot
$ANDROID_DIR = Join-Path $PROJECT_ROOT "android"

#region agent log
function Write-AgentLog {
    param(
        [string]$HypothesisId,
        [string]$Message,
        [hashtable]$Data
    )
    try {
        $payload = @{
            sessionId    = "debug-session"
            runId        = "pre-fix"
            hypothesisId = $HypothesisId
            location     = "build-android.ps1"
            message      = $Message
            data         = $Data
            timestamp    = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        } | ConvertTo-Json -Compress

        Add-Content -Path "C:\Users\Lorenzo Bela\Downloads\Thesis 24-25 Smart Top Box\.cursor\debug.log" -Value $payload
    } catch {
    }
}
#endregion

# Set Node binary path
$env:NODE_BINARY = "C:\Program Files\nodejs\node.exe"
Write-Host "[OK] Node binary set to: $env:NODE_BINARY" -ForegroundColor Green

#region agent log
Write-AgentLog -HypothesisId "H1" -Message "env snapshot" -Data @{
    ANDROID_HOME    = $env:ANDROID_HOME
    ANDROID_SDK_ROOT = $env:ANDROID_SDK_ROOT
    JAVA_HOME       = $env:JAVA_HOME
    NODE_BINARY     = $env:NODE_BINARY
}
#endregion

# Step 0: Toolchain sanity (JDK + Android SDK)
Write-Host "`nStep 0: Toolchain sanity..." -ForegroundColor Yellow

# Try to infer ANDROID_HOME/ANDROID_SDK_ROOT from android/local.properties if missing
$localPropsPathEarly = "$ANDROID_DIR\local.properties"
$sdkDirEarly = $null
if (Test-Path $localPropsPathEarly) {
    $sdkLineEarly = Get-Content $localPropsPathEarly | Where-Object { $_ -match '^sdk\.dir=' } | Select-Object -First 1
    if ($sdkLineEarly) {
        $sdkDirEarly = $sdkLineEarly -replace '^sdk\.dir=', ''
    }
}
if ((!$env:ANDROID_HOME -or !$env:ANDROID_SDK_ROOT) -and $sdkDirEarly) {
    if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = $sdkDirEarly }
    if (-not $env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT = $sdkDirEarly }
    Write-Host "[OK] Android SDK inferred from local.properties: $sdkDirEarly" -ForegroundColor Green
}

# Prefer Android Studio embedded JBR (Java 17) if JAVA_HOME is missing or points to Java 8
$candidateJdks = @(
    "$env:ProgramFiles\Android\Android Studio\jbr",
    "$env:ProgramFiles\Android\Android Studio\jre",
    "$env:ProgramFiles\Android\Android Studio\jre\jre"
)
$chosenJavaHome = $null
foreach ($j in $candidateJdks) {
    if ($j -and (Test-Path "$j\bin\java.exe")) { $chosenJavaHome = $j; break }
}
if (-not $env:JAVA_HOME) {
    if ($chosenJavaHome) {
        $env:JAVA_HOME = $chosenJavaHome
        Write-Host "[OK] JAVA_HOME set to Android Studio JBR: $env:JAVA_HOME" -ForegroundColor Green
    } else {
        Write-Host "[WARN] JAVA_HOME not set and Android Studio JBR not found; build may use system Java." -ForegroundColor DarkYellow
    }
}

# Ensure JAVA_HOME\bin is on PATH for this process
if ($env:JAVA_HOME -and (Test-Path "$env:JAVA_HOME\bin")) {
    if ($env:Path -notlike "*$env:JAVA_HOME\bin*") {
        $env:Path = "$env:JAVA_HOME\bin;$env:Path"
    }
}

#region agent log
Write-AgentLog -HypothesisId "H7" -Message "toolchain inferred" -Data @{
    inferredSdkDir     = $sdkDirEarly
    ANDROID_HOME       = $env:ANDROID_HOME
    ANDROID_SDK_ROOT   = $env:ANDROID_SDK_ROOT
    JAVA_HOME          = $env:JAVA_HOME
    chosenJavaHome     = $chosenJavaHome
}
#endregion

# Change to project directory
Set-Location $PROJECT_ROOT
Write-Host "[OK] Changed to project directory: $PROJECT_ROOT" -ForegroundColor Green

# Step 1: Clean build directories
Write-Host "`nStep 1: Cleaning build directories..." -ForegroundColor Yellow

$cleanupPaths = @(
    "$ANDROID_DIR\app\.cxx",
    "$ANDROID_DIR\app\build",
    "$ANDROID_DIR\build",
    "$PROJECT_ROOT\node_modules\expo-modules-core\android\.cxx",
    "$PROJECT_ROOT\node_modules\expo-modules-core\android\build"
)

foreach ($path in $cleanupPaths) {
    if (Test-Path $path) {
        Write-Host "  Removing: $path" -ForegroundColor Gray
        Remove-Item -Recurse -Force $path -ErrorAction SilentlyContinue
    }
}
Write-Host "[OK] Build directories cleaned" -ForegroundColor Green

# Step 2: Clean Gradle cache (optional but recommended)
Write-Host "`nStep 2: Cleaning Gradle cache..." -ForegroundColor Yellow
Set-Location $ANDROID_DIR
$gradleCleanExit = $null
if (Test-Path ".\gradlew.bat") {
    .\gradlew.bat clean
    $gradleCleanExit = $LASTEXITCODE
    Write-Host "[OK] Gradle clean completed" -ForegroundColor Green
} else {
    Write-Host "[WARN] gradlew.bat not found, skipping Gradle clean" -ForegroundColor DarkYellow
}
#region agent log
Write-AgentLog -HypothesisId "H3" -Message "gradle clean result" -Data @{
    gradlewPresent = (Test-Path ".\gradlew.bat")
    exitCode       = $gradleCleanExit
}
#endregion
Set-Location $PROJECT_ROOT

# Step 3: Ensure node_modules are fresh
Write-Host "`nStep 3: Checking node_modules..." -ForegroundColor Yellow
$nodeModulesExists = Test-Path "$PROJECT_ROOT\node_modules"
$npmInstallExit = $null
if (!$nodeModulesExists) {
    Write-Host "  Installing dependencies..." -ForegroundColor Gray
    npm install
    $npmInstallExit = $LASTEXITCODE
} else {
    Write-Host "[OK] node_modules exists" -ForegroundColor Green
}
#region agent log
Write-AgentLog -HypothesisId "H4" -Message "node modules check" -Data @{
    exists        = $nodeModulesExists
    installRan    = (-not $nodeModulesExists)
    npmExitCode   = $npmInstallExit
}
#endregion

# Step 4: Pre-build checks
Write-Host "`nStep 4: Running pre-build checks..." -ForegroundColor Yellow

# Check if Android SDK is available
if ($env:ANDROID_HOME) {
    Write-Host "[OK] ANDROID_HOME: $env:ANDROID_HOME" -ForegroundColor Green
} else {
    Write-Host "[WARN] ANDROID_HOME not set. Make sure Android SDK is configured." -ForegroundColor DarkYellow
}

#region agent log
$localPropsPath = "$ANDROID_DIR\local.properties"
$sdkDir = $null
if (Test-Path $localPropsPath) {
    $sdkLine = Get-Content $localPropsPath | Where-Object { $_ -match '^sdk\.dir=' } | Select-Object -First 1
    if ($sdkLine) {
        $sdkDir = $sdkLine -replace '^sdk\.dir=', ''
    }
}
Write-AgentLog -HypothesisId "H2" -Message "local.properties status" -Data @{
    exists = (Test-Path $localPropsPath)
    sdkDir = $sdkDir
}
if ($sdkDir) {
    Write-AgentLog -HypothesisId "H2" -Message "sdk directory check" -Data @{
        sdkDir     = $sdkDir
        sdkDirExists = (Test-Path $sdkDir)
    }
}
#endregion

# Check Java version
Write-Host "`nJava version:" -ForegroundColor Gray
$javaVersionOutput = & java -version 2>&1
$javaExitCode = $LASTEXITCODE
$javaVersionOutput | ForEach-Object { Write-Host $_ }
#region agent log
Write-AgentLog -HypothesisId "H5" -Message "java version check" -Data @{
    exitCode = $javaExitCode
    output   = $javaVersionOutput
}
#endregion

# Step 5: Build the Android app
Write-Host "`n====================================" -ForegroundColor Cyan
Write-Host "Starting Android build..." -ForegroundColor Cyan
Write-Host "====================================" -ForegroundColor Cyan
Write-Host ""

#region agent log
Write-AgentLog -HypothesisId "H3" -Message "pre-build context" -Data @{
    workingDir    = (Get-Location).Path
    androidDir    = $ANDROID_DIR
    gradlewExists = (Test-Path "$ANDROID_DIR\gradlew.bat")
    command       = "npx expo run:android"
}
#endregion

npx expo run:android
$expoExitCode = $LASTEXITCODE
#region agent log
Write-AgentLog -HypothesisId "H6" -Message "expo run result" -Data @{
    exitCode = $expoExitCode
}
#endregion
if ($expoExitCode -ne 0) {
    Write-Host "Build failed with exit code $expoExitCode" -ForegroundColor Red
}

Write-Host "`n====================================" -ForegroundColor Cyan
Write-Host "Build process completed!" -ForegroundColor Cyan
Write-Host "====================================" -ForegroundColor Cyan
