# install.ps1 - Package and install the Code Explainer extension
# Usage: .\scripts\install.ps1

param(
    [switch]$SkipCompile,
    [switch]$Uninstall
)

$ErrorActionPreference = "Stop"
$extensionDir = Split-Path -Parent $PSScriptRoot
$packageJsonPath = Join-Path $extensionDir "package.json"
$packageJson = Get-Content $packageJsonPath -Raw | ConvertFrom-Json
$extensionId = "$($packageJson.publisher).$($packageJson.name)"

Write-Host "=== Code Explainer Extension Installer ===" -ForegroundColor Cyan
Write-Host ""

# Change to extension directory
Push-Location $extensionDir

try {
    # Uninstall if requested
    if ($Uninstall) {
        Write-Host "Uninstalling extension..." -ForegroundColor Yellow
        $installed = code --list-extensions | Where-Object { $_ -like "*$extensionId*" }
        if ($installed) {
            code --uninstall-extension $installed
            Write-Host "Extension uninstalled." -ForegroundColor Green
        } else {
            Write-Host "Extension not found." -ForegroundColor Gray
        }
        exit 0
    }

    # Check for vsce
    $vsceInstalled = Get-Command vsce -ErrorAction SilentlyContinue
    if (-not $vsceInstalled) {
        Write-Host "Installing vsce..." -ForegroundColor Yellow
        npm install -g @vscode/vsce
        if ($LASTEXITCODE -ne 0) { throw "Failed to install vsce" }
    }

    # Compile TypeScript
    if (-not $SkipCompile) {
        Write-Host "Compiling TypeScript..." -ForegroundColor Yellow
        npm run compile
        if ($LASTEXITCODE -ne 0) { throw "Compilation failed" }
        Write-Host "Compilation successful." -ForegroundColor Green
    }

    # Remove old .vsix files
    Get-ChildItem -Filter "*.vsix" | Remove-Item -Force

    # Package the extension
    Write-Host "Packaging extension..." -ForegroundColor Yellow
    echo "y" | vsce package --allow-missing-repository
    if ($LASTEXITCODE -ne 0) { throw "Packaging failed" }

    # Find the generated .vsix file
    $vsix = Get-ChildItem -Filter "*.vsix" | Select-Object -First 1
    if (-not $vsix) { throw "No .vsix file found" }
    Write-Host "Created: $($vsix.Name)" -ForegroundColor Green

    # Uninstall any existing version
    Write-Host "Checking for existing installation..." -ForegroundColor Yellow
    $installed = code --list-extensions | Where-Object { $_ -like "*$extensionId*" }
    if ($installed) {
        Write-Host "Uninstalling existing version..." -ForegroundColor Yellow
        code --uninstall-extension $installed 2>$null
    }

    # Install the new version
    Write-Host "Installing extension..." -ForegroundColor Yellow
    code --install-extension $vsix.FullName
    if ($LASTEXITCODE -ne 0) { throw "Installation failed" }

    Write-Host ""
    Write-Host "=== Installation Complete ===" -ForegroundColor Green
    Write-Host "Reload VS Code to activate the extension." -ForegroundColor Cyan
    Write-Host ""
    Write-Host "To reload: Ctrl+Shift+P -> 'Developer: Reload Window'" -ForegroundColor Gray

} finally {
    Pop-Location
}
