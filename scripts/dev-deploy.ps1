# dev-deploy.ps1 — Compile TypeScript and deploy to the installed extension
# Usage: .\scripts\dev-deploy.ps1
#   -Watch    Start tsc in watch mode + auto-deploy on change
#   -NoBuild  Skip compilation, just copy existing output
#
# After running, reload VS Code (Ctrl+Shift+P → "Developer: Reload Window").

param(
    [switch]$Watch,
    [switch]$NoBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$outDir      = Join-Path $projectRoot 'out'
$tsc         = Join-Path $projectRoot 'node_modules\typescript\bin\tsc'

# ── Resolve installed extension path ──────────────────────────────
$packageJson = Get-Content (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
$extId       = "$($packageJson.publisher).$($packageJson.name)-$($packageJson.version)".ToLower()
$extDir      = Join-Path $env:USERPROFILE ".vscode\extensions\$extId"

if (-not (Test-Path $extDir)) {
    # Try finding it with a wildcard (version mismatch)
    $candidates = Get-ChildItem (Join-Path $env:USERPROFILE '.vscode\extensions') -Directory `
        | Where-Object { $_.Name -like "$($packageJson.publisher).$($packageJson.name)-*".ToLower() } `
        | Sort-Object Name -Descending
    if ($candidates.Count -gt 0) {
        $extDir = $candidates[0].FullName
        Write-Host "  Found installed extension at: $extDir" -ForegroundColor DarkGray
    } else {
        Write-Host "ERROR: No installed extension found matching '$extId'." -ForegroundColor Red
        Write-Host "  Run install.ps1 first to create the initial install." -ForegroundColor Yellow
        exit 1
    }
}

$extOutDir = Join-Path $extDir 'out'

function Deploy-Output {
    <#
    .SYNOPSIS Copy compiled JS + sourcemaps from out/ to the installed extension.
    #>
    $copied = 0
    Get-ChildItem $outDir -Recurse -Include '*.js','*.js.map' | ForEach-Object {
        $rel  = $_.FullName.Substring($outDir.Length)
        $dest = Join-Path $extOutDir $rel
        $destDir = Split-Path $dest -Parent
        if (-not (Test-Path $destDir)) { New-Item $destDir -ItemType Directory -Force | Out-Null }
        Copy-Item $_.FullName $dest -Force
        $copied++
    }
    # Also copy the WASM file if present
    $wasm = Join-Path $outDir 'sql-wasm.wasm'
    if (Test-Path $wasm) {
        Copy-Item $wasm (Join-Path $extOutDir 'sql-wasm.wasm') -Force
        $copied++
    }
    $ts = Get-Date -Format 'HH:mm:ss'
    Write-Host "[$ts] Deployed $copied files → $extDir" -ForegroundColor Green
}

# ── Watch mode ────────────────────────────────────────────────────
if ($Watch) {
    Write-Host "Starting watch mode (compile + deploy on save)..." -ForegroundColor Cyan
    Write-Host "  Source:  $projectRoot\src" -ForegroundColor DarkGray
    Write-Host "  Target:  $extDir" -ForegroundColor DarkGray
    Write-Host "  Press Ctrl+C to stop." -ForegroundColor DarkGray
    Write-Host ""

    # Initial build + deploy
    Write-Host ">> Initial compile..." -ForegroundColor Cyan
    & node $tsc -p $projectRoot 2>&1 | ForEach-Object { Write-Host "  $_" }
    if ($LASTEXITCODE -ne 0) { Write-Host "  Compile errors found — fix and save to retry." -ForegroundColor Yellow }
    Deploy-Output

    # Watch for .ts file changes
    $watcher = New-Object System.IO.FileSystemWatcher
    $watcher.Path = Join-Path $projectRoot 'src'
    $watcher.Filter = '*.ts'
    $watcher.IncludeSubdirectories = $true
    $watcher.EnableRaisingEvents = $true

    $debounceTimer = $null
    $action = {
        # Debounce: wait 500ms after last change before recompiling
        if ($null -ne $script:debounceTimer) { $script:debounceTimer.Dispose() }
        $script:debounceTimer = New-Object System.Timers.Timer
        $script:debounceTimer.Interval = 500
        $script:debounceTimer.AutoReset = $false
        $recompileAction = [scriptblock]::Create(@"
            Write-Host ""
            Write-Host ">> Recompiling..." -ForegroundColor Cyan
            & node "$tsc" -p "$projectRoot" 2>&1 | ForEach-Object { Write-Host "  `$_" }
            if (`$LASTEXITCODE -eq 0) {
                Deploy-Output
                Write-Host "  Ready — reload VS Code to activate changes." -ForegroundColor DarkGray
            } else {
                Write-Host "  Compile errors — fix and save to retry." -ForegroundColor Yellow
            }
"@)
        Register-ObjectEvent -InputObject $script:debounceTimer -EventName Elapsed -Action $recompileAction | Out-Null
        $script:debounceTimer.Start()
    }

    Register-ObjectEvent -InputObject $watcher -EventName Changed -Action $action | Out-Null
    Register-ObjectEvent -InputObject $watcher -EventName Created -Action $action | Out-Null
    Register-ObjectEvent -InputObject $watcher -EventName Renamed -Action $action | Out-Null

    Write-Host "Watching for changes... (Ctrl+C to stop)" -ForegroundColor Cyan
    try { while ($true) { Start-Sleep -Seconds 1 } }
    finally { $watcher.Dispose() }
    return
}

# ── One-shot mode ─────────────────────────────────────────────────
if (-not $NoBuild) {
    Write-Host ">> Compiling TypeScript..." -ForegroundColor Cyan
    & node $tsc -p $projectRoot 2>&1 | ForEach-Object { Write-Host "  $_" }
    if ($LASTEXITCODE -ne 0) { throw "Compile failed" }
    Write-Host "  Compile OK." -ForegroundColor Green
}

Write-Host ">> Deploying to installed extension..." -ForegroundColor Cyan
Deploy-Output

Write-Host ""
Write-Host "Done. Reload VS Code (Ctrl+Shift+P -> 'Developer: Reload Window') to activate." -ForegroundColor Green
