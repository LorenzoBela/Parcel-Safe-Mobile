# ============================================================
#  Parcel Safe - Enhanced Dev Script with Auto-Sync & More
#
#  USAGE:
#    .\dev-simple.ps1                    # Normal mode
#    .\dev-simple.ps1 -ClearCache        # Clear caches first
#    .\dev-simple.ps1 -Tunnel            # Use tunnel instead of LAN
#    .\dev-simple.ps1 -NoWatch           # Disable file watcher
#    .\dev-simple.ps1 -SyncOnly          # Just sync files, don't start Metro
#    .\dev-simple.ps1 -OpenDebugger      # Auto-open debugger in browser
#    .\dev-simple.ps1 -Verbose           # Show detailed sync logs
#
#  FEATURES:
#    ✓ Real-time file syncing (source → build dir)
#    ✓ Pre-flight checks (env, git, ports, deps)
#    ✓ Smart process cleanup
#    ✓ Automatic firewall configuration
#    ✓ Cache clearing options
#    ✓ Session statistics
#    ✓ Detailed sync logging with file sizes
#    ✓ Git status display
#    ✓ Dependency change detection
#    ✓ Port conflict detection
#
# ============================================================
param(
    [switch]$ClearCache,      # Clear Metro & Expo caches before starting
    [switch]$Tunnel,          # Use tunnel instead of LAN
    [switch]$NoWatch,         # Skip file watcher (sync once only)
    [switch]$SyncOnly,        # Sync files and exit (no Metro)
    [switch]$SkipDeps,        # Skip dependency check
    [switch]$OpenDebugger,    # Auto-open debugger in browser
    [switch]$Verbose          # Show detailed sync logs
)

$ErrorActionPreference = "Continue"

# Banner
Write-Host "═══════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  🚀 Parcel Safe - Enhanced Dev Environment   " -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# Config
$SOURCE_DIR = "C:\Users\Lorenzo Bela\Downloads\Thesis 24-25 Smart Top Box\mobile"
$BUILD_DIR  = "C:\Dev\TopBox\mobile"
$IGNORE_DIRS = @('node_modules', '.expo', '.git', 'coverage', 'android\app\build', 'android\build', 'android\.gradle')

# Stats
$script:syncCount = 0
$script:startTime = Get-Date

# ════════════════════════════════════════════════════════════
# PRE-FLIGHT CHECKS
# ════════════════════════════════════════════════════════════

Write-Host "🔍 Pre-flight Checks" -ForegroundColor Yellow
Write-Host "────────────────────────────────────────────────" -ForegroundColor DarkGray

# Check 1: Environment file
if (Test-Path "$SOURCE_DIR\.env") {
    Write-Host "  ✓ .env file found" -ForegroundColor Green
} else {
    Write-Host "  ⚠ .env file not found - using defaults" -ForegroundColor DarkYellow
}

# Check 2: Git status
try {
    Push-Location $SOURCE_DIR
    $gitBranch = git rev-parse --abbrev-ref HEAD 2>$null
    $gitStatus = git status --porcelain 2>$null
    $changedFiles = ($gitStatus | Measure-Object).Count
    if ($gitBranch) {
        Write-Host "  ✓ Git: branch '$gitBranch' ($changedFiles modified files)" -ForegroundColor Green
    }
    Pop-Location
} catch {
    Write-Host "  - Git not available" -ForegroundColor DarkGray
}

# Check 3: Port 8081 availability
$portInUse = Get-NetTCPConnection -LocalPort 8081 -ErrorAction SilentlyContinue
if ($portInUse) {
    Write-Host "  ⚠ Port 8081 is in use - will attempt to clear" -ForegroundColor Yellow
} else {
    Write-Host "  ✓ Port 8081 available" -ForegroundColor Green
}

# Check 4: Dependencies
if (-not $SkipDeps -and (Test-Path "$SOURCE_DIR\package.json")) {
    $pkgModified = (Get-Item "$SOURCE_DIR\package.json").LastWriteTime
    $nodeModulesExists = Test-Path "$SOURCE_DIR\node_modules"
    
    if ($nodeModulesExists) {
        $nodeModulesTime = (Get-Item "$SOURCE_DIR\node_modules").LastWriteTime
        if ($pkgModified -gt $nodeModulesTime) {
            Write-Host "  ⚠ package.json modified - consider running 'npm install'" -ForegroundColor Yellow
        } else {
            Write-Host "  ✓ Dependencies up to date" -ForegroundColor Green
        }
    } else {
        Write-Host "  ⚠ node_modules not found - run 'npm install' first" -ForegroundColor Yellow
    }
}

Write-Host ""

# ════════════════════════════════════════════════════════════
# STEP 1: FILE SYNC
# ════════════════════════════════════════════════════════════

Write-Host "📁 Step 1: Syncing files..." -ForegroundColor Yellow
if (-not (Test-Path $BUILD_DIR)) {
    New-Item -ItemType Directory -Path $BUILD_DIR -Force | Out-Null
}

robocopy $SOURCE_DIR $BUILD_DIR /MIR /MT:8 /NFL /NDL /NJH /NJS /NC /NS `
    /XD node_modules .expo "android\app\build" "android\.gradle" "android\build" .git coverage `
    /XF *.log | Out-Null

if ($LASTEXITCODE -ge 8) {
    Write-Host "  ✗ Sync failed!" -ForegroundColor Red
    exit $LASTEXITCODE
}
Write-Host "  ✓ Files synced successfully!" -ForegroundColor Green
Write-Host ""

Set-Location $BUILD_DIR

if ($SyncOnly) {
    Write-Host "✓ Sync-only mode complete - exiting" -ForegroundColor Green
    exit 0
}

# ════════════════════════════════════════════════════════════
# STEP 2: CLEANUP OLD PROCESSES & CACHES
# ════════════════════════════════════════════════════════════

Write-Host "🧹 Step 2: Cleanup..." -ForegroundColor Yellow

# Kill stale Metro processes
$killedCount = 0
Get-Process -Name "node" -ErrorAction SilentlyContinue | ForEach-Object {
    try {
        $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)" -ErrorAction SilentlyContinue).CommandLine
        if ($cmd -and ($cmd -match "metro|expo|react-native")) {
            Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
            $killedCount++
        }
    } catch {}
}

if ($killedCount -gt 0) {
    Write-Host "  ✓ Killed $killedCount stale Metro process(es)" -ForegroundColor Green
} else {
    Write-Host "  ✓ No stale processes found" -ForegroundColor Green
}

# Clear caches if requested
if ($ClearCache) {
    Write-Host "  Clearing caches..." -ForegroundColor Gray
    
    @(".expo", "node_modules\.cache") | ForEach-Object {
        $path = Join-Path $BUILD_DIR $_
        if (Test-Path $path) {
            Remove-Item -Path $path -Recurse -Force -ErrorAction SilentlyContinue
            Write-Host "    • Removed $_" -ForegroundColor DarkGray
        }
    }
    
    $tempMetro = Join-Path $env:TEMP "metro-*"
    Remove-Item $tempMetro -Recurse -Force -ErrorAction SilentlyContinue
    
    try { 
        if (Get-Command watchman -ErrorAction SilentlyContinue) {
            watchman watch-del-all 2>$null | Out-Null
            Write-Host "    • Cleared watchman cache" -ForegroundColor DarkGray
        }
    } catch {}
    
    Write-Host "  ✓ Caches cleared" -ForegroundColor Green
}

Write-Host ""

# ════════════════════════════════════════════════════════════
# STEP 3: NETWORK CONFIGURATION
# ════════════════════════════════════════════════════════════

Write-Host "🌐 Step 3: Network setup..." -ForegroundColor Yellow

$lanIP = (Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.InterfaceAlias -match 'Wi-Fi|Ethernet|LAN' -and $_.IPAddress -notmatch '^(127\.|169\.254\.)' } |
    Sort-Object -Property InterfaceAlias |
    Select-Object -First 1).IPAddress

if (-not $lanIP) {
    $lanIP = (Get-NetIPAddress -AddressFamily IPv4 |
        Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' } |
        Select-Object -First 1).IPAddress
}

if ($lanIP) {
    Write-Host "  ✓ LAN IP: $lanIP" -ForegroundColor Green
    
    # Check firewall
    $fwRule = Get-NetFirewallRule -DisplayName "Metro Bundler (8081)" -ErrorAction SilentlyContinue
    if (-not $fwRule) {
        Write-Host "  ⚠ Creating firewall rule for port 8081..." -ForegroundColor Yellow
        try {
            New-NetFirewallRule -DisplayName "Metro Bundler (8081)" `
                -Direction Inbound -Protocol TCP -LocalPort 8081 `
                -Action Allow -Profile Any -ErrorAction Stop | Out-Null
            Write-Host "  ✓ Firewall rule created" -ForegroundColor Green
        } catch {
            Write-Host "  ⚠ Could not create firewall rule (run as Admin for auto-config)" -ForegroundColor DarkYellow
        }
    } else {
        Write-Host "  ✓ Firewall configured" -ForegroundColor Green
    }
} else {
    Write-Host "  ⚠ Could not detect LAN IP - using localhost" -ForegroundColor Yellow
    $lanIP = "localhost"
}

Write-Host ""

# Step 4: Start file watcher (background job)
Write-Host "👀 Step 4: Real-time file watcher..." -ForegroundColor Yellow

if ($NoWatch) {
    Write-Host "  ⊘ File watcher disabled (-NoWatch)" -ForegroundColor DarkYellow
    $watcherJob = $null
} else {
    $watcherJob = Start-Job -ArgumentList $SOURCE_DIR, $BUILD_DIR, $IGNORE_DIRS, $Verbose -ScriptBlock {
        param($SRC, $DST, $IGNORE, $VERBOSE)

        function Test-Ignored($path) {
            foreach ($dir in $IGNORE) {
                if ($path -like "*\$dir\*" -or $path -like "*\$dir") { return $true }
            }
            if ($path -like "*.log") { return $true }
            return $false
        }

        $watcher = New-Object System.IO.FileSystemWatcher
        $watcher.Path = $SRC
        $watcher.IncludeSubdirectories = $true
        $watcher.NotifyFilter = [System.IO.NotifyFilters]::FileName -bor
                                [System.IO.NotifyFilters]::LastWrite -bor
                                [System.IO.NotifyFilters]::DirectoryName
        $watcher.EnableRaisingEvents = $true

        $lastSync = @{}
        $syncCount = 0

        while ($true) {
            $event = $watcher.WaitForChanged([System.IO.WatcherChangeTypes]::All, 1000)

            if ($event.TimedOut) { continue }

            $fullPath = Join-Path $SRC $event.Name
            $relPath  = $event.Name
            $now      = [DateTime]::Now

            if (Test-Ignored $relPath) { 
                if ($VERBOSE) {
                    Write-Output "[$(Get-Date -Format 'HH:mm:ss')] Ignored: $relPath"
                }
                continue 
            }
            
            if ($lastSync.ContainsKey($relPath) -and ($now - $lastSync[$relPath]).TotalMilliseconds -lt 500) { continue }
            $lastSync[$relPath] = $now

            $destPath = Join-Path $DST $relPath

            try {
                if ($event.ChangeType -eq [System.IO.WatcherChangeTypes]::Deleted) {
                    if (Test-Path $destPath) {
                        Remove-Item $destPath -Force -ErrorAction SilentlyContinue
                        $syncCount++
                        Write-Output "[$(Get-Date -Format 'HH:mm:ss')] ✗ Deleted: $relPath" 
                    }
                }
                elseif (Test-Path $fullPath -PathType Leaf) {
                    $destDir = Split-Path $destPath -Parent
                    if (-not (Test-Path $destDir)) {
                        New-Item -ItemType Directory -Path $destDir -Force | Out-Null
                    }
                    Copy-Item -Path $fullPath -Destination $destPath -Force
                    $syncCount++
                    
                    $size = (Get-Item $fullPath).Length
                    $sizeKB = [math]::Round($size/1KB, 1)
                    Write-Output "[$(Get-Date -Format 'HH:mm:ss')] ✓ Synced: $relPath ($sizeKB KB)"
                }
            } catch {
                Write-Output "[$(Get-Date -Format 'HH:mm:ss')] ✗ Error syncing $relPath : $_"
            }
        }
    }

    Write-Host "  ✓ Watcher running (Job ID: $($watcherJob.Id))" -ForegroundColor Green
    Write-Host "  → Edits auto-sync from source to build dir" -ForegroundColor DarkGray
    if ($Verbose) {
        Write-Host "  → Verbose logging enabled" -ForegroundColor DarkGray
    }
}

Write-Host ""

# Step 5: Set env and start Metro
$env:REACT_NATIVE_PACKAGER_HOSTNAME = $lanIP

Write-Host "🚀 Step 5: Starting Metro bundler..." -ForegroundColor Cyan
Write-Host "────────────────────────────────────────────────" -ForegroundColor Dark Gray
Write-Host ""
Write-Host "  📱 Phone URL:  http://${lanIP}:8081" -ForegroundColor Green
Write-Host "  🌍 Web:        http://localhost:8081" -ForegroundColor Green
Write-Host "  🔍 Debugger:   http://localhost:8081/debugger-ui" -ForegroundColor Green
Write-Host ""
Write-Host "  Mode:      " -NoNewline
if ($Tunnel) {
    Write-Host "Tunnel (ngrok)" -ForegroundColor Magenta
} else {
    Write-Host "LAN" -ForegroundColor Cyan
}

if (-not $NoWatch) {
    Write-Host "  Watcher:   Enabled ✓" -ForegroundColor Green
}

Write-Host ""
Write-Host "  💡 Tip: Press 'r' to reload, 'j' to open debugger" -ForegroundColor DarkYellow
Write-Host "  ⚠  Press Ctrl+C to stop Metro & cleanup" -ForegroundColor Yellow
Write-Host ""
Write-Host "════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# Auto-open debugger if requested
if ($OpenDebugger) {
    Start-Sleep 3
    Start-Process "http://localhost:8081/debugger-ui"
}

# Build Metro command
$expoArgs = @("expo", "start", "--dev-client", "--host")
if ($Tunnel) {
    $expoArgs += "tunnel"
} else {
    $expoArgs += "lan"
}
if ($ClearCache) {
    $expoArgs += "--clear"
}

try {
    npx @expoArgs
} finally {
    # ════════════════════════════════════════════════════════════
    # CLEANUP & STATS
    # ════════════════════════════════════════════════════════════
    
    Write-Host ""
    Write-Host "════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host "  Shutting down..." -ForegroundColor Yellow
    Write-Host ""
    
    if ($watcherJob) {
        Write-Host "  Stopping file watcher..." -ForegroundColor Gray
        
        # Show recent sync activity
        $recentLogs = Receive-Job -Job $watcherJob -ErrorAction SilentlyContinue | Select-Object -Last 10
        if ($recentLogs) {
            Write-Host "  Recent sync activity:" -ForegroundColor DarkGray
            $recentLogs | ForEach-Object {
                Write-Host "    $_" -ForegroundColor DarkGray
            }
        }
        
        Stop-Job -Job $watcherJob -ErrorAction SilentlyContinue
        Remove-Job -Job $watcherJob -ErrorAction SilentlyContinue
        Write-Host "  ✓ Watcher stopped" -ForegroundColor Green
    }
    
    # Session stats
    $duration = (Get-Date) - $script:startTime
    Write-Host ""
    Write-Host "  📊 Session Stats:" -ForegroundColor Cyan
    Write-Host "     Duration: $($duration.Hours)h $($duration.Minutes)m $($duration.Seconds)s" -ForegroundColor White
    Write-Host ""
    
    Write-Host "  ✓ Dev environment shut down cleanly" -ForegroundColor Green
    Write-Host "════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host ""
}
