---
name: publish-extension
description: Publish the ContextManager VS Code extension to the marketplace. Use this skill when the user asks to publish, release, package, or ship a new version of the extension.
---

## Overview

This skill handles the full release workflow for the ContextManager extension at `c:\projects\ContextManager`. It covers version bumping, changelog updates, compilation, packaging, and marketplace upload preparation.

## When to Use

- User says "publish", "release", "ship", "package for marketplace", or "bump version"
- After a significant batch of features/fixes is complete
- User asks to prepare a new version

## Prerequisites

- Node.js and npm installed
- `@vscode/vsce` installed in node_modules (check: `node node_modules/@vscode/vsce/vsce --version`)
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

Update **two** changelog files:

1. **Root `CHANGELOG.md`** — Detailed, all versions, Keep a Changelog format:

```markdown
## [1.5.0] - YYYY-MM-DD

### Added
- **Feature name** — User-facing description.

### Changed
- **What changed** — Description.

### Fixed
- **Bug fixed** — Description.
```

2. **`docs/changelog.md`** — Condensed user-facing summary for the docs site. Same structure but shorter descriptions. Goes above the latest existing entry (note: docs/changelog.md may skip versions).

**Rules:**
- Only user-facing changes (no internal refactors)
- Bold feature names with em-dash descriptions
- Group by Added / Changed / Fixed
- Date format: YYYY-MM-DD

### 4. Update docs (if applicable)

If the release adds/changes user-facing features, update the relevant `docs/features/*.md` pages. Match the existing Jekyll style:
- YAML frontmatter with `layout`, `title`, `parent`, `nav_order`
- Heading size classes: `{: .fs-8 }`, subtitle `{: .fs-5 .fw-300 }`
- Tables for field/setting references
- Wrap `{{ }}` template variables in `{% raw %}...{% endraw %}`
- Admonitions: `{: .tip }` / `{: .note }` before blockquotes

### 5. Compile and validate

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
cd c:\projects\ContextManager
npm run compile
```

Must exit with code 0 and no errors.

### 6. Validate webview script (critical)

The dashboard webview is a template-literal-generated JavaScript string. TypeScript compilation does NOT catch runtime JS parse errors inside it. Always validate:

```powershell
node -e "const fs=require('fs'); const m=require('./out/dashboard/webviewScript.js'); const s=m.getDashboardScript('p','overview'); const start=s.indexOf('>')+1; const end=s.lastIndexOf('</script>'); fs.writeFileSync('.tmp-wv.js', s.slice(start,end));"
node --check .tmp-wv.js
Remove-Item .tmp-wv.js -ErrorAction SilentlyContinue
```

**IMPORTANT:** The `<script>` tag has a `nonce` attribute (`<script nonce="...">`) so you CANNOT slice by `'<script>'.length`. Use `s.indexOf('>')+1` to find the end of the opening tag.

Must produce no output (= valid syntax). If it fails, fix the webview script source before proceeding.

### 7. Git commit and push

Commit **before** packaging so the working tree is clean:

```powershell
cd c:\projects\ContextManager
git add -A
git commit -m "v1.5.0 — Brief description of changes"
git push origin main
```

### 8. Run publish script

**MUST run in a background terminal** — packaging 14k files takes ~60s and foreground terminals kill long-running processes.

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\scripts\publish.ps1
```

This script:
1. Swaps publisher from `local-dev` → `HarshaNarayanaP` in package.json
2. Runs `node node_modules/@vscode/vsce/vsce package --allow-missing-repository --allow-star-activation`
3. Verifies the `.vsix` was created with the correct publisher (using .NET ZipFile)
4. Restores publisher back to `local-dev`
5. Prints size, publisher, and version for confirmation

**Important:** The publisher swap is temporary and automatically reverted. Do NOT manually change the publisher.

After the background terminal finishes, verify with:
```powershell
Get-ChildItem *.vsix | Sort-Object LastWriteTime -Descending | Select-Object -First 1 | Format-Table Name, @{N='MB';E={[math]::Round($_.Length/1MB,1)}}, LastWriteTime
```

### 9. Upload to marketplace

- Go to: https://marketplace.visualstudio.com/manage
- Sign in with the publisher account (HarshaNarayanaP)
- Click on ContextManager extension → Update → Upload the `.vsix` file
- Verify the listing page after upload

### 10. (Optional) Install locally to verify

```powershell
powershell -ExecutionPolicy Bypass -File c:\projects\ContextManager\install.ps1
```

Then reload VS Code window to test the installed version.

## Common Issues

| Issue | Solution |
|---|---|
| `npm run compile` fails | Fix TypeScript errors first |
| Webview script syntax error | Template literal escaping issue — check for unescaped backticks, `\n` inside quotes, or `${}` in generated JS |
| **npx output swallowed** | **NEVER use `npx @vscode/vsce`** — use `node node_modules/@vscode/vsce/vsce` instead. npx output gets eaten by VS Code integrated terminals. |
| **Foreground terminal kills packaging** | Exit code `-1073741510` = `STATUS_CONTROL_C_EXIT`. Run publish.ps1 in a **background terminal**. |
| **Webview nonce validation fails** | The `<script>` tag has a `nonce` attribute. Use `s.indexOf('>')+1` not `'<script>'.length` to find script body start. |
| VSIX too large | Check `.vscodeignore` — ensure `node_modules/` dev deps, `.old` files, and test fixtures are excluded |
| Publisher mismatch | `publish.ps1` handles this automatically; never manually edit publisher |
| `vsce package` fails | Usually missing `repository` field — the `--allow-missing-repository` flag bypasses this |
| VSIX corrupted (bad zip) | Process was interrupted. Delete the `.vsix` and re-run in a background terminal. |

## Key Files

- `package.json` — version, publisher, metadata
- `CHANGELOG.md` — detailed release notes (all versions)
- `docs/changelog.md` — condensed release notes for docs site
- `docs/features/*.md` — feature documentation pages
- `scripts/publish.ps1` — packaging script (swaps publisher, packages, verifies, restores)
- `scripts/install.ps1` — local install script
- `.vscodeignore` — file exclusion for VSIX

## Constraints

- **NEVER use `npx`** for vsce — always `node node_modules/@vscode/vsce/vsce`
- **ALWAYS run publish.ps1 in a background terminal** when invoked by Copilot
- Do NOT publish with `vsce publish` directly (no PAT configured; use manual upload)
- Do NOT commit with publisher set to `HarshaNarayanaP` — it must be `local-dev` in git
- Always validate webview script syntax before packaging — a broken webview disables the entire dashboard
- Set `ExecutionPolicy` before running scripts: `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass`
