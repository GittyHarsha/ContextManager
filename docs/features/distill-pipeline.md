---
layout: default
title: Distill Pipeline
parent: Features
nav_order: 6
prev_page:
  url: /features/workflows/
   title: Custom Workflows
---

# Distill Pipeline
{: .fs-8 }

Full transparency into how ContextManager's AI agents process your interactions in the background.
{: .fs-5 .fw-300 }

---

## Overview

ContextManager runs three distillation pipelines that transform raw AI interactions into structured project knowledge. All pipelines are **user-triggered or rate-limited** — nothing runs without your awareness.

{: .important }
> Every distill pipeline uses the model configured in **Extraction Model** (`intelligence.autoLearn.modelFamily`). Choose a small/cheap model (e.g., GPT-4.1 Nano, Claude Haiku) to minimize cost. The dashboard shows a dynamic dropdown of all models available in your VS Code instance.

---

## Pipeline 1: Observation Distillation

**Trigger:** Manual ("🤖 Distill Observations" button) or automatic at compaction checkpoints  
**Input:** Up to 40 unprocessed observations from the circular buffer  
**Output:** Conventions, tool hints, and working notes  
**LLM calls:** 1 per run  
**Timeout:** 30 seconds

### Algorithm

```
1. Filter observations: only unprocessed (learningsExtracted = false), scoped to active project
2. Format each observation as a compact text block:
   [1] from:<participant> type:<type>
     Q: <prompt excerpt, 200 chars>
     A: <response excerpt, 200 chars>
     files: <up to 5 referenced files>
3. Send to LLM with extraction prompt (customizable via prompts.distillObservations setting)
4. Parse JSON response → { conventions[], toolHints[], workingNotes[] }
5. Cap at 5 items per category
6. Mark all input observations as learningsExtracted = true (prevents re-processing)
```

### What the LLM is asked to extract

| Category | What it captures | Example |
|:---------|:-----------------|:--------|
| **Conventions** | Coding patterns, file organization, naming rules specific to this codebase | "Use kebab-case for all API route files" |
| **Tool Hints** | Which search strategies, folders, and file patterns work for finding things | "Auth logic lives in src/middleware/auth/, search for 'jwt' or 'bearer'" |
| **Working Notes** | What the agent discovered about specific components/areas | "The payment service uses a saga pattern with compensating transactions" |

### Auto-Distill (Background)

When `autoDistill.enabled` is true, the same pipeline runs automatically at compaction checkpoints:

```
Guards:
  - autoDistill.enabled must be true
  - At least 4 observations in the last 2 hours for this project
  - Per-project rate limit: minimum intervalMinutes between runs (default 30)
    Each project has its own independent cooldown timer.
  
Behavior:
  - Runs distillObservations(40, projectId) 
  - Auto-saves up to 3 conventions and 3 working notes
  - Deduplicates against existing items by title (case-insensitive)
  - All auto-saved items get confidence = "inferred"
  - Logs to background tasks for audit trail
```

---

## Pipeline 2: Card Queue Distillation

**Trigger:** Manual ("Distill into Cards" button in Knowledge tab)  
**Input:** All queued card candidates (up to `cardQueue.maxSize`, default 30)  
**Output:** Knowledge card proposals with confidence scores  
**LLM calls:** ceil(candidates / batchSize) — up to 15 with a full queue (default batch size 2, max 30 candidates)  
**Timeout:** 60 seconds per batch

### Algorithm

```
1. Load all candidates from the card queue
2. Split into batches of distillBatchSize (default 2) candidates each
3. For each batch:
   a. Format full prompt + response text (NO truncation — full content preserved)
   b. Send to LLM with synthesis prompt (customizable via prompts.distillQueue setting)
   c. Parse JSON response → { cards[] } (each card includes tags)
   d. Accumulate cards, stopping at maxCardsPerDistill (default 12)
4. Return all accumulated card proposals to the UI
5. User reviews each proposal: title, category, content, tags, confidence %, reasoning, source indices
6. User clicks "Add Card" per proposal or "Approve All" to batch-create — tags are propagated through the entire approve chain
```

### Why batching matters

Each candidate can be thousands of tokens (full AI response). Sending all 30 candidates in one prompt would exceed most model context windows. Batching ensures:

- **No content truncation** — every response is sent in full to the LLM
- **Cross-response synthesis** — within each batch, the LLM can identify patterns across responses
- **Graceful degradation** — if one batch fails to parse, others still succeed
- **Budget control** — `maxCardsPerDistill` caps total output regardless of batch count

### What the LLM produces per card

| Field | Purpose |
|:------|:--------|
| `title` | Descriptive title (5–10 words) |
| `category` | architecture, pattern, convention, explanation, or note |
| `content` | **Full technical content** — code snippets, commands, file paths, config values, edge cases preserved verbatim |
| `tags` | 2–5 lowercase keywords for filtering and search (e.g., `["auth", "jwt", "middleware"]`) |
| `reasoning` | Which source response(s) this came from and why it's worth keeping |
| `confidence` | 0.0–1.0 score reflecting how reusable and project-specific this knowledge is |
| `sourceIndices` | Array of 1-based indices into the candidate list |

---

## Pipeline 3: Multi-Turn Extraction

**Trigger:** Automatic on PreCompact hook events (when Copilot compacts conversation history)  
**Input:** Array of user/assistant turn pairs from the compacted conversation  
**Output:** Conventions and working notes (saved directly, no user review)  
**LLM calls:** 1 per turn (iterative accumulator pattern)  
**Timeout:** 15 seconds per extraction call

### Algorithm

```
1. Receive turns[] from PreCompact hook entry
2. Initialize accumulators: { conventions: [], relationships: [] }
3. For each turn:
   a. Truncate user + assistant to 1500 chars each
   b. Send to LLM with:
      - The extraction prompt (CAPTURE_EXTRACTION_PROMPT)
      - "Learned so far: <accumulated JSON>"
      - "New turn: <user + assistant text>"
      - "Add NEW items only. No repeats."
   c. Merge new conventions/relationships into accumulators (dedup by title, case-insensitive)
4. After all turns processed:
   a. Save up to 5 conventions (validated: category must be in allowed set, title >= 5 chars, content >= 10 chars)
   b. Save up to 3 relationships as working notes
   c. All items saved with confidence = "inferred", source = "auto-captured from multi-turn PreCompact"
```

### The iterative accumulator pattern

This is the key design: rather than sending all turns at once (which would exceed context windows for long conversations), each turn is processed individually with the **accumulated state** passed forward. The LLM sees what was already found and only adds genuinely new insights.

```
Turn 1 → LLM("Learned: {}, Turn: ...") → {conventions: [A]}
Turn 2 → LLM("Learned: {A}, Turn: ...") → {conventions: [A, B]}  
Turn 3 → LLM("Learned: {A, B}, Turn: ...") → {conventions: [A, B, C]}
```

This approach:
- Handles conversations of any length
- Avoids duplicate extraction across turns
- Keeps each LLM call small and fast
- Naturally prioritizes patterns that appear across multiple turns

---

## Anchor Extraction (Post-Card)

After multi-turn extraction produces a knowledge card, an optional **anchor extraction** pass identifies code stubs that ground the card to specific files and line ranges.

```
1. For each card produced by multi-turn extraction:
   a. Scan turns for tool call results (file reads, search results)
   b. Send card content + tool results to LLM with ANCHOR_EXTRACTION_PROMPT
   c. LLM identifies which code snippets are "load-bearing" for the card
   d. Extract AnchorStub objects: { filePath, symbolName, startLine, endLine, stubContent }
2. Anchors are stored on the card and used for:
   - Staleness detection (if file changes, card may be stale)
   - Context grounding (when #getCard reads a card, anchors are verified against current file content)
```

---

## Prompt Customization

All three distill pipelines use customizable system prompts:

| Setting | Pipeline | What to customize |
|:--------|:---------|:------------------|
| `prompts.distillObservations` | Observation Distillation | What categories to extract, how many, filtering criteria |
| `prompts.distillQueue` | Card Queue Distillation | Card format, content preservation rules, confidence criteria |
| `prompts.synthesizeCard` | Dashboard "Synthesize" action | Single-card synthesis behavior |

Customization replaces only the **instruction** part of the prompt. The data (observations, candidates, source material) is always appended after your custom instructions.

{: .note }
> Leave empty to use the built-in defaults. The defaults are battle-tested and work well for most projects. Customize when you want to focus extraction on specific areas (e.g., "only extract security-related conventions") or change the output format.

---

## Data Flow Summary

{::nomarkdown}
<pre class="mermaid">
graph TD
    A[User chats with Copilot] --> B["Hook Scripts (all participants)"]
    B -- "capture.ps1 / capture.sh" --> C[append to hook-queue.jsonl]
    C --> D[HookWatcher]
    D -- "byte-offset tracking, dedup" --> E{Route by hookType}
    E --> F[Stop]
    E --> G[PostToolUse]
    E --> H[PreCompact]
    F --> I["Observe + Queue"]
    G --> J[Observe]
    H --> K["Multi-Turn Extraction (iterative)"]
    I --> L["Card Queue (staging)"]
    K --> M["Auto-save conventions + notes"]
    L --> N["User: Distill"]
    N --> O[Batch synthesis]
    O --> P[Review + Add]

    style A fill:#1f6feb,stroke:#388bfd,color:#fff
    style B fill:#9e6a03,stroke:#d29922,color:#fff
    style D fill:#1158c7,stroke:#388bfd,color:#fff
    style F fill:#238636,stroke:#3fb950,color:#fff
    style G fill:#238636,stroke:#3fb950,color:#fff
    style H fill:#238636,stroke:#3fb950,color:#fff
    style L fill:#1f6feb,stroke:#388bfd,color:#fff
    style M fill:#238636,stroke:#3fb950,color:#fff
    style P fill:#238636,stroke:#3fb950,color:#fff
</pre>
{:/nomarkdown}

---

## Cost & Performance

| Pipeline | LLM calls | Tokens per call | Frequency |
|:---------|:----------|:----------------|:----------|
| Observation Distill | 1 | ~2K input, ~500 output | Manual or every 30 min |
| Card Queue Distill | 2–5 | ~4K input, ~2K output per batch | Manual only |
| Multi-Turn Extract | N (one per turn) | ~500 input, ~300 output | On compaction events |
| Auto-Distill | 1 | ~2K input, ~500 output | Rate-limited, background |

All calls use the configured **Extraction Model**, which defaults to whatever is available. For minimal cost, set it to a small model — the extraction tasks are simple structured-output tasks that don't need frontier-class models.
