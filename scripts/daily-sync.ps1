#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Daily sync script — pulls vscode-copilot-chat, detects changes, and either
    saves a report (scheduled mode) or launches copilot CLI (manual mode).

.DESCRIPTION
    Two modes:
    - SCHEDULED (default): Pull, analyze, save report to sync-report.md, show
      a Windows toast notification. No copilot CLI launched.
    - MANUAL (-Go): Same analysis, then launches copilot CLI in interactive mode
      to implement changes with your approval.

    Run without -Go from Task Scheduler. Run with -Go when you're ready to act.

.PARAMETER Go
    Launch copilot CLI to implement changes (manual mode).

.PARAMETER Force
    Force sync even if no new commits are detected.

.PARAMETER DryRun
    Show what would be done without updating state or launching anything.

.PARAMETER Model
    Specify the copilot model to use (default: claude-sonnet-4).
#>

param(
    [switch]$Go,
    [switch]$Force,
    [switch]$DryRun,
    [string]$Model = "claude-sonnet-4"
)

$ErrorActionPreference = "Stop"

# ─── Paths ───────────────────────────────────────────────────────
$scriptDir = $PSScriptRoot
$extensionRoot = Split-Path -Parent $scriptDir
$copilotChatRoot = Join-Path (Split-Path -Parent $extensionRoot) "vscode-copilot-chat"
$stateFile = Join-Path $scriptDir ".sync-state.json"
$logFile = Join-Path $scriptDir "sync-log.md"
$reportFile = Join-Path $scriptDir "sync-report.md"

# ─── Validate prerequisites ─────────────────────────────────────
if (-not (Test-Path $copilotChatRoot)) {
    Write-Host "ERROR: vscode-copilot-chat not found at $copilotChatRoot" -ForegroundColor Red
    exit 1
}

if ($Go -and -not (Get-Command "copilot" -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: copilot CLI not found in PATH. Install it first." -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $stateFile)) {
    Write-Host "ERROR: .sync-state.json not found. Initialize it first." -ForegroundColor Red
    exit 1
}

# ─── Read sync state ─────────────────────────────────────────────
$state = Get-Content $stateFile -Raw | ConvertFrom-Json
$lastCommit = $state.lastCommit
$lastSyncDate = $state.lastSyncDate
$totalSyncs = $state.totalSyncs

Write-Host "=== ContextManager Daily Sync ===" -ForegroundColor Cyan
Write-Host "Last sync: $lastSyncDate (commit: $lastCommit)"
Write-Host "Total syncs: $totalSyncs"
Write-Host ""

# ─── Pull latest vscode-copilot-chat ─────────────────────────────
Write-Host "Pulling latest vscode-copilot-chat..." -ForegroundColor Yellow
Push-Location $copilotChatRoot
try {
    git fetch origin 2>&1 | Out-Null
    git pull origin main --ff-only 2>&1 | Out-Null
} catch {
    Write-Host "WARNING: Git pull failed, continuing with local state." -ForegroundColor Yellow
}

# ─── Check for new commits ───────────────────────────────────────
$headCommit = (git rev-parse --short HEAD).Trim()
$headCommitFull = (git rev-parse HEAD).Trim()

if ($headCommit -eq $lastCommit -and -not $Force) {
    Write-Host "No new commits since last sync. Already up to date." -ForegroundColor Green
    Pop-Location
    exit 0
}

Write-Host "New commits detected: $lastCommit..$headCommit" -ForegroundColor Green
Write-Host ""

# ─── Gather changes ─────────────────────────────────────────────
$commitLog = git log --oneline --no-merges "$lastCommit..HEAD" 2>$null
if (-not $commitLog) {
    $commitLog = git log --oneline --no-merges -20
}
$commitCount = ($commitLog | Measure-Object).Count

$changedFiles = git diff --name-status "$lastCommit..HEAD" 2>$null
if (-not $changedFiles) {
    $changedFiles = git diff --name-status "HEAD~20..HEAD"
}

$changedDts = $changedFiles | Where-Object { $_ -match '\.d\.ts$' }
$changedDtsInExtension = $changedDts | Where-Object {
    $_ -match 'vscode\.proposed\.' -or $_ -match 'vscode\.d\.ts'
}

# Our proposed API files
$ourApis = @(
    "chatHooks",
    "chatParticipantAdditions",
    "chatSessionsProvider",
    "chatStatusItem",
    "embeddings",
    "languageModelSystem",
    "languageModelToolSupportsModel",
    "mcpServerDefinitions"
)

# Which of our APIs have upstream changes
$impactedApis = @()
foreach ($api in $ourApis) {
    $pattern = "vscode.proposed.$api"
    $match = $changedDtsInExtension | Where-Object { $_ -match [regex]::Escape($pattern) }
    if ($match) {
        $impactedApis += $api
    }
}

# New proposed APIs we don't use
$allUpstreamDts = git ls-files "src/extension/vscode.proposed.*.d.ts" 2>$null
$newApis = @()
if ($allUpstreamDts) {
    foreach ($f in $allUpstreamDts) {
        $basename = [System.IO.Path]::GetFileName($f)
        $apiName = $basename -replace '^vscode\.proposed\.', '' -replace '\.d\.ts$', ''
        if ($apiName -and $ourApis -notcontains $apiName) {
            $newApis += $apiName
        }
    }
}

Pop-Location

# ─── Console report ──────────────────────────────────────────────
Write-Host "━━━ Change Summary ━━━" -ForegroundColor Cyan
Write-Host "Commits: $commitCount new commits"
Write-Host "Changed files: $(($changedFiles | Measure-Object).Count)"
Write-Host "Changed .d.ts: $(($changedDtsInExtension | Measure-Object).Count)"

if ($impactedApis.Count -gt 0) {
    Write-Host ""
    Write-Host "⚠️  IMPACTED PROPOSED APIs (we use these):" -ForegroundColor Red
    foreach ($api in $impactedApis) {
        Write-Host "  - $api" -ForegroundColor Red
    }
}

if ($newApis.Count -gt 0) {
    Write-Host ""
    Write-Host "🆕 New proposed APIs available: $($newApis.Count)" -ForegroundColor Yellow
}

Write-Host ""

# ─── Build report ────────────────────────────────────────────────
$today = Get-Date -Format "yyyy-MM-dd"
$impactLevel = if ($impactedApis.Count -gt 0) { "⚠️ HIGH" } else { "✅ LOW" }

$report = @"
# Sync Report — $today

**Impact Level: $impactLevel**
**Commits:** $lastCommit → $headCommit ($commitCount new)
**Changed files:** $(($changedFiles | Measure-Object).Count) | **Changed .d.ts:** $(($changedDtsInExtension | Measure-Object).Count)

$(if ($impactedApis.Count -gt 0) {
"## ⚠️ Impacted APIs (we depend on these)
$($impactedApis | ForEach-Object { "- **$_** — our copy may need updating" } | Out-String)"
} else {
"## ✅ No Impacted APIs
None of our 8 proposed API dependencies were changed upstream."
})

$(if ($newApis.Count -gt 0) {
"## 🆕 New Proposed APIs Available ($($newApis.Count))
$($newApis | Select-Object -First 15 | ForEach-Object { "- $_" } | Out-String)$(if ($newApis.Count -gt 15) { "- ...and $($newApis.Count - 15) more`n" })"
})

## Recent Commits
``````
$($commitLog | Select-Object -First 30 | Out-String)``````

$(if ($changedDtsInExtension) {
"## Changed .d.ts Files
``````
$($changedDtsInExtension | Out-String)``````"
})

---
**Next step:** Run ``.\scripts\daily-sync.ps1 -Go`` to launch copilot CLI and implement changes.
"@

if ($DryRun) {
    Write-Host "[DRY RUN] Report preview:" -ForegroundColor Yellow
    Write-Host $report
    exit 0
}

# ─── Save report ─────────────────────────────────────────────────
Set-Content -Path $reportFile -Value $report
Write-Host "Report saved: $reportFile" -ForegroundColor Green

# ─── Update sync state ───────────────────────────────────────────
$newState = @{
    lastCommit   = $headCommit
    lastSyncDate = $today
    totalSyncs   = $totalSyncs + 1
} | ConvertTo-Json -Depth 2

Set-Content -Path $stateFile -Value $newState -NoNewline

# ─── Append to sync log ──────────────────────────────────────────
$logEntry = @"

---

## Sync #$($totalSyncs + 1) — $today

- **Commits**: $lastCommit..$headCommit ($commitCount new)
- **Impact**: $impactLevel
- **Impacted APIs**: $(if ($impactedApis.Count -gt 0) { $impactedApis -join ", " } else { "None" })
- **New APIs**: $(if ($newApis.Count -gt 0) { "$($newApis.Count) available" } else { "None" })

"@

if (-not (Test-Path $logFile)) {
    $header = @"
# ContextManager — vscode-copilot-chat Sync Log

Tracks daily syncs with the upstream vscode-copilot-chat repository.

"@
    Set-Content -Path $logFile -Value $header
}

Add-Content -Path $logFile -Value $logEntry
Write-Host "Sync log updated: $logFile" -ForegroundColor Green

# ─── Toast notification (Windows) ────────────────────────────────
try {
    $title = "ContextManager Sync"
    $body = "$commitCount new commits"
    if ($impactedApis.Count -gt 0) {
        $body += " | ⚠️ $($impactedApis.Count) impacted API(s): $($impactedApis -join ', ')"
    } else {
        $body += " | ✅ No breaking changes"
    }
    $body += "`nRun: .\scripts\daily-sync.ps1 -Go"

    # Use BurntToast if available, otherwise fallback to .NET
    if (Get-Module -ListAvailable -Name BurntToast -ErrorAction SilentlyContinue) {
        Import-Module BurntToast
        New-BurntToastNotification -Text $title, $body
    } else {
        # Fallback: Windows .NET toast
        Add-Type -AssemblyName System.Windows.Forms
        $notify = New-Object System.Windows.Forms.NotifyIcon
        $notify.Icon = [System.Drawing.SystemIcons]::Information
        $notify.BalloonTipIcon = if ($impactedApis.Count -gt 0) { "Warning" } else { "Info" }
        $notify.BalloonTipTitle = $title
        $notify.BalloonTipText = $body
        $notify.Visible = $true
        $notify.ShowBalloonTip(10000)
        Start-Sleep -Seconds 12
        $notify.Dispose()
    }
} catch {
    Write-Host "Toast notification failed (non-critical): $_" -ForegroundColor Yellow
}

# ─── If -Go: launch copilot CLI ─────────────────────────────────
if (-not $Go) {
    Write-Host ""
    Write-Host "=== Analysis Complete ===" -ForegroundColor Cyan
    Write-Host "Report: $reportFile" -ForegroundColor Green
    Write-Host "To implement changes: .\scripts\daily-sync.ps1 -Go" -ForegroundColor Yellow
    exit 0
}

# ─── Build copilot prompt ────────────────────────────────────────
Write-Host ""
Write-Host "Launching copilot CLI..." -ForegroundColor Cyan

$impactedSection = ""
if ($impactedApis.Count -gt 0) {
    $impactedSection = @"

## ⚠️ IMPACTED APIs (HIGH PRIORITY)
The following proposed APIs that ContextManager depends on have upstream changes:
$($impactedApis | ForEach-Object { "- $_" } | Out-String)
For each impacted API:
1. Read the upstream .d.ts at vscode-copilot-chat/src/extension/vscode.proposed.$_.d.ts
2. Compare with our copy at codebase-navigator/src/vscode.proposed.$_.d.ts
3. Identify breaking changes, new types, removed types, signature changes
4. Update our .d.ts copy if needed
5. Update src/proposedApi.ts to handle any new/changed APIs
"@
}

$newApisSection = ""
if ($newApis.Count -gt 0) {
    $newApisSection = @"

## 🆕 New Proposed APIs Available
These exist upstream but we don't use them yet:
$($newApis | Select-Object -First 20 | ForEach-Object { "- $_" } | Out-String)
Evaluate if any would be valuable for ContextManager. Only suggest if clearly useful.
"@
}

$prompt = @"
You are analyzing changes to vscode-copilot-chat to determine impact on the ContextManager extension.

## Context
- **ContextManager**: q:\Edge\vscode-extension-samples\codebase-navigator
- **vscode-copilot-chat**: q:\Edge\vscode-extension-samples\vscode-copilot-chat
- **Last synced**: $lastCommit ($lastSyncDate) → Current: $headCommit
- **New commits**: $commitCount

## Recent Changes
$($commitLog | Select-Object -First 30 | Out-String)

## Changed .d.ts Files
$($changedDtsInExtension | Out-String)

## Our Proposed API Dependencies (8)
$($ourApis | ForEach-Object { "- $_ (src/vscode.proposed.$_.d.ts)" } | Out-String)
Implementation: src/proposedApi.ts (runtime feature detection with graceful fallbacks)
$impactedSection
$newApisSection

## Tasks
1. **Analyze**: Read changed .d.ts files (upstream vs ours). Report breaking changes.
2. **Propose**: Suggest specific modifications. Wait for my approval.
3. **Implement**: After approval, make changes.
4. **Verify**: Run ``npm run compile`` then ``.\scripts\install.ps1 -SkipCompile``
5. **Summary**: List all changes made.

## Build Commands
- Compile: ``npm run compile``
- Install: ``.\scripts\install.ps1 -SkipCompile``
- Package: ``.\scripts\publish.ps1``
"@

Push-Location $extensionRoot
copilot -i $prompt `
    --model $Model `
    --add-dir $extensionRoot `
    --add-dir $copilotChatRoot `
    --allow-all-tools `
    --allow-all-paths
$copilotExitCode = $LASTEXITCODE
Pop-Location

# Append implementation note to log
$implNote = "- **Copilot CLI exit code**: $copilotExitCode`n"
Add-Content -Path $logFile -Value $implNote

Write-Host ""
Write-Host "=== Sync Complete ===" -ForegroundColor Cyan
