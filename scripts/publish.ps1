#!/usr/bin/env pwsh
# publish.ps1 — Package for marketplace (swaps publisher, builds, swaps back)
#
# IMPORTANT: Use `node node_modules/@vscode/vsce/vsce` — NOT npx.
# npx output gets swallowed in VS Code integrated terminals.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$pkg = Join-Path $root "package.json"
$publisherId = "HarshaNarayanaP"

Write-Host "=== Packaging for Marketplace ===" -ForegroundColor Cyan

# Read original
$original = Get-Content $pkg -Raw

# Read version for output filename
$version = ($original | ConvertFrom-Json).version
$vsixName = "context-manager-$version.vsix"

# Swap publisher
$modified = $original -replace '"publisher":\s*"local-dev"', "`"publisher`": `"$publisherId`""
Set-Content $pkg -Value $modified -NoNewline

try {
    Push-Location $root
    Write-Host "Publisher set to: $publisherId"

    # Use node directly — npx output is swallowed in VS Code terminals
    node node_modules/@vscode/vsce/vsce package --allow-missing-repository --allow-star-activation
    if ($LASTEXITCODE -ne 0) { throw "vsce package failed (exit $LASTEXITCODE)" }

    Pop-Location

    # Verify the VSIX was created and has the correct publisher
    $vsixPath = Join-Path $root $vsixName
    if (-not (Test-Path $vsixPath)) { throw "Expected $vsixName not found" }
    $sizeMB = [math]::Round((Get-Item $vsixPath).Length / 1MB, 1)

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::OpenRead($vsixPath)
    $entry = $zip.Entries | Where-Object { $_.FullName -eq 'extension/package.json' }
    $reader = New-Object System.IO.StreamReader($entry.Open())
    $inner = $reader.ReadToEnd() | ConvertFrom-Json
    $reader.Close()
    $zip.Dispose()

    if ($inner.publisher -ne $publisherId) {
        throw "VSIX publisher is '$($inner.publisher)' — expected '$publisherId'"
    }

    Write-Host "`n=== Done ==="                                   -ForegroundColor Green
    Write-Host "  $vsixName ($sizeMB MB)"                        -ForegroundColor Green
    Write-Host "  Publisher: $($inner.publisher)  Version: $($inner.version)" -ForegroundColor Green
    Write-Host "  Upload at https://marketplace.visualstudio.com/manage"
} finally {
    # Always restore original publisher
    Set-Content $pkg -Value $original -NoNewline
    Write-Host "Publisher restored to: local-dev" -ForegroundColor Yellow
}
