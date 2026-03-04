# ContextManager — AI Project Memory

> Give Copilot persistent, structured memory for your codebase. Knowledge cards, conventions, working notes, tool hints, BM25 search, auto-capture from all chat participants, and a full dashboard — all injected automatically into every AI interaction.

[![Version](https://img.shields.io/badge/version-2.3.0-blue.svg)](https://github.com/GittyHarsha/ContextManager)
[![VS Code](https://img.shields.io/badge/VS%20Code-1.100.0+-007ACC.svg)](https://code.visualstudio.com/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](https://opensource.org/licenses/MIT)

---

## Features

### 🧠 Knowledge Cards — Persistent AI Memory

Create, curate, and inject expert knowledge into every AI interaction. Knowledge cards are structured markdown notes — architectural decisions, coding conventions, patterns — that enhance all Copilot responses.

- **Create cards** from the dashboard, via `#saveCard` tool, or from the Card Queue
- **Tag and categorize** (architecture, pattern, convention, explanation, note)
- **Folder organization** — organize cards into folders manually or with `#organizeCards` auto-organize
- **Code anchors** — cards track referenced files and flag staleness when code changes
- **Search and filter** — find cards by keyword or BM25 full-text search
- **Smart merge** — when saving a card similar to an existing one, a merge picker appears automatically

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

- **`#ctx`** — unified BM25 search across cards, conventions, working notes, tool hints, cache, observations, sessions, and projects
- SQLite FTS4 via sql.js (WebAssembly) — no native binaries, works everywhere
- Quoted phrases (`"error handler"`), prefix matching (`auth*`), snippet previews
- Index persisted between sessions, rebuilt on activation, incrementally synced on every mutation

### 🧩 Project Intelligence — Auto-Learn Pipeline

ContextManager automatically learns from your interactions:

- **Conventions** — coding patterns and rules extracted from AI responses
- **Tool Hints** — search queries that work for your codebase (fail→success patterns)
- **Working Notes** — file relationships and insights from code exploration
- **Tiered injection** — confirmed conventions are always injected; task-relevant notes are matched by keywords
- **Staleness tracking** — items are flagged when their referenced files change

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
| **Context** | Project goals, conventions, key files, prompt customization |
| **Settings** | All extension settings — edit right in the dashboard |

---

## 5 Language Model Tools

These tools are registered via `vscode.lm.registerTool` and available to **all agents** — Copilot Chat, background agents, cloud agents, and Codex:

| Tool | Reference | Purpose |
|------|-----------|---------|  
| `contextManager_ctx` | `#ctx` | Unified project memory — search, list, learn, getCard, retrospect |
| `contextManager_getCard` | `#getCard` | Read a specific knowledge card by ID |
| `contextManager_saveKnowledgeCard` | `#saveCard` | Save a new knowledge card (runs silently) |
| `contextManager_editKnowledgeCard` | `#editCard` | Edit an existing knowledge card |
| `contextManager_organizeKnowledgeCards` | `#organizeCards` | Organize cards into folders |

---

## Getting Started

### Step 1 — Create a Project

1. Click the **📖 book icon** in the Activity Bar
2. Click **+** to create a new project
3. Name it and select workspace folders
4. Open the **Dashboard** → **Context** tab to add goals and conventions

### Step 2 — Chat Normally

Just use Copilot as you normally would. ContextManager captures intelligence silently in the background from all chat participants.

### Step 3 — Review the Card Queue

AI responses accumulate in the **Card Queue**. Periodically:

1. Open the Dashboard → **Knowledge** tab → **Card Queue** subtab
2. Click **Distill into Cards** — one LLM call synthesizes all queued items into card proposals
3. Review proposals: click **Add** for ones worth keeping (or **Approve All**)

### Step 4 — Use Tools Directly

Type `#ctx` in any Copilot Chat to search your project memory:

```
#ctx query:"error handling"
#ctx mode:list type:conventions
#ctx mode:learn learnType:convention title:"Error handling" content:"Always use Result<T>"
```

### Step 5 — Context Everywhere

ContextManager delivers context to every AI interaction via two channels:

- **`copilot-instructions.md` managed block** — auto-synced `#ctx` usage instructions and pinned card titles, included in every agent session
- **`#ctx` tool** — available on-demand for search, list, learn, and getCard across all project knowledge

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
| `contextManager.intelligence.enableStalenessTracking` | ✅ | Flag items when referenced files change |
| `contextManager.intelligence.stalenessAgeDays` | 30 | Days before cards are flagged as age-stale (7–365) |

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

---

## Architecture

```
copilot-instructions.md (auto-synced managed block)
  └── #ctx usage instructions + pinned card titles

5 Language Model Tools (available to ALL agents)
  ├── #ctx — unified project memory (search, list, learn, getCard, retrospect)
  ├── #getCard — read a specific card by ID
  └── #saveCard / #editCard / #organizeCards — knowledge card CRUD

Auto-Capture Pipeline
  ├── Observation capture from all chat participants
  ├── Auto-learn: conventions, tool hints, working notes
  ├── Card Queue: card-worthy responses staged for review
  └── Auto-distill: periodic observation compaction

Dashboard (WebView, 4 tabs)
  ├── Intelligence — conventions, tool hints, working notes
  ├── Knowledge — cards, folders, card queue, card canvas
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
