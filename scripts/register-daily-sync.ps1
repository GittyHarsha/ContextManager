#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Register (or unregister) the ContextManager daily sync as a Windows Scheduled Task.

.PARAMETER Unregister
    Remove the scheduled task instead of creating it.

.PARAMETER Time
    Time to run daily (default: "09:00"). Format: "HH:mm".

.PARAMETER AtLogon
    Run at user logon instead of at a fixed time.
#>

param(
    [switch]$Unregister,
    [string]$Time = "09:00",
    [switch]$AtLogon
)

$ErrorActionPreference = "Stop"
$taskName = "ContextManager-DailySync"
$scriptDir = $PSScriptRoot
$syncScript = Join-Path $scriptDir "daily-sync.ps1"

if ($Unregister) {
    Write-Host "Removing scheduled task: $taskName" -ForegroundColor Yellow
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "Done." -ForegroundColor Green
    exit 0
}

if (-not (Test-Path $syncScript)) {
    Write-Host "ERROR: daily-sync.ps1 not found at $syncScript" -ForegroundColor Red
    exit 1
}

# Check if task already exists
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Task '$taskName' already exists. Updating..." -ForegroundColor Yellow
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

# Build trigger
if ($AtLogon) {
    $trigger = New-ScheduledTaskTrigger -AtLogOn
    Write-Host "Trigger: At logon" -ForegroundColor Cyan
} else {
    $parts = $Time -split ':'
    $triggerTime = [DateTime]::Today.AddHours([int]$parts[0]).AddMinutes([int]$parts[1])
    $trigger = New-ScheduledTaskTrigger -Daily -At $triggerTime
    Write-Host "Trigger: Daily at $Time" -ForegroundColor Cyan
}

# Build action — run daily-sync.ps1 in the extension directory
$extensionRoot = Split-Path -Parent $scriptDir
$action = New-ScheduledTaskAction `
    -Execute "pwsh.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$syncScript`"" `
    -WorkingDirectory $extensionRoot

# Settings: allow on battery, don't stop on battery, run whether logged in or not
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1)

# Register
Register-ScheduledTask `
    -TaskName $taskName `
    -Description "Daily analysis of vscode-copilot-chat upstream changes for ContextManager (report only, no auto-changes)" `
    -Trigger $trigger `
    -Action $action `
    -Settings $settings `
    -Force

Write-Host ""
Write-Host "=== Scheduled Task Registered ===" -ForegroundColor Green
Write-Host "Task name: $taskName"
Write-Host "Script:    $syncScript"
Write-Host "Working:   $extensionRoot"
Write-Host ""
Write-Host "To test: schtasks /run /tn `"$taskName`""
Write-Host "To view: Get-ScheduledTask -TaskName '$taskName' | Format-List"
Write-Host "To remove: .\register-daily-sync.ps1 -Unregister"
