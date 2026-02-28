# install.ps1 — Build, package, and install the ContextManager extension
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Push-Location $scriptDir

try {
    Write-Host ">> Compiling TypeScript..." -ForegroundColor Cyan
    npm run compile
    if ($LASTEXITCODE -ne 0) { throw "Compile failed" }

    Write-Host ">> Packaging VSIX..." -ForegroundColor Cyan
    # Install vsce locally if not present
    if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
        throw "npx not found — ensure Node.js is on PATH"
    }
    npx @vscode/vsce package --allow-missing-repository --allow-star-activation --out context-manager.vsix
    if ($LASTEXITCODE -ne 0) { throw "Packaging failed" }

    $vsix = Resolve-Path "context-manager.vsix"
    Write-Host ">> Installing $vsix into VS Code..." -ForegroundColor Cyan
    code --install-extension "$vsix" --force
    if ($LASTEXITCODE -ne 0) { throw "Install failed" }

    Write-Host ""
    Write-Host "✅  ContextManager installed successfully. Reload VS Code to activate." -ForegroundColor Green
} finally {
    Pop-Location
}
