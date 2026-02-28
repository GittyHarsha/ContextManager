---
layout: default
title: Changelog
nav_order: 8
---

# Changelog
{: .fs-9 }

All notable changes to ContextManager.
{: .fs-6 .fw-300 }

---

## [2.1.0] - 2026-02-27

### Added
- **Smart-merge on queue approval** - When approving a card from the queue, ContextManager checks for similar existing cards (Jaccard ≥ 30%) and offers a QuickPick: "Create new" or "Merge into: [title] (XX% similar)". Merge appends new content to the target card with a dated separator.
- **Knowledge cards in intelligence injection** - Tier 1 now includes pinned and `includeInContext` cards (full content). Tier 2 uses BM25 search to inject task-relevant cards alongside conventions and working notes.

### Changed
- **Auto-capture routes cards to queue** - Knowledge cards and architecture notes extracted by the Auto-Capture / Auto-Learn service are no longer silently created. They are staged in the Card Queue for user review and approval, the same as hook-captured cards.
- **Tier token defaults raised to 800** - `intelligence.tier1MaxTokens` and `intelligence.tier2MaxTokens` both default to 800 (was 400).
- **Intelligence injection cap raised to 32 000 chars** - Previous hard cap of 2 000 characters was far too restrictive; raised to 32 k to support cards with substantial content.

---

## [2.0.0] - 2026-02-27

### Added
- **`distillQueue()` - cross-response card synthesis** - New pipeline that reads the entire card queue in one LLM call and synthesizes high-quality knowledge card proposals across all responses
- **Tool call capture** - Agent hook system now captures `tool.execution_start` entries from VS Code Copilot transcripts alongside responses (capped at 10, inputs truncated to 200 chars)
- **Observations distill now produces knowledge cards** - `distillObservations` extended with a `cards[]` array
- **Approve All** - One-click approval for all distilled card proposals
- **`cardQueue.minResponseLength` setting** - Configurable minimum (default 300, range 50–5000)

### Changed
- **Card Queue merged into Intelligence tab** - Standalone Queue tab replaced with inline section
- **Card Queue redesigned as zero-cost staging buffer** - No per-response LLM call; quality assessed at distill time
- **Queue capped at 30 items** - FIFO eviction
- **Distill results render inline** - In Intelligence tab, not a modal

---

## [1.9.0] - 2026-02-26

### Added
- **Intelligence tab** - New dashboard tab (🧠 Intelligence) for Auto-Capture, Auto-Learn, observations, conventions, tool hints, working notes, token economics, card queue

### Changed
- **TODOs tab removed** - TODOs continue via `@ctx /todo` and `#manageTodos`
- **Observations and Token Economics** moved to Intelligence tab

---

## [1.8.0] - 2026-02-26

### Added
- **Disk-backed project storage** - JSON files on disk instead of VS Code globalState
- **BM25 full-text search** - FTS4 with BM25 ranking from `matchinfo('pcnalx')`
- **Knowledge card flags** - `pinned`, `archived`, `includeInContext`
- **Knowledge index file** - `~/.contextmanager/knowledge-index.txt`
- **`#getCard` tool** - Read a card by ID (read-only, no confirmation)

### Changed
- **FTS4 migration** - From FTS5 (not available in sql.js 1.14.0) to FTS4
- **Storage migration** - Transparent lossless migration from globalState to disk

---

## [1.7.0] - 2025-02-25

### Added
- **Typed observations** - bugfix 🔴, feature 🟣, discovery 🔵, decision ⚖️, refactor 🔄, change ✅
- **Content-hash deduplication** - SHA-based with 30-second window
- **Privacy tags** - `<private>` content stripped before storage
- **Token economics** - `discoveryTokens` vs `readTokens`, ROI tracking
- **3-layer search** - `search` (index), `timeline` (context), `fetch` (detail)
- **File path extraction** - Auto-indexed from prompts and responses

---

## [1.6.0] - 2025-02-25

### Added
- **Auto-Capture Service** - Zero-friction observation logging from all chat participants
- **Session Continuity** - Injects context from previous sessions into new ones
- **Cross-participant LLM learning** - Learns from regular Copilot Chat
- **Observation buffer** - Circular buffer (default 50 entries)
- **8 new settings** for auto-capture and session continuity

---

## [1.5.0] - 2026-02-24

### Added
- **Progressive disclosure** - 3-tier knowledge card injection
- **BM25 OR fallback** - Automatic retry with OR when AND returns zero
- **camelCase query expansion**
- **Nested folders** - Hierarchical folder structure for cards
- **Drag-and-drop cards** - Move cards between folders
- **Card staleness detection** - 30+ day warning
- **Card Health dashboard** - Analytics, duplicates, usage tracking
- **Git-tracked card storage** - Export as `.md` with YAML frontmatter
- **SKILL.md export** - Claude Code compatibility
- **`#organizeCards` tool** - listFolders, createFolder, moveCard, autoOrganize
- **Card templates** - 6 structured templates
- **Keyboard shortcuts** - `1-7` tabs, `Ctrl+K` search, `Ctrl+N` new card

---

## [1.4.0] - 2026-02-19

### Added
- **Project Intelligence Layer** - Conventions, tool hints, working notes
- **Tiered injection** - Confirmed always, relevant matched, rest on-demand (800 token cap)
- **`#projectIntelligence` tool** - learnConvention, learnToolHint, learnNote, retrospect
- **Branch session enhancements** - Living document model, checkpoint, gitDiff
- **`@ctx /done` command** - End-of-task retrospective
- **Data import/export** - Full and per-project export/import
- **LaTeX rendering** - KaTeX with MathML output

---

## [1.3.0] - 2026-02-19

### Added
- **Inline context menu modals** - Replace, Delete, Refine, Create Card
- **`/add` command** - Save last AI response as card
- **Find in Card** - Ctrl+F-style search within cards

---

## [1.2.0] - 2026-02-18

### Added
- **Global knowledge cards** *(planned)* - Share across all projects
- **Mermaid code block styling** - Styled display for ` ```mermaid ` blocks
- **Research & Save as Card** inline input
- **Concurrent /save queue** - No UI conflicts

---

## [1.0.0] - 2026-02-16

### Added
- **BM25 full-text search** - SQLite FTS5 via sql.js WebAssembly
- **Branch tracking & git integration**
- **Custom prompt system** - 6 customizable system prompts
- **Content Security Policy** - nonce-based
- **11 proposed API integrations** - auto-activating on VS Code Insiders

---

## [0.1.0] - 2025-07-18

### Added
- Chat participant `@ctx` with 10 commands
- `#projectContext` Language Model Tool
- Knowledge cards with AI generation and refinement
- TODO management with AI agents
- Explanation cache
- Dashboard with 6 tabs
- 17+ settings
- Sidebar tree view and status bar
