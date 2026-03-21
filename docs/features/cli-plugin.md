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
| **AgentStop** | Records the full prompt + response for card queue candidates |
| **SubagentStop** | Same as AgentStop — captures subagent completions |
| **PreToolUse** | Logs tool invocations before execution |

Events are tagged with `origin: "copilot-cli-plugin"` so you can distinguish them from VS Code sessions in the Dashboard → Sessions tab.

{: .note }
Copilot CLI now supports `agentStop` and `subagentStop` hooks, which fire when the agent finishes a turn. This means **automatic card queue population works** from CLI sessions — the same way it works in VS Code.

---

## MCP Tools

The plugin bundles a local MCP server that gives the CLI agent read access to your project memory and orchestration primitives:

| Tool | Purpose |
|:-----|:--------|
| `contextmanager_list_projects` | List all ContextManager projects |
| `contextmanager_create_project` | Create a new project with name, description, root paths |
| `contextmanager_rename_project` | Rename an existing project |
| `contextmanager_update_project` | Update description, root paths, goals, conventions, key files |
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

### Orchestrator Tools

These tools enable multi-session coordination — agents can see each other and communicate:

| Tool | Purpose |
|:-----|:--------|
| `orchestrator_list_agents` | List all active agent sessions (filter by project) |
| `orchestrator_get_agent` | Get full details for a specific agent |
| `orchestrator_set_agent_meta` | Set arbitrary metadata on your agent entry (status, task, phase — anything) |
| `orchestrator_post_message` | Post a message to the bus (broadcast or directed, any JSON payload) |
| `orchestrator_read_messages` | Read unread messages, advances read cursor |
| `orchestrator_peek_messages` | Read without advancing cursor (good for monitoring) |

{: .tip }
Write intents are appended to `~/.contextmanager/hook-queue.jsonl` as `WriteIntent` entries. The VS Code extension's HookWatcher picks them up and materializes them into the target project.

---

## Bundled Agents

The plugin ships 3 custom agents, available immediately after install:

| Agent | Usage | Purpose |
|:------|:------|:--------|
| `fleet-monitor` | `copilot --agent=fleet-monitor` | Show active agents and recent bus messages |
| `build-coordinator` | `copilot --agent=build-coordinator` | Serialize builds across worktrees |
| `session-reviewer` | `copilot --agent=session-reviewer` | Analyze sessions for repeated mistakes |

## Bundled Skills

| Skill | Purpose |
|:------|:--------|
| `orchestrate` | Coordination patterns and workflows for multi-agent setups |

---

## Claude Code Plugin

Unlike the Copilot CLI, **Claude Code fully supports the `Stop` hook**, so automatic card queue population works out of the box. ContextManager ships a dedicated Claude Code plugin with hooks **and** MCP access.

### Install

```bash
claude plugin install GittyHarsha/ContextManager:claude-code-plugin
```

Or from a local clone:

```bash
claude plugin install ./claude-code-plugin
```

### What It Captures

| Hook | Purpose |
|:-----|:--------|
| **Stop** | Captures the full prompt + response for card queue candidates |
| **SubagentStop** | Same as Stop — captures subagent completions |
| **SessionStart / SessionEnd** | Tracks session lifecycle |
| **UserPromptSubmit** | Injects selected knowledge cards and custom instructions |
| **PostToolUse** | Captures tool results for observation processing |
| **PreCompact** | Extracts multi-turn context before conversation compaction |

The plugin also bundles the same MCP server as the Copilot CLI plugin, giving Claude Code full read/write access to your project memory.

All events are routed through `~/.contextmanager/hook-queue.jsonl` — the same pipeline as VS Code sessions. Events are tagged with `origin: "claude-code-plugin"`.

### Quick-Start Alternative (Hooks Only)

If you just want hooks without MCP, run **ContextManager: Install Claude Code Hooks** from the VS Code Command Palette. This writes hooks to `.claude/settings.json` in the project root.

{: .tip }
You can install both the Copilot CLI plugin and Claude Code plugin in the same project — they coexist without conflict.

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

- **Write intents require VS Code** — the MCP server queues writes but doesn't execute them directly. The VS Code extension must be running to materialize them.
- **No plugin skills yet** — the plugin provides hooks and MCP tools but no Copilot CLI skills.
- **Session ID is synthetic** — CLI sessions use a per-directory ID, not a true Copilot session ID.
