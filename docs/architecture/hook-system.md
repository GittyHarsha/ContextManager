---
layout: default
title: Hook System
parent: Architecture
nav_order: 3
---

# Hook System
{: .fs-8 }

How ContextManager captures AI interactions from VS Code Copilot's native transcript pipeline.
{: .fs-5 .fw-300 }

---

## Overview

VS Code provides a Chat Hooks API (`chatHooks` proposed API) that fires lifecycle events during AI interactions. ContextManager uses these hooks to capture interactions that don't flow through the `@ctx` chat participant - primarily VS Code Copilot's native responses.

The hook system consists of two halves:

1. **`capture.ps1`** - PowerShell script that runs as a hook handler, writes to a queue file
2. **`HookWatcher`** - TypeScript service in the extension that watches the queue file and processes entries

---

## Hook Script (`capture.ps1`)

Located at `~/.contextmanager/scripts/capture.ps1` (also bundled at `resources/hooks/capture.ps1`).

### Hook Events Handled

| Event | When | What capture.ps1 Does |
|:------|:-----|:----------------------|
| `SessionStart` | New chat session begins | Reads `session-context.txt`, outputs as `additionalContext` |
| `PostToolUse` | After each tool call | Records tool use; also harvests completed turns from transcript |
| `PreCompact` | Before context summarization | Extracts all turns since last offset for multi-turn processing |
| `Stop` | Session ends | Records final exchange from transcript |

### Data Flow

{::nomarkdown}
<pre class="mermaid">
graph TD
    A[VS Code Hook Event] --> B[capture.ps1 receives JSON via stdin]
    B --> C[Process based on hookEventName]
    C --> D[Append entry to hook-queue.jsonl]
    C --> E[SessionStart: output JSON to stdout]

    style A fill:#7c3aed,stroke:#a78bfa,color:#fff
    style D fill:#2563eb,stroke:#58a6ff,color:#fff
    style E fill:#059669,stroke:#3fb950,color:#fff
</pre>
{:/nomarkdown}

### PostToolUse - Transcript Harvesting

Since the `Stop` hook doesn't reliably fire for VS Code Copilot, `PostToolUse` does double duty:

1. Records the tool execution itself
2. Scans the Copilot transcript for completed user+assistant turns
3. If a new completed turn is found (ID-based dedup), writes a synthetic `Stop` entry

```powershell
# Transcript location
%APPDATA%\Code\User\workspaceStorage\<wsId>\GitHub.copilot-chat\transcripts\<sessionId>.jsonl

# Transcript format (VS Code Copilot)
{"type":"user.message","data":{"content":"..."},"id":"uuid"}
{"type":"tool.execution_start","data":{"toolCallId":"...","toolName":"read_file","arguments":{...}}}
{"type":"tool.execution_complete","data":{"toolCallId":"...","success":true}}
{"type":"assistant.message","data":{"content":"final response text","toolRequests":[...]}}
```

### Tool Call Capture

`Get-LastCompletedTurn` collects `tool.execution_start` entries between user and assistant messages:

- **Capped at 10** tool calls per turn (token budget control)
- **Input truncated to 200 chars** per call
- Tool output is not available in the transcript (empty string)

The result structure:

```json
{
  "userId": "uuid",
  "user": "user prompt text",
  "assistant": "assistant response text",
  "toolCalls": [
    { "toolName": "read_file", "input": "{\"filePath\":\"src/auth.ts\",\"startLine\":1,...}", "output": "" },
    { "toolName": "grep_search", "input": "{\"query\":\"handleAuth\",...}", "output": "" }
  ]
}
```

---

## HookWatcher (TypeScript)

Located at `src/hooks/HookWatcher.ts`.

### File Watching

```typescript
// Watch the queue file for changes
fs.watch(QUEUE_FILE, () => {
    // 400ms debounce
    setTimeout(() => this._processQueue(), 400);
});
```

### Entry Processing

```typescript
interface HookEntry {
    hookType: string;       // "Stop" | "PostToolUse" | "PreCompact" | "SessionStart"
    timestamp: number;
    sessionId?: string;
    participant?: string;
    prompt?: string;
    response?: string;
    toolName?: string;
    toolInput?: unknown;
    toolResponse?: string;
    toolCalls?: Array<{ toolName: string; input: string; output: string }>;
    turns?: Array<{ user: string; assistant: string }>;
}
```

### Routing

| hookType | Action |
|:---------|:-------|
| `Stop` | `autoCapture.onModelResponse()` + `_queueCardCandidate()` |
| `PostToolUse` | Observation recording with tool detail extraction |
| `PreCompact` | Multi-turn extraction via `extractMultiTurnLearnings()` + auto-distill |

### Offset Management

The watcher tracks its position in the queue file by byte offset:

{::nomarkdown}
<pre class="mermaid">
graph TD
    A[Read queue file] --> B[Slice from lastOffset to end]
    B --> C[Parse new lines]
    C --> D[Process entries]
    D --> E[Advance offset by byte length]
    E --> F[Persist offset to .queue-offset file]

    style A fill:#7c3aed,stroke:#a78bfa,color:#fff
    style D fill:#2563eb,stroke:#58a6ff,color:#fff
    style F fill:#059669,stroke:#3fb950,color:#fff
</pre>
{:/nomarkdown}

This ensures crash-safe resumption - entries are never processed twice or lost.

---

## Session Context

The `HookWatcher` writes `~/.contextmanager/session-context.txt` whenever the active project changes. The `SessionStart` hook reads this file and injects it as `additionalContext`.

Contents include:
- Project name and root path

---

## Dual-Format Support

The transcript parser handles two formats:

| Format | Source | User Type | Assistant Type | Content Path |
|:-------|:-------|:----------|:---------------|:-------------|
| Claude Code | Claude Code sessions | `user` | `assistant` | `message.content` |
| VS Code Copilot | Copilot Chat | `user.message` | `assistant.message` | `data.content` |

Both formats are handled in `Get-LastExchange`, `Get-LastCompletedTurn`, and `Get-AllTurnsSinceOffset`.

---

## Versioning

The capture script includes a `cm-version` header:

| Version | Changes |
|:--------|:--------|
| 1 | Initial: basic Stop/PostToolUse handling |
| 2 | Added PreCompact multi-turn, dual-format support |
| 3 | Added PostToolUse transcript harvesting, ID-based dedup |
| 4 | Added tool call capture (tool.execution_start) |

The extension checks the installed version and updates the script if a newer version is bundled.

---

## Debugging

### Stop Debug Log

```
~/.contextmanager/stop-debug.log
```

Contains timestamped entries for every Stop hook invocation:
- Keys received in the event data
- Transcript path (provided or auto-discovered)
- Exchange content (truncated to 80 chars)

### HookWatcher Debug Logging

Console output with `[HookWatcher:DEBUG]` and `[HookWatcher/CardQueue:DEBUG]` prefixes:
- Queue processing: line count, offset
- Entry processing: hookType, participant, prompt/response length, tool call count
- Card queue decisions: enabled, participant filter, response length threshold

---

## Next Steps

[Configuration →]({% link configuration.md %})
{: .fs-5 }
