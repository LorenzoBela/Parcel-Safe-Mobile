Write-Host "=================================================" -ForegroundColor Magenta
Write-Host " Uploading APK to GitHub releases... " -ForegroundColor Magenta
$repo = "LorenzoBela/Parcel-Safe-Mobile"

$workspaceDir = "C:\Users\Lorenzo Bela\Downloads\Thesis 24-25 Smart Top Box\mobile"
$envFile = Join-Path $workspaceDir ".env.build"
if (Test-Path $envFile) {
    Get-Content $envFile | Where-Object { $_ -match "^[^#]*=" } | ForEach-Object {
        $name, $value = $_.Split('=', 2)
        Set-Item -Path "env:\$name" -Value $value.Trim()
    }
}

$token = $env:GITHUB_TOKEN
if ([string]::IsNullOrWhiteSpace($token)) {
    Write-Host "`n[ERROR] GitHub Token (GITHUB_TOKEN) is not provided." -ForegroundColor Red
    exit 1
}

$CENTRAL_APK_DIR = "C:\Dev\TopBox\mobile\APK"
$apkFileName = "Parcel Safe.apk"
$productionApk = Join-Path $CENTRAL_APK_DIR "production.apk"
$apkToUpload = Join-Path $CENTRAL_APK_DIR $apkFileName

if (-not (Test-Path $productionApk)) {
    Write-Host "[ERROR] Could not find production.apk at $productionApk" -ForegroundColor Red
    exit 1
}

Write-Host "Copying production.apk to '$apkFileName' locally..." -ForegroundColor Gray
Copy-Item -Path $productionApk -Destination $apkToUpload -Force

# 1. Get latest commit SHA
Write-Host "Fetching latest commit..." -ForegroundColor Gray
$commitResponse = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/commits/master" -Headers @{ "Authorization" = "token $token" }
$sha = $commitResponse.sha

# 2. Update the 'latest' tag
Write-Host "Updating 'latest' tag..." -ForegroundColor Gray
$tagBody = @{ ref = "refs/tags/latest"; sha = $sha } | ConvertTo-Json
try {
    Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/git/refs" -Method Post -Headers @{ "Authorization" = "token $token" } -Body $tagBody | Out-Null
} catch {
    Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/git/refs/tags/latest" -Method Patch -Headers @{ "Authorization" = "token $token" } -Body (@{ sha = $sha; force = $true } | ConvertTo-Json) | Out-Null
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
    $response = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases" -Method Post -Headers @{ "Authorization" = "token $token"; "Accept" = "application/vnd.github.v3+json" } -Body $releaseBody
    $releaseId = $response.id
} catch {
    $releases = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/tags/latest" -Headers @{ "Authorization" = "token $token"; "Accept" = "application/vnd.github.v3+json" }
    $releaseId = $releases.id
}

if ($releaseId) {
    # Delete old asset
    $assets = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/$releaseId/assets" -Headers @{ "Authorization" = "token $token" }
    
    # GitHub automatically replaces spaces with dots in asset names, so we check both
    $expectedAssetName = $apkFileName -replace ' ', '.'
    $existingAsset = $assets | Where-Object { $_.name -eq $apkFileName -or $_.name -eq $expectedAssetName }
    
    if ($existingAsset) {
        Write-Host "Removing previous APK..." -ForegroundColor Gray
        Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/assets/$($existingAsset.id)" -Method Delete -Headers @{ "Authorization" = "token $token" }
    }

    # Upload new asset
    Write-Host "Uploading new APK..." -ForegroundColor Gray
    $fileNameUrl = [uri]::EscapeDataString($apkFileName)
    Invoke-RestMethod -Uri "https://uploads.github.com/repos/$repo/releases/$releaseId/assets?name=$fileNameUrl" -Method Post -Headers @{ "Authorization" = "token $token"; "Content-Type" = "application/vnd.android.package-archive" } -InFile $apkToUpload
    Write-Host "`n[OK] Successfully uploaded APK to GitHub Releases!" -ForegroundColor Green
} else {
    Write-Host "`n[ERROR] Failed to determine GitHub Release ID." -ForegroundColor Red
}
