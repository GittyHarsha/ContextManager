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

ContextManager is a VS Code extension with the following core subsystems:

{::nomarkdown}
<pre class="mermaid">
graph TB
    LMT[Language Model Tools - 5 tools] --> PM[Project Manager]
    DASH[Dashboard - 4 tabs] --> PM
    PM --> AC[Auto-Capture Service]
    AC --> AL[Auto-Learn Pipeline]
    AC --> SI[Search Index - SQLite FTS4]
    HW[Hook Watcher] --> AC
    GI[GitHub Instructions Manager] --> PM
    HW -.-> HQ

    subgraph FS[File System]
        HQ[hook-queue.jsonl]
        SC[capture.ps1 / capture.sh]
        CTX[session-context.txt]
    end

    style LMT fill:#1f6feb,stroke:#388bfd,color:#fff
    style DASH fill:#1f6feb,stroke:#388bfd,color:#fff
    style PM fill:#1158c7,stroke:#388bfd,color:#fff
    style AC fill:#1158c7,stroke:#388bfd,color:#fff
    style AL fill:#1158c7,stroke:#388bfd,color:#fff
    style SI fill:#238636,stroke:#3fb950,color:#fff
    style HW fill:#9e6a03,stroke:#d29922,color:#fff
    style GI fill:#238636,stroke:#3fb950,color:#fff
</pre>
{:/nomarkdown}
---

## Technology Stack

| Component | Technology |
|:----------|:-----------|
| Language | TypeScript (ES2022) |
| Runtime | VS Code Extension Host (Node.js) |
| Database | SQLite via sql.js (WebAssembly) — FTS4 with BM25 |
| Storage | JSON files on disk (`globalStorageUri`) |
| Dashboard | WebView (HTML/CSS/JS, Content Security Policy) |
| Rendering | Markdown + KaTeX (LaTeX) + Mermaid (styled blocks) |
| Search | BM25 from `matchinfo('pcnalx')` with per-column weights |
| Agent Hooks | PowerShell/Bash scripts via VS Code chat hooks API |
| AI | VS Code Language Model API (`vscode.lm`) |
| Testing | Vitest |

---

## Component Details

### 1. Language Model Tools (5 tools)

Registered via `vscode.lm.registerTool()`. Available to all agents:

```typescript
// Registration pattern (src/tools/index.ts → registerTools())
vscode.lm.registerTool('contextManager_ctx', handler);              // #ctx — unified search/list/learn/getCard/fetch/retrospect
vscode.lm.registerTool('contextManager_getCard', handler);          // #getCard — read full card by ID
vscode.lm.registerTool('contextManager_saveKnowledgeCard', handler);   // #saveCard
vscode.lm.registerTool('contextManager_editKnowledgeCard', handler);   // #editCard
vscode.lm.registerTool('contextManager_organizeKnowledgeCards', handler); // #organizeCards — folder management
```

Each tool includes `disambiguation` entries that help Copilot decide when to auto-invoke.

**Conditional registration:** `ctx` requires `SearchIndex`. If the dependency isn't available at activation, the tool won't be registered at runtime.

**Dead/orphaned tool files:** `projectContextTool.ts` (deprecated), `projectIntelligenceTool.ts` (orphaned — functionality merged into `CtxTool`), `todoManagerTool.ts` (imported but never registered).

### 2. Project Manager

Central data store (`src/projects/ProjectManager.ts`, ~2000 lines) managing:

- **Projects** — metadata, root paths, goals, conventions
- **Knowledge Cards** — CRUD, folders, flags, progressive disclosure
- **Project Intelligence** — conventions, tool hints, working notes
- **Todos** — user-managed task items
- **Events** — `onDidChangeActiveProject`, `onDidChangeProjects`, `onDidChangeCache`

Data persists to JSON files in `globalStorageUri` with in-memory caching for zero-overhead reads. Storage layer (`storage.ts`) handles disk I/O and `globalState` for metadata.

### 3. Auto-Capture Service

Listens to all chat interactions from all participants (`src/autoCapture.ts`, ~1050 lines):

{::nomarkdown}
<pre class="mermaid">
graph LR
    A[Model Response] --> B[Strip Private Tags]
    B --> C[DJB2 Content Hash]
    C --> D[Dedup Check - 30s window]
    D --> E[Typed Observation Buffer]
    E --> F[FTS4 Indexing]
    E --> G[Intelligence Extraction]
    G --> H[Conventions]
    G --> I[Working Notes]

    style A fill:#1f6feb,stroke:#388bfd,color:#fff
    style E fill:#1158c7,stroke:#388bfd,color:#fff
    style G fill:#1158c7,stroke:#388bfd,color:#fff
    style H fill:#238636,stroke:#3fb950,color:#fff
    style I fill:#238636,stroke:#3fb950,color:#fff
</pre>
{:/nomarkdown}

Key features:

- **Content-hash deduplication** — dual DJB2 hash with 30-second window (`DEDUP_WINDOW_MS`)
- **Typed observations** — 6 types: bugfix, feature, discovery, decision, refactor, change (classified via keyword scoring)
- **Privacy tag stripping** — `<private>...</private>` replaced with `[REDACTED]`
- **Multi-turn extraction** — iterative convention extraction for PreCompact events
- **Auto-distill** — periodic background distillation to knowledge card candidates (rate-limited, min 4 observations)
- **Anchor extraction** — identifies load-bearing tool results for knowledge cards
- **Tool call capture** — separate path (`captureToolCalls()`) creating per-tool-call observations
- **Configurable buffer** — default `MAX_OBSERVATIONS = 50`, overridable via settings

### 4. Auto-Learn Pipeline

Intelligence extraction via LLM (`src/autoLearn.ts`, ~790 lines):

- **LLM extraction** — lightweight calls (~200 input tokens) for conventions and working notes
- **Regex fallback** — if no LM available, regex-based extraction for tool hints (always regex, high precision)
- **Hard caps with decay** — 30 working notes, 20 tool hints, 15 conventions; oldest-inferred eviction
- **Feedback loop** — discard counters suppress over-discarded categories; confirming resets
- **All intelligence saved as `confidence: 'inferred'`** — nothing auto-confirmed

### 5. Search Index

SQLite FTS4 via sql.js WebAssembly with **8 virtual tables** (`src/search/SearchIndex.ts`, ~1450 lines):

| Table | FTS-Indexed Columns | Weights (title/primary=10, content=5) |
|:------|:-------------------|:--------------------------------------|
| `cards_fts` | title, content, category, tags, source | 10, 5, 2, 1, 1 |
| `cache_fts` | symbol_name, content, file_path | 5, 5, 2 |
| `learnings_fts` | subject, content, related_files, related_symbols | 10, 5, 2, 2 |
| `observations_fts` | prompt, response_summary, files_referenced, tool_calls | 10, 5, 3, 2 |
| `agent_messages_fts` | content | 5 |
| `todos_fts` | title, description, notes | 10, 5, 3 |
| `projects_fts` | name, description, goals, conventions | 5, 3, 3, 2 |
| `sessions_fts` | branch_name, task, goal, current_state, approaches, decisions, next_steps, blockers | 5, 10, 5, 3, 2, 2, 2, 2 |

BM25 ranking uses JavaScript-computed scores from `matchinfo('pcnalx')` with standard parameters (k1=1.2, b=0.75). Over-fetches 3× the limit from SQLite, ranks in JS, then trims. Automatic OR fallback if AND query returns 0 results.

### 6. Hook Watcher

File system watcher on `~/.contextmanager/hook-queue.jsonl` (`src/hooks/HookWatcher.ts`, ~400 lines):

1. Uses native `fs.watch()` with 400ms debounce
2. Reads queue file as raw Buffer for accurate byte offsets with multi-byte UTF-8
3. Parses new JSONL lines into typed `HookEntry` objects
4. Routes to handler by `hookType` — **3 active handlers:**
   - **`Stop`** → `autoCapture.onModelResponse()` + card queue candidate (gated by `hooks.stop` setting)
   - **`PostToolUse`** → tool-call observation with parsed input summary (gated by `hooks.postToolUse` setting)
   - **`PreCompact`** → multi-turn extraction via `extractMultiTurnLearnings()` + `distillAndSaveBackground()` (gated by `hooks.preCompact` setting)
5. Advances byte offset and persists to `~/.contextmanager/.queue-offset`
6. On startup, processes any backlog before starting the watcher; snaps to end if offset exceeds file size

**Configured but unhandled hooks:** `SessionStart` and `SubagentStart` (context injection handled at shell-script level via `session-context.txt`), `UserPromptSubmit` — all declared in `hooks.json` but silently ignored by the TypeScript watcher.

### 7. Supporting Services

| Service | File | Role |
|:--------|:-----|:-----|
| **GitHubInstructionsManager** | `githubInstructions.ts` | Syncs `.github/copilot-instructions.md` with pinned cards and tool discovery hints |
| **ConfigurationManager** | `config.ts` | Centralized, type-safe access to all extension settings |
| **ExplanationCache** | `cache.ts` | Internal cache of explanations — used by dashboard and commands (not exposed as LM tools) |
| **BackgroundTasks** | `backgroundTasks.ts` | Background task queue running LLM agent loops with live dashboard progress |
| **FileSync** | `fileSync.ts` | File-based sync for knowledge cards via git-tracked `.contextmanager/` directory |
| **Sidebar** | `sidebar/ProjectsTreeProvider.ts` | Tree view provider for the Projects sidebar panel |

---

## Data Flow

### Knowledge Card Lifecycle

{::nomarkdown}
<pre class="mermaid">
graph LR
    subgraph Discovery
        A1["saveAsCard command"]
        A2["save tool"]
        A3[Card Queue Distill]
        A4[Auto-Distill]
    end
    subgraph Curation
        B1[Dashboard Edit]
        B2["edit tool"]
        B3["organize tool"]
        B4[Smart Merge via LLM]
    end
    subgraph Injection
        C1[copilot-instructions.md]
        C2["#ctx tool - search/list"]
        C3["#getCard - full content"]
    end
    A1 --> B1 --> C1
    A2 --> B2 --> C2
    A3 --> B3 --> C3
    A4 --> B4 --> C3
</pre>
{:/nomarkdown}

### Intelligence Pipeline

{::nomarkdown}
<pre class="mermaid">
graph TD
    A[Any Chat Response] --> B[Auto-Capture]
    B --> C["Observation Buffer (default 50)"]
    C --> D["Auto-Learn (LLM or regex fallback)"]
    D --> E[Conventions + Tool Hints + Working Notes]
    E --> F1["GitHubInstructionsManager → copilot-instructions.md"]
    F1 --> F1a[Pinned cards + tool discovery]
    E --> F2["#ctx tool — on-demand search/list/learn/retrospect"]
    C --> G["Auto-Distill → Card Queue candidates"]

    style A fill:#1f6feb,stroke:#388bfd,color:#fff
    style C fill:#1158c7,stroke:#388bfd,color:#fff
    style D fill:#1158c7,stroke:#388bfd,color:#fff
    style E fill:#238636,stroke:#3fb950,color:#fff
    style F1 fill:#238636,stroke:#3fb950,color:#fff
    style F2 fill:#238636,stroke:#3fb950,color:#fff
    style G fill:#238636,stroke:#3fb950,color:#fff
</pre>
{:/nomarkdown}

### Hook Pipeline (VS Code Copilot)

{::nomarkdown}
<pre class="mermaid">
graph TD
    A[VS Code Copilot Chat] --> B[PostToolUse hook fires]
    B --> C[capture.ps1 / capture.sh]
    C --> D[Find Copilot transcript]
    D --> E[Get-LastCompletedTurn]
    E --> F[Write Stop entry to queue]
    F --> G["HookWatcher detects change (fs.watch + 400ms debounce)"]
    G --> H[Card Queue Candidate]
    G --> I[Typed Observation Buffer]
    I --> J[FTS4 Index]

    style A fill:#1f6feb,stroke:#388bfd,color:#fff
    style C fill:#9e6a03,stroke:#d29922,color:#fff
    style G fill:#1158c7,stroke:#388bfd,color:#fff
    style H fill:#238636,stroke:#3fb950,color:#fff
    style I fill:#238636,stroke:#3fb950,color:#fff
    style J fill:#238636,stroke:#3fb950,color:#fff
</pre>
{:/nomarkdown}

---

## Dashboard

The WebView dashboard has **4 tabs**:

| Tab | ID | Contents |
|:----|:---|:---------|
| 🧠 Intelligence | `intelligence` | Auto-Learn & Auto-Capture controls, observation stats (24h/90d), toggle switches |
| Knowledge | `knowledge` | 3 sub-tabs: **Workbench** (conventions, notes, hints), **Knowledge Cards** (full card list + editor), **Card Queue** (AI candidates) |
| Context | `context` | Project context editor (goals, conventions, tech stack) included in AI prompts |
| ⚙ Settings | `settings` | Extension settings UI with grouped sections |

---

## Directory Structure

```
ContextManager/
├── src/
│   ├── extension.ts              # Activation — wires all subsystems
│   ├── autoCapture.ts            # Auto-capture service (~1050 lines)
│   ├── autoLearn.ts              # Intelligence extraction via LLM (~790 lines)
│   ├── backgroundTasks.ts        # Background task queue with LLM agent loops
│   ├── cache.ts                  # ExplanationCache — internal data layer
│   ├── commands.ts               # VS Code command registrations
│   ├── config.ts                 # ConfigurationManager — type-safe settings
│   ├── fileSync.ts               # Git-tracked .contextmanager/ sync + markdown import
│   ├── githubInstructions.ts     # copilot-instructions.md managed block
│   ├── prompts.ts                # System prompt templates for explanation commands
│   │
│   ├── dashboard/
│   │   ├── DashboardPanel.ts     # WebView dashboard (4 tabs, ~1500 lines)
│   │   ├── cardCanvas.ts         # Card tile rendering & tool-call viewer
│   │   ├── index.ts              # Barrel export
│   │   ├── htmlHelpers.ts        # HTML generation (escapeHtml, renderMarkdown, KaTeX)
│   │   ├── messageHandler.ts     # WebView ↔ extension message handler (~1800 lines)
│   │   ├── styles.ts             # Dashboard CSS (~1570 lines)
│   │   ├── webviewScript.ts      # Client-side JS (~2700 lines)
│   │   └── __tests__/
│   │       └── htmlHelpers.test.ts
│   │
│   ├── hooks/
│   │   └── HookWatcher.ts        # File watcher for hook-queue.jsonl
│   │
│   ├── projects/
│   │   ├── ProjectManager.ts     # Central data store (~2000 lines)
│   │   ├── storage.ts            # Persistence: globalStorageUri + globalState
│   │   └── types.ts              # Interfaces & factory functions (~440 lines)
│   │
│   ├── search/
│   │   ├── SearchIndex.ts        # SQLite FTS4 via sql.js (~1450 lines)
│   │   └── types.ts              # Search entity types, result interfaces
│   │
│   ├── sidebar/
│   │   └── ProjectsTreeProvider.ts  # Tree view provider for Projects panel
│   │
│   ├── tools/
│   │   ├── index.ts              # Barrel + registerTools()
│   │   ├── searchTools.ts        # CtxTool (~450 lines)
│   │   ├── knowledgeCardTools.ts # Save/Edit/Organize/GetCard tools (~450 lines)
│   │   ├── projectContextTool.ts # DEPRECATED — not registered
│   │   ├── projectIntelligenceTool.ts  # ORPHANED — merged into CtxTool
│   │   └── todoManagerTool.ts    # DEAD — imported but never registered
│   │
│   └── utils/
│       ├── gitUtils.ts           # Git helpers (branch, diff, log)
│       ├── symbolUtils.ts        # VS Code symbol/selection helpers
│       ├── toolFilter.ts         # Tool filtering & name normalization
│       └── toolUsageExtractor.ts # Tool-call pattern extraction for cards
│
├── resources/
│   └── hooks/
│       ├── capture.ps1           # Agent hook script (Windows)
│       ├── capture.sh            # Agent hook script (macOS/Linux)
│       └── hooks.json            # Hook type declarations
│
├── media/
│   └── mermaid.min.js            # Bundled Mermaid for dashboard rendering
│
├── out/                          # Compiled JavaScript
├── docs/                         # Documentation site (Jekyll)
└── package.json                  # Extension manifest
```

---

## Next Steps

[Data Flow →]({% link architecture/data-flow.md %})
{: .fs-5 }
