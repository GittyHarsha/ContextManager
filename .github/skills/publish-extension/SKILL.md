---
name: publish-extension
description: Publish the ContextManager VS Code extension to the marketplace. Use this skill when the user asks to publish, release, package, or ship a new version of the extension.
---

## Overview

This skill handles the full release workflow for the ContextManager extension located at `codebase-navigator/`. It covers version bumping, changelog updates, compilation, packaging, and marketplace upload preparation.

## When to Use

- User says "publish", "release", "ship", "package for marketplace", or "bump version"
- After a significant batch of features/fixes is complete
- User asks to prepare a new version

## Prerequisites

- Node.js and npm installed
- `npx @vscode/vsce` available (installed via npm)
- Extension compiles cleanly: `npm run compile`
- Working directory: `c:\projects\ContextManager`

## Step-by-Step Workflow

### 1. Determine version number

- **Patch** (1.x.Y): Bug fixes only
- **Minor** (1.X.0): New features, no breaking changes
- **Major** (X.0.0): Breaking changes or major overhaul

Read current version from `package.json` → `version` field.

### 2. Bump version in package.json

Update the `"version"` field. Example:
```json
"version": "1.5.0",
```

### 3. Update CHANGELOG.md

Add new version entry at the top (after the header), following Keep a Changelog format:

```markdown
## [1.5.0] - YYYY-MM-DD

### Added
- **Feature name** — User-facing description.

### Changed
- **What changed** — Description.

### Fixed
- **Bug fixed** — Description.
```

**Rules:**
- Only user-facing changes (no internal refactors)
- Bold feature names with em-dash descriptions
- Group by Added / Changed / Fixed
- Date format: YYYY-MM-DD

### 4. Compile and validate

```powershell
cd c:\projects\ContextManager
npm run compile
```

Must exit with code 0 and no errors.

### 5. Validate webview script (critical)

The dashboard webview is a template-literal-generated JavaScript string. TypeScript compilation does NOT catch runtime JS parse errors inside it. Always validate:

```powershell
node -e "const fs=require('fs'); const m=require('./out/dashboard/webviewScript.js'); const s=m.getDashboardScript('p','overview'); const code=s.slice('<script>'.length, s.length - '</script>'.length); fs.writeFileSync('.tmp-wv.js', code);"
node --check .tmp-wv.js
Remove-Item .tmp-wv.js -ErrorAction SilentlyContinue
```

Must produce no output (= valid syntax). If it fails, fix the webview script source before proceeding.

### 6. Run publish script

```powershell
.\scripts\publish.ps1
```

This script:
1. Swaps publisher from `local-dev` → `HarshaNarayanaP` in package.json
2. Runs `npx @vscode/vsce package --allow-missing-repository`
3. Produces a `.vsix` file (e.g., `context-manager-1.5.0.vsix`)
4. Restores publisher back to `local-dev`

**Important:** The publisher swap is temporary and automatically reverted. Do NOT manually change the publisher.

### 7. Upload to marketplace

- Go to: https://marketplace.visualstudio.com/manage
- Sign in with the publisher account (HarshaNarayanaP)
- Click on ContextManager extension → Update → Upload the `.vsix` file
- Verify the listing page after upload

### 8. Git commit and push

```powershell
cd c:\projects\ContextManager
git add -A
git commit -m "Release v1.5.0"
git push origin main
```

### 9. (Optional) Install locally to verify

```powershell
.\scripts\install.ps1 -SkipCompile
```

Then reload VS Code window to test the installed version.

## Common Issues

| Issue | Solution |
|---|---|
| `npm run compile` fails | Fix TypeScript errors first |
| Webview script syntax error | Template literal escaping issue — check for unescaped backticks, `\n` inside quotes, or `${}` in generated JS |
| VSIX too large | Check `.vscodeignore` — ensure `node_modules/` dev deps, `.old` files, and test fixtures are excluded |
| Publisher mismatch | `publish.ps1` handles this automatically; never manually edit publisher |
| `vsce package` fails | Usually missing `repository` field — the `--allow-missing-repository` flag bypasses this |

## Key Files

- `package.json` — version, publisher, metadata
- `CHANGELOG.md` — release notes
- `scripts/publish.ps1` — packaging script
- `scripts/install.ps1` — local install script
- `.vscodeignore` — file exclusion for VSIX
- `PUBLISHING.md` — detailed publishing guide

## Constraints

- Do NOT publish with `vsce publish` directly (no PAT configured; use manual upload)
- Do NOT commit with publisher set to `HarshaNarayanaP` — it must be `local-dev` in git
- Always validate webview script syntax before packaging — a broken webview disables the entire dashboard
