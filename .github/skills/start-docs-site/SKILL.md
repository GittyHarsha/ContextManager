```skill
---
name: start-docs-site
description: Start the ContextManager Jekyll documentation site locally and open it in the Simple Browser. Use this skill when the user asks to see the website, start the docs, preview the site, or open the documentation.
---

## Overview

Starts the Jekyll docs server for the ContextManager site located at `codebase-navigator/docs/` and opens it in VS Code's Simple Browser at `http://127.0.0.1:4000/ContextManager/`.

## When to Use

- User says "show me the website", "start the docs", "open the site", "I wanna see how it looks"
- After making doc changes and wanting to preview them
- When the Simple Browser shows a connection error (server is down)

## Steps

### 1. Check if already running

```powershell
try { (Invoke-WebRequest -Uri "http://127.0.0.1:4000/ContextManager/" -UseBasicParsing -TimeoutSec 5).StatusCode } catch { "not up" }
```

If it returns `200`, skip to step 3.

### 2. Start the server

```powershell
Get-Process ruby -ErrorAction SilentlyContinue | Stop-Process -Force 2>$null
$env:PATH = "C:\Ruby33-x64\bin;" + $env:PATH
cd "c:\projects\ContextManager\docs"
Start-Process -FilePath "C:\Ruby33-x64\bin\bundle.bat" -ArgumentList "exec jekyll serve --baseurl /ContextManager" -NoNewWindow
Start-Sleep 16
try { (Invoke-WebRequest -Uri "http://127.0.0.1:4000/ContextManager/" -UseBasicParsing -TimeoutSec 5).StatusCode } catch { "failed" }
```

Wait for `200` before proceeding. If it returns `failed`, wait another 5–10 seconds and retry the status check.

### 3. Open in Simple Browser

Use the `open_simple_browser` tool with URL: `http://127.0.0.1:4000/ContextManager/`

### 4. Confirm to user

Tell the user the site is live and mention they can navigate to any page (Getting Started, Features, etc.).

## Stopping the Server

```powershell
Get-Process ruby -ErrorAction SilentlyContinue | Stop-Process -Force
```

## Notes

- Jekyll starts as a background process via `Start-Process -NoNewWindow` — it keeps running until killed or the terminal closes
- The `--baseurl /ContextManager` flag is required; without it all CSS/JS links break
- Sass deprecation warnings in the build output are harmless (upstream Just the Docs theme issue)
- Ruby must be on PATH: `C:\Ruby33-x64\bin`
```
