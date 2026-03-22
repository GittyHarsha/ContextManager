# ContextManager — Claude Code Plugin

Extend **ContextManager** to [Claude Code](https://code.claude.com/) — capture knowledge from terminal Claude sessions and access your project memory via MCP.

## What It Does

| Capability | How |
|:-----------|:----|
| **Capture knowledge** | Hook scripts fire on Stop, PostToolUse, PreCompact, and session events — writing normalized entries to the shared hook queue |
| **Read your cards** | An MCP server exposes your knowledge cards, conventions, and project data to Claude Code |
| **Write directly** | Claude Code can save cards, conventions, tool hints, and working notes directly to project storage with deduplication |
| **Full card queue support** | Unlike the Copilot CLI plugin, Claude Code exposes a `Stop` hook — so **automatic card queue population works** |

## Installation

### From GitHub

```bash
claude plugin install GittyHarsha/ContextManager:claude-code-plugin
```

### From a local clone

```bash
claude plugin install ./claude-code-plugin
```

### Verify

Inside a Claude Code session:

```
/mcp
```

You should see `contextmanager` listed with its tools.

> **Note:** The VS Code extension must be running so `HookWatcher` ingests events written by Claude Code sessions. Without it, captures queue up in `~/.contextmanager/hook-queue.jsonl` but aren't processed.

## Hooks

The plugin registers hooks for the following Claude Code events:

| Event | What it captures |
|:------|:-----------------|
| **Stop** | Records the full prompt + response for card queue candidates |
| **SubagentStop** | Same as Stop — captures subagent completions |
| **SessionStart** | Registers a tracked session for the working directory |
| **SessionEnd** | Records session completion |
| **UserPromptSubmit** | Injects selected knowledge cards and custom instructions into prompts |
| **PostToolUse** | Logs tool name, input, and result for observation capture |
| **PreCompact** | Extracts multi-turn context before conversation compaction |

Events are tagged with `origin: "claude-code-plugin"` so you can distinguish them from VS Code sessions in the Dashboard → Sessions tab.

## MCP Tools

The plugin bundles a local MCP server that gives Claude Code read access to your project memory:

| Tool | Purpose |
|:-----|:--------|
| `contextmanager_list_projects` | List all ContextManager projects |
| `contextmanager_search_knowledge` | Search cards, conventions, tool hints, and working notes |
| `contextmanager_get_knowledge_card` | Read a specific card by ID or title |
| `contextmanager_list_sessions` | List tracked sessions and binding status |
| `contextmanager_storage_info` | Show storage directory and queue file paths |

### Direct Write Tools

These tools write directly to project storage (no VS Code extension needed for writes):

| Tool | Purpose |
|:-----|:--------|
| `contextmanager_save_card` | Save a knowledge card (updates existing if title matches) |
| `contextmanager_learn_convention` | Save a coding convention (updates existing if title matches) |
| `contextmanager_learn_tool_hint` | Save a tool hint (updates existing if title matches) |
| `contextmanager_learn_working_note` | Save a working note (updates existing if title matches) |

## How It Connects to VS Code

```
Claude Code session
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

1. **Capture path** — Hook scripts append JSONL entries to the shared queue file. The VS Code extension watches this file and processes new entries, routing them to the correct project.
2. **Read path** — The MCP server reads project data directly from ContextManager's storage directory. No extension required for reads.
3. **Write path** — Direct write tools (`save_card`, `learn_convention`, etc.) write to `projects.json` immediately. No VS Code extension required for writes.

## Quick-Start Alternative

If you prefer project-level hooks without installing the full plugin, the VS Code extension offers a command:

1. Open Command Palette (`Ctrl+Shift+P`)
2. Run **ContextManager: Install Claude Code Hooks**
3. This writes hooks to `.claude/settings.json` in the project root

This approach gives you hook-based capture but **does not** include the MCP server. Use the full plugin for both hooks and MCP access.

## Requirements

- **Node.js** — required to run the capture script and MCP server
- **VS Code with ContextManager** — must be running for HookWatcher to process the queue
- **Claude Code** — terminal-based Claude ([code.claude.com](https://code.claude.com/))
