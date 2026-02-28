---
layout: default
title: Data Flow
parent: Architecture
nav_order: 2
---

# Data Flow
{: .fs-8 }

How data moves through ContextManager's pipelines - from capture to injection.
{: .fs-5 .fw-300 }

---

## Three Pipelines

ContextManager has three main data pipelines that operate concurrently:

1. **Direct Pipeline** - `@ctx` commands → immediate processing
2. **Auto-Capture Pipeline** - all chat responses → background processing
3. **Hook Pipeline** - VS Code Copilot transcript → file-based queue

---

## 1. Direct Pipeline

When you use `@ctx` commands, data flows synchronously:

{::nomarkdown}
<pre class="mermaid">
graph TD
    A[User types ctx /knowledge] --> B[ChatParticipant receives request]
    B --> C[Build system prompt]
    C --> D[Send to Language Model API]
    D --> E[Handle tool calls in loop]
    E --> F[Stream response to user]
    F --> G[Post-processing]
    G --> H[Auto-capture records observation]

    style A fill:#7c3aed,stroke:#a78bfa,color:#fff
    style D fill:#2563eb,stroke:#58a6ff,color:#fff
    style H fill:#059669,stroke:#3fb950,color:#fff
</pre>
{:/nomarkdown}
---

## 2. Auto-Capture Pipeline

Runs in the background for **all** chat participants:

{::nomarkdown}
<pre class="mermaid">
graph TD
    A[Any Model Response] --> B[AutoCaptureService]
    B --> C{Content hash dedup}
    C -->|New| D[Strip private tags]
    C -->|Duplicate| X[Skip]
    D --> E[Classify observation type]
    E --> F[Extract file paths]
    F --> G[Calculate token economics]
    G --> H[Add to observation buffer]
    H --> I[Update FTS index]
    I --> J{autoLearn enabled?}
    J -->|Yes| K[LLM extraction]
    K --> L[Conventions + Tool Hints + Notes]
    J -->|No| N[Done]

    style A fill:#7c3aed,stroke:#a78bfa,color:#fff
    style H fill:#2563eb,stroke:#58a6ff,color:#fff
    style K fill:#d97706,stroke:#fbbf24,color:#fff
    style L fill:#059669,stroke:#3fb950,color:#fff
    style X fill:#1c2333,stroke:#30363d,color:#8b949e
</pre>
{:/nomarkdown}
---

## 3. Hook Pipeline

Captures from VS Code Copilot's native transcript system:

{::nomarkdown}
<pre class="mermaid">
graph TD
    A[Copilot processes tool call] --> B[Chat Hooks API fires PostToolUse]
    B --> C[capture.ps1 runs]
    C --> D[Write PostToolUse entry]
    C --> E[Find Copilot transcript]
    E --> F[Get-LastCompletedTurn]
    F --> G{New turn?}
    G -->|Yes| H[Write synthetic Stop entry]
    G -->|No| I[Skip]
    H --> J[HookWatcher detects change]
    J --> K[Parse JSONL entries]
    K --> L{Route by hookType}
    L --> L1[Stop: autoCapture + cardQueue]
    L --> L2[PostToolUse: observation]
    L --> L3[PreCompact: multi-turn]
    L --> L4[SessionStart: context injection]

    style A fill:#7c3aed,stroke:#a78bfa,color:#fff
    style C fill:#d97706,stroke:#fbbf24,color:#fff
    style J fill:#2563eb,stroke:#58a6ff,color:#fff
    style L1 fill:#059669,stroke:#3fb950,color:#fff
    style L2 fill:#059669,stroke:#3fb950,color:#fff
    style L3 fill:#059669,stroke:#3fb950,color:#fff
    style L4 fill:#059669,stroke:#3fb950,color:#fff
    style I fill:#1c2333,stroke:#30363d,color:#8b949e
</pre>
{:/nomarkdown}
---

## Storage Architecture

### Disk-Backed JSON

All project data persists to JSON files in `globalStorageUri`:

```
globalStorageUri/
├── projects.json              # All project metadata (single file for all projects)
├── observations.json          # All observations (managed by AutoCaptureService)
└── search-fts4.db             # SQLite FTS4 search index
```

**In-memory caching**: Data loaded once at startup, served from memory on read, flushed to disk on every write. Zero I/O overhead for reads.

### File-Based Queue

The hook system uses a simple append-only JSONL file:

```
~/.contextmanager/
├── hook-queue.jsonl      # Append-only entries from capture.ps1
├── .queue-offset         # Byte offset (HookWatcher resumption point)
├── session-context.txt   # Written by HookWatcher (project name + root path only)
├── knowledge-index.txt   # Card index (actively written for PreCompact hook)
├── seen-turn-<sid>       # Dedup files (last processed userId per session)
├── stop-debug.log        # Debug log for Stop hook
└── scripts/
    ├── capture.ps1       # The hook script (Windows)
    └── capture.sh        # The hook script (Linux/macOS)
```

---

## Context Injection Flow

When context is injected into a prompt:

{::nomarkdown}
<pre class="mermaid">
graph TD
    A[Project data changes] --> B[syncInstructions triggers]
    B --> C[Write copilot-instructions.md managed block]
    C --> D[Pinned cards + tool discovery]
    D --> G[Always included by VS Code on every request]

    E["Agent invokes #ctx tool"] --> F[On-demand search / getCard / learn]
    F --> H[Context returned to agent]

    I["Agent invokes #searchCards or #getCard"] --> J[Knowledge cards returned]
    J --> H

    G --> K[Language model receives context]
    H --> K

    style A fill:#7c3aed,stroke:#a78bfa,color:#fff
    style C fill:#059669,stroke:#3fb950,color:#fff
    style G fill:#2563eb,stroke:#58a6ff,color:#fff
    style E fill:#d97706,stroke:#fbbf24,color:#fff
    style K fill:#059669,stroke:#3fb950,color:#fff
</pre>
{:/nomarkdown}
---

## Token Budget Summary

| Component | Setting | Default | Range |
|:----------|:--------|:--------|:------|
| Intelligence Tier 1 | `intelligence.tier1MaxTokens` | 400 tokens | 100–1000 |
| Intelligence Tier 2 | `intelligence.tier2MaxTokens` | 400 tokens | 100–1000 |
| Intelligence Max Chars | `intelligence.injectionMaxChars` | 0 (unlimited) | 0+ |
| Session Continuity | `sessionContinuity.maxContextTokens` | 800 tokens | 200–2000 |
| Knowledge Cards | `maxKnowledgeCardsInContext` | 5 cards | 1–20 |

---

## Next Steps

[Hook System →]({% link architecture/hook-system.md %})
{: .fs-5 }
