# Change Log

All notable changes to the "ContextManager" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Project management MCP tools** — New `contextmanager_create_project`, `contextmanager_rename_project`, and `contextmanager_update_project` MCP tools let CLI agents create projects, rename them, and update context (description, goals, conventions, key files). Delete stays dashboard-only for safety.
- **Session bind MCP tool** — New `contextmanager_bind_session` lets CLI agents bind unbound sessions to projects, triggering pending capture backfill.
- **Agent Orchestration Primitives** — New `src/orchestrator/` module with AgentRegistry. Enables multi-session coordination across Copilot CLI, VS Code, and Claude Code agents.
- **4 orchestrator MCP tools** — `orchestrator_list_agents`, `orchestrator_get_agent`, `orchestrator_set_agent_meta`, `orchestrator_send`. Available in every CLI session via the ContextManager plugin.
- **`orchestrator_send` psmux tool** — Sends a message to another agent by typing into its psmux/tmux pane via `send-keys`. Resolves session → pane ID from the agent registry.
- **Auto-bind sessions by cwd** — HookWatcher automatically binds sessions to projects by matching working directory against project rootPaths on SessionStart.
- **Pane ID capture** — Capture script reads `$env:TMUX_PANE` on SessionStart; HookWatcher stores it in agent registry metadata for `orchestrator_send` resolution.
- **Plugin ships orchestrate agent** — Plugin bundles the `orchestrate` agent — a single flexible agent that knows registry + psmux send-keys and follows the user's lead. Available immediately on `copilot plugin install`.
- **1 orchestrator setting** — `orchestrator.enabled`.
- **Claude Code plugin** — Full Claude Code plugin (`claude-code-plugin/`) with hooks and MCP server. Install via `claude plugin install GittyHarsha/ContextManager:claude-code-plugin`. Captures Stop, PostToolUse, PreCompact, session events, and provides MCP read/write access to project memory. Unlike the Copilot CLI plugin, automatic card queue population works fully.
- **Claude Code hook install command** — Quick-start command `ContextManager: Install Claude Code Hooks` writes hooks to `.claude/settings.json` for project-level setup without the full plugin. Also available as a dashboard button.
- **Copilot CLI `agentStop` / `subagentStop` hooks** — Copilot CLI now supports `agentStop` and `subagentStop` events. The plugin hooks into both, producing `Stop` queue entries with the full prompt + response. **Automatic card queue population now works from CLI sessions.**
- **Copilot CLI `preToolUse` hook** — Registers a `preToolUse` hook for tool invocation logging.

### Changed
- **Orchestrator simplified to registry + psmux send-keys** — Removed MessageBus, ContextSync, AgentLauncher, and AgentDiscovery. The orchestrator is now just the AgentRegistry (who's running, pane IDs, project bindings) and `orchestrator_send` (type into another agent's pane). No shared files, no context injection — one agent looks up another and sends it a message directly.
- **Plugin ships single orchestrate agent** — Replaced 3 narrow agents + 1 skill with a single `orchestrate` agent that knows registry + psmux send-keys and follows the user's direction.
- **Plugin v2.14.0** — Updated description, keywords, and added `agents` field to `plugin.json`.

### Fixed
- **MCP server zod compatibility** — Switched from esbuild to tsc for MCP server compilation to fix zod v4 instance mismatch (`_zod` property error) with `@modelcontextprotocol/sdk`.
- **Session file hash mismatch** — Aligned MCP server session file key (SHA256) with capture script, so the real Copilot session UUID flows through to orchestrator tools instead of synthetic `cm-*` IDs.
- **Removed CLI card capture gap warning** — `agentStop` is now available, resolving the original limitation.
- **CLI `agentStop` transcript path mismatch** — Scripts now check `transcriptPath` (camelCase) first, then fall back to `transcript_path`.
- **`ConvertFrom-Json -Depth` on PS 5.1** — Removed unsupported parameter that silently broke all CLI hooks on Windows PowerShell 5.1.
- **VS Code agent hooks file conflicts with Copilot CLI** — Gitignored the generated `.github/hooks/contextmanager-hooks.json` to prevent format conflicts.

### Removed
- **MessageBus** — Removed `src/orchestrator/MessageBus.ts`. Agents communicate directly via psmux send-keys instead of a shared JSONL bus file.
- **ContextSync** — Removed `src/orchestrator/ContextSync.ts`. No more automatic injection of bus messages or fleet status into session context.
- **AgentLauncher** — Removed `src/orchestrator/AgentLauncher.ts`. Terminal launch bridge no longer needed.
- **AgentDiscovery** — Removed `src/orchestrator/AgentDiscovery.ts`. Agent discovery no longer needed.
- **4 bus MCP tools** — Removed `orchestrator_post_message`, `orchestrator_read_messages`, `orchestrator_peek_messages`. Replaced by `orchestrator_send` psmux tool.
- **`orchestrator_resume_session` MCP tool** — Removed. Users run `copilot --resume` themselves.
- **4 orchestrator settings** — Removed `orchestrator.injectBusMessages`, `orchestrator.maxInjectedMessages`, `orchestrator.injectFleetStatus`, `orchestrator.agentStaleTimeout`. Only `orchestrator.enabled` remains.
- **ACP Orchestrator** — Removed `AcpOrchestrator` module and all headless ACP agent spawning.
- **3 prescriptive plugin agents** — Removed `fleet-monitor`, `build-coordinator`, and `session-reviewer` agents from the plugin.
- **Orchestrate skill** — Removed `plugin/skills/` directory. Skill content consolidated into the `orchestrate` agent.

## [2.12.0] - 2026-03-15

### Changed
- **Per-project workflow execution** — Workflow re-entrancy guard is now per-project instead of global. Workflows for different projects no longer block each other in multi-project setups.
- **Per-project auto-distill rate limit** — Background auto-distill cooldown timer is now per-project. Each project can independently trigger auto-distill without being blocked by another project's recent run.

### Fixed
- **Documented CLI card capture gap** — The Copilot CLI does not expose a `Stop` hook, so CLI sessions cannot auto-populate the card queue. Added clear warnings to CLI plugin docs and plugin README with workaround (use MCP `contextmanager_save_card_intent`).

## [2.11.0] - 2026-03-15

### Added
- **Session tracking opt-out** — New `contextManager.sessionTracking.enabled` setting lets you disable session tracking entirely. The Sessions tab stays empty and no session records are written when disabled.
- **Bulk session operations** — Select multiple sessions with checkboxes and Dismiss or Delete them in one action from the Sessions tab.
- **Copilot CLI plugin hooks** — New commands to install Copilot CLI plugin hooks and open the plugin scaffold for terminal-based Copilot workflows.
- **Installation section in README** — Marketplace and CLI install instructions now appear in the project README.

### Changed
- **PostToolUse capture disabled by default** — `hooks.postToolUse` now defaults to `false`. It was creating an observation for every single tool call, flooding the card queue with noise.
- **Renamed Forget → Delete** — Session destructive actions now use "Delete" wording for clarity.

### Fixed
- **Settings checkboxes not persisting** — `updateSetting()` and `resetPrompt()` were defined inside the webview IIFE but never exported to `window`, so all inline `onchange` handlers silently failed. Settings appeared to toggle but never actually saved.
- **Bulk session buttons not working** — `confirm()` is silently blocked in VS Code webview sandboxed iframes (returns `false` immediately). Removed client-side confirms; the extension-side handlers already use `vscode.window.showWarningMessage`.
- **Card queue spam from PostToolUse** — The capture script's PostToolUse handler was synthesizing fake Stop entries from the transcript on every tool call, creating card queue candidates on each one. Removed the synthetic Stop harvesting.

## [2.10.0] - 2026-03-09

### Added
- **Folder-aware `#saveCard` flow** — The save-card tool can now list existing knowledge folders, create folders, and save directly into a named folder from a single tool contract.
- **Template workflow actions** — Custom workflows now support direct template-based create, update, and append actions that skip the model call and save the rendered template verbatim.
- **Dedicated AI model selectors** — AI workflows and AI Draft / Synthesize Card can now use their own model family settings instead of sharing the background extraction model.

### Fixed
- **Workflow markdown preservation** — AI-backed workflow outputs now preserve markdown structure when cards are created or updated.
- **Dashboard draft resilience** — Card editor and add-card drafts now survive dashboard refreshes, and saved-card edits warn before overwriting newer background changes.

## [2.9.0] - 2026-03-07

### Added
- **One-shot card injection** — New "One-shot (deselect after use)" toggle in the Inject into Every Prompt section. When enabled, selected knowledge cards are automatically unchecked after being injected into a prompt, so each card is used exactly once. Injection count is tracked per card.

### Fixed
- **Local install reliability** — `install.ps1` now extracts the VSIX directly and patches `extensions.json` instead of relying on `code --install-extension`, which silently failed from integrated terminals.

## [2.8.1] - 2026-03-07

### Fixed
- **Data migration across publishers** — Users who updated from a previous version with a different publisher ID now automatically recover their projects, observations, and search index. The extension detects data in alternate publisher storage directories and copies it on activation.

## [2.8.0] - 2026-03-06

### Changed
- **esbuild bundling** — Extension is now bundled with esbuild into a single file. VSIX size reduced from 34.6 MB to 3.3 MB, dramatically improving install and update speed.

### Fixed
- **Per-prompt context injection** — `UserPromptSubmit` hook now uses `additionalContext` (injected into model conversation) instead of `systemMessage` (UI-only warning). "Inject into Every Prompt" now correctly provides project knowledge on every message, not just at session start.

## [2.7.0] - 2026-03-05

### Added
- **Skip Pattern** — Optional per-workflow regex field. When the LLM output matches the pattern, the output action is skipped entirely and the run is recorded as "skipped" (⏭️). Useful for filtering out low-value AI responses before they create or pollute cards.
- **Trigger Filter** — Optional per-workflow regex field. Auto-triggered workflows only fire when the event content (queue item text, convention content, card content, or observation summary) matches the filter pattern. Lets you scope event triggers to relevant content without disabling the workflow.
- **Execution history** — Each workflow now tracks its last 15 runs with timestamps and status (success / skipped / error). The dashboard displays aggregated run counts (✅ / ⏭️ / ❌) under each workflow for at-a-glance health monitoring.
- **Target card auto-resolution on auto-triggers** — Event-triggered workflows that use `{{card.content}}`, `{{card.title}}`, or `{{card.tags}}` in their prompt template now automatically resolve the target card's data before execution. Previously these variables were empty on auto-triggers; now the AI can see existing card content for intelligent merging.

### Fixed
- **Manual workflow run re-entrancy** — The `runWorkflow` dashboard handler now reuses the singleton `WorkflowEngine` instead of creating a new instance, preserving the re-entrancy guard that prevents infinite loops.

## [2.6.0] - 2026-03-05

### Fixed
- **UserPromptSubmit hook injection** — Fixed output format to use top-level `systemMessage` per VS Code docs (was incorrectly nested inside `hookSpecificOutput`). "Inject into Every Prompt" now works in agent mode.
- **Inject Memory toggle** — The dashboard "UserPromptSubmit — Inject Memory" checkbox now actually controls injection. Previously the setting was written but never read.

## [2.5.0] - 2026-03-05

### Added
- **Custom AI Workflows** — User-defined pipelines with template variables, 7 trigger types, and 3 output actions.
- **Workflow entity data sources** — Access cards, conventions, working notes, tool hints, and queue items in workflow templates.
- **Workflow event triggers** — Auto-run workflows on observation-created, convention-learned, queue-item-added, and more.
- **Global cards** — Share knowledge cards across all projects.
- **maxItems cap** — Limit collection variable expansion in workflow prompts.

### Fixed
- **Hook compatibility with Copilot Chat 0.38.0** — Capture scripts now handle both snake_case (`hook_event_name`, `session_id`) and camelCase field names in hook stdin JSON. Fixes "Inject into Every Prompt" silently failing after VS Code update.
- Dashboard suppression stuck when user switches panels.
- 5s safety timeout for dashboard suppression.

## [2.3.0] - 2026-03-04

### Changed
- **Observations are raw data, not promotable** — Removed "Promote to convention" and "Promote to working note" buttons from individual observation rows. Observations are unprocessed raw captures; use "Distill with AI" to extract structured knowledge instead.
- **Build script now validates webview** — `install.ps1` includes automatic webview script syntax validation between compile and package steps, catching template-literal JS errors that TypeScript misses.

### Removed
- **Legacy chat participant code** — Deleted `src/chat/` (6 files), `src/prompts/` (8 files), `src/chatParticipant.old.ts`, and `src/tools.old.ts` (~8,300 lines of dead code from the pre-MCP architecture).
- **Overview tab** — Removed from dashboard. Intelligence is now the default landing tab.
- **Cache tab** — Removed standalone cache tab; cache entries integrated into other views.

## [2.2.0] - 2026-03-03

### Added
- **Tags propagation in distill-to-approve pipeline** — The LLM now generates 2–5 keyword tags per distilled card. Tags are stored in the DOM, passed through `approveDistilledCard()` / `approveAllDistilled()` messages, validated in the message handler, and persisted via `addKnowledgeCard()`. Previously tags were hardcoded to `[]` at every stage.
- **Custom prompt for AI synthesis** — The ✨ AI Synthesize action now opens the card editor with a custom prompt textarea. Users can provide specific instructions (e.g., "Focus on security implications") that are injected as a `## User's Custom Instructions` section in the LLM prompt. Leave blank for default behavior.
- **Generate with AI uses LM API directly** — The "Generate with AI" button in the Knowledge tab now calls `vscode.lm.selectChatModels()` + `model.sendRequest()` directly instead of opening `@ctx /knowledge` via the chat panel. Includes cancellable progress notification and robust JSON parsing.
- **Descriptive error messages for AI operations** — All AI failure paths (distill, synthesize, generate) now return specific reasons: "No unprocessed observations", "No language model available", "LLM returned no response", parse failures with response preview. Replaces generic "AI draft failed" / "No model available" messages.

### Changed
- **Unified card selection for hook injection** — The Knowledge tab checkboxes (`selectedCardIds`) now drive the "Inject into Every Prompt" hook system. Previously there was a separate card picker in the injection section; this has been removed. One checkbox, one source of truth.
- **Hook renamed SessionStart → UserPromptSubmit** — The capture script now uses `UserPromptSubmit` (fires before every prompt) with a `hookSpecificOutput` wrapper instead of the old `SessionStart` event.
- **Injection section simplified** — The dashboard's "Inject into Every Prompt" section no longer has a duplicate card picker. It now shows the count of selected cards from the Knowledge tab, a custom instruction textarea, and an "Include full card content" toggle.

### Fixed
- **Multi-strategy JSON parsing** — LLM response parsing now tries 3 approaches: strip boundary fences → extract first `{...}` block → extract from fenced code block. Fixes failures when the model returns preamble text before JSON.
- **Config crash on non-string values** — Added `getString()` helper that safely coerces config values to strings before `.trim()`. Fixes `TypeError: this.get(...).trim is not a function` when settings have null/undefined/non-string values. Applied to all 11 vulnerable call sites.

### Removed
- **Agents feature** — Entire Agents feature removed across 9 files (~160 lines): Agents tab in dashboard, `broadcastAgentContext`/`pruneAgent` handlers, `getAgents()`/`updateAgentActivity()`/`pruneAgent()` methods, `AgentSession` interface, `agentsActivityWindowHours` config, agent identity in hook entries, peer agents section in session context.
- **Overview tab** — Removed from dashboard. Intelligence is now the default tab. Dead branch-tracking functions removed from webview script.

## [2.1.0] - 2026-02-28

### Added
- **File-based staleness detection** — Working notes and knowledge cards are now checked against actual file modification times. Working notes show 🟢 fresh → ⚠️ possibly-stale → 🔴 stale. Knowledge cards show ⚠️ file-stale (referenced files changed) and ⏳ age-stale (configurable threshold). Checks run on dashboard open and file save.
- **Dynamic model dropdown** — Extraction Model and Subagent Model settings now query `vscode.lm.selectChatModels()` at runtime to show only models available in your VS Code instance. No more hardcoded model lists.
- **Distiller prompt customization** — Three new settings (`prompts.distillObservations`, `prompts.distillQueue`, `prompts.synthesizeCard`) let you customize the system prompts used by all distill pipelines.
- **`stalenessAgeDays` setting** — Configurable age threshold (7–365 days, default 30) for flagging knowledge cards as age-stale.

### Removed
- **Session Continuity** — Entire feature removed (was dead code — `getSessionContext()` had zero callers after intelligence moved to copilot-instructions.md managed block).
- **Dashboard git display** — Git status card, branch tracking buttons, and all git subprocess spawning removed from dashboard. VS Code's built-in Source Control handles this; agents can run `git` commands on demand.
- **SKILL.md export** — Removed the single-file SKILL.md export. Use "Export Cards to Filesystem" for multi-file markdown export instead.
- **Experimental settings section** — Proposed API toggle removed from dashboard.
- **"Promote to Card" button on working notes** — Working notes have their own purpose; promotion to knowledge cards was unnecessary.
- **7 `sessionContinuity.*` settings** from package.json.

### Fixed
- **Duplicate card flood** — Root cause was byte-offset vs char-offset mismatch in HookWatcher queue processing. Now reads queue file as Buffer for correct byte-based slicing. Also snaps to end-of-file when offset is missing or overflows.
- **Card editor save button** — Tags and anchors from the editor were silently dropped due to narrow type in `approveQueuedCard()`. Widened to accept and pass through all fields.
- **Tool call capture quality** — Added minimal cleanup filter (drop malformed/empty entries) and size caps (input 2K, output 4K chars) to prevent huge tool outputs from bloating queue entries.

### Changed
- **Working note staleness icon** — Changed from 📌 (confusing — conflicts with "pinned" on cards) to 🟢 for fresh status.
- **Dismiss button naming** — Context-aware labels: "✕ Remove Selected" for queue items, "🗑 Delete Selected" for saved cards.

## [2.0.0] - 2026-02-27

### Added
- **`distillQueue()` — cross-response card synthesis** — New pipeline that reads the entire card queue in one LLM call and synthesizes high-quality knowledge card proposals across all responses. Surfaces cross-cutting patterns and insights that no single response contains clearly enough on its own. Each proposal includes a confidence score and `sourceIndices[]` showing which responses contributed.
- **Observations distill now produces knowledge cards** — `distillObservations` LLM output extended with a `cards[]` array alongside conventions, toolHints, and workingNotes. The distill modal now includes a **📚 Knowledge Cards** section with checkboxes to batch-approve into the knowledge base.
- **Approve All distilled cards** — One-click **Approve All** in the queue distill results region batch-creates all proposed cards via `addKnowledgeCard`.
- **`contextManager.cardQueue.minResponseLength` setting** — Configurable minimum response length (default 300, range 50–5000) for automatic queue inclusion. Replaces the previous hardcoded threshold.

### Changed
- **Queue tab removed — Card Queue merged into Intelligence tab** — The standalone Queue tab is gone. A **📬 Card Queue** section now lives at the bottom of the Intelligence tab: pending count, Distill into Cards button, Clear Queue, and a collapsible raw-items accordion with per-item ✕ removal.
- **Card Queue redesigned as staging buffer** — Queue no longer runs a per-response LLM call to assess worthiness (eliminated `gpt-4o` call per message). Every response over the min-length threshold is silently queued at zero LLM cost. Card quality judgement happens once, at distill time, when the user decides to run synthesis.
- **Queue capped at 30 items** — Oldest items are evicted when the cap is exceeded (FIFO) to prevent unbounded growth.
- **Distill queue results render inline** — Queue distill results appear directly in the Intelligence tab (not a modal), showing category, confidence %, content preview, reasoning, source indices, and per-card **+ Add Card** buttons.

## [1.9.0] - 2026-02-26

### Added
- **Intelligence tab** — New dedicated dashboard tab (🧠 Intelligence) for orchestrating Auto-Capture and Auto-Learn. Shows ON/OFF toggles for both systems with live stats (observation counts, conventions, tool hints, working notes), inline setting controls, Token Economics ROI widget, and the full Observations feed with per-source filter pills, promote, delete, and AI Distill actions. Replaces the former TODOs tab.

### Changed
- **TODOs tab removed from dashboard** — The built-in TODO tracker (add/edit/delete/run agent) has been removed from the UI. TODOs continue to work via the `@ctx /todo` chat command and `#manageTodos` tool.
- **Observations feed moved** — The Recent Observations feed and Distill modal are now in the Intelligence tab instead of the Overview tab, keeping Overview focused on project status and git.
- **Token Economics widget moved** — Relocated from Overview to Intelligence tab alongside the other Auto-Capture controls.
- **Quick Actions updated** — Overview Quick Actions now shows "🧠 Intelligence" instead of "Add TODO".

## [1.8.0] - 2026-02-26

### Added
- **Disk-backed project storage** — Projects, embeddings, observations, and background tasks now persist to JSON files on disk (`globalStorageUri`) instead of VS Code's `globalState`. In-memory caching ensures zero performance overhead — data is loaded once at startup and flushed on every write. Eliminates the "large extension state" warning (was 2.4 MB in globalState).
- **BM25 full-text search** — All 8 FTS tables now use FTS4 with a proper BM25 ranking function computed in JavaScript from `matchinfo('pcnalx')`. Per-column weights, IDF, and document-length normalization — same ranking quality as FTS5's built-in `bm25()`, compatible with the default sql.js WASM build.
- **Knowledge card flags** — Cards now support `pinned`, `archived`, and `includeInContext` boolean flags. Dashboard UI shows toggle buttons (📌 pin, 👁 include, 🗃 archive) in card summaries and the inline edit form.
- **Knowledge index file** — `~/.contextmanager/knowledge-index.txt` is automatically written whenever cards change. Provides a plain-text index of all cards for external tools and scripts.
- **Get Card tool** — `#getCard` reads a knowledge card by ID with full content, anchors, and staleness warnings. Runs immediately without confirmation (read-only).

### Changed
- **FTS4 migration** — Search index migrated from FTS5 (not available in sql.js 1.14.0) to FTS4 with `notindexed=` columns. Snippet syntax adapted to FTS4 argument order. DB filename changed from `search-fts5.db` to `search-fts4.db`.
- **Storage migration** — First launch after update automatically migrates data from `globalState` to disk files, then clears the globalState keys. Transparent and lossless.
- **Tool registration cleanup** — Removed stale monolithic `tools.js` output that was shadowing the modular `tools/index.js` barrel. Excluded `.old.ts` source files from tsconfig. Eliminates "was not contributed" errors for file operation tools.

### Fixed
- **"No implementation registered" for #getCard** — Tool was registered too late in activation order. Moved to core tools section alongside `#projectIntelligence`.
- **File tools registration errors** — Stale `out/tools.js` monolith was registering undeclared tools (writeFile, editFile, fileStat, etc.). Deleted stale files and excluded `.old.ts` from compilation.
- **FTS5 crash on activation** — sql.js 1.14.0 does not include FTS5. SearchIndex now gracefully degrades if FTS modules are unavailable, and uses FTS4 by default.

## [1.7.0] - 2025-02-25

### Added
- **Typed observations** — Every auto-captured observation is now classified as bugfix 🔴, feature 🟣, discovery 🔵, decision ⚖️, refactor 🔄, or change ✅. Heuristic classification based on prompt/response keywords.
- **Content-hash deduplication** — Observations are deduplicated using a content hash with a 30-second window. Replaces the naive 5s throttle timer. Identical interactions are never recorded twice.
- **Privacy tags** — `<private>content</private>` tags are stripped from prompts and responses before storage. Prevents sensitive information from entering the observation buffer.
- **Token economics** — Every observation tracks `discoveryTokens` (original interaction cost) and `readTokens` (compressed observation cost). Shows ROI: "saved 85% tokens across 47 observations."
- **3-layer search** — The `#search` tool now supports `mode` parameter: `search` (index with IDs), `timeline` (context around an anchor), `fetch` (full details for specific IDs), and `economics` (token savings stats). Progressive disclosure prevents token waste.
- **Timeline navigation** — `mode: "timeline"` shows observations chronologically around a specific anchor ID. Navigate forward and backward through your project's observation history.
- **Tool-call-grade capture** — @ctx interactions now pipe full tool call metadata (tool name, inputs, file operations) into the observation buffer. Per-tool granularity for @ctx commands.
- **File path extraction** — Observations automatically extract and index file paths mentioned in prompts and responses.
- **Observation FTS5 indexing** — New `observations_fts` table enables full-text search across all auto-captured observations.
- **Auto-session summarization** — Session continuity now generates structured summaries with observation type breakdown, token economics, and referenced files when updating branch sessions.

### Changed
- **Observation schema** — `Observation` interface now includes `type`, `contentHash`, `filesReferenced`, `toolCalls`, `discoveryTokens`, `readTokens` fields.
- **Search results** — Observation results in `#search` show type emoji, participant, and provide instructions for timeline/fetch follow-up queries.
- **Session summaries** — `getSessionSummary()` and `getDetailedSummary()` now include observation type emojis for visual classification.
- **FullTextSearchTool** expanded with `mode`, `observationId`, `observationIds`, `timelineDepth` parameters for the 3-layer search workflow.

## [1.6.0] - 2025-02-25

### Added
- **Auto-Capture Service** — Zero-friction observation logging from **all** chat participants (Copilot Chat, @workspace, etc.), not just `@ctx`. Every model response is recorded as a lightweight observation in a circular buffer.
- **Session Continuity** — Automatically injects context from previous chat sessions into new ones. Builds a compressed payload from branch session state, recent chat activity, and recently learned intelligence. No more "starting from scratch" every time you open a new chat.
- **Cross-participant LLM learning** — Lightweight LLM extraction now runs on non-@ctx interactions to learn conventions and working notes from regular Copilot Chat conversations.
- **Observation buffer** — Persistent circular buffer (configurable, default 50 entries) stores prompt/response summaries across sessions, surviving VS Code restarts.
- **Session context budget system** — Token budget for session continuity injection split ~40% branch session, ~30% recent activity, ~30% intelligence recap. Configurable via `sessionContinuity.maxContextTokens` (default: 800).
- **Branch session auto-update** — On new session start, previous session's observations are compressed and saved to the active branch session's `currentState`.
- **8 new settings** — `autoCapture.enabled`, `autoCapture.learnFromAllParticipants`, `autoCapture.maxObservations`, `sessionContinuity.enabled`, `sessionContinuity.maxContextTokens`, `sessionContinuity.includeBranchSession`, `sessionContinuity.includeRecentActivity`, `sessionContinuity.includeIntelligence`, `sessionContinuity.alwaysInject`.

### Changed
- **chatHooks enhanced** — `SessionStart` hook now initializes session continuity and pre-builds context for injection. `UserPromptSubmit` hook injects both project intelligence AND session continuity context. `ModelResponse` hook triggers auto-capture observation recording.
- **Participant tracking** — `UserPromptSubmit` now stashes the participant name alongside the prompt, so `ModelResponse` can distinguish @ctx (already handled by full auto-learn) from other participants.

## [1.5.0] - 2026-02-24

### Added
- **Progressive disclosure** — Knowledge cards injected in 3 tiers: full content (top 3), summary (4-7), metadata-only (8+). Reduces prompt token waste while preserving relevance.
- **BM25 OR fallback** — When AND search returns zero results, automatically retries with OR for partial matches.
- **camelCase query expansion** — Search now splits camelCase/PascalCase/snake_case terms for better tokenization at both index and query time.
- **Nested folder hierarchy** — Folders can now contain subfolders (folder inside folder) like a normal file tree.
- **Collapsible folder sections** — Each folder is a collapsible `<details>` — click the arrow to expand/collapse. State persists across re-renders.
- **Drag-and-drop cards** — Drag a card by its header and drop it onto any folder to move it. Folder highlights on hover.
- **Card staleness detection** — Cards not updated in 30+ days show ⚠️ in both the dashboard and prompt injection.
- **Usage analytics** — Tracks selection count, injection count, and last-selected timestamp per card.
- **Card Health dashboard** — Collapsible analytics section showing: total/selected/stale/never-used card counts, top 5 most-used cards, duplicate detection (Jaccard similarity), and stale card list.
- **Cross-card dedup detection** — Detects near-duplicate cards using word-set Jaccard similarity (≥40% threshold).
- **Git-tracked card storage** — Export cards as `.md` files to `.contextmanager/cards/` with YAML frontmatter for git version control and team sharing.
- **Import from markdown folder** — Recursively import `.md` files from any directory as knowledge cards with auto-folder assignment.
- **SKILL.md export** — Export a project or folder as a valid Agent Skills specification file for Claude Code compatibility.
- **Organize Knowledge Cards tool** — New `#organizeCards` tool with actions: listFolders, createFolder, moveCard, autoOrganize.
- **Auto-folder assignment** — New cards created via `/knowledge` or `saveKnowledgeCard` tool auto-assign to the best-matching folder.
- **Per-card tool tracking toggle** — Always-visible 🔧 toggle in card headers (no need to open Edit).
- **Card templates library** — 6 structured templates: General, Architecture Decision Record, API Reference, Debugging Guide, Code Pattern, Onboarding Note.
- **Keyboard shortcuts** — `1-7` switch tabs, `Ctrl+K` focus search, `Ctrl+Shift+K` deselect all cards, `Ctrl+N` new card.
- **Card preview on hover** — Tooltip shows first 200 chars of content when hovering over card title.
- **Last updated timestamps** — Knowledge cards and cache entries now show relative timestamps (e.g. "2h ago") in headers.
- **Per-card tool memory** — Opt-in tracking of successful tool usage patterns scoped to individual cards, injected as separate context section.
- **Refine fallback recovery** — `/refine` now recovers from model tool-call errors (wrong ID, unavailable tools) with deterministic direct-rewrite fallback.

### Changed
- **Search precision** — BM25 now uses exact matching for words ≥4 chars (prefix only for short words), dramatically reducing false negatives.
- **Folder UI redesigned** — Replaced separate folder management block with unified tree layout: folder headers inline with cards, hover-reveal actions, depth indentation.
- **Edit textarea auto-sizes** — Content editor now auto-expands to fit card content (min 300px, max 80vh) instead of fixed tiny box.
- **Scroll position preserved** — Switching to edit mode no longer jumps the page.
- **Root → Uncategorized** — Unfiled cards now labeled "Uncategorized" instead of prominent "📁 Root".
- **Render suppression hardened** — Dashboard re-renders fully deferred during edit/interaction mode to prevent cursor loss.

### Fixed
- **Webview script parse error** — Fixed `join('\n')` inside template literal that crashed all tab click handlers.
- **BM25 search returning zero results** — Long multi-word queries no longer fail silently; OR fallback ensures partial matches surface.
- **FullTextSearch card fallback** — When BM25 returns zero and card search is requested, falls back to keyword title/content matching.

## [1.4.4] - 2026-02-23

### Added
- **Knowledge folders** — Organize knowledge cards into user-defined folders directly in the Knowledge tab.
- **Folder management actions** — Create, rename, and delete folders from the dashboard UI.
- **Move cards between folders** — Each card now has a folder selector for quick re-organization (including moving back to Root).
- **Folder-aware card creation** — New cards can be created directly inside a selected folder.

### Changed
- **Knowledge tab organization** — Cards are grouped by folder in the dashboard for easier browsing in larger projects.

### Fixed
- **Dashboard tab reliability** — Improved tab switching behavior in the webview so tab navigation remains responsive and consistent.

## [1.4.3] - 2026-02-20

### Changed
- **Refine context window optimization** — `/refine` now exposes only 2 tools (`writeFile`, `editKnowledgeCard`) instead of ~20, inlines card content in the prompt (eliminating the file-read round-trip), and uses a single `writeFile` call for the refined content instead of multiple `editFile` calls. Reduces tool-call turns from 3-5 to 1.
- **Exclude target card from project context** — The card being refined is filtered from `projectContext` to avoid duplicate content in the prompt.

## [1.4.2] - 2026-02-20

### Changed
- **Refine with AI uses chat session** — Both the "Refine with AI" button and context menu "Refine Selection with AI" now route through `@ctx /refine` in the chat session. Uses the user's selected model, full tool-calling loop, workspace file access, and project context — instead of a hardcoded one-shot GPT-4o call.
- **Refine via temp file + workspace FS tools** — Card content is written to a temp file; the AI uses `contextManager_editFile` for targeted old→new edits instead of sending entire card content as a tool argument.
- **Card ID-based refine lookup** — Dashboard passes `[id:cardId]` to `/refine` for exact card matching instead of fragile title-prefix matching.
- **Concise refine responses** — AI confirms what changed in one sentence. No more verbose before/after diffs or replacement QuickPick dialogs.
- **Renamed tool** — `contextManager_replaceStringInFile` → `contextManager_editFile`.
- **Removed Find button** from knowledge cards.

### Added
- **🤖 Create Card with AI** — New context menu item. Select text on a card, right-click → "Create Card with AI from Selection" routes through `@ctx /knowledge` with the selection as context.

### Fixed
- **Stale "no changes" message** — Post-refine detection now checks both temp file edits and direct `contextManager_editKnowledgeCard` usage so the success message always shows correctly.

## [1.4.1] - 2026-02-20

### Fixed
- **Branch session living document model** — Each branch now has exactly one session that is always updated in place. No more duplicate sessions.
- **Auto-save never creates sessions** — `autoSaveBranchSession` only updates the existing session; new sessions are created only by auto-bootstrap or explicit tool calls.
- **Git file count accuracy** — Changed files now computed via `git merge-base` diff instead of scanning commit history. No more inflated counts (was showing 697 files instead of actual changes).
- **Git author filter** — `captureGitSnapshot` now uses email (not user name) for commit filtering. Fixes 0 files / 0 commits on branch sessions.
- **Context menu actions** — Fixed Replace, Delete, Refine, and Create Card actions not working. The `mouseup` handler was re-triggering on menu clicks, resetting the selection context.
- **Context menu reordered** — Removed redundant Copy Selection. Most useful actions first: Ask Question, Refine with AI, Replace, Delete, Create Card.
- **Confirm dialog keyboard** — Delete confirmation modal now supports Enter/Escape keyboard shortcuts.

### Added
- **Dashboard: Conventions UI** — Context tab shows all conventions with confidence badges, pending review count, confirm/edit/discard actions
- **Dashboard: Tool Hints UI** — Context tab shows search patterns with anti-patterns
- **Dashboard: Working Notes UI** — Context tab shows expandable notes with rendered markdown, staleness badges, related files/symbols, promote-to-card actions
- **Dashboard: Branch session cards** — Inline per-branch cards with progress bars, status icons, task, currentState, git stats

## [1.4.0] - 2026-02-19

### Added

#### Project Intelligence Layer
- **Conventions** — Structured codebase conventions (`architecture`, `naming`, `patterns`, `testing`, `tooling`, `pitfalls`) with confidence levels (`confirmed`, `observed`, `inferred`)
- **Tool Hints** — Learned search patterns and anti-patterns (e.g., "search `TabStripController` not `tab strip`") with use counting
- **Working Notes** — Agent exploration memory for relationships and insights with `relatedFiles`, `relatedSymbols`, and git-based staleness tracking (`fresh` / `possibly-stale` / `stale`)
- **Tiered Injection** — Confirmed conventions + top tool hints auto-injected into every prompt (Tier 1); task-relevant notes matched by file/keyword (Tier 2); remaining available via tool query (Tier 3). Total capped at 800 tokens.

#### `ProjectIntelligenceTool` (LM Tool — `#projectIntelligence`)
- `learnConvention` / `updateConvention` / `listConventions` — Record and manage codebase conventions
- `learnToolHint` — Record search patterns that work (and anti-patterns that don't)
- `learnNote` / `queryNotes` — Agent writes and queries working notes about code relationships
- `searchLearnings` — BM25 search across all learning types (conventions + hints + notes) via unified `learnings_fts` FTS5 table
- `retrospect` — End-of-task reflection: captures what worked, what didn't, new conventions, tool hints, and knowledge cards

#### Branch Session Enhancements
- **Living document model** — Each branch has exactly one session that is always updated, never duplicated. No more session timeline or duplicate sessions.
- **`checkpoint` action** — Structured progress tracking: `completed` (appended to approaches), `inProgress`, `pending` (next steps), `decisions` — survives context window summarization
- **`gitDiff` action** — Bounded diff between refs (default `main..HEAD`), capped at ~2000 tokens with per-file previews
- **Token-aware `resume`** — `detail: 'brief'` (~300 tokens) vs `'full'` (~800 tokens); brief is the new default
- **Auto-bootstrap** — First branch session auto-created on chat if `branch.autoBootstrap` enabled (default: `true`)
- **Richer auto-capture** — Full prompt (no 200-char truncation), optional `currentState` extraction from last AI response (gated by `branch.autoCaptureSessions`)
- **Accurate file counting** — Changed files computed via `git merge-base` diff instead of scanning commit history; no more inflated counts

#### Dashboard: Project Intelligence UI
- **Conventions section** in Context tab — shows all conventions with confidence badges (`confirmed` ✅ / `observed` ⏳), pending review count, confirm/edit/discard actions
- **Tool Hints section** in Context tab — shows search patterns with anti-patterns, delete per hint
- **Working Notes section** in Context tab — expandable notes with rendered markdown, staleness badges (⚠️ possibly-stale), related files/symbols, promote-to-card and mark-fresh actions
- **Branch session cards** — inline per-branch cards with progress bars (done/pending %), status icons (✅ Done / ⚠️ Blocked / 🔄 Active), task, currentState, git stats

#### `@ctx /done` Command
- End-of-task retrospective: finalizes branch session (`nextSteps = []`), extracts outcome summary, prompts agent to call `retrospect` for structured learning capture

#### Data Import/Export
- Dashboard Settings tab → **📦 Data Management** section with 4 buttons
- **Export All Data** / **Import Data** — Full dump/restore of all projects + cache to `.ctxmgr.json`
- **Export Current Project** / **Import Project** — Single-project export/import with duplicate handling (overwrite or import as copy)
- Import supports merge mode (skip existing) and replace mode (with confirmation)

#### LaTeX Rendering
- Knowledge cards and cache entries now render LaTeX math expressions
- Supports `$...$` (inline), `$$...$$` (display), `\(...\)`, `\[...\]` delimiters
- Uses KaTeX with MathML output — native Chromium rendering, zero external dependencies

### Changed
- **Deduplication on all write paths** — Knowledge cards, conventions, tool hints, and working notes now match by natural key (title, subject, pattern) and update in place instead of creating duplicates
- **Literal `\n` fix** — `renderMarkdown()` now normalizes escaped `\n`/`\t` from LM tool JSON into real characters before rendering
- **FTS5 incremental migration** — `ensureSchema()` now uses `CREATE IF NOT EXISTS` for new tables instead of dropping all existing tables. Existing user indexes are never destroyed on upgrade.
- **`learnings_fts` table** — New FTS5 virtual table for BM25 search across conventions, tool hints, and working notes
- **Rebuild includes learnings** — FTS index rebuild now indexes conventions, tool hints, and working notes from all projects

### New Settings
- `branch.autoCaptureSessions` (default: `false`) — Extract last AI response as `currentState` after every exchange
- `branch.autoBootstrap` (default: `true`) — Auto-create first session on chat
- `intelligence.enableTieredInjection` (default: `true`) — Auto-inject conventions + hints into prompts
- `intelligence.tier1MaxTokens` (default: `400`) — Token budget for always-injected learnings
- `intelligence.tier2MaxTokens` (default: `400`) — Token budget for task-relevant learnings
- `intelligence.enableStalenessTracking` (default: `true`) — Git-based staleness checks on working notes

## [1.3.0] - 2026-02-19

### Added

#### Inline Context Menu Modals
- **Replace Selection**, **Delete Selection**, **Refine Selection with AI**, and **Create Card from Selection** now use inline webview modals instead of VS Code's command palette input boxes
- Modals are centered overlays with backdrop dimming, Enter/Escape keyboard shortcuts, and won't disappear on click outside VS Code
- **Ask Question about Selection** unchanged (opens chat directly with `isPartialQuery`)

#### `/add` Command
- New `@ctx /add` slash command — saves the **last AI response** from the current chat session as a knowledge card
- Optional prompt text used as title hint; prompts for title and category via QuickPick
- Followup button "📥 Add last response as card" appears after `/chat` and `/save` commands

#### Find in Card (Ctrl+F equivalent)
- Each expanded knowledge card now has a **🔍 Find** button
- Toggles inline search bar with live text highlighting across all matches
- Auto-scrolls to first match; highlights use VS Code's `findMatchHighlightBackground` color
- Clear button removes all highlights and closes the bar

### Changed
- **Cache title auto-detection** — Single-word prompts auto-title without showing an input box; multi-word selections still prompt for a title
- **Table rendering** — Markdown table detection now requires header row to start with `|`, preventing false positives from content containing pipe characters
- **Auto-save context** — "Save Context" button replaced with 800ms debounced auto-save on textarea input, with "Saving…" → "✓ Saved" → "Auto-saves on edit" status indicators
- **Mermaid blocks** — Styled with 📊 icon, blue left border, and "mermaid diagram" label in card views

### Removed
- `manageTodos` tool declaration removed from package.json (class kept as dead code, not registered)
- Tags `#` prefix removed from display and add form

### Fixed
- **Dashboard crash** — `\n` inside template literal string in delete confirmation modal broke the entire `<script>` block, disabling all tabs and buttons
- **Smart Select** button now gated behind `experimental.enableProposedApi` setting
- **Edit card** preserves cursor position and `<details>` expanded state

---

## [1.2.0] - 2026-02-18

### Added

#### Global Knowledge Cards
- Cards can be marked as **global** to share across all projects
- "Share Globally" / "🌐 Make Local" toggle in card action buttons
- Global cards from other projects appear in a dedicated section at the bottom of the Knowledge tab
- Global cards can be selected/deselected for context injection in any project
- "🌐 Global Only" filter option in Knowledge tab category dropdown
- Tab badge shows global card count alongside local cards
- Context injection labels global cards with 🌐 for model awareness

#### Mermaid Diagram Rendering
- ` ```mermaid ` code blocks in knowledge cards now render as interactive SVG diagrams
- Bundled mermaid.js v11 (~2.75MB) loaded locally — no CDN or network requests
- Dark theme tuned to match VS Code styling
- Graceful fallback: shows raw source if mermaid parsing fails

#### UX Improvements
- **Research & Save as Card**: inline input with optional query — "Research" button fires immediately using selected text; custom query also supported
- **/save auto-save**: no carousel or dialog — auto-generates title, saves with "explanation" category, shows toast with "Open Dashboard" button
- **/refine second model call**: when tool calls happen but no structured edits produced, sends a focused conversion prompt
- **/refine auto-append fallback**: appends research findings instead of showing a vanishing QuickPick dialog
- **Git files**: click to open, Ctrl+click to diff; "📝 Summarize My Changes" button
- **Concurrent /save queue**: `queuedInputBox()` and `queuedQuickPick()` prevent UI conflicts
- **Smart Select** button gated behind `experimentalProposedApi` setting

### Removed
- Tags removed from knowledge card UI, AI generation, and refine parsing (data model field kept for backwards compat)
- TODO manager tool removed from agent tool registration

### Fixed
- Dashboard crash caused by broken quote escaping in inline onclick handlers across 4 nesting levels — replaced with `data-*` attributes + event delegation
- Untrack branch button wired via `getElementById` + `addEventListener` instead of inline onclick

## [1.0.0] - 2026-02-16

### Added

#### BM25 Full-Text Search (SQLite FTS5)
- **`#searchCards`** tool — BM25-ranked knowledge card search with full content retrieval
- **`#search`** tool — Cross-entity search across cards, TODOs, cache, branch sessions, agent messages, and projects with snippet previews
- SQLite FTS5 via sql.js (WebAssembly) — no native binaries required
- unicode61 tokenizer with diacritics normalization for code-friendly matching
- Quoted phrase support for exact matching (`"error handler"`)
- Prefix matching for partial terms (`auth*` matches `authentication`, `authorize`)
- 6 FTS5 virtual tables with tuned BM25 weight configurations per entity type
- Index persisted to `globalStorageUri/search-fts5.db` between sessions
- Full rebuild from Memento on activation, incremental sync on every mutation
- Configurable: `search.enableFTS`, `search.maxCardResults`, `search.maxSearchResults`, `search.snippetTokens`

#### Branch Tracking & Git Integration
- **Branch session tracking** — capture task, goal, approaches, decisions, next steps, and blockers per branch
- **Git state capture** — changed files, recent commits (filtered by author), branch name display
- Dashboard **Git** section — async-loaded commit history, changed file lists, branch status
- `branch.includeInPrompts` and `branch.autoCapture` settings
- `/save` auto-links branch sessions to knowledge cards

#### Custom Prompt System
- 6 customizable system prompts: `/chat`, `/explain`, `/usage`, `/relationships`, `/knowledge`, `/research`
- Override defaults via `contextManager.prompts.*` settings
- Empty = use built-in defaults (non-breaking)

### Changed
- Knowledge card search now uses 3-tier strategy: embeddings → BM25 FTS5 → keyword fallback
- Dashboard git data loads asynchronously with spinner (no longer blocks initial render)
- Commit filtering uses exact email match (no more false positives from partial matches)
- Untracked files excluded from branch state capture

### Fixed
- **Thinking tokens leak** — `lastResponse` tracking in tool-calling loops prevents thinking tokens from appearing in knowledge card content
- Dashboard branch name display showing `undefined` → now shows actual branch
- Floating promise in FTS5 initialization → proper async IIFE with error handling
- Race condition: incremental index writes during full rebuild now guarded by `_rebuilding` lock

### Security
- **Content Security Policy** added to dashboard webview (nonce-based script policy)
- **FTS5 query injection hardened** — `preprocessQuery` now strips `OR`/`AND`/`NOT`/`NEAR` operators, `:` column filters, and sanitizes quoted phrase internals

### Removed
- Dead `TelemetryManager` class (was never imported or used)
- Dead `chatParticipant_backup.js` (1000+ line obsolete backup)
- Empty `src/tools/` directory
- Stray documentation files from VSIX packaging (`ICON_GUIDE.md`, `PRODUCTION_READY.md`, `PUBLISHING.md`)

### Improved
- All file I/O in SearchIndex converted from synchronous to async (`fs/promises`) — no longer blocks extension host
- Auto-save timer (30s) for FTS5 index — crash-safe incremental updates
- Deprecated `String.prototype.substr()` replaced with `substring()`
- Unused `getLocalBranches` import removed
- VSIX size: 2.63 MB (143 files)

### Proposed API Integrations (auto-enabled)
All features below activate automatically when the VS Code build supports them. No setting required — they gracefully degrade on stable VS Code.

- **Chat Status Item** (`chatStatusItem`) — Persistent status in the chat panel showing project name, selected cards, cached explanations, and pending TODOs
- **System Messages** (`languageModelSystem`) — Uses `LanguageModelChatMessageRole.System` for cleaner prompt construction with graceful fallback
- **User Action Tracking** (`onDidPerformAction`) — Logs when users copy, insert, apply, or run code from chat responses
- **Question Carousel** (`questionCarousel`) — Inline multi-question UI for `/save` category and title selection, with fallback to traditional QuickPick
- **Participant Variables** (`participantVariableProvider`) — Custom `#projectInfo`, `#todoList`, `#knowledgeCards`, `#cachedExplanations` references + individual `#card:<title>` variables
- **Code Block URI** (`ChatResponseCodeblockUriPart`) — Links code blocks in `/explain`, `/usage`, `/relationships` responses back to source files
- **Tool Invocation Progress** (`beginToolInvocation`) — Rich tool progress indicators in the chat response during tool-calling loops
- **MCP Server Discovery** (`mcpServerDefinitions`) — Lists available MCP servers in `/context` output
- **Chat Hooks** (`chatHooks`) — Session start and prompt submission hooks for extensibility
- **Dynamic Tool Registration** (`languageModelToolSupportsModel`) — Per-project `knowledgeByCategory` and `todoStatus` tools registered dynamically when project changes
- **Chat Sessions Provider** (`chatSessionsProvider`) — TODO agent runs surfaced as browsable session items in the chat sidebar with run history and status
- **Thinking Progress** — Visual thinking indicator during analysis operations
- **Warning Parts** — Native warning badges in chat responses (with markdown fallback)
- **Token Usage Reporting** — `stream.usage()` for prompt/completion token stats

#### Type Definitions
- Expanded `chatParticipantAdditions.d.ts` from 45 to 250+ lines covering all new response part types
- Added 6 new proposed API `.d.ts` files: `chatStatusItem`, `languageModelSystem`, `mcpServerDefinitions`, `chatHooks`, `languageModelToolSupportsModel`, `chatSessionsProvider`
- Added `embeddings.d.ts` proposed API type definitions
- `package.json` `enabledApiProposals` expanded to 8 entries

#### Embeddings / Smart Select (experimental)
- **On-demand semantic search** over knowledge cards using `vscode.lm.computeEmbeddings`
- Card text sent to cloud for vectorization; vectors stored locally in `globalState`
- Cosine-similarity matching finds the most relevant cards for a natural-language query
- Content-hash optimization skips re-embedding unchanged cards
- Three new commands: `Smart Select Knowledge Cards`, `Embed Knowledge Cards`, `Clear Embeddings`
- Dashboard **✨ Smart Select** button in Knowledge Cards tab
- Gated behind `experimental.enableProposedApi` setting (requires VS Code Insiders)

## [0.1.0] - 2025-07-18

### Added

#### Chat Participant
- Chat participant `@ctx` with **10 specialized commands**:
  - `/chat` — General questions with project context
  - `/explain` — Deep-dive explanation of symbols
  - `/usage` — Explain why code is used at a location
  - `/relationships` — Show class hierarchies and relationships
  - `/todo` — AI agent for TODO completion (full tool access)
  - `/knowledge` — Research topics and generate knowledge cards
  - `/refine` — Refine existing knowledge cards with new AI research
  - `/save` — Answer questions and save as knowledge cards
  - `/context` — Display current project context
  - `/doc` — ⚠️ Experimental: Generate doc comments with inline diff (proposed API)
- Context-aware followup suggestions after each response

#### Language Model Tool
- `#projectContext` tool registered via `vscode.lm.registerTool()`
- Exposes project context to **all** chat participants (not just `@ctx`)
- Fine-grained per-project sharing config (metadata, cards, cache, TODOs)
- Auto-invocable by Copilot when queries relate to project architecture

#### Knowledge Cards
- Create, edit, delete, and tag knowledge cards
- AI-generated cards via `/knowledge` and `/save`
- Refine cards with `/refine` — picks card, researches codebase, updates
- Tag categories: architecture, pattern, convention, explanation, note
- Reference files attached to cards
- Select/deselect to include in AI context
- Search and filter by keyword or tag
- Uncheck All button
- Linked TODO cards — TODOs auto-create and refine a linked card across runs

#### TODO Management
- Create, edit, and delete TODOs with priority (low, medium, high)
- AI agent with autonomous execution (full tool access)
- Conversation history — review every agent step
- Resume with instructions — pause, adjust, continue
- Auto-status updates based on agent progress
- Bulk select, bulk complete, bulk delete
- Search and filter by text or status

#### Explanation Cache
- Auto-cache all `/explain`, `/usage`, `/relationships` results
- Selectable entries to include in AI prompts
- Editable titles and content
- Convert cache entry to knowledge card
- Configurable expiration (0 = never)
- Uncheck All button
- Project-scoped

#### Dashboard
- WebView dashboard with **6 tabs**: Overview, TODOs, Knowledge, Cache, Context, Settings
- **Settings tab** — all extension settings editable in-dashboard
- **Context tab** — project goals, conventions, key files, `#projectContext` tool sharing config
- Search bars and filter dropdowns across all tabs
- Bulk operations for TODOs
- Markdown rendering with tables, code blocks, blockquotes
- Collapsible TODO descriptions (collapsed by default)
- Multi-word cache title prompt (asks for title when selected text > 1 word)

#### Settings (17+)
- General: status bar, confirmations, auto-select cards, max cards, cache expiration, context default
- Chat: max iterations, include copilot instructions, include README
- TODO: max agent iterations, auto-update status
- Explanations: expand context, include references
- Context: auto-deselect after use
- Dashboard: default tab, show progress
- Experimental: enable proposed APIs

#### Other
- Context menu commands (Explain, Explain Usage, Explain Relationships)
- Sidebar tree view with project switching, TODO list, stats
- Status bar integration — active project, quick stats, click to open
- Auto-discovery of `.github/copilot-instructions.md` and `README.md`
- Multi-project support with global/workspace state
- Install script (`scripts/install.ps1`)

### Fixed
- Extension not activating when `node_modules/` excluded from VSIX
- Reference error when using normal chat after `@ctx` query
- Markdown rendering breaking parent container in dashboard
- TypeScript strict mode comparison errors in settings

## [0.0.1] - Pre-release

### Added
- Basic prototype implementation
- Core chat participant functionality
- Initial caching mechanism
