#!/usr/bin/env pwsh
# publish.ps1 — Package for marketplace (swaps publisher, builds, swaps back)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$pkg = Join-Path $root "package.json"
$publisherId = "HarshaNarayanaP"

Write-Host "=== Packaging for Marketplace ===" -ForegroundColor Cyan

# Read original
$original = Get-Content $pkg -Raw

# Swap publisher
$modified = $original -replace '"publisher":\s*"local-dev"', "`"publisher`": `"$publisherId`""
Set-Content $pkg -Value $modified -NoNewline

try {
    Push-Location $root
    Write-Host "Publisher set to: $publisherId"
    npx @vscode/vsce package --allow-missing-repository --allow-star-activation
    Pop-Location
    Write-Host "`n=== Done ===" -ForegroundColor Green
    Write-Host "Upload the .vsix at https://marketplace.visualstudio.com/manage"
} finally {
    # Always restore original publisher
    Set-Content $pkg -Value $original -NoNewline
    Write-Host "Publisher restored to: local-dev" -ForegroundColor Yellow
}
