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
3. **7 Language Model Tools** available in Copilot Chat (type `#ctx` to access)

### Verify Installation

Open the **Dashboard** (click the status bar item or run `ContextManager: Open Dashboard`). You should see the four tabs: Intelligence, Knowledge, Context, and Settings. If no project exists yet, you'll be prompted to create one.

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

- **UserPromptSubmit** - Injects selected knowledge cards and custom instruction into every prompt
- **PostToolUse** - Captures tool executions and harvests completed turns (disabled by default)
- **PreCompact** - Extracts multi-turn context before summarization
- **Stop** - Records final exchange for card queue processing

{: .note }
Hooks are optional. All core features (knowledge cards, search, dashboard, LM tools) work without hooks enabled.

---

## Claude Code Plugin (Optional)

If you use [Claude Code](https://code.claude.com/) for terminal-based AI sessions, install the ContextManager plugin so Claude Code sessions capture knowledge and have MCP access to your project memory.

### Plugin Install (Recommended)

```bash
claude plugin install GittyHarsha/ContextManager:claude-code-plugin
```

This installs hooks (`Stop`, `PostToolUse`, `PreCompact`, session events) **and** an MCP server that gives Claude Code read/write access to your knowledge cards.

Verify inside a Claude Code session:

```
/mcp
```

### Quick-Start Alternative

If you just want hooks without the MCP server:

1. Open the Command Palette (`Ctrl+Shift+P`)
2. Run **ContextManager: Install Claude Code Hooks**
3. This writes hooks to `.claude/settings.json` in the active project root

You can also click **🟣 Install Claude Code Hooks** on the Dashboard → Settings tab.

{: .note }
Both the Copilot CLI plugin and Claude Code plugin support automatic card queue population. `agentStop` / `Stop` hooks fire when the agent completes a turn, producing card queue candidates.

For more details, see the [plugin README](https://github.com/GittyHarsha/ContextManager/tree/main/claude-code-plugin).

---

## Copilot CLI Plugin (Optional)

If you use [GitHub Copilot in the terminal](https://docs.github.com/en/copilot/github-copilot-in-the-cli), you can install the ContextManager plugin so CLI sessions also capture knowledge and have access to your cards via MCP.

```bash
copilot plugin install GittyHarsha/ContextManager:plugin
```

The VS Code extension must be running so `HookWatcher` can ingest events from the CLI. Verify the MCP server inside Copilot CLI with `/mcp show contextmanager`.

For more details, see the [plugin README](https://github.com/GittyHarsha/ContextManager/tree/main/plugin).

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
