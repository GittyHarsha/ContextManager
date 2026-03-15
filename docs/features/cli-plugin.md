---
layout: default
title: Copilot CLI Plugin
parent: Features
nav_order: 10
---

# Copilot CLI Plugin
{: .fs-8 }

Extend ContextManager to GitHub Copilot in the terminal — capture knowledge from CLI sessions and access your cards via MCP.
{: .fs-5 .fw-300 }

---

## Overview

The Copilot CLI plugin bridges terminal-based Copilot sessions with your ContextManager project memory. When installed, CLI sessions:

- **Capture knowledge** — tool use, conversation turns, and errors flow into the same hook queue that VS Code uses
- **Read your cards** — an MCP server exposes your knowledge cards, conventions, and project data to the CLI agent
- **Queue write intents** — the CLI can request card saves and convention learns, materialized by the VS Code extension

---

## Installation

### From the GitHub repository

```bash
copilot plugin install GittyHarsha/ContextManager:plugin
```

### From a local clone

```bash
copilot plugin install ./plugin
```

### Verify

Inside a Copilot CLI session:

```
/mcp show contextmanager
```

This should list the MCP tools available to the CLI agent.

{: .note }
The VS Code extension must be running so `HookWatcher` ingests events written by CLI sessions. Without it, captures queue up in `~/.contextmanager/hook-queue.jsonl` but aren't processed.

---

## What Gets Captured

The plugin hooks into Copilot CLI's event pipeline and writes normalized entries to the shared hook queue:

| Event | What it captures |
|:------|:-----------------|
| **SessionStart** | Registers a tracked session for the CLI working directory |
| **SessionEnd** | Records session completion with reason |
| **UserPromptSubmitted** | Injects session context (selected cards + custom instructions) into the prompt |
| **PostToolUse** | Logs tool name, input, and result for observation capture |
| **ErrorOccurred** | Captures error details for debugging patterns |

Events are tagged with `origin: "copilot-cli-plugin"` so you can distinguish them from VS Code sessions in the Dashboard → Sessions tab.

{: .warning }
**No automatic card capture from CLI sessions.** The Copilot CLI does not expose a `Stop` hook (the event that fires when the agent finishes a turn with the full prompt + response). This is the event that VS Code sessions use to populate the card queue. Until the CLI adds a `Stop`-equivalent hook, CLI sessions will track observations and tool use but will **not** automatically produce card queue candidates. Use the MCP write intent tools (`contextmanager_save_card_intent`) to manually save knowledge from CLI sessions.

---

## MCP Tools

The plugin bundles a local MCP server that gives the CLI agent read access to your project memory:

| Tool | Purpose |
|:-----|:--------|
| `contextmanager_list_projects` | List all ContextManager projects |
| `contextmanager_search_knowledge` | Search cards, conventions, tool hints, and working notes |
| `contextmanager_get_knowledge_card` | Read a specific card by ID or title |
| `contextmanager_list_sessions` | List tracked sessions and binding status |
| `contextmanager_storage_info` | Show storage directory and queue file paths |

### Write Intent Tools

These tools queue write requests that the VS Code extension materializes:

| Tool | Purpose |
|:-----|:--------|
| `contextmanager_save_card_intent` | Queue a new knowledge card to be saved |
| `contextmanager_learn_convention_intent` | Queue a coding convention to be learned |
| `contextmanager_learn_tool_hint_intent` | Queue a tool hint to be learned |
| `contextmanager_learn_working_note_intent` | Queue a working note to be learned |

{: .tip }
Write intents are appended to `~/.contextmanager/hook-queue.jsonl` as `WriteIntent` entries. The VS Code extension's HookWatcher picks them up and materializes them into the target project.

---

## How It Connects to VS Code

```
Copilot CLI session
  │
  ├─ Hook scripts → ~/.contextmanager/hook-queue.jsonl
  │                         ↓
  │                 VS Code HookWatcher reads queue
  │                         ↓
  │                 Events routed to project memory
  │
  └─ MCP server  → reads project storage directly
                    (JSON files in VS Code globalStorage)
```

1. **Capture path** — CLI hook scripts append JSONL entries to the shared queue file. The VS Code extension watches this file and processes new entries, routing them to the correct project.
2. **Read path** — The MCP server reads project data directly from ContextManager's storage directory (VS Code `globalStorage`). No extension required for reads.
3. **Write path** — Write intents go through the queue file → HookWatcher → ProjectManager. The MCP server does not write to storage directly.

---

## Session Correlation

Copilot CLI doesn't provide a stable session ID, so the plugin synthesizes one per working directory:

- Session IDs are persisted in `~/.contextmanager/plugin-sessions/`
- Each unique working directory gets its own synthetic session
- These sessions appear in the Dashboard → Sessions tab alongside VS Code sessions

---

## Alternate Setup (Without Plugin Install)

If you prefer repo-level hook wiring instead of a global plugin install:

1. Run the command **ContextManager: Install Copilot CLI Plugin Hooks** from VS Code
2. This copies scripts to `~/.contextmanager/scripts/copilot-cli/` and writes `.github/hooks/contextmanager-copilot-cli-hooks.json` in the active project
3. Useful for team setups where hooks are committed to the repo

---

## Managing the Plugin

```bash
copilot plugin list                      # View installed plugins
copilot plugin update contextmanager     # Update to latest version
copilot plugin uninstall contextmanager  # Remove the plugin
```

---

## Current Limitations

- **No automatic card capture** — The Copilot CLI does not fire a `Stop` hook (agent turn complete with full response), so CLI sessions cannot auto-populate the card queue. VS Code sessions use this hook to create card candidates. Until the CLI exposes it, use the MCP `contextmanager_save_card_intent` tool to capture knowledge explicitly.
- **Write intents require VS Code** — the MCP server queues writes but doesn't execute them directly. The VS Code extension must be running to materialize them.
- **No plugin skills yet** — the plugin provides hooks and MCP tools but no Copilot CLI skills.
- **Session ID is synthetic** — CLI sessions use a per-directory ID, not a true Copilot session ID.
