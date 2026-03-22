# ContextManager — AI Project Memory

> Build a persistent project memory layer for Copilot. Curate knowledge cards, auto-capture project intelligence, search everything with BM25, run AI or template workflows, route different features to different models, and manage it all from one dashboard.

[![Version](https://img.shields.io/badge/version-2.11.0-blue.svg)](https://marketplace.visualstudio.com/items?itemName=HarshaNarayanaP.context-manager)
[![VS Code](https://img.shields.io/badge/VS%20Code-1.100.0+-007ACC.svg)](https://code.visualstudio.com/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](https://opensource.org/licenses/MIT)

**[📖 Documentation](https://gittyharsha.github.io/ContextManager/)** · **[🐛 Issues](https://github.com/GittyHarsha/ContextManager/issues)** · **[📦 Marketplace](https://marketplace.visualstudio.com/items?itemName=HarshaNarayanaP.context-manager)**

---

## Features

### 🧠 Knowledge Cards — Persistent AI Memory

Create, curate, and inject expert knowledge into every AI interaction. Knowledge cards are structured markdown notes — architectural decisions, coding conventions, patterns — that enhance all Copilot responses.

- **Create cards** from the dashboard, via `#saveCard` tool, or from the Card Queue
- **Tag and categorize** (architecture, pattern, convention, explanation, note)
- **Folder-aware chat saves** — `#saveCard` can list folders, create folders, and save directly into a named folder
- **Folder organization** — organize cards into folders manually or with `#organizeCards` auto-organize
- **Code anchors** — cards track referenced files and flag staleness when code changes
- **Search and filter** — find cards by keyword or BM25 full-text search
- **Smart merge** — when saving a card similar to an existing one, a merge picker appears automatically

### ⚡ Custom Workflows

Build reusable automations on top of your project memory. Workflow templates can render project data into markdown, then either send it through the model or save the rendered output directly.

- **AI-backed actions** — generate markdown and create, update, or append cards
- **Template actions** — skip the model call and write rendered templates directly
- **7 triggers** — manual, queue, convention learned, card created, card updated, observation created
- **Target-aware updates** — workflows can resolve target card content into template variables before updating
- **Dedicated workflow model** — choose a specific model family for AI workflow actions without affecting other features
- **Run history and skip patterns** — track success/skipped/error runs and suppress low-value output

### 🔄 Auto-Capture & Card Queue

ContextManager captures knowledge silently in the background from **all** chat participants:

| What's captured | How |
|:----------------|:----|
| **Conventions** | LLM extracts coding patterns from responses |
| **Tool Hints** | Learned search terms that work for your codebase |
| **Working Notes** | Code relationships and insights discovered during exploration |
| **Card Candidates** | High-confidence knowledge staged in the Card Queue for review |

Card-worthy responses are automatically queued. Click **Distill into Cards** in the dashboard to synthesize them into knowledge card proposals for review.

### 🔍 BM25 Full-Text Search (SQLite FTS4)

Fast, ranked search across your entire project memory:

- **`#ctx`** — unified BM25 search plus explicit card queue review flows across cards, conventions, working notes, tool hints, cache, observations, sessions, and projects
- SQLite FTS4 via sql.js (WebAssembly) — no native binaries, works everywhere
- Quoted phrases (`"error handler"`), prefix matching (`auth*`), snippet previews
- Index persisted between sessions, rebuilt on activation, incrementally synced on every mutation

### 🧩 Project Intelligence — Auto-Learn Pipeline

ContextManager automatically learns from your interactions:

- **Conventions** — coding patterns and rules extracted from AI responses
- **Tool Hints** — search queries that work for your codebase (fail→success patterns)
- **Working Notes** — file relationships and insights from code exploration
- **Dedicated extraction model** — route background auto-learn extraction to a smaller or cheaper model family
- **Tiered injection** — confirmed conventions are always injected; task-relevant notes are matched by keywords
- **Staleness tracking** — items are flagged when their referenced files change

### 🚀 Agent Orchestration — Multi-Session Coordination

Coordinate multiple Copilot CLI sessions working on the same project. Agents see each other in the registry and send messages directly into each other's terminal panes via psmux/tmux send-keys.

- **Agent Registry** — live directory of all sessions (CLI, VS Code, Claude Code) with status tracking (active/idle/stopped), terminal info, and project bindings
- **Direct messaging** — `orchestrator_send` types a message into another agent's psmux/tmux pane
- **Auto-bind** — sessions automatically bind to projects by matching cwd to project root paths
- **4 MCP tools** — `orchestrator_list_agents`, `get_agent`, `set_agent_meta`, `orchestrator_send`
- **Terminal tracking** — psmux/tmux pane, window, and session info auto-detected and stored per agent
- **Plugin ships orchestrate agent** — a single flexible agent that knows registry + psmux send-keys and follows your lead

### 💾 Explanation Cache

Right-click context menu explanations are automatically cached:

- **Never ask twice** — cached explanations are served instantly
- **Project-scoped** — cache entries belong to a specific project
- **Editable** — rename or modify cached content in the dashboard
- **Searchable** — find entries via `#ctx` search

### 📊 Dashboard — Centralized Management

Open with the status bar icon or `ContextManager: Open Dashboard`:

| Tab | What's inside |
|-----|--------------|
| **Intelligence** | Conventions, tool hints, working notes, auto-learn pipeline status |
| **Knowledge** | Cards, folders, card queue, search, inline editing, card canvas |
| **Sessions** | Tracked chat sessions, pending capture counts, and bind/rebind controls for multi-project routing |
| **Context** | Project goals, conventions, key files, prompt customization |
| **Settings** | All extension settings, dedicated model selectors, and import/export |

---

## 5 Language Model Tools

These tools are registered via `vscode.lm.registerTool` and available to **all agents** — Copilot Chat, background agents, cloud agents, and Codex:

| Tool | Reference | Purpose |
|------|-----------|---------|  
| `contextManager_ctx` | `#ctx` | Unified project memory — search, list, learn, getCard, explicit card queue review, distillQueue, clearQueue, retrospect |
| `contextManager_getCard` | `#getCard` | Read a specific knowledge card by ID |
| `contextManager_saveKnowledgeCard` | `#saveCard` | Save a card, list folders, or create folders from chat |
| `contextManager_editKnowledgeCard` | `#editCard` | Edit an existing knowledge card |
| `contextManager_organizeKnowledgeCards` | `#organizeCards` | Organize cards into folders |

When multiple ContextManager projects exist, pass `project:"Exact Project Name"` or the exact project ID/root path on every LM tool call.

---

## Installation

### VS Code Extension

Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=HarshaNarayanaP.context-manager):

1. Open VS Code
2. Go to **Extensions** (Ctrl+Shift+X)
3. Search for **ContextManager**
4. Click **Install**

Or from the command line:

```
code --install-extension HarshaNarayanaP.context-manager
```

### Copilot CLI Plugin (optional)

If you use [GitHub Copilot in the terminal](https://docs.github.com/en/copilot/github-copilot-in-the-cli), you can install the ContextManager plugin so CLI sessions also capture knowledge and have access to your cards via MCP.

```
copilot plugin install GittyHarsha/ContextManager:plugin
```

Or from a local clone:

```
copilot plugin install ./plugin
```

The VS Code extension must be running so `HookWatcher` can ingest events from the CLI. Verify the MCP server inside Copilot CLI with `/mcp show contextmanager`.

---

## Getting Started

### Step 1 — Create a Project

1. Click the **📖 book icon** in the Activity Bar
2. Click **+** to create a new project
3. Name it and select workspace folders
4. Open the **Dashboard** → **Context** tab to add goals and conventions

### Step 2 — Chat Normally

Just use Copilot as you normally would. ContextManager captures intelligence silently in the background from all chat participants.

If you keep multiple ContextManager projects at once, open the **Dashboard** → **Sessions** tab and bind each tracked chat session to the right project before backfilling pending captures.

### Step 3 — Review the Card Queue

AI responses accumulate in the **Card Queue**. Periodically:

1. Open the Dashboard → **Knowledge** tab → **Card Queue** subtab
2. Click **Distill into Cards** — one LLM call synthesizes all queued items into card proposals
3. Review proposals: click **Add** for ones worth keeping (or **Approve All**)

### Step 4 — Use Tools Directly

Type `#ctx` in any Copilot Chat to search your project memory:

```
#ctx query:"error handling"
#ctx project:"ContextManager" mode:list type:conventions
#ctx project:"ContextManager" mode:learn learnType:convention title:"Error handling" content:"Always use Result<T>"
#ctx project:"ContextManager" mode:list type:queue
#ctx project:"ContextManager" mode:getQueueItem id:"candidate-id"
#ctx project:"ContextManager" mode:distillQueue
```

You can also save and organize cards directly from chat:

```
#saveCard project:"ContextManager" action:"listFolders"
#saveCard project:"ContextManager" action:"createFolder" folderName:"Security" parentFolderName:"Architecture"
#saveCard project:"ContextManager" title:"Authentication Flow" content:"# Authentication Flow\nUses JWT for session auth." folderMode:"named-folder" folderName:"Security"
```

### Step 5 — Context Everywhere

ContextManager delivers context to every AI interaction via two channels:

- **`copilot-instructions.md` managed block** — auto-synced `#ctx` usage instructions and pinned card titles, included in every agent session
- **`#ctx` tool** — available on-demand for search, list, learn, getCard, and explicit card queue review across all project knowledge

---

## Settings Reference

All settings are accessible from the **Settings** tab in the dashboard.

### General

| Setting | Default | Description |
|---------|---------|-------------|
| `contextManager.showStatusBar` | ✅ | Show active project in the status bar |
| `contextManager.confirmDelete` | ✅ | Confirmation dialog before deleting items |
| `contextManager.maxKnowledgeCardsInContext` | 10 | Maximum cards injected into AI prompts (1–20) |
| `contextManager.explanation.expandContext` | ✅ | Expand surrounding code when explaining symbols |

### Intelligence & Auto-Learn

| Setting | Default | Description |
|---------|---------|-------------|
| `contextManager.intelligence.enableTieredInjection` | ✅ | Auto-inject conventions and top tool hints into every prompt |
| `contextManager.intelligence.tier1MaxTokens` | 400 | Token budget for always-injected learnings (100–1000) |
| `contextManager.intelligence.tier2MaxTokens` | 400 | Token budget for task-relevant learnings (100–1000) |
| `contextManager.intelligence.autoLearn` | ✅ | Enable auto-learning pipeline |
| `contextManager.intelligence.autoLearn.useLLM` | ✅ | Use LLM for convention/note extraction (vs regex-only) |
| `contextManager.intelligence.autoLearn.modelFamily` | _(auto)_ | Preferred model family for background auto-learn extraction |
| `contextManager.intelligence.enableStalenessTracking` | ✅ | Flag items when referenced files change |
| `contextManager.intelligence.stalenessAgeDays` | 30 | Days before cards are flagged as age-stale (7–365) |

### AI Model Routing

| Setting | Default | Description |
|---------|---------|-------------|
| `contextManager.intelligence.autoLearn.modelFamily` | _(auto)_ | Preferred model family for background extraction in Project Intelligence / Auto-Learn |
| `contextManager.workflows.modelFamily` | _(auto)_ | Preferred model family for AI workflow actions; template-only workflows ignore it |
| `contextManager.knowledgeCards.synthesisModelFamily` | _(auto)_ | Preferred model family for AI Draft / Synthesize Card in the dashboard editor |

### Auto-Capture

| Setting | Default | Description |
|---------|---------|-------------|
| `contextManager.autoCapture.enabled` | ✅ | Capture observations from all chat participants |
| `contextManager.autoCapture.learnFromAllParticipants` | ✅ | Run LLM extraction on non-@ctx interactions |
| `contextManager.autoCapture.maxObservations` | 50 | Max observations in circular buffer (10–200) |

### Card Queue

| Setting | Default | Description |
|---------|---------|-------------|
| `contextManager.cardQueue.enabled` | ✅ | Auto-detect card-worthy content in chat responses |
| `contextManager.cardQueue.minResponseLength` | 300 | Min response length to queue as candidate (50–5000) |
| `contextManager.cardQueue.maxSize` | 30 | Max candidates in review queue (5–100) |

### Auto-Distill

| Setting | Default | Description |
|---------|---------|-------------|
| `contextManager.autoDistill.enabled` | ✅ | Auto-distill observations at compaction checkpoints |
| `contextManager.autoDistill.intervalMinutes` | 30 | Min minutes between distillation runs |

### Search

| Setting | Default | Description |
|---------|---------|-------------|
| `contextManager.search.enableFTS` | ✅ | Enable BM25 full-text search |
| `contextManager.search.maxCardResults` | 5 | Max results for card search (1–20) |
| `contextManager.search.maxSearchResults` | 10 | Max results for cross-entity search (1–50) |
| `contextManager.search.snippetTokens` | 16 | Context tokens around match highlights (8–64) |

### Prompts

| Setting | Default | Description |
|---------|---------|-------------|
| `contextManager.prompts.globalInstructions` | _(empty)_ | Custom instructions appended to every prompt |
| `contextManager.prompts.distillObservations` | _(empty)_ | Custom prompt for observation distillation |
| `contextManager.prompts.distillQueue` | _(empty)_ | Custom prompt for card queue distillation |
| `contextManager.prompts.synthesizeCard` | _(empty)_ | Custom prompt for AI card synthesis |

### Orchestration

| Setting | Default | Description |
|---------|---------|-------------|
| `contextManager.orchestrator.enabled` | ✅ | Enable agent orchestration (registry + psmux send) |

---

## Architecture

```
copilot-instructions.md (auto-synced managed block)
  └── #ctx usage instructions + pinned card titles

5 Language Model Tools (available to ALL agents)
  ├── #ctx — unified project memory (search, list, learn, getCard, queue review, distillQueue, clearQueue, retrospect)
  ├── #getCard — read a specific card by ID
  └── #saveCard / #editCard / #organizeCards — knowledge card CRUD and folder flows

Auto-Capture Pipeline
  ├── Observation capture from all chat participants
  ├── Auto-learn: conventions, tool hints, working notes
  ├── Card Queue: card-worthy responses staged for review
  └── Auto-distill: periodic observation compaction

Agent Orchestration (multi-session coordination)
  ├── Agent Registry — tracks sessions with status (active/idle/stopped), terminal info, project bindings
  ├── psmux/tmux send-keys — direct messaging into agent terminal panes
  └── 4 MCP tools — list/get/set agents, send messages

Workflow Engine
  ├── Template resolution with project, queue, card, and observation variables
  ├── AI actions: create / update / append markdown cards
  ├── Template actions: create / update / append without model calls
  └── Re-entrancy guard + run history + skip patterns

Dashboard (WebView, 5 tabs)
  ├── Intelligence — conventions, tool hints, working notes
  ├── Knowledge — cards, folders, card queue, card canvas
  ├── Sessions — tracked chats, pending captures, binding controls
  ├── Context — project metadata, prompt customization
  └── Settings — all extension settings

SQLite FTS4 (sql.js WebAssembly)
  └── BM25-ranked search across 8 FTS tables
```

---

## Requirements

- **VS Code** 1.100.0 or higher
- **GitHub Copilot** — required for AI features (language model API)
- Any programming language — optimized for TypeScript/JavaScript, C/C++, Python, C#

---

## FAQ

**Q: How is this different from `.github/copilot-instructions.md`?**
A: Copilot instructions are a flat file. ContextManager gives you structured, searchable knowledge cards with auto-capture, a learning pipeline, BM25 search, and a full dashboard. It also auto-syncs a managed block into your `copilot-instructions.md` so every agent starts informed.

**Q: Does my context persist across workspaces?**
A: Project metadata and knowledge cards are stored in VS Code's `globalState` — they persist across workspaces. Cache entries use `workspaceState` and are workspace-specific.

**Q: How do agents access my knowledge?**
A: Two ways: (1) ContextManager auto-syncs a managed block into `copilot-instructions.md` with `#ctx` tool instructions and pinned card titles — every agent sees this automatically. (2) Agents can invoke any of the 5 LM tools on-demand (e.g. `#ctx`, `#getCard`, `#saveCard`).


---

## License

MIT

---

**Built for developers who work with complex codebases and want their AI to remember what matters.**
