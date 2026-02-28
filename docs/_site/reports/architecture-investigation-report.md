# Architecture Investigation Report: Context Injection & Token Economics

**Date:** 2025-07-14  
**Scope:** `codebase-navigator/src/` — ContextManager VS Code extension  
**Author:** Architecture investigation (automated)

---

## 1. Context Injection Flow

### 1.1 Storage: Where Conventions, Working Notes, and Tool Hints Live

All three intelligence types are stored as arrays on the `Project` object, persisted via `ProjectManager` → `storage.ts` (VS Code `globalState`).

| Type | Storage Field | Type Definition | Selection Tracking |
|------|--------------|-----------------|-------------------|
| **Conventions** | `project.conventions[]` | `Convention` interface (`types.ts:208-218`) | `project.selectedConventionIds[]` |
| **Tool Hints** | `project.toolHints[]` | `ToolHint` interface (`types.ts:220-229`) | `project.selectedToolHintIds[]` |
| **Working Notes** | `project.workingNotes[]` | `WorkingNote` interface (`types.ts:231-244`) | No selection tracking (filtered by `enabled` flag) |

Additionally, the user can set free-form conventions in `project.context.conventions` (a plain string, `types.ts:158`), which is separate from the structured `Convention[]` array.

### 1.2 How Context Gets Injected into @ctx Chat Prompts

When the user chats with `@ctx`, the flow is:

1. **`chat/index.ts:53-167`** — The chat handler routes to `handleChat()` (or other command handlers).

2. **`chat/helpers.ts:35-44` (`getProjectContext()`)** — Calls `ProjectManager.getFullProjectContext()`.

3. **`ProjectManager.ts:659-780` (`getFullProjectContext()`)** — Builds a context string containing:
   - Project name, description, goals
   - **Free-form conventions** (`project.context.conventions`, line 678)
   - Key files
   - Copilot instructions (from `.github/copilot-instructions.md`)
   - **Selected knowledge cards** with 3-tier progressive disclosure (lines 696-766):
     - Tier 1 (first 3 cards): Full content, up to ~2000 tokens each
     - Tier 2 (cards 4-7): Truncated to ~500 chars
     - Tier 3 (cards 8+): Metadata only (title + first line)
   - Selected cache entries

4. **`prompts/chatPrompt.tsx:56-84`** — The prompt-tsx `ChatPrompt` component assembles the final prompt:
   - System instructions (line 28-54)
   - `<ProjectContext>` component with the context string (priority 30)
   - `<BranchContext>` component (priority 27)
   - `<ReferenceFiles>` badges (priority 25)
   - `<History>` (priority 10)
   - User message
   - `<ToolCalls>` (tool call history)

5. **`prompts/components.tsx:369-397` (`ProjectContext` component)** — Renders workspace paths, copilot instructions, and the curated project context as a `<UserMessage>` with explicit instruction: "do NOT re-derive or re-search this".

6. **`chat/toolCallingLoop.ts:80-225`** — The tool-calling loop iterates: render prompt → send to model → collect tool calls → loop. Each iteration re-renders the prompt with accumulated tool call results.

**Key insight:** The structured `Convention[]`, `ToolHint[]`, and `WorkingNote[]` are **NOT** directly injected into `@ctx` prompts via `getFullProjectContext()`. They are injected only through the **intelligence injection** path (section 1.3 below) or accessed via the `#projectContext` / `#projectIntelligence` tools.

### 1.3 Tiered Intelligence Injection (Into ALL Participants)

This is the core mechanism for injecting conventions, tool hints, and working notes into prompts:

**`ProjectManager.ts:1805-2010+` (`getProjectIntelligenceString()`)** builds a two-tier intelligence string:

**Tier 1 (always injected, budget: `intelligence.tier1MaxTokens` = 800 tokens):**
- Knowledge cards: selected cards, or pinned cards if none selected (lines 1834-1848)
- Conventions: selected conventions, or ALL enabled conventions if none selected (lines 1851-1865)
- Tool hints: only if user has explicitly selected hints (lines 1868-1882)

**Tier 2 (task-relevant, budget: `intelligence.tier2MaxTokens` = 800 tokens):**
- Uses BM25 full-text search (when available) or keyword fallback to find relevant:
  - Knowledge cards not already in Tier 1 (lines 1901-1915)
  - Conventions, notes, tool hints ranked by relevance (lines 1918-1934)
- Tool hints (unselected) are auto-injected only for exploration-type prompts (line 1886-1887)
- Working notes matched by file overlap or keyword (lines 1979-2001)

**Token budgeting:** Uses `Math.ceil(line.length / 4)` as token estimate (~4 chars/token). Lines are added until the tier budget is exhausted. This is a **heuristic estimate, not actual token counting**.

**Injection point:** `proposedApi.ts:561-619` — The `UserPromptSubmit` chatHook appends the intelligence string to the user's prompt for **all non-@ctx participants**.

### 1.4 How Conventions/Notes/Hints Are Created

Three creation pathways:

1. **Manual (via tools):** `ProjectIntelligenceTool` (`tools/projectIntelligenceTool.ts:44-262`) exposes `learnConvention`, `learnToolHint`, `learnNote`, and `retrospect` actions.

2. **Auto-Learn Pipeline:** `autoLearn.ts:160-344` runs after every `@ctx` tool-calling loop:
   - **Tool Hints:** Regex-based detection of search fail→success patterns (always regex, lines 196-224)
   - **Conventions:** LLM extraction (default) or regex fallback (lines 226-329)
   - **Working Notes:** LLM extraction or file co-access regex fallback (lines 226-295)
   - All auto-extracted items have `confidence: 'inferred'` — never auto-confirmed

3. **Auto-Capture Service:** `autoCapture.ts` captures observations from ALL participants and optionally runs LLM extraction for conventions/notes.

**Caps & Eviction:** Hard caps per category (configurable, defaults: 30 notes, 20 hints, 15 conventions). When exceeded, oldest `inferred` items are evicted. `observed`/`confirmed` items are never evicted (`autoLearn.ts:440-502`).

---

## 2. Integration with External Agents

### 2.1 copilot-instructions.md (File-Based Integration)

**`githubInstructions.ts:43-328`** (`GitHubInstructionsManager`) syncs ContextManager knowledge to `.github/` files:

1. **`.github/copilot-instructions.md`** — A managed block (`<!-- ContextManager:BEGIN -->` / `<!-- ContextManager:END -->`) is injected containing:
   - High-confidence conventions (up to 10, `observed` only) (lines 106-112)
   - Knowledge card index with IDs (up to 15 cards) (lines 116-128)
   - User content outside the block is preserved (lines 146-161)

2. **`.github/instructions/cm-*.instructions.md`** — Per-architecture-card scoped instruction files with `applyTo:` frontmatter for file-glob scoping (lines 168-207). Stale files are auto-cleaned.

3. **`.github/prompts/knowledge-retrospect.prompt.md`** — A reusable prompt file for running knowledge audits (lines 260-273).

4. **`~/.contextmanager/knowledge-index.txt`** — A global file for external tools to read the card index, used by the PreCompact hook so knowledge survives conversation compaction (lines 280-311).

**Sync trigger:** `extension.ts:187-195` — Syncs 10 seconds after activation and 5 seconds after any project/card change, with fingerprint-based no-op detection to skip unnecessary writes (lines 49-57).

**This is how plain Copilot and other extensions access ContextManager knowledge** — VS Code natively reads `.github/copilot-instructions.md` and scoped `.instructions.md` files.

### 2.2 Chat Hook Injection (Proposed API)

**`proposedApi.ts:507-679`** registers three `chatHooks` on the `@ctx` participant:

1. **`SessionStart`** — Initializes session continuity (pre-builds context).
2. **`UserPromptSubmit`** — The critical hook. For non-@ctx participants:
   - Injects **session continuity context** (git state, card index) — first prompt only (lines 580-589)
   - Injects **project intelligence** (tiered conventions/notes/hints) — every prompt when `intelligence.injectIntoAllParticipants` is true (lines 592-609)
   - Appends to the user's prompt text: `{original prompt}\n\n[Project Intelligence — auto-injected by ContextManager]\n{intelligence}`
3. **`ModelResponse`** — Captures responses for auto-capture observations and card queue detection.

**Limitation:** Chat hooks are a **proposed API** (`vscode.proposed.chatHooks.d.ts`). They only work in VS Code Insiders or when the extension has access to the proposed API. The code gracefully checks for availability (`proposedApi.ts:515`).

### 2.3 LM Tool Sharing (#projectContext)

**`tools/projectContextTool.ts:15-130`** — The `ProjectContextTool` class implements `vscode.LanguageModelTool` to expose project context to any chat participant that invokes the `#projectContext` tool. Returns project metadata, knowledge card index, cache entries, and TODOs.

**However:** This tool is **NOT registered** as of the current code. `tools/index.ts:117-125` shows it's commented out with the note: "DEPRECATED in WS0b (Intelligence Pipeline Upgrade)". The replacement is specialized tools (`#getCard`, `#knowledgeByCategory`, etc.).

### 2.4 Summary of External Agent Access Mechanisms

| Mechanism | Agent Type | Availability | Content |
|-----------|-----------|-------------|---------|
| `.github/copilot-instructions.md` | All Copilot agents, GitHub Copilot Chat | Always (file-based) | Conventions (top 10 observed) + card index |
| Scoped `.instructions.md` files | All agents via VS Code | Always (file-based) | Architecture cards with file-glob scoping |
| `UserPromptSubmit` chatHook | All VS Code chat participants | Proposed API only | Full tiered intelligence (Tier 1 + Tier 2) |
| `~/.contextmanager/knowledge-index.txt` | External tools (Claude Code hooks, etc.) | Always (file-based) | Card index for compaction survival |
| `#projectContext` tool | Any LM tool caller | **DEPRECATED / not registered** | Full project context dump |

---

## 3. Token Economics

### 3.1 What It Is

The "Token Economics" feature is an **auto-capture ROI metric** displayed in the dashboard. It measures the compression ratio between original chat interactions and their stored observation summaries.

**Location:** `autoCapture.ts:494-499` (`getTokenEconomics()`) and `dashboard/DashboardPanel.ts:493-521`.

### 3.2 How It Works

For each captured observation, two values are estimated:

1. **Discovery Tokens** (`discoveryTokens`): The estimated token cost of the **original** full interaction.
   - For non-@ctx interactions (`autoCapture.ts:329`): `Math.ceil((promptText.length + responseText.length) / 4)`
   - For @ctx tool call interactions (`autoCapture.ts:407`): Sum of all tool call round content lengths ÷ 4

2. **Read Tokens** (`readTokens`): The estimated token cost to **read the compressed observation**.
   - For non-@ctx (`autoCapture.ts:330`): `Math.ceil((promptSummary.length + respSummary.length) / 4)` where summaries are truncated (prompt to 500 chars, response summarized)
   - For @ctx tool calls (`autoCapture.ts:410`): `Math.ceil((cleanPrompt.length + respSummary.length + allToolCalls.length * 30) / 4)`

3. **Savings** = `totalDiscovery - totalRead`
4. **Savings %** = `savings / totalDiscovery * 100`

### 3.3 Dashboard Display

**`DashboardPanel.ts:493-521`** renders a card with:
- Total observations count
- Total discovery tokens (estimated)
- Total read tokens (estimated)
- Savings percentage
- Per-observation averages

### 3.4 Assessment: Is It Legitimate?

**Partially.** The feature is functional but has important caveats:

1. **Estimates, not real token counts.** The `CHARS_PER_TOKEN = 4` constant (`autoCapture.ts:78`) is a rough heuristic. Real tokenization varies significantly by model (GPT-4 ≈ 3.5 chars/token, Claude ≈ 4). The values are approximate.

2. **Measures compression, not actual API cost.** Discovery tokens don't represent actual API billing — they estimate what it *would have cost* to re-read the full interaction. The "savings" represent the compression ratio of the observation store, not money saved.

3. **Useful as a proxy metric.** It correctly shows that compressed observations are much smaller than original interactions, which is the whole point of the auto-capture system. The percentage gives a meaningful at-a-glance sense of how much context is being compressed.

4. **No integration with real token counting.** There's no VS Code API for tracking actual LLM token usage. The extension cannot access billing data.

### 3.5 Token-Related Configuration

The following settings use "tokens" as a budget mechanism (all in `config.ts`):

| Setting | Default | Location | Purpose |
|---------|---------|----------|---------|
| `intelligence.tier1MaxTokens` | 800 | `config.ts:200-201` | Budget for always-injected conventions/cards |
| `intelligence.tier2MaxTokens` | 800 | `config.ts:204-205` | Budget for task-relevant learnings |
| `intelligence.injectionMaxChars` | 0 (unlimited) | `config.ts:209-210` | Hard cap on chars injected per prompt |
| `sessionContinuity.maxContextTokens` | 800 | `config.ts:327-328` | Budget for session continuity injection |
| `search.snippetTokens` | 16 | `config.ts:119-120` | Context tokens around search match highlights |

All token budgets use the same `Math.ceil(chars / 4)` heuristic for estimation. None perform actual tokenization.

---

## 4. Recommendations

### 4.1 Gaps Found

1. **`getFullProjectContext()` doesn't include structured intelligence.** The `@ctx` prompt-building path (`ProjectManager.ts:659`) includes the free-form `context.conventions` string but **not** the structured `Convention[]`, `ToolHint[]`, or `WorkingNote[]` arrays. These only reach `@ctx` prompts if the `UserPromptSubmit` hook fires (which it doesn't for `@ctx` — it's explicitly skipped at `proposedApi.ts:572-574`). This means `@ctx` itself doesn't benefit from the tiered intelligence system unless items happen to be in knowledge cards.

2. **Deprecated `#projectContext` tool leaves a gap.** The tool is commented out (`tools/index.ts:117-125`) but no direct replacement aggregates project meta + conventions + todos for tool callers. Individual tools exist but require the model to know to call them.

3. **Token estimation is coarse.** The `chars / 4` heuristic could under- or over-count by 15-25%. For budget-sensitive injection (Tier 1/Tier 2), this means the actual injected content may exceed the intended token budget. Consider using VS Code's `LanguageModelChat.countTokens()` for critical paths.

4. **Working notes have no selection mechanism.** Unlike conventions (`selectedConventionIds`) and tool hints (`selectedToolHintIds`), working notes rely only on the `enabled` boolean flag. Users can't selectively prioritize specific notes for injection.

5. **Chat hook dependency on proposed API.** The entire external-agent intelligence injection depends on `chatHooks`, a proposed API. On stable VS Code builds, the only integration path for non-@ctx agents is the `.github/copilot-instructions.md` file, which only includes `observed`-confidence conventions and a card index — no working notes, no tool hints, no task-relevant filtering.

6. **Auto-Learn LLM cost is unbounded.** Every chat interaction triggers an LLM call for extraction (`autoLearn.ts:249`, `autoCapture.ts:359`). While there's a one-time warning, there's no per-session or per-day cap on these calls.

### 4.2 Suggested Improvements

1. **Inject tiered intelligence into `@ctx` prompts directly.** Call `getProjectIntelligenceString()` in the `@ctx` chat handler and include it in the `ChatPrompt` props, rather than relying on the hook path that's skipped for `@ctx`.

2. **Add actual token counting for budget enforcement.** Use `model.countTokens()` (available in the tool-calling loop where the model reference exists) to accurately enforce Tier 1/Tier 2 budgets.

3. **Add `selectedWorkingNoteIds` to Project type.** Mirror the convention/tool-hint selection pattern to give users fine-grained control over which notes are injected.

4. **Add a daily LLM call cap for auto-learn.** Introduce a `intelligence.autoLearn.maxDailyLLMCalls` setting with a reasonable default (e.g., 20) to prevent runaway API usage.

5. **Consider re-registering a lightweight project context tool.** Even if the original kitchen-sink tool was deprecated, a slim version that returns project meta + active convention summary would help tool-calling models that don't receive hook-injected context.

---

## Appendix: Key File Reference

| File | Role |
|------|------|
| `projects/types.ts` | Data models: Project, Convention, ToolHint, WorkingNote |
| `projects/ProjectManager.ts` | Storage, CRUD, `getFullProjectContext()`, `getProjectIntelligenceString()` |
| `config.ts` | All settings including token budgets |
| `chat/index.ts` | Chat participant registration, auto-learn triggering |
| `chat/helpers.ts` | `getProjectContext()`, `getBranchContext()`, tool filtering |
| `chat/toolCallingLoop.ts` | Generic tool-calling loop |
| `prompts/chatPrompt.tsx` | Chat prompt template with `<ProjectContext>` |
| `prompts/components.tsx` | Shared prompt components (ProjectContext, BranchContext, ToolCalls) |
| `proposedApi.ts:507-679` | Chat hooks (UserPromptSubmit injection, ModelResponse capture) |
| `tools/projectContextTool.ts` | `#projectContext` LM tool (DEPRECATED, not registered) |
| `tools/projectIntelligenceTool.ts` | `#projectIntelligence` LM tool (learn/query/retrospect) |
| `autoLearn.ts` | Auto-learning pipeline (tool hints, conventions, notes extraction) |
| `autoCapture.ts` | Observation logging, token economics, LLM extraction |
| `sessionContinuity.ts` | Cross-session context restoration |
| `githubInstructions.ts` | `.github/copilot-instructions.md` sync, scoped instructions |
| `dashboard/DashboardPanel.ts:493-521` | Token Economics dashboard widget |
