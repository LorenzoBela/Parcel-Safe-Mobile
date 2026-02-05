# Android Build Script for Parcel Safe App
# This script syncs files from editing location to build location, then cleans and builds the Android app

Write-Host "====================================" -ForegroundColor Cyan
Write-Host "Parcel Safe Android Build Script" -ForegroundColor Cyan
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
        # Stop all Gradle daemons
        Push-Location (Join-Path $ProjectPath "android")
        .\gradlew --stop 2>&1 | Out-Null
        Pop-Location
        Write-Host "[OK] Gradle daemons stopped" -ForegroundColor Green
    } catch {
        Write-Host "[WARN] Could not stop Gradle daemons: $_" -ForegroundColor DarkYellow
    }
    
    # Clean old Gradle cache files (keep recent ones)
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
    
    # Check critical SDK components
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

# Step 2: Pre-Flight Environment Validation
Write-Host "`nStep 2: Pre-Flight Environment Validation..." -ForegroundColor Yellow

# Check Node.js version (React Native 0.81.5 requires Node 16+)
Test-ToolVersion -ToolName "Node.js" `
    -VersionCommand { node --version } `
    -RequiredPattern "v(1[6-9]|2\d)\." `
    -Description "Node.js 16.x or higher"

# Check Java/JDK version (React Native 0.81.5 requires JDK 11 or 17)
$javaCheck = Test-ToolVersion -ToolName "Java JDK" `
    -VersionCommand { javac -version } `
    -RequiredPattern "javac (11|17|21)\." `
    -Description "JDK 11, 17, or 21"

if (-not $javaCheck) {
    Write-Host "[WARN] JDK version might cause build issues. Recommended: JDK 17" -ForegroundColor DarkYellow
}

# Clean Gradle daemons and old caches
Invoke-GradleDaemonCleanup -ProjectPath $PROJECT_ROOT

# Step 2.1: Toolchain sanity (JDK + Android SDK)
Write-Host "`nStep 2.1: Toolchain sanity (JDK + Android SDK)..." -ForegroundColor Yellow

# Force CMake/NDK to use shared libc++ to avoid missing stdlib symbols at link time
$env:ANDROID_STL = "c++_shared"
$env:CMAKE_ANDROID_STL_TYPE = "c++_shared"
Write-Host "[OK] Android STL set to: $env:ANDROID_STL" -ForegroundColor Green

# Try to infer ANDROID_HOME/ANDROID_SDK_ROOT from android/local.properties if missing
$localPropsPathEarly = "$ANDROID_DIR\local.properties"
$sdkDirEarly = $null
if (Test-Path $localPropsPathEarly) {
    $sdkLineEarly = Get-Content $localPropsPathEarly | Where-Object { $_ -match '^sdk\.dir=' } | Select-Object -First 1
    if ($sdkLineEarly) {
        # Guard against malformed line that accidentally contains ndk.dir as well
        $sdkLineEarly = $sdkLineEarly -replace 'ndk\.dir=.*', ''
        # Remove the property name and unescape Java properties format (\\: -> :, \\ -> \, \  -> space)
        $sdkDirEarly = $sdkLineEarly -replace '^sdk\.dir=', '' -replace '\\:', ':' -replace '\\ ', ' ' -replace '\\\\', '\'
    }
}

function Update-LocalPropertiesPaths {
    param(
        [string]$Path,
        [string]$SdkDir,
        [string]$NdkDir
    )
    $lines = @()
    if (Test-Path $Path) {
        $lines = Get-Content $Path
    }
    $lines = $lines | Where-Object { $_ -notmatch '^sdk\.dir=' -and $_ -notmatch '^ndk\.dir=' }
    if ($SdkDir) { $lines += ("sdk.dir=" + ($SdkDir -replace '\\', '/')) }
    if ($NdkDir) { $lines += ("ndk.dir=" + ($NdkDir -replace '\\', '/')) }
    Set-Content -Path $Path -Value $lines
}
if ((!$env:ANDROID_HOME -or !$env:ANDROID_SDK_ROOT) -and $sdkDirEarly) {
    if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = $sdkDirEarly }
    if (-not $env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT = $sdkDirEarly }
    Write-Host "[OK] Android SDK inferred from local.properties: $sdkDirEarly" -ForegroundColor Green

    # Validate Android SDK components
    Test-AndroidEnvironment -SdkPath $sdkDirEarly

    # Normalize sdk.dir in local.properties for the build directory
    Update-LocalPropertiesPaths -Path $localPropsPathEarly -SdkDir $sdkDirEarly -NdkDir $null
    
    # Add platform-tools to PATH if not already there (for adb command)
    $platformTools = Join-Path $sdkDirEarly "platform-tools"
    if ((Test-Path $platformTools) -and ($env:Path -notlike "*$platformTools*")) {
        $env:Path = "$platformTools;$env:Path"
        Write-Host "[OK] Added Android platform-tools to PATH" -ForegroundColor Green
    }

    # Set NDK path (prefer 27.2.12479018 for C++20 std::format support)
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
        
        # Verify NDK is valid and report version
        $ndkSourceProps = Join-Path $ndkDir "source.properties"
        if (Test-Path $ndkSourceProps) {
            $ndkVersion = (Get-Content $ndkSourceProps | Where-Object { $_ -match "^Pkg.Revision" } | Select-Object -First 1) -replace "^Pkg.Revision\s*=\s*", ""
            Write-Host "[OK] NDK verified: $ndkVersion (supports c++_shared STL)" -ForegroundColor Green
            
            # Warn if using very old NDK (< 25.x) which might have STL issues
            if ($ndkVersion -match "^(\d+)\.") {
                $majorVersion = [int]$matches[1]
                if ($majorVersion -lt 25) {
                    Write-Host "[WARN] NDK version $ndkVersion is older than 25.x. Recommend upgrading for better c++_shared support" -ForegroundColor DarkYellow
                }
            }
        }

        # Ensure local.properties has ndk.dir pointing at the selected NDK (use forward slashes)
        $ndkDirForProps = $ndkDir -replace '\\', '/'
        $ndkLine = "ndk.dir=$ndkDirForProps"
        if (Test-Path $localPropsPathEarly) {
            $localPropsContent = Get-Content $localPropsPathEarly
            $normalized = @()
            foreach ($line in $localPropsContent) {
                if ($line -match '^sdk\.dir=.*ndk\.dir=') {
                    $parts = $line -split 'ndk\.dir='
                    $sdkPart = $parts[0].TrimEnd()
                    if ($sdkPart) { $normalized += $sdkPart }
                    if ($parts.Count -gt 1) { $normalized += ("ndk.dir=" + $parts[1]) }
                } else {
                    $normalized += $line
                }
            }
            $normalized = $normalized | Where-Object { $_ -notmatch '^ndk\.dir=' }
            $normalized += $ndkLine
            Set-Content -Path $localPropsPathEarly -Value $normalized
        }

        Write-Host "[OK] Using NDK: $ndkDir" -ForegroundColor Green
    } else {
        Write-Host "[ERROR] No valid NDK installation found under $ndkRoot" -ForegroundColor Red
        Write-Host "[INFO] Install NDK $preferredNdkVersion in Android SDK Manager and re-run." -ForegroundColor Yellow
        exit 1
    }
}

# Save working config snapshot for future builds
Write-Host "`nStep 2.5: Saving working build config..." -ForegroundColor Yellow
$configPath = Join-Path $PROJECT_ROOT "build-config.json"
$configData = [ordered]@{
    timestamp           = (Get-Date).ToString("o")
    projectRoot         = $PROJECT_ROOT
    androidDir          = $ANDROID_DIR
    androidSdkRoot      = $env:ANDROID_SDK_ROOT
    androidHome         = $env:ANDROID_HOME
    androidNdkHome       = $env:ANDROID_NDK_HOME
    ndkHome             = $env:NDK_HOME
    javaHome            = $env:JAVA_HOME
    nodeBinary          = $env:NODE_BINARY
    androidStl          = $env:ANDROID_STL
    cmakeAndroidStlType = $env:CMAKE_ANDROID_STL_TYPE
}
try {
    $configData | ConvertTo-Json -Depth 5 | Set-Content -Path $configPath -Encoding UTF8
    Write-Host "[OK] Saved build config to: $configPath" -ForegroundColor Green
} catch {
    Write-Host "[WARN] Failed to save build config snapshot" -ForegroundColor DarkYellow
}

# Step 2.6: Apply known working build fixes (Gradle + CMake patches)
Write-Host "`nStep 2.6: Applying working build fixes..." -ForegroundColor Yellow

function Ensure-LineInFile {
    param(
        [string]$Path,
        [string]$MatchRegex,
        [string]$LineToSet
    )
    if (-not (Test-Path $Path)) { return }
    $content = Get-Content -Path $Path
    $matched = $false
    $newContent = @()
    foreach ($line in $content) {
        if ($line -match $MatchRegex) {
            $newContent += $LineToSet
            $matched = $true
        } else {
            $newContent += $line
        }
    }
    if (-not $matched) { $newContent += $LineToSet }
    Set-Content -Path $Path -Value $newContent
}

function Ensure-BlockAfterLine {
    param(
        [string]$Path,
        [string]$AnchorRegex,
        [string]$BlockText,
        [string]$BlockMarker
    )
    if (-not (Test-Path $Path)) { return }
    $raw = Get-Content -Path $Path -Raw
    if ($raw -match [regex]::Escape($BlockMarker)) { return }
    $lines = Get-Content -Path $Path
    $output = @()
    foreach ($line in $lines) {
        $output += $line
        if ($line -match $AnchorRegex) {
            $output += $BlockText
        }
    }
    Set-Content -Path $Path -Value $output
}

function Ensure-CMakeLibCppShared {
    param(
        [string]$Path,
        [string]$TargetName
    )
    if (-not (Test-Path $Path)) { return }
    $raw = Get-Content -Path $Path -Raw

    # Ensure linker flags
    # Sanitize accidental backticks from previous runs
    $raw = $raw -replace '`cmake_minimum_required', 'cmake_minimum_required'
    $raw = $raw -replace '`n', "`n"

    if ($raw -notmatch 'CMAKE_SHARED_LINKER_FLAGS') {
        $insert = "string(APPEND CMAKE_SHARED_LINKER_FLAGS `" -lc++_shared`")`nstring(APPEND CMAKE_EXE_LINKER_FLAGS `" -lc++_shared`")`n"
        $raw = [regex]::Replace($raw, '(cmake_minimum_required\([^\)]*\)\s*)', { $args[0].Groups[1].Value + $insert })
    }

    # Ensure find_library + fallback
    if ($raw -notmatch 'find_library\(CPP_SHARED_LIB c\+\+_shared\)') {
        $raw = $raw -replace '(find_library\([^\n]*log[^\n]*\)\s*)', "`$1find_library(CPP_SHARED_LIB c++_shared)`n`nif(NOT CPP_SHARED_LIB)`n  set(CPP_SHARED_LIB c++_shared)`nendif()`n"
        if ($raw -notmatch 'find_library\(CPP_SHARED_LIB c\+\+_shared\)') {
            $raw = "find_library(CPP_SHARED_LIB c++_shared)`n`nif(NOT CPP_SHARED_LIB)`n  set(CPP_SHARED_LIB c++_shared)`nendif()`n`n" + $raw
        }
    } elseif ($raw -notmatch 'if\(NOT CPP_SHARED_LIB\)') {
        $raw = $raw -replace '(find_library\(CPP_SHARED_LIB c\+\+_shared\)\s*)', "`$1`nif(NOT CPP_SHARED_LIB)`n  set(CPP_SHARED_LIB c++_shared)`nendif()`n"
    }

    # Ensure target_link_options
    if ($raw -notmatch 'target_link_options\(') {
        $raw += "`n`ntarget_link_options(${TargetName} PRIVATE `"-lc++_shared`")`n"
    } elseif ($raw -notmatch 'lc\+\+_shared') {
        $raw += "`n`ntarget_link_options(${TargetName} PRIVATE `"-lc++_shared`")`n"
    }

    Set-Content -Path $Path -Value $raw
}

# Enforce Gradle STL flags
$gradleProps = Join-Path $ANDROID_DIR "gradle.properties"
Ensure-LineInFile -Path $gradleProps -MatchRegex '^android\.cmake\.arguments=' -LineToSet 'android.cmake.arguments=-DANDROID_STL=c++_shared -DCMAKE_ANDROID_STL_TYPE=c++_shared'

# Enforce root build.gradle subproject CMake args
$rootBuildGradle = Join-Path $ANDROID_DIR "build.gradle"
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

# Patch common native modules in node_modules (if present)
$expoCmake = Join-Path $PROJECT_ROOT "node_modules\expo-modules-core\android\CMakeLists.txt"
Ensure-CMakeLibCppShared -Path $expoCmake -TargetName '${PACKAGE_NAME}'

$workletsCmake = Join-Path $PROJECT_ROOT "node_modules\react-native-worklets\android\CMakeLists.txt"
Ensure-CMakeLibCppShared -Path $workletsCmake -TargetName 'worklets'

$gestureCmake = Join-Path $PROJECT_ROOT "node_modules\react-native-gesture-handler\android\src\main\jni\CMakeLists.txt"
Ensure-CMakeLibCppShared -Path $gestureCmake -TargetName '${PACKAGE_NAME}'

Write-Host "[OK] Working build fixes applied" -ForegroundColor Green

# Step 2.7: Verify working build fixes
Write-Host "`nStep 2.7: Verifying working build fixes..." -ForegroundColor Yellow

function Test-FileContains {
    param(
        [string]$Path,
        [string]$Pattern
    )
    if (-not (Test-Path $Path)) { return $false }
    $raw = Get-Content -Path $Path -Raw
    return ($raw -match $Pattern)
}

$checkResults = [ordered]@{}
$checkResults["gradle.properties ANDROID_STL"] = Test-FileContains -Path $gradleProps -Pattern 'android\.cmake\.arguments=.*ANDROID_STL=c\+\+_shared'
$checkResults["root build.gradle libcxx-shared-fix"] = Test-FileContains -Path $rootBuildGradle -Pattern 'BEGIN libcxx-shared-fix'
$checkResults["expo-modules-core CMake libc++_shared"] = Test-FileContains -Path $expoCmake -Pattern 'c\+\+_shared'
$checkResults["worklets CMake libc++_shared"] = Test-FileContains -Path $workletsCmake -Pattern 'c\+\+_shared'
$checkResults["gesture-handler CMake libc++_shared"] = Test-FileContains -Path $gestureCmake -Pattern 'c\+\+_shared'

foreach ($key in $checkResults.Keys) {
    if ($checkResults[$key]) {
        Write-Host "[OK] $key" -ForegroundColor Green
    } else {
        Write-Host "[WARN] $key" -ForegroundColor DarkYellow
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

# Use smart cleanup function
Invoke-SmartCleanup -ProjectPath $PROJECT_ROOT

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
        # Guard against malformed line that accidentally contains ndk.dir as well
        $sdkLine = $sdkLine -replace 'ndk\.dir=.*', ''
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

# Ensure a healthy adb connection before build
function Test-ConnectedAndroidDevice {
    param([string]$SdkRoot)
    if (-not $SdkRoot) { return $true }
    $adbPath = Join-Path $SdkRoot "platform-tools\adb.exe"
    if (-not (Test-Path $adbPath)) { return $true }
    $devices = & $adbPath devices
    $deviceLines = $devices | Where-Object { $_ -match "\t" }
    foreach ($line in $deviceLines) {
        $parts = $line -split "\t"
        if ($parts.Count -ge 2 -and $parts[1] -eq "device") { return $true }
    }
    return $false
}

if (-not (Test-ConnectedAndroidDevice -SdkRoot $env:ANDROID_SDK_ROOT)) {
    $adbPath = Join-Path $env:ANDROID_SDK_ROOT "platform-tools\adb.exe"
    if (Test-Path $adbPath) {
        Write-Host "[WARN] No active Android device found. Restarting adb..." -ForegroundColor DarkYellow
        & $adbPath kill-server | Out-Null
        Start-Sleep -Seconds 2
        & $adbPath start-server | Out-Null
        Start-Sleep -Seconds 2
    }
    if (-not (Test-ConnectedAndroidDevice -SdkRoot $env:ANDROID_SDK_ROOT)) {
        Write-Host "[ERROR] No connected Android device/emulator. Please start an emulator or connect a device, then re-run." -ForegroundColor Red
        exit 1
    }
}

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

Write-Host "`n====================================" -ForegroundColor Cyan
Write-Host "Build process completed!" -ForegroundColor Cyan
Write-Host "====================================" -ForegroundColor Cyan

# Post-build verification
if ($expoExitCode -eq 0) {
    Write-Host "`n[OK] Build succeeded!" -ForegroundColor Green
    
    # Check for APK output
    $apkSearchPaths = @(
        "$ANDROID_DIR\app\build\outputs\apk\debug\*.apk",
        "$ANDROID_DIR\app\build\outputs\apk\release\*.apk"
    )
    
    $foundApks = @()
    foreach ($pattern in $apkSearchPaths) {
        $apks = Get-ChildItem -Path $pattern -ErrorAction SilentlyContinue
        if ($apks) {
            $foundApks += $apks
        }
    }
    
    if ($foundApks.Count -gt 0) {
        Write-Host "`nGenerated APKs:" -ForegroundColor Green
        foreach ($apk in $foundApks) {
            $sizeInMB = [math]::Round($apk.Length / 1MB, 2)
            Write-Host "  - $($apk.Name) ($sizeInMB MB)" -ForegroundColor Gray
            Write-Host "    Path: $($apk.FullName)" -ForegroundColor DarkGray
        }
    }
    
    # Verify critical configuration is still in place
    Write-Host "`nVerifying build configuration..." -ForegroundColor Yellow
    $gradleProps = Join-Path $ANDROID_DIR "gradle.properties"
    if (Test-Path $gradleProps) {
        $content = Get-Content $gradleProps -Raw
        if ($content -match "android\.cmake\.arguments=-DANDROID_STL=c\+\+_shared") {
            Write-Host "[OK] gradle.properties STL configuration intact" -ForegroundColor Green
        } else {
            Write-Host "[WARN] gradle.properties STL configuration missing" -ForegroundColor DarkYellow
        }
    }
    
} else {
    Write-Host "`n[ERROR] Build failed with exit code $expoExitCode" -ForegroundColor Red
    Write-Host "`nTroubleshooting tips:" -ForegroundColor Yellow
    Write-Host "  1. Check if all NDK/SDK components are installed" -ForegroundColor Gray
    Write-Host "  2. Verify JDK version is compatible (11, 17, or 21)" -ForegroundColor Gray
    Write-Host "  3. Try running: .\gradlew clean in android\ folder" -ForegroundColor Gray
    Write-Host "  4. Check build logs above for specific error messages" -ForegroundColor Gray
    exit $expoExitCode
}
