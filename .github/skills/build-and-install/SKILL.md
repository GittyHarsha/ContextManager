---
name: build-and-install
description: Compile and locally install the ContextManager VS Code extension for testing. Use this skill when the user asks to build, install, test locally, or try out the extension via the local-dev publisher.
argument-hint: build, install
---

## Overview

The root `install.ps1` handles everything in one shot: compile TypeScript, validate the webview script, package a `.vsix`, and install it into VS Code. No marketplace upload — purely for local testing.

## Step-by-Step Workflow

### 1. Build + install (one command)

```powershell
powershell -ExecutionPolicy Bypass -File c:\projects\ContextManager\install.ps1
```

This single command:
1. Compiles TypeScript (`npm run compile`) + copies `sql-wasm.wasm`
2. Validates the webview script for JS syntax errors (catches bugs `tsc` misses)
3. Packages with `npx @vscode/vsce package --allow-missing-repository --allow-star-activation`
4. Installs the `.vsix` with `code --install-extension --force`

If any step fails, the script stops with a clear error. Fix the issue and re-run.

### 2. Tell the user to reload

**Ctrl+Shift+P → `Developer: Reload Window`** to activate the new version.

## Alternative: Hot-deploy (faster iteration)

When the extension is already installed and you just need to push compiled JS changes without repackaging:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
cd c:\projects\ContextManager
npm run compile
powershell -ExecutionPolicy Bypass -File .\scripts\dev-deploy.ps1
```

Then reload VS Code. This skips packaging (~34 MB VSIX) so it's much faster, but does NOT work if the extension was uninstalled.

## Constraints & Pitfalls

- **NEVER use `vsce package --no-dependencies`** — the extension requires bundled `sql.js` (WASM), `katex`, etc.
- **NEVER use `npx vsce package` without `--allow-star-activation`** — will hang with an interactive prompt.
- **dev-deploy.ps1 only works when the extension is already installed** — it copies JS into `~/.vscode/extensions/local-dev.context-manager-*/out/`.
- Do NOT manually change the publisher field — `local-dev` stays in source control.
- After install, a **window reload is required** — the extension does not hot-reload.
