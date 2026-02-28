---
layout: default
title: Architecture Overview
parent: Architecture
nav_order: 1
---

# Architecture Overview
{: .fs-8 }

System components, data flow, and how everything connects.
{: .fs-5 .fw-300 }

---

## System Components

ContextManager is a VS Code extension with six core layers:

{::nomarkdown}
<pre class="mermaid">
graph TB
    CP[Chat Participant - 15 commands] --> PM[Project Manager]
    LMT[Language Model Tools - 11 tools] --> PM
    DASH[Dashboard - 6 tabs] --> PM
    PM --> AC[Auto-Capture Service]
    AC --> SI[Search Index - SQLite FTS4]
    HW[Hook Watcher] --> AC
    HW -.-> HQ

    subgraph FS[File System]
        HQ[hook-queue.jsonl]
        SC[capture.ps1]
        CTX[session-context.txt]
    end

    style CP fill:#7c3aed,stroke:#a78bfa,color:#fff
    style LMT fill:#7c3aed,stroke:#a78bfa,color:#fff
    style DASH fill:#7c3aed,stroke:#a78bfa,color:#fff
    style PM fill:#2563eb,stroke:#58a6ff,color:#fff
    style AC fill:#2563eb,stroke:#58a6ff,color:#fff
    style SI fill:#059669,stroke:#3fb950,color:#fff
    style HW fill:#d97706,stroke:#fbbf24,color:#fff
</pre>
{:/nomarkdown}
---

## Technology Stack

| Component | Technology |
|:----------|:-----------|
| Language | TypeScript (ES2022) |
| Runtime | VS Code Extension Host (Node.js) |
| Database | SQLite via sql.js (WebAssembly) - FTS4 with BM25 |
| Storage | JSON files on disk (`globalStorageUri`) |
| Dashboard | WebView (HTML/CSS/JS, Content Security Policy) |
| Rendering | Markdown + KaTeX (LaTeX) + Mermaid (styled blocks) |
| Search | BM25 from `matchinfo('pcnalx')` with per-column weights |
| Agent Hooks | PowerShell scripts via VS Code chat hooks API |
| AI | VS Code Language Model API (`vscode.lm`) |

---

## Component Details

### 1. Chat Participant (`@ctx`)

Registered as `context-manager.ctx` with 15 slash commands. Each command:

1. Receives the user's message and selected context
2. Builds a system prompt with project injection (cards, intelligence)
3. Sends to the language model via `vscode.lm.sendChatRequest`
4. Handles tool calls in a loop (search, read file, navigate)
5. Streams the response back to the user
6. Triggers auto-capture and follow-up suggestions

### 2. Language Model Tools (11 tools)

Registered via `vscode.lm.registerTool()`. Available to all agents:

```typescript
// Registration pattern
vscode.lm.registerTool('contextManager_ctx', handler);              // #ctx - unified search/list/learn/getCard
vscode.lm.registerTool('contextManager_semanticSearch', handler);   // #searchCards
vscode.lm.registerTool('contextManager_runSubagent', handler);      // #ctxSubagent
vscode.lm.registerTool('contextManager_getCard', handler);          // #getCard
vscode.lm.registerTool('contextManager_saveKnowledgeCard', handler);
vscode.lm.registerTool('contextManager_editKnowledgeCard', handler);
vscode.lm.registerTool('contextManager_organizeKnowledgeCards', handler);
vscode.lm.registerTool('contextManager_saveCache', handler);
vscode.lm.registerTool('contextManager_searchCache', handler);
vscode.lm.registerTool('contextManager_readCache', handler);
vscode.lm.registerTool('contextManager_editCache', handler);
```

Each tool includes `disambiguation` entries that help Copilot decide when to auto-invoke.

### 3. Project Manager

Central data store managing:

- **Projects** - metadata, root paths, goals, conventions
- **Knowledge Cards** - CRUD, folders, flags, progressive disclosure
- **Project Intelligence** - conventions, tool hints, working notes
- **Card Queue** - staging buffer for response capture
- **Observations** - auto-captured interaction buffer

Data persists to JSON files in `globalStorageUri` with in-memory caching for zero-overhead reads.

### 4. Auto-Capture Service

Listens to all chat interactions:

{::nomarkdown}
<pre class="mermaid">
graph LR
    A[Model Response] --> B[Content Hash]
    B --> C[Dedup Check]
    C --> D[Observation Buffer]
    D --> E[Intelligence Extraction]
    E --> F[Conventions]
    E --> G[Tool Hints]
    E --> H[Working Notes]

    style A fill:#7c3aed,stroke:#a78bfa,color:#fff
    style D fill:#2563eb,stroke:#58a6ff,color:#fff
    style E fill:#2563eb,stroke:#58a6ff,color:#fff
    style F fill:#059669,stroke:#3fb950,color:#fff
    style G fill:#059669,stroke:#3fb950,color:#fff
    style H fill:#059669,stroke:#3fb950,color:#fff
</pre>
{:/nomarkdown}
- **Content-hash deduplication** with 30-second window
- **Privacy tag stripping** (`<private>...</private>`)
- **Token economics tracking** (discovery vs read cost)
- **Multi-turn extraction** for PreCompact events

### 5. Search Index

SQLite FTS4 via sql.js WebAssembly with 7 virtual tables:

| Table | Indexed Content |
|:------|:---------------|
| `cards_fts` | Knowledge card title, content, category |
| `cache_fts` | Cache entry title, content |
| `learnings_fts` | Conventions, tool hints, working notes |
| `observations_fts` | Auto-captured observations |
| `agent_messages_fts` | Agent conversation messages |
| `todos_fts` | Todo items and descriptions |
| `projects_fts` | Project metadata and goals |

BM25 ranking uses JavaScript-computed scores from `matchinfo('pcnalx')`.

### 6. Hook Watcher

File system watcher on `~/.contextmanager/hook-queue.jsonl`:

1. Detects new entries via byte offset tracking
2. Parses JSONL lines into typed `HookEntry` objects
3. Routes to handler by `hookType`:
   - `Stop` → `autoCapture.onModelResponse()` + card queue
   - `PostToolUse` → observation recording
   - `PreCompact` → multi-turn extraction
   - `SessionStart` → context injection
4. Advances offset and persists to `.queue-offset`

---

## Data Flow

### Knowledge Card Lifecycle

{::nomarkdown}
<pre class="mermaid">
graph LR
    subgraph Discovery
        A1["knowledge command"]
        A2["save command"]
        A3["add command"]
        A4[Card Queue Distill]
    end
    subgraph Curation
        B1[Dashboard Edit]
        B2["refine command"]
        B3[Folder Organize]
        B4["audit command"]
    end
    subgraph Injection
        C1[Progressive Disclosure]
        C2[projectContext tool]
        C3[searchCards tool]
        C4[Auto-inject top 3]
    end
    A1 --> B1 --> C1
    A2 --> B2 --> C2
    A3 --> B3 --> C3
    A4 --> B4 --> C4
</pre>
{:/nomarkdown}
### Intelligence Pipeline

{::nomarkdown}
<pre class="mermaid">
graph TD
    A[Any Chat Response] --> B[Auto-Capture]
    B --> C[Observation Buffer - 50 entries]
    C --> D[Auto-Learn via LLM]
    D --> E[Conventions + Tool Hints + Notes]
    E --> F1[copilot-instructions.md managed block]
    F1 --> F1a[Pinned cards + tool discovery]
    E --> F2["#ctx tool - on-demand search/list/learn"]

    style A fill:#7c3aed,stroke:#a78bfa,color:#fff
    style C fill:#2563eb,stroke:#58a6ff,color:#fff
    style D fill:#2563eb,stroke:#58a6ff,color:#fff
    style E fill:#059669,stroke:#3fb950,color:#fff
    style F1 fill:#059669,stroke:#3fb950,color:#fff
    style F2 fill:#059669,stroke:#3fb950,color:#fff
</pre>
{:/nomarkdown}
### Hook Pipeline (VS Code Copilot)

{::nomarkdown}
<pre class="mermaid">
graph TD
    A[VS Code Copilot Chat] --> B[PostToolUse hook fires]
    B --> C[capture.ps1]
    C --> D[Find Copilot transcript]
    D --> E[Get-LastCompletedTurn]
    E --> F[Write Stop entry to queue]
    F --> G[HookWatcher detects change]
    G --> H[Card Queue]
    G --> I[Observation Buffer]

    style A fill:#7c3aed,stroke:#a78bfa,color:#fff
    style C fill:#d97706,stroke:#fbbf24,color:#fff
    style G fill:#2563eb,stroke:#58a6ff,color:#fff
    style H fill:#059669,stroke:#3fb950,color:#fff
    style I fill:#059669,stroke:#3fb950,color:#fff
</pre>
{:/nomarkdown}
---

## Directory Structure

```
codebase-navigator/
├── src/
│   ├── extension.ts              # Activation, registration
│   ├── autoCapture.ts            # Auto-capture service
│   ├── autoLearn.ts              # Intelligence extraction via LLM
│   ├── backgroundTasks.ts        # Background task runner
│   ├── cache.ts                  # Cache data layer
│   ├── commands.ts               # VS Code command registrations
│   ├── config.ts                 # Configuration manager
│   ├── embeddings.ts             # Embedding utilities
│   ├── fileSync.ts               # File synchronization
│   ├── githubInstructions.ts     # copilot-instructions.md management
│   ├── prompts.ts                # Legacy prompt utilities
│   ├── proposedApi.ts            # Proposed API wrappers
│   ├── sessionContinuity.ts      # Session continuity tracking
│   │
│   ├── chat/
│   │   ├── index.ts              # @ctx chat participant (15 commands)
│   │   ├── helpers.ts            # Chat response helpers
│   │   ├── toolCallingLoop.ts    # Tool-calling loop
│   │   └── commands/
│   │       ├── index.ts          # Command barrel export
│   │       ├── analysisCommands.ts
│   │       ├── knowledgeCommands.ts
│   │       └── workflowCommands.ts
│   │
│   ├── dashboard/
│   │   ├── DashboardPanel.ts     # WebView dashboard (6 tabs)
│   │   ├── index.ts              # Dashboard barrel export
│   │   ├── htmlHelpers.ts        # HTML generation helpers
│   │   ├── messageHandler.ts     # WebView message handler
│   │   ├── styles.ts             # Dashboard CSS
│   │   └── webviewScript.ts      # Client-side script
│   │
│   ├── hooks/
│   │   └── HookWatcher.ts        # File watcher for hook-queue.jsonl
│   │
│   ├── projects/
│   │   ├── ProjectManager.ts     # Central data store
│   │   ├── storage.ts            # Persistence layer
│   │   └── types.ts              # Interfaces, factory functions
│   │
│   ├── prompts/
│   │   ├── index.ts              # Prompt barrel export
│   │   ├── chatPrompt.tsx        # Chat system prompt
│   │   ├── analysisPrompt.tsx    # Analysis prompt
│   │   ├── knowledgePrompt.tsx   # Knowledge extraction prompt
│   │   ├── refineKnowledgePrompt.tsx
│   │   ├── cardMerge.tsx         # Card merge prompt
│   │   ├── cardWorthinessDetector.tsx
│   │   ├── todoPrompt.tsx        # Todo prompt
│   │   └── components.tsx        # Shared prompt components
│   │
│   ├── search/
│   │   ├── SearchIndex.ts        # SQLite FTS4 via sql.js
│   │   └── types.ts              # Search types
│   │
│   ├── sidebar/
│   │   └── ProjectsTreeProvider.ts  # Tree view provider
│   │
│   ├── tools/
│   │   ├── index.ts              # Tool barrel export
│   │   ├── searchTools.ts        # CtxTool (unified search/list/learn/getCard)
│   │   ├── knowledgeCardTools.ts # Save/edit/organize card tools
│   │   ├── cacheTools.ts         # Save/search/read/edit cache tools
│   │   ├── subagentTool.ts       # Subagent runner tool
│   │   ├── projectContextTool.ts # Project context tool
│   │   ├── projectIntelligenceTool.ts
│   │   ├── fileTools.ts          # File operation tools
│   │   └── todoManagerTool.ts    # Todo management tool
│   │
│   └── utils/
│       ├── gitUtils.ts           # Git helpers
│       └── symbolUtils.ts        # Symbol utilities
│
├── resources/
│   └── hooks/
│       └── capture.ps1           # Agent hook script (bundled)
│
├── out/                          # Compiled JavaScript
├── docs/                         # This documentation site
└── package.json                  # Extension manifest
```

---

## Next Steps

[Data Flow →]({% link architecture/data-flow.md %})
{: .fs-5 }
