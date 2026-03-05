# install.ps1 -- Build, validate, package, and install the ContextManager extension
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Push-Location $scriptDir

try {
    Write-Host ">> Compiling TypeScript..." -ForegroundColor Cyan
    npm run compile
    if ($LASTEXITCODE -ne 0) { throw "Compile failed" }

    Write-Host ">> Validating webview script..." -ForegroundColor Cyan
    node -e "const fs=require('fs'); const m=require('./out/dashboard/webviewScript.js'); const s=m.getDashboardScript('p','overview'); const start=s.indexOf('>')+1; const end=s.lastIndexOf('</script>'); fs.writeFileSync('.tmp-wv.js', s.slice(start,end));"
    node --check .tmp-wv.js
    if ($LASTEXITCODE -ne 0) {
        Remove-Item .tmp-wv.js -ErrorAction SilentlyContinue
        throw "Webview script has syntax errors -- fix before packaging"
    }
    Remove-Item .tmp-wv.js -ErrorAction SilentlyContinue
    Write-Host "   Webview script OK" -ForegroundColor Green

    Write-Host ">> Packaging VSIX..." -ForegroundColor Cyan
    # Use node directly — npx output gets swallowed in VS Code integrated terminals
    node node_modules/@vscode/vsce/vsce package --allow-missing-repository --allow-star-activation --out context-manager.vsix
    if ($LASTEXITCODE -ne 0) { throw "Packaging failed" }

    $vsix = Resolve-Path "context-manager.vsix"
    Write-Host ">> Installing $vsix into VS Code..." -ForegroundColor Cyan
    code --install-extension "$vsix" --force
    if ($LASTEXITCODE -ne 0) { throw "Install failed" }

    Write-Host ""
    Write-Host "ContextManager installed successfully. Reload VS Code to activate." -ForegroundColor Green
} finally {
    Pop-Location
}