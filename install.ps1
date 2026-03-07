# install.ps1 -- Build, validate, package, and install the ContextManager extension
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Push-Location $scriptDir

try {
    # ── 1. Build (type-check + esbuild bundle) ──
    Write-Host ">> Building (type-check + esbuild bundle)..." -ForegroundColor Cyan
    npm run compile
    if ($LASTEXITCODE -ne 0) { throw "Build failed" }
    Write-Host "   Build OK" -ForegroundColor Green

    # ── 2. Package VSIX ──
    Write-Host ">> Packaging VSIX..." -ForegroundColor Cyan
    $version = (Get-Content package.json | ConvertFrom-Json).version
    $vsixName = "context-manager-$version.vsix"
    # Use node directly — npx output gets swallowed in VS Code integrated terminals
    node node_modules/@vscode/vsce/vsce package --allow-missing-repository --allow-star-activation --out $vsixName
    if ($LASTEXITCODE -ne 0) { throw "Packaging failed" }

    $vsix = Resolve-Path $vsixName
    $sizeMB = [math]::Round((Get-Item $vsix).Length / 1MB, 1)
    Write-Host "   VSIX: $vsix ($sizeMB MB, v$version)" -ForegroundColor Green

    # ── 3. Remove old extension directory, then install ──
    $extDir = "$env:USERPROFILE\.vscode\extensions"
    $oldDirs = Get-ChildItem $extDir -Directory -Filter "local-dev.context-manager-*" -ErrorAction SilentlyContinue
    if ($oldDirs) {
        Write-Host ">> Removing old extension directories..." -ForegroundColor Cyan
        $oldDirs | ForEach-Object {
            Write-Host "   Removing $($_.Name)"
            Remove-Item $_.FullName -Recurse -Force
        }
    }

    Write-Host ">> Installing into VS Code..." -ForegroundColor Cyan
    code --install-extension "$vsix" --force
    if ($LASTEXITCODE -ne 0) { throw "Install failed" }

    # ── 4. Verify installation ──
    # VS Code defers extraction when running — poll for up to 15 seconds
    $installed = $null
    for ($i = 0; $i -lt 5; $i++) {
        Start-Sleep -Seconds 3
        $installed = Get-ChildItem $extDir -Directory -Filter "local-dev.context-manager-*" -ErrorAction SilentlyContinue
        if ($installed) {
            $instPkg = Get-Content (Join-Path $installed[0].FullName "package.json") -ErrorAction SilentlyContinue | ConvertFrom-Json
            if ($instPkg -and $instPkg.version -eq $version) { break }
        }
    }

    if ($installed) {
        $instPkg = Get-Content (Join-Path $installed[0].FullName "package.json") -ErrorAction SilentlyContinue | ConvertFrom-Json
        if ($instPkg.version -eq $version -and $instPkg.main -eq "./dist/extension.js") {
            Write-Host "   Verified: $($installed[0].Name) v$($instPkg.version)" -ForegroundColor Green
        } elseif ($instPkg.version -eq $version) {
            Write-Host "   Installed v$($instPkg.version) (main=$($instPkg.main))" -ForegroundColor Green
        } else {
            Write-Host "   WARNING: Installed version is v$($instPkg.version), expected v$version" -ForegroundColor Yellow
        }
    } else {
        Write-Host "   Extension directory not created yet — VS Code will install on next reload" -ForegroundColor Yellow
    }

    Write-Host ""
    Write-Host "ContextManager v$version installed. Reload VS Code (Ctrl+Shift+P > Reload Window)." -ForegroundColor Green
} finally {
    Pop-Location
}