# Android Build Script for Parcel Safe App
# This script syncs files from editing location to build location, then cleans and builds the Android app

Write-Host "====================================" -ForegroundColor Cyan
Write-Host "Parcel Safe Android Build Script" -ForegroundColor Cyan
Write-Host "====================================" -ForegroundColor Cyan
Write-Host ""

# Define source and destination paths
$SOURCE_DIR = "C:\Users\Lorenzo Bela\Downloads\Thesis 24-25 Smart Top Box\mobile"
$DEST_DIR = "C:\Dev\TopBox\mobile"

# Step 0: Sync files from editing location to build location
Write-Host "`nStep 0: Syncing files from editing location to build location..." -ForegroundColor Yellow
Write-Host "  Source: $SOURCE_DIR" -ForegroundColor Gray
Write-Host "  Destination: $DEST_DIR" -ForegroundColor Gray


# Ensure destination directory exists
if (-not (Test-Path $DEST_DIR)) {
    Write-Host "  Creating destination directory..." -ForegroundColor Gray
    New-Item -ItemType Directory -Path $DEST_DIR -Force | Out-Null
}

# Use robocopy to mirror directories (excludes node_modules and build artifacts for efficiency)
$robocopyArgs = @(
    $SOURCE_DIR,
    $DEST_DIR,
    "/MIR",              # Mirror mode (sync deletions too)
    "/R:2",              # Retry 2 times on failed copies
    "/W:3",              # Wait 3 seconds between retries
    "/MT:8",             # Multi-threaded (8 threads)
    "/XD",               # Exclude directories
    "node_modules",
    "android\build",
    "android\app\build",
    "android\app\.cxx",
    "android\.gradle",
    ".expo",
    ".git",
    "/XF",               # Exclude files
    "*.log",
    "*.lock",
    ".DS_Store",
    "/NFL",              # No file list (less verbose)
    "/NDL",              # No directory list (less verbose)
    "/NP",               # No progress (less verbose)
    "/NS",               # No size (less verbose)
    "/NC",               # No class (less verbose)
    "/BYTES"             # Print sizes in bytes
)

robocopy @robocopyArgs
$robocopyExitCode = $LASTEXITCODE

# Robocopy exit codes: 0-7 are success, 8+ are errors
if ($robocopyExitCode -ge 8) {
    Write-Host "[ERROR] File sync failed with exit code $robocopyExitCode" -ForegroundColor Red
    exit $robocopyExitCode
} else {
    Write-Host "[OK] Files synced successfully (exit code: $robocopyExitCode)" -ForegroundColor Green
}

# Change to build directory for all subsequent operations
Set-Location $DEST_DIR
Write-Host "[OK] Switched to build directory: $DEST_DIR" -ForegroundColor Green
Write-Host ""


# Check and enable Windows long path support if needed
Write-Host "`nStep 1: Checking Windows long path support..." -ForegroundColor Yellow
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

# Set project root to build directory (not script location, since we're syncing)
$PROJECT_ROOT = $DEST_DIR
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

# Step 2: Toolchain sanity (JDK + Android SDK)
Write-Host "`nStep 2: Toolchain sanity..." -ForegroundColor Yellow

# Try to infer ANDROID_HOME/ANDROID_SDK_ROOT from android/local.properties if missing
$localPropsPathEarly = "$ANDROID_DIR\local.properties"
$sdkDirEarly = $null
if (Test-Path $localPropsPathEarly) {
    $sdkLineEarly = Get-Content $localPropsPathEarly | Where-Object { $_ -match '^sdk\.dir=' } | Select-Object -First 1
    if ($sdkLineEarly) {
        # Remove the property name and unescape Java properties format (\\: -> :, \\ -> \)
        $sdkDirEarly = $sdkLineEarly -replace '^sdk\.dir=', '' -replace '\\:', ':' -replace '\\\\', '\'
    }
}
if ((!$env:ANDROID_HOME -or !$env:ANDROID_SDK_ROOT) -and $sdkDirEarly) {
    if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = $sdkDirEarly }
    if (-not $env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT = $sdkDirEarly }
    Write-Host "[OK] Android SDK inferred from local.properties: $sdkDirEarly" -ForegroundColor Green
    
    # Add platform-tools to PATH if not already there (for adb command)
    $platformTools = Join-Path $sdkDirEarly "platform-tools"
    if ((Test-Path $platformTools) -and ($env:Path -notlike "*$platformTools*")) {
        $env:Path = "$platformTools;$env:Path"
        Write-Host "[OK] Added Android platform-tools to PATH" -ForegroundColor Green
    }

    # Set NDK path (prefer 27.2.12479018 for C++20 std::format support; otherwise use newest available)
    $preferredNdkVersion = "27.2.12479018"
    $ndkRoot = Join-Path $sdkDirEarly "ndk"
    $ndkDir = $null

    function Get-SdkManagerPath {
        param([string]$SdkRoot)
        $candidates = @(
            Join-Path $SdkRoot "cmdline-tools\latest\bin\sdkmanager.bat",
            Join-Path $SdkRoot "cmdline-tools\bin\sdkmanager.bat",
            Join-Path $SdkRoot "tools\bin\sdkmanager.bat"
        )
        foreach ($c in $candidates) {
            if (Test-Path $c) { return $c }
        }
        return $null
    }

    function Test-NdkValid {
        param([string]$Path)
        return (Test-Path (Join-Path $Path "source.properties"))
    }

    if (Test-Path $ndkRoot) {
        $preferredCandidate = Join-Path $ndkRoot $preferredNdkVersion

        if ((Test-Path $preferredCandidate) -and -not (Test-NdkValid $preferredCandidate)) {
            Write-Host "[WARN] NDK $preferredNdkVersion exists but is missing source.properties. Removing broken folder..." -ForegroundColor DarkYellow
            try {
                Remove-Item -Recurse -Force $preferredCandidate -ErrorAction Stop
            } catch {
                Write-Host "[WARN] Failed to remove broken NDK folder: $preferredCandidate" -ForegroundColor DarkYellow
            }
        }

        if ((Test-Path $preferredCandidate) -and (Test-NdkValid $preferredCandidate)) {
            $ndkDir = $preferredCandidate
        } else {
            $sdkManager = Get-SdkManagerPath -SdkRoot $sdkDirEarly
            if ($sdkManager) {
                Write-Host "[INFO] Installing NDK $preferredNdkVersion via sdkmanager..." -ForegroundColor Yellow
                try {
                    $env:ANDROID_SDK_ROOT = $sdkDirEarly
                    $env:ANDROID_HOME = $sdkDirEarly
                    # Accept licenses and install the preferred NDK
                    "y" | & $sdkManager "ndk;$preferredNdkVersion" | Out-Host
                } catch {
                    Write-Host "[WARN] Failed to install NDK $preferredNdkVersion via sdkmanager." -ForegroundColor DarkYellow
                }
            } else {
                Write-Host "[WARN] sdkmanager not found. Please install NDK $preferredNdkVersion in Android SDK Manager." -ForegroundColor DarkYellow
            }

            if ((Test-Path $preferredCandidate) -and (Test-NdkValid $preferredCandidate)) {
                $ndkDir = $preferredCandidate
            } else {
                $ndkDir = Get-ChildItem -Path $ndkRoot -Directory | Sort-Object Name -Descending |
                    Where-Object { Test-NdkValid $_.FullName } |
                    Select-Object -First 1 | ForEach-Object { $_.FullName }
            }
        }
    }

    if ($ndkDir) {
        $env:ANDROID_NDK_HOME = $ndkDir
        $env:NDK_HOME = $ndkDir

        # Ensure local.properties has ndk.dir pointing at the selected NDK (use forward slashes)
        $ndkDirForProps = $ndkDir -replace '\\', '/'
        $ndkLine = "ndk.dir=$ndkDirForProps"
        if (Test-Path $localPropsPathEarly) {
            $localPropsContent = Get-Content $localPropsPathEarly
            if ($localPropsContent -match '^ndk\.dir=') {
                $localPropsContent = $localPropsContent -replace '^ndk\.dir=.*', $ndkLine
            } else {
                $localPropsContent += $ndkLine
            }
            $localPropsContent | Set-Content $localPropsPathEarly
        }

        Write-Host "[OK] Using NDK: $ndkDir" -ForegroundColor Green
    } else {
        Write-Host "[ERROR] No valid NDK installation found under $ndkRoot" -ForegroundColor Red
        Write-Host "[INFO] Install NDK $preferredNdkVersion in Android SDK Manager and re-run." -ForegroundColor Yellow
        exit 1
    }
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

# We're already in the project directory from the sync step above

# Step 3: Clean build directories
Write-Host "`nStep 3: Cleaning build directories..." -ForegroundColor Yellow

$cleanupPaths = @(
    "$ANDROID_DIR\app\.cxx",
    "$ANDROID_DIR\app\build",
    "$ANDROID_DIR\build",
    "$PROJECT_ROOT\node_modules\expo-modules-core\android\.cxx",
    "$PROJECT_ROOT\node_modules\expo-modules-core\android\build",
    "$PROJECT_ROOT\node_modules\react-native-reanimated"
)

foreach ($path in $cleanupPaths) {
    if (Test-Path $path) {
        Write-Host "  Removing: $path" -ForegroundColor Gray
        Remove-Item -Recurse -Force $path -ErrorAction SilentlyContinue
    }
}
Write-Host "[OK] Build directories cleaned" -ForegroundColor Green

# Step 4: Clean Gradle cache (optional but recommended)
Write-Host "`nStep 4: Cleaning Gradle cache..." -ForegroundColor Yellow
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

# Step 5: Ensure node_modules are fresh
Write-Host "`nStep 5: Ensuring node_modules are up to date..." -ForegroundColor Yellow

# Always reinstall in build directory to ensure correct versions
Write-Host "  Installing dependencies..." -ForegroundColor Gray
npm install --force
$npmInstallExit = $LASTEXITCODE
if ($npmInstallExit -ne 0) {
    Write-Host "[ERROR] npm install failed with exit code $npmInstallExit" -ForegroundColor Red
    exit $npmInstallExit
}

Write-Host "[OK] Dependencies installed" -ForegroundColor Green
#region agent log
Write-AgentLog -HypothesisId "H4" -Message "node modules check" -Data @{
    exists        = $nodeModulesExists
    installRan    = (-not $nodeModulesExists)
    npmExitCode   = $npmInstallExit
}
#endregion

# Step 6: Pre-build checks
Write-Host "`nStep 6: Running pre-build checks..." -ForegroundColor Yellow

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
        # Remove the property name and unescape Java properties format (\\: -> :, \\ -> \)
        $sdkDir = $sdkLine -replace '^sdk\.dir=', '' -replace '\\:', ':' -replace '\\\\', '\'
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

# Step 7: Build the Android app
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
