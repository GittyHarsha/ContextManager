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

    # ── 4. Extract VSIX into extensions directory ──
    # `code --install-extension` silently fails from integrated terminals, so we
    # extract manually and patch extensions.json ourselves.
    Write-Host ">> Extracting VSIX into extensions directory..." -ForegroundColor Cyan
    $targetDir = Join-Path $extDir "local-dev.context-manager-$version"
    New-Item -ItemType Directory -Path $targetDir -Force | Out-Null

    $tmpZip = Join-Path $env:TEMP "ctx-install-$version.zip"
    $tmpExtract = Join-Path $env:TEMP "ctx-install-extract"
    if (Test-Path $tmpExtract) { Remove-Item $tmpExtract -Recurse -Force }
    Copy-Item $vsix $tmpZip -Force
    Expand-Archive $tmpZip -DestinationPath $tmpExtract -Force
    Copy-Item (Join-Path $tmpExtract "extension\*") $targetDir -Recurse -Force
    Remove-Item $tmpExtract -Recurse -Force
    Remove-Item $tmpZip -Force

    # ── 5. Patch extensions.json so VS Code recognises the extension ──
    Write-Host ">> Updating extensions.json..." -ForegroundColor Cyan
    $extJsonPath = Join-Path $extDir "extensions.json"
    $extJson = Get-Content $extJsonPath -Raw | ConvertFrom-Json
    $relLoc = "local-dev.context-manager-$version"
    $extId  = "local-dev.context-manager"

    # Remove any existing entry for this extension
    $extJson = @($extJson | Where-Object {
        $_.identifier.id -ne $extId -and $_.relativeLocation -notlike "local-dev.context-manager-*"
    })

    # Build a new entry
    $newEntry = [ordered]@{
        identifier       = [ordered]@{ id = $extId }
        version          = $version
        location         = [ordered]@{
            '$mid'  = 1
            path    = "/c:/Users/$env:USERNAME/.vscode/extensions/$relLoc"
            scheme  = "file"
        }
        relativeLocation = $relLoc
        metadata         = [ordered]@{
            isApplicationScoped = $false
            isMachineScoped     = $false
            isBuiltin           = $false
            installedTimestamp  = [long](Get-Date -UFormat %s) * 1000
            pinned              = $false
            source              = "vsix"
        }
    }
    $extJson += $newEntry
    $extJson | ConvertTo-Json -Depth 10 | Set-Content $extJsonPath -Encoding UTF8

    # ── 6. Verify ──
    $instPkg = Get-Content (Join-Path $targetDir "package.json") | ConvertFrom-Json
    if ($instPkg.version -eq $version) {
        Write-Host "   Verified: $relLoc v$($instPkg.version)" -ForegroundColor Green
    } else {
        Write-Host "   WARNING: Extracted version is v$($instPkg.version), expected v$version" -ForegroundColor Yellow
    }

    Write-Host ""
    Write-Host "ContextManager v$version installed. Reload VS Code (Ctrl+Shift+P > Reload Window)." -ForegroundColor Green
} finally {
    Pop-Location
}