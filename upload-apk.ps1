# Upload APK to GitHub Releases
# Use this script to manually deploy the production APK if the build script's upload fails.

$SOURCE_DIR = "C:\Users\Lorenzo Bela\Downloads\Thesis 24-25 Smart Top Box\mobile"
$CENTRAL_APK_DIR = "C:\Dev\TopBox\mobile\APK"
$repo = "LorenzoBela/Parcel-Safe-Mobile"
$apkFileName = "Parcel Safe.apk"
$productionApk = Join-Path $CENTRAL_APK_DIR "production.apk"
$apkToUpload = Join-Path $CENTRAL_APK_DIR $apkFileName

Write-Host "=================================================" -ForegroundColor Magenta
Write-Host " Uploading APK to GitHub releases... 🚀" -ForegroundColor Magenta
Write-Host "=================================================" -ForegroundColor Magenta

if (-not (Test-Path $productionApk)) {
    Write-Host "[ERROR] Could not find production.apk at $productionApk" -ForegroundColor Red
    Write-Host "Did you successfully run build-android-prod.ps1?" -ForegroundColor Yellow
    exit 1
}

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

Write-Host "Preparing '$apkFileName'..." -ForegroundColor Gray
Copy-Item -Path $productionApk -Destination $apkToUpload -Force

try {
    # 1. Get the latest commit SHA from 'master'
    Write-Host "Fetching latest commit..." -ForegroundColor Gray
    $commitResponse = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/commits/master" -Headers @{ "Authorization" = "Bearer $token" }
    $sha = $commitResponse.sha

    # 2. Update the 'latest' tag
    Write-Host "Updating 'latest' tag..." -ForegroundColor Gray
    $tagBody = @{ ref = "refs/tags/latest"; sha = $sha } | ConvertTo-Json
    try {
        try {
            Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/git/refs" -Method Post -Headers @{ "Authorization" = "Bearer $token" } -Body $tagBody | Out-Null
        } catch {
            Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/git/refs/tags/latest" -Method Patch -Headers @{ "Authorization" = "Bearer $token" } -Body (@{ sha = $sha; force = $true } | ConvertTo-Json) | Out-Null
        }
    } catch {
        Write-Host "[WARN] Could not update 'latest' tag pointer to the latest commit ($($_.Exception.Message))." -ForegroundColor DarkYellow
        Write-Host "This usually means your GitHub token lacks 'Contents: write' permission or the tag is protected." -ForegroundColor DarkYellow
        Write-Host "Proceeding with the release upload anyway..." -ForegroundColor Gray
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
} catch {
    Write-Host "[ERROR] Failed to upload APK to GitHub." -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Gray
    if ($_.Exception.Message -match "401") {
        Write-Host "You received a 401 Unauthorized Error." -ForegroundColor Yellow
        Write-Host "Make sure the GITHUB_TOKEN in your mobile/.env.build is valid and has 'repo' scope." -ForegroundColor Yellow
    }
    exit 1
}
