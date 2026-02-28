# ContextManager — AI Project Memory

> Give Copilot persistent, structured memory for your codebase. Curate knowledge cards, delegate tasks to autonomous AI agents, search everything with BM25, track branch sessions, and share context across every Copilot interaction — all from a single dashboard.

[![Version](https://img.shields.io/badge/version-1.1.0-blue.svg)](https://github.com/GittyHarsha/ContextManager)
[![VS Code](https://img.shields.io/badge/VS%20Code-1.100.0+-007ACC.svg)](https://code.visualstudio.com/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](https://opensource.org/licenses/MIT)

---

## Features

### 🧠 Knowledge Cards — Persistent AI Memory

Create, curate, and inject expert knowledge into every AI interaction. Knowledge cards are structured notes — architectural decisions, coding conventions, patterns — that you select to automatically enhance all Copilot responses.

- **Create cards manually** from the dashboard or **generate them with AI** using `@ctx /knowledge`
- **Refine existing cards** with `@ctx /refine` — the AI researches your codebase and updates a card
- **Tag and categorize** (architecture, pattern, convention, explanation, note)
- **Select cards** to inject them into AI prompts — only selected cards are used
- **Reference files** — attach source files to cards for richer context
- **Linked TODO cards** — TODOs can auto-create and refine a linked knowledge card across runs
- **Search and filter** — find cards by keyword, tag, or BM25 full-text search

### 🤖 Subagent Tool — Delegate Complex Tasks

Launch an autonomous subagent that runs its own tool-calling loop in an isolated context window. Any agent — local, background, cloud, or Codex — can invoke `#ctxSubagent` to delegate multi-step work:

| Task | What it does |
|------|-------------|
| `executeTodo` | Research and implement a TODO item, update its status |
| `generateKnowledge` | Research a topic across the codebase, create a knowledge card |
| `refineKnowledge` | Improve an existing card with fresh codebase research |
| `research` | General research — explore code and project memory |
| `analyzeCode` | Deep code analysis — patterns, architecture, relationships |

The subagent gets **pre-filled context** (project state, TODO details, card content) so it starts working immediately. Post-processing auto-creates cards and updates TODOs.

Configurable via `contextManager.subagent.*` settings (enable/disable, max iterations, model family).

### 💬 Chat Participant (`@ctx`) — 10 Specialized Commands

Type `@ctx` in Copilot Chat:

| Command | What it does |
|---------|-------------|
| `@ctx /chat` | Ask questions with full project context (default) |
| `@ctx /explain` | Deep-dive explanation of a symbol, class, or function |
| `@ctx /usage` | Explain _why_ a symbol is used at a specific location |
| `@ctx /relationships` | Show class hierarchies and architectural patterns |
| `@ctx /todo` | Work on a TODO with AI agent (full tool access) |
| `@ctx /knowledge` | Research a topic and generate a knowledge card |
| `@ctx /refine` | Refine an existing knowledge card with new AI research |
| `@ctx /save` | Answer a question and save the result as a knowledge card |
| `@ctx /context` | Display current project context (cards, cache, metadata) |
| `@ctx /doc` | ⚠️ _Experimental_ — Generate and apply doc comments to selected code |

Every command automatically includes your selected knowledge cards and cache entries as context.

### 🔍 BM25 Full-Text Search (SQLite FTS5)

Fast, ranked search across your entire project memory:

- **`#searchCards`** — BM25-ranked knowledge card search with full content retrieval
- **`#search`** — Cross-entity search across cards, TODOs, cache, branch sessions, agent messages, and projects
- SQLite FTS5 via sql.js (WebAssembly) — no native binaries, works everywhere
- Quoted phrases (`"error handler"`), prefix matching (`auth*`), snippet previews
- Index persisted between sessions, rebuilt on activation, incrementally synced on every mutation

### 🔗 `#projectContext` — Share Context With All Chat Participants

Your curated knowledge is available in **any Copilot chat** — not just `@ctx`:

- Type `#projectContext` to pull in your project context
- Copilot can also **auto-invoke** it when your question relates to project architecture
- **Fine-grained control** from the dashboard:
  - ✅ Project metadata (name, goals, conventions)
  - ✅ Selected knowledge cards
  - ✅ Selected cache entries
  - ☐ Active TODOs (off by default)
- Per-project master toggle to enable/disable

### ✅ TODO Management with AI Agents

Create TODOs, then let an AI agent work on them autonomously:

- **Full tool access** — the agent searches, reads files, and navigates your entire codebase
- **Conversation history** — review every step the agent took
- **Resume with instructions** — pause, adjust, and continue with additional context
- **Auto-status updates** — status changes automatically based on agent progress
- **Linked knowledge cards** — each TODO can create/refine a linked card across runs
- **Priority levels** — low, medium, high
- **Bulk operations** — select all, bulk complete, bulk delete
- **Subagent delegation** — use `#ctxSubagent` with `executeTodo` to run TODOs from any agent

### 🔀 Branch Tracking & Git Integration

Track your work across branches with automatic git state capture:

- **Branch session tracking** — task, goal, approaches, decisions, next steps, blockers
- **Git state capture** — changed files, recent commits (filtered by author), branch name
- **Dashboard Git section** — async-loaded commit history, changed files, branch status
- **`@ctx /save` auto-links** branch sessions to knowledge cards
- **Session history** — browse and review past sessions per branch

### 💾 Explanation Cache

Explanations from `/explain`, `/usage`, and `/relationships` are automatically cached:

- **Never ask twice** — cached explanations are served instantly
- **Project-scoped** — cache entries belong to a specific project
- **Selectable for context** — check entries to include them in AI prompts
- **Editable** — rename or modify cached content inline
- **Convert to knowledge** — promote a cache entry to a knowledge card
- **Configurable expiration** — set days to keep (0 = never expire)

### 📊 Dashboard — Centralized Management

Open with the status bar icon or `ContextManager: Open Dashboard`:

| Tab | What's inside |
|-----|--------------|
| **Overview** | Project stats, context injection toggle, quick actions |
| **TODOs** | Full TODO management with search, filter, bulk ops |
| **Branches** | Tracked branches, session history, git status |
| **Knowledge** | All cards with search, filter, select/deselect, inline editing |
| **Cache** | Cached explanations with selection, editing, conversion |
| **Context** | Project goals, conventions, key files, `#projectContext` tool config |
| **⚙ Settings** | All extension settings — edit right in the dashboard |

---

## 7 Language Model Tools

These tools are registered via `vscode.lm.registerTool` and available to **all agents** — Copilot, background agents, cloud agents, Codex:

| Tool | Reference | Purpose |
|------|-----------|---------|
| `contextManager_getProjectContext` | `#projectContext` | Get project metadata, knowledge cards, cache |
| `contextManager_manageTodos` | `#manageTodos` | CRUD TODOs, update status, run agents |
| `contextManager_branchSession` | `#branchSession` | Save/resume branch sessions, track branches |
| `contextManager_semanticSearch` | `#searchCards` | Embedding-based semantic card search |
| `contextManager_fullTextSearch` | `#search` | BM25 cross-entity full-text search |
| `contextManager_runSubagent` | `#ctxSubagent` | Autonomous subagent for complex tasks |

---

## Getting Started

### Step 1 — Create a Project

1. Click the **📖 book icon** in the Activity Bar
2. Click **+** to create a new project
3. Name it and select workspace folders
4. Open the **Dashboard** → **Context** tab to add goals and conventions

### Step 2 — Understand Your Code

Right-click any symbol in the editor:
- **Explain** — what does this code do?
- **Explain Usage** — why is this used here?
- **Explain Relationships** — show class hierarchy and architecture

Explanations are cached automatically. Select cached entries to include them in future AI prompts.

### Step 3 — Build Knowledge

```
@ctx /save How does authentication work in this project?
@ctx /knowledge Research the observer pattern in this codebase
```

Cards are created and added to your project. Select them to inject into all AI interactions.

### Step 4 — Delegate Work

```
@ctx /todo Refactor the authentication module
```

Or use the subagent tool from any agent:
```
#ctxSubagent task:research prompt:"How does the error handling pipeline work?"
```

### Step 5 — Use Context Everywhere

- **`@ctx` queries** — knowledge cards and cache are injected automatically
- **Normal Copilot queries** — type `#projectContext` to pull in your project knowledge
- **Any agent** — tools are available to background, cloud, and Codex agents

---

## Settings Reference

All settings are accessible from the **⚙ Settings** tab in the dashboard.

### General

| Setting | Default | Description |
|---------|---------|-------------|
| `contextManager.showStatusBar` | ✅ | Show active project in the status bar |
| `contextManager.confirmDelete` | ✅ | Confirmation dialog before deleting items |
| `contextManager.autoSelectKnowledgeCards` | ☐ | Auto-select relevant cards based on context |
| `contextManager.maxKnowledgeCards` | 5 | Maximum cards to include in AI prompts (1–20) |
| `contextManager.cacheExpiration` | 30 | Days to keep cached explanations (0 = never) |
| `contextManager.enableContextByDefault` | ✅ | Auto-enable context for new projects |

### Chat

| Setting | Default | Description |
|---------|---------|-------------|
| `contextManager.chat.includeCopilotInstructions` | ✅ | Include `.github/copilot-instructions.md` |
| `contextManager.chat.includeReadme` | ✅ | Include README.md in project context |

### TODO Agent

| Setting | Default | Description |
|---------|---------|-------------|
| `contextManager.todo.autoUpdateStatus` | ✅ | Auto-change TODO status based on agent progress |

### Subagent

| Setting | Default | Description |
|---------|---------|-------------|
| `contextManager.subagent.enabled` | ✅ | Enable the subagent tool for delegating tasks |
| `contextManager.subagent.maxIterations` | 50 | Max tool-calling iterations per subagent run (10–200) |
| `contextManager.subagent.modelFamily` | _(auto)_ | Preferred model family for subagent loops |

### Search

| Setting | Default | Description |
|---------|---------|-------------|
| `contextManager.search.enableFTS` | ✅ | Enable BM25 full-text search |
| `contextManager.search.maxCardResults` | 10 | Max results for card search |
| `contextManager.search.maxSearchResults` | 20 | Max results for cross-entity search |
| `contextManager.search.snippetTokens` | 80 | Snippet size in search results |

### Explanations

| Setting | Default | Description |
|---------|---------|-------------|
| `contextManager.explanation.expandContext` | ✅ | Expand surrounding code when explaining symbols |
| `contextManager.explanation.includeReferences` | ✅ | Include file references in explanations |

### Context

| Setting | Default | Description |
|---------|---------|-------------|
| `contextManager.context.autoDeselectAfterUse` | ☐ | Deselect cards/cache after they're used in a query |

### Branch Tracking

| Setting | Default | Description |
|---------|---------|-------------|
| `contextManager.branch.includeInPrompts` | ✅ | Include branch context in AI prompts |
| `contextManager.branch.autoCapture` | ☐ | Auto-capture branch state on switch |

### Dashboard

| Setting | Default | Description |
|---------|---------|-------------|
| `contextManager.dashboard.defaultTab` | Overview | Tab shown when dashboard opens |
| `contextManager.notifications.showProgress` | ✅ | Progress notifications for long-running operations |

### Experimental

| Setting | Default | Description |
|---------|---------|-------------|
| `contextManager.experimental.enableProposedApi` | ☐ | Enables `/doc` command and Smart Select (embeddings). Requires VS Code Insiders. |

---

## Architecture

```
@ctx Chat Participant (10 commands)
  ├── Tool-calling loop (search, read, navigate codebase)
  ├── Project context injection (knowledge cards + cache)
  ├── Explanation caching (auto-cache + selectable)
  └── Knowledge card lifecycle (create → refine → inject)

7 Language Model Tools (available to ALL agents)
  ├── #projectContext — project metadata + selected cards/cache
  ├── #manageTodos — CRUD + agent execution
  ├── #branchSession — save/resume/track branches
  ├── #searchCards — BM25 knowledge card search
  ├── #search — cross-entity full-text search
  ├── #ctxSubagent — autonomous subagent with isolated loop
  └── #semanticSearch — embedding-based card search (experimental)

Dashboard (WebView)
  ├── Overview — stats, quick actions
  ├── TODOs — search, filter, bulk ops, agent runs
  ├── Branches — tracked branches, session history, git status
  ├── Knowledge — cards, tags, search, select
  ├── Cache — entries, edit, select, convert
  ├── Context — project metadata, tool sharing config
  └── Settings — all extension settings

SQLite FTS5 (sql.js WebAssembly)
  └── BM25-ranked search across 6 entity types
```

---

## Requirements

- **VS Code** 1.100.0 or higher
- **GitHub Copilot** — required for AI features (language model API)
- Any programming language — optimized for TypeScript/JavaScript, C/C++, Python, C#

---

## FAQ

**Q: How is this different from `.github/copilot-instructions.md`?**
A: Copilot instructions are a flat file. ContextManager gives you structured, selectable, taggable knowledge cards with per-project organization. You choose exactly which context to inject. Plus you get TODO agents, subagent delegation, BM25 search, branch tracking, and a full dashboard.

**Q: Does my context persist across workspaces?**
A: Project metadata and knowledge cards are stored in VS Code's `globalState` — they persist across workspaces. Cache entries use `workspaceState` and are workspace-specific.

**Q: Can Copilot see my context without `@ctx`?**
A: Yes. Type `#projectContext` in any chat query, or Copilot may auto-invoke it based on your question. All 7 tools are also available to background/cloud/Codex agents.

**Q: What is the subagent tool?**
A: `#ctxSubagent` launches an autonomous subagent with its own tool-calling loop. It gets pre-filled project context and can search, read, and use all ContextManager tools independently. Use it to delegate complex tasks like researching a topic, executing a TODO, or analyzing code — without consuming the main agent's context budget.

**Q: What are the proposed API features?**
A: Features like chat status items, `#variables`, inline question carousels, tool progress, and chat sessions auto-activate on VS Code Insiders and gracefully degrade on stable VS Code. No setting needed.

---

## License

MIT

---

**Built for developers who work with complex codebases and want their AI to remember what matters.**
