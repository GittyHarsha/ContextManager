---
layout: default
title: Installation
nav_order: 2
---

# Installation
{: .fs-9 }

Install ContextManager and set up your first project in under a minute.
{: .fs-6 .fw-300 }

---

## From VS Code Marketplace

1. Open **VS Code**
2. Go to Extensions (`Ctrl+Shift+X`)
3. Search for **"ContextManager"**
4. Click **Install**
5. Reload VS Code when prompted

{: .note }
ContextManager requires **VS Code 1.100.0+** and **GitHub Copilot** to be installed and active.

---

## From VSIX (Manual)

If you're building from source or using a pre-release version:

```powershell
# Clone the repository
git clone https://github.com/GittyHarsha/ContextManager.git
cd ContextManager

# Install dependencies
npm install

# Build and install
.\install.ps1 build-and-install
```

Or install a `.vsix` file directly:

```
code --install-extension context-manager.vsix
```

---

## Post-Installation

After installation, you'll see:

1. **📖 Book icon** in the Activity Bar (sidebar)
2. **Status bar item** showing the active project name
3. **`@ctx` chat participant** available in Copilot Chat

### Verify Installation

Open Copilot Chat and type:

```
@ctx /context
```

You should see the current project context. If no project exists yet, you'll be prompted to create one.

---

## System Requirements

| Requirement | Minimum |
|:------------|:--------|
| VS Code | 1.100.0+ |
| GitHub Copilot | Latest version |
| OS | Windows, macOS, or Linux |
| Node.js | Not required (bundled via VS Code) |

---

## Data Storage

ContextManager stores data in two locations:

| Data | Location | Scope |
|:-----|:---------|:------|
| Projects, cards, intelligence | `globalStorageUri` (VS Code managed) | Global |
| FTS search index | `globalStorageUri/search-fts4.db` | Global |
| Hook queue, scripts | `~/.contextmanager/` | User-wide |
| Session context | `~/.contextmanager/session-context.txt` | User-wide |

{: .tip }
All data is stored locally. Nothing is sent to external servers beyond the standard VS Code language model API calls.

---

## Agent Hooks (Optional)

ContextManager includes an optional hook system that captures AI interactions from VS Code Copilot's transcript pipeline. This enables automatic card queue population without manual intervention.

The hook script (`capture.ps1`) is automatically installed to `~/.contextmanager/scripts/` on first activation. It watches for:

- **SessionStart** - Injects project context into new sessions
- **PostToolUse** - Captures tool executions and harvests completed turns
- **PreCompact** - Extracts multi-turn context before summarization
- **Stop** - Records final exchange for card queue processing

{: .note }
Hooks are optional. All core features (knowledge cards, search, dashboard, chat commands) work without hooks enabled.

---

## Upgrading

When updating to a new version:

1. VS Code handles the extension update automatically
2. On first activation, any data migrations run transparently
3. The hook script is updated if a newer version is bundled

### Migration Notes

| Version | Migration |
|:--------|:----------|
| 1.8.0+ | Storage migrated from `globalState` to disk-backed JSON files |
| 1.8.0+ | FTS migrated from FTS5 to FTS4 (sql.js compatibility) |
| 2.0.0+ | Card queue moved from standalone tab to Intelligence tab |

---

## Next Steps

[Getting Started →]({% link getting-started.md %})
{: .fs-5 }
