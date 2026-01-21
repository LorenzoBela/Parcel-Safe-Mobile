# Auto-build Android Debug APK using current project settings
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot

# Ensure Node is on PATH for Gradle exec in settings.gradle
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  $nodePath = Join-Path $env:ProgramFiles "nodejs"
  if (Test-Path $nodePath) {
    $env:Path = "$nodePath;$env:Path"
  }
}

$junctionRoot = "C:\build\mobile-project"
if (-not (Test-Path $junctionRoot)) {
  New-Item -ItemType Junction -Path $junctionRoot -Target $projectRoot | Out-Null
}

$shortRoot = $junctionRoot
$androidDir = Join-Path $shortRoot "android"

# Ensure NODE_ENV for Expo config
$env:NODE_ENV = "production"

# Infer Android SDK from local.properties if needed
$localProps = Join-Path $androidDir "local.properties"
if (Test-Path $localProps) {
  $sdkLine = Get-Content $localProps | Where-Object { $_ -match '^sdk\.dir=' } | Select-Object -First 1
  if ($sdkLine) {
    $sdkDir = $sdkLine -replace '^sdk\.dir=', ''
    if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = $sdkDir }
    if (-not $env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT = $sdkDir }
  }
}

if (-not (Test-Path (Join-Path $androidDir "gradlew.bat"))) {
  throw "gradlew.bat not found in $androidDir"
}

Push-Location $androidDir
try {
  .\gradlew.bat app:assembleDebug -x lint -x test --no-daemon
} finally {
  Pop-Location
}

$apkPath = Join-Path $androidDir "app\build\outputs\apk\debug\app-debug.apk"
if (Test-Path $apkPath) {
  Write-Host "APK built successfully:" -ForegroundColor Green
  Write-Host $apkPath -ForegroundColor Green
} else {
  Write-Host "Build finished, but APK not found at expected path:" -ForegroundColor Yellow
  Write-Host $apkPath -ForegroundColor Yellow
}

