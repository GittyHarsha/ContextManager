---
layout: default
title: Agent Orchestration
parent: Features
nav_order: 11
---

# Agent Orchestration
{: .fs-8 }

Coordinate multiple Copilot CLI sessions, VS Code Copilot, and Claude Code agents working on the same project.
{: .fs-5 .fw-300 }

---

## Overview

When you run multiple agent sessions simultaneously — each in its own terminal pane — they're isolated by default. Agent A doesn't know what Agent B is doing. ContextManager connects them with two primitives:

- **Agent Registry** — a live directory of who's running, what pane they're in, and what project they're bound to
- **Direct messaging via psmux/tmux send-keys** — type a message directly into another agent's terminal pane

No message bus, no shared files, no context injection. One agent looks up another in the registry and sends it a message by typing into its pane. Simple and direct.

## MCP Tools

All tools are available in any Copilot CLI or Claude Code session with the ContextManager plugin installed.

| Tool | Description |
|---|---|
| `orchestrator_list_agents` | List agents with status and terminal info, optionally filter by project or status |
| `orchestrator_get_agent` | Get full details for a specific agent by session ID |
| `orchestrator_set_agent_meta` | Set metadata and terminal info on your agent (status, task, phase, terminal — anything) |
| `orchestrator_send` | Send a message to another agent by typing into its psmux/tmux pane |

## How It Works

### Agent Registry

Every Copilot CLI, VS Code, or Claude Code session that fires hook events is automatically registered in `~/.contextmanager/agent-registry.json`. Each entry tracks:

- **Session ID** and **origin** (CLI, VS Code, Claude Code)
- **Working directory** and **bound project** (auto-detected from cwd)
- **Status** — `active`, `idle`, or `stopped` (tracked automatically via SessionStart/SessionEnd hooks)
- **Terminal info** — multiplexer type (`psmux`, `tmux`, `vscode`, `raw`), pane ID, window ID, and session name (auto-detected on SessionStart)
- **Last activity timestamp** (heartbeat)
- **Custom metadata blob** (open schema — set anything you want)

Stale agents (no activity for 30 minutes by default) are marked as `stopped` instead of being deleted — history is preserved. A separate `purge()` removes entries that have been stopped for 7+ days.

### Auto-Bind by Working Directory

When a session starts, HookWatcher matches the session's working directory against each project's `rootPaths`. If the cwd falls under a project root, the session is automatically bound to that project. No manual binding needed for standard setups.

### Pane ID and Terminal Capture

The capture script auto-detects the terminal multiplexer on every `SessionStart` event:

1. **psmux** — detected via `$env:PSMUX` or `Get-Command psmux`. Captures `paneId`, `windowId`, and `sessionName`.
2. **tmux** — falls back to `$env:TMUX_PANE`. Captures pane ID and optionally window/session.

HookWatcher stores full `TerminalInfo` (type, paneId, windowId, sessionName) in the agent's registry entry via `registry.setTerminal()`. This means `orchestrator_send` can resolve any registered agent to its terminal pane automatically.

{: .note }
If the session isn't running inside a multiplexer, agents can set their terminal info manually via `orchestrator_set_agent_meta({ terminal: { type: "psmux", paneId: "0" } })`.

### Sending Messages (psmux send-keys)

`orchestrator_send` takes a `sessionId` and a `message`. It:

1. Looks up the target agent in the registry
2. Reads the `pane` from the agent's metadata
3. Runs `psmux send-keys -t <pane> "<message>" Enter` (Windows) or `tmux send-keys` (Unix)

The message is typed directly into the target agent's terminal pane, as if a human typed it. The target agent receives it as a normal prompt.

{: .warning }
`orchestrator_send` requires psmux (Windows) or tmux (Unix) to be available on `PATH`. Sessions must be running inside a multiplexer for send-keys to work.

## Orchestrate Agent

The plugin ships a single `orchestrate` agent that knows the registry and psmux send-keys — and follows your lead:

```
copilot --agent=orchestrate
> "Show me who's running on this project"
> "Send Agent B a message to start the API migration"
> "Coordinate builds across my worktrees"
```

This replaces the previous `fleet-monitor`, `build-coordinator`, and `session-reviewer` agents. Instead of 3 narrow agents that each prescribe a single workflow, one flexible agent lets you direct the orchestration however you want.

## Building Your Own Orchestration

The primitives are simple — build whatever you need:

**Task assignment:**
```
Agent A: orchestrator_send({ sessionId: "agent-b-id", message: "Please update the API docs for the new /users endpoint" })
Agent B: receives the message as a prompt → does the work → orchestrator_send({ sessionId: "agent-a-id", message: "API docs updated, PR ready for review" })
```

**Status coordination:**
```
Agent A: orchestrator_set_agent_meta({ meta: { status: "waiting-for-build", task: "frontend tests" } })
Build agent: orchestrator_list_agents() → sees waiting agent → builds → orchestrator_send({ sessionId: "agent-a-id", message: "Build complete, all tests pass" })
```

**Fleet monitoring:**
```
Monitor: orchestrator_list_agents({ project: "MyApp" }) → sees 3 agents, their tasks, last activity
Monitor: orchestrator_send({ sessionId: "stale-agent-id", message: "Are you still working on the auth refactor?" })
```

## Settings

| Setting | Default | Description |
|---|---|---|
| `contextManager.orchestrator.enabled` | `true` | Enable agent orchestration (registry + psmux send) |
