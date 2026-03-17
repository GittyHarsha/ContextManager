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

## [Unreleased]

### Added
- **Claude Code plugin** — Full plugin with hooks + MCP server. Install via `claude plugin install GittyHarsha/ContextManager:claude-code-plugin`. Automatic card queue population works fully.
- **Claude Code hook install command** — Quick-start: writes hooks to `.claude/settings.json` without the full plugin.
- **Copilot CLI `agentStop` / `subagentStop` hooks** — Automatic card queue population now works from CLI sessions.
- **Copilot CLI `preToolUse` hook** — Tool invocation logging.

### Fixed
- **Removed CLI card capture gap warning** — `agentStop` is now available, resolving the original limitation.
- **CLI `agentStop` transcript path mismatch** — Scripts now check `transcriptPath` (camelCase) first, then fall back to `transcript_path`.
- **`ConvertFrom-Json -Depth` on PS 5.1** — Removed unsupported parameter that silently broke all CLI hooks on Windows PowerShell 5.1.
- **VS Code agent hooks file conflicts with Copilot CLI** — Gitignored the generated `.github/hooks/contextmanager-hooks.json` to prevent format conflicts.

---

## [2.12.0] - 2026-03-15

### Changed
- **Per-project workflow execution** — Re-entrancy guard scoped per-project; multi-project workflows no longer block each other.
- **Per-project auto-distill rate limit** — Each project has its own independent cooldown timer.

### Fixed
- **Documented CLI card capture gap** — Added warnings that CLI sessions cannot auto-populate the card queue (no `Stop` hook). Workaround: use MCP `contextmanager_save_card_intent`.

---

## [2.11.0] - 2026-03-15

### Added
- **Session tracking opt-out** — Disable session tracking entirely via `contextManager.sessionTracking.enabled`.
- **Bulk session operations** — Select and Dismiss or Delete multiple sessions at once.
- **Copilot CLI plugin hooks** — Commands to install CLI plugin hooks for terminal-based Copilot.
- **Installation section in README** — Marketplace and CLI install instructions.

### Changed
- **PostToolUse capture off by default** — `hooks.postToolUse` defaults to `false` to prevent observation and card queue noise.
- **Renamed Forget → Delete** — Destructive session actions now say "Delete".

### Fixed
- **Settings checkboxes not saving** — Webview settings toggles now persist correctly.
- **Bulk session buttons not working** — Removed `confirm()` calls blocked by webview sandbox.
- **Card queue spam** — Removed synthetic Stop entry generation from PostToolUse handler.

---

## [2.10.0] - 2026-03-09

### Added
- **Folder-aware `#saveCard`** — Chat can now list folders, create folders, and save cards directly into named folders.
- **Custom Workflow upgrades** — Workflows now support AI and direct-template create, update, and append actions.
- **Dedicated model selectors** — Separate model settings are available for AI workflows and AI Draft / Synthesize Card.

### Fixed
- **Workflow markdown preservation** — AI workflow output now keeps markdown structure when written to cards.
- **Dashboard draft resilience** — Open card drafts survive background updates instead of being replaced mid-edit.

---

## [2.9.0] - 2026-03-07

### Added
- **One-shot card injection** — Selected cards auto-deselect after being injected into a prompt. Toggle in Dashboard → Context → Inject into Every Prompt.

### Fixed
- **Local install reliability** — `install.ps1` no longer relies on `code --install-extension`.

---

## [2.8.1] - 2026-03-07

### Fixed
- **Data migration** — Automatic recovery of projects and data when updating across publisher changes.

---

## [2.8.0] - 2026-03-06

### Changed
- **esbuild bundling** — VSIX reduced from 34.6 MB to 3.3 MB via single-file bundling.

### Fixed
- **Per-prompt context injection** — "Inject into Every Prompt" now correctly provides project knowledge on every message, not just at session start.

---

## [2.7.0] - 2026-03-05

### Added
- **Skip Pattern** — Per-workflow regex; if the LLM output matches, the output action is skipped (⏭️ status). Filters out low-value AI responses before they reach cards.
- **Trigger Filter** — Per-workflow regex; auto-triggered workflows only fire when event content matches. Scope event triggers to relevant content without disabling the workflow.
- **Execution history** — Last 15 runs tracked per workflow with success/skipped/error counts shown in the dashboard.
- **Card variable resolution for auto-triggers** — `{{card.content}}`, `{{card.title}}`, and `{{card.tags}}` now auto-resolve from the target card on event-triggered workflows.

### Fixed
- **Manual run re-entrancy** — Dashboard "Run" button now reuses the singleton WorkflowEngine, preserving the re-entrancy guard.

---

## [2.3.0] - 2026-03-05

### Added
- **Custom Workflows** — User-defined pipelines with custom prompt templates using `{{variable}}` syntax. Define workflows in the Dashboard Intelligence tab with clickable variable insertion buttons.
- **7 trigger types** — Manual, auto-queue, both, convention-learned, card-created, card-updated, observation-created. Event triggers fire automatically in the background.
- **3 output actions** — Create card, update card, append to collector card (with dated separator).
- **Collection template variables** — `{{cards.all}}`, `{{cards.selected}}`, `{{conventions.all}}`, `{{toolHints.all}}`, `{{workingNotes.all}}`, `{{observations.recent}}` — each capped by a per-workflow Max Items setting (default 20).
- **Event template variables** — `{{convention.title}}`, `{{convention.content}}`, `{{observation.summary}}`, `{{observation.files}}` available when triggered by entity events.
- **Re-entrancy guard** — Prevents infinite loops when workflow output actions create/update entities that would re-trigger other workflows.
- **WorkflowEngine singleton** — Centralized engine created in extension activation, injected via setters into ProjectManager, AutoCaptureService, and HookWatcher.
- **Purple event badges** — Dashboard workflow list shows color-coded trigger badges (blue auto-queue, gray manual, purple event triggers).

---

## [2.2.0] - 2026-03-03

### Added
- **Tags in distill-to-approve pipeline** — Distilled cards now carry 2–5 keyword tags from the LLM, propagated through the full approve chain (individual and batch)
- **Custom prompt for AI synthesis** — ✨ AI Synthesize opens the editor with an optional custom prompt textarea for user-directed generation
- **Generate with AI uses LM API directly** — Knowledge tab button now calls the Language Model API directly with cancellable progress and robust JSON parsing
- **Descriptive error messages** — All AI failure paths show specific reasons instead of generic messages

### Changed
- **Unified card selection for hook injection** — Knowledge tab checkboxes now drive the "Inject into Every Prompt" hook system directly. The duplicate card picker in the injection section has been removed.
- **Hook renamed SessionStart → UserPromptSubmit** — Capture script now uses `UserPromptSubmit` with `hookSpecificOutput` wrapper instead of the old `SessionStart` event
- **Injection section simplified** — Dashboard injection section shows selected card count, custom instruction, and full-content toggle only

### Fixed
- **Multi-strategy JSON parsing** — 3 fallback strategies for parsing LLM responses with preamble text
- **Config crash on non-string values** — Safe `getString()` helper prevents `.trim()` on null/undefined

### Removed
- **Agents feature** — Entire feature removed (dashboard tab, handlers, methods, types, config, hook entries)
- **Overview tab** — Removed from dashboard. Intelligence is now the default tab.

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
- **TODOs tab removed** - TODOs are now user-managed only (no agent TODO tools)
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
