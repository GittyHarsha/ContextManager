# Agent Orchestration

ContextManager provides primitives for coordinating multiple Copilot CLI sessions, VS Code Copilot, and Claude Code agents working on the same project.

## Overview

When you run multiple agent sessions simultaneously — each in its own terminal — they're isolated by default. Agent A doesn't know what Agent B learned. ContextManager's orchestration primitives connect them:

- **Agent Registry** — a live directory of who's running
- **Message Bus** — a shared channel for agents to communicate
- **Context Sync** — automatic injection of cross-session knowledge

These are generic, unopinionated primitives exposed as MCP tools. You compose them into whatever orchestration patterns you need via custom agents.

## MCP Tools

All tools are available in any Copilot CLI session with the ContextManager plugin installed.

### Registry

| Tool | Description |
|---|---|
| `orchestrator_list_agents` | List active agents, optionally filter by project |
| `orchestrator_get_agent` | Get full details for a specific agent |
| `orchestrator_set_agent_meta` | Set arbitrary metadata on your agent (status, task, phase — anything) |

### Message Bus

| Tool | Description |
|---|---|
| `orchestrator_post_message` | Post a message to the bus (any JSON payload) |
| `orchestrator_read_messages` | Read unread messages, advances cursor |
| `orchestrator_peek_messages` | Read without advancing cursor (monitoring) |

## How It Works

### Agent Registry

Every Copilot CLI/VS Code/Claude session that fires hook events is automatically registered in `~/.contextmanager/agent-registry.json`. Each entry tracks:

- Session ID and origin (CLI, VS Code, Claude)
- Working directory and bound project
- Last activity timestamp (heartbeat)
- Custom metadata blob (open schema — set anything you want)

Stale agents (no activity for 30 minutes by default) are automatically pruned.

### Message Bus

Agents communicate via `~/.contextmanager/agent-bus.jsonl` — an append-only message log. Messages have:

- Sender and optional recipient (omit for broadcast)
- Optional project scope
- Any JSON payload (no schema enforced)
- TTL (default 24 hours)

**System messages** (prefixed `cm:`) are auto-posted when:
- A convention is learned → `{ type: "cm:convention-learned", title: "...", content: "..." }`
- A knowledge card is created → `{ type: "cm:card-created", title: "..." }`

### Context Sync

Recent bus messages and fleet status are automatically injected into `session-context.txt`, which Copilot reads on every prompt. This means:

- When Agent A learns a convention, Agent B sees it on its next prompt
- When Agent A posts a message, Agent B gets it without explicitly calling `read_messages`

Configure injection via VS Code settings:
- `contextManager.orchestrator.injectBusMessages` (default: true)
- `contextManager.orchestrator.maxInjectedMessages` (default: 5)
- `contextManager.orchestrator.injectFleetStatus` (default: false)

## Example Agents

ContextManager ships example agents in `.github/agents/` that demonstrate common orchestration patterns:

### fleet-monitor

Shows who's running and what they're communicating. Read-only.

```
copilot --agent=fleet-monitor
> "Show me fleet status"
```

### build-coordinator

Reads build requests from the bus, runs builds one at a time, posts results back.

```
copilot --agent=build-coordinator
> "Process pending build requests"
```

### session-reviewer

Analyzes recent sessions for repeated mistakes and suggests convention improvements.

```
copilot --agent=session-reviewer
> "Review last week's sessions"
```

## Building Your Own Orchestration

The primitives are generic — build whatever you need:

**Task assignment:**
```
Agent A: orchestrator_post_message({ payload: { type: "task", description: "update API docs", priority: 1 } })
Agent B: orchestrator_read_messages() → sees task → does it → orchestrator_post_message({ payload: { type: "task-done", task: "update API docs" } })
```

**Status coordination:**
```
Agent A: orchestrator_set_agent_meta({ meta: { status: "waiting-for-build" } })
Build agent: orchestrator_list_agents() → sees waiting agent → builds → orchestrator_post_message({ to: "agent-a-session-id", payload: { type: "build-complete", status: "success" } })
```

**Knowledge sharing:**
```
Agent A learns something → auto-posted to bus as cm:convention-learned → Agent B sees it on next prompt via context sync
```

## Settings

| Setting | Default | Description |
|---|---|---|
| `contextManager.orchestrator.enabled` | `true` | Enable orchestration primitives |
| `contextManager.orchestrator.injectBusMessages` | `true` | Auto-inject bus messages into prompts |
| `contextManager.orchestrator.maxInjectedMessages` | `5` | Max messages to inject |
| `contextManager.orchestrator.injectFleetStatus` | `false` | Include peer agent list in prompts |
| `contextManager.orchestrator.agentStaleTimeout` | `1800` | Seconds before pruning stale agents |
