---
layout: default
title: Project Intelligence
parent: Features
nav_order: 1
---

# Project Intelligence
{: .fs-8 }

Automatically learns conventions, tool hints, and working notes from every AI interaction - not just `@ctx`.
{: .fs-5 .fw-300 }

---

## Overview

The Project Intelligence layer is a three-part learning system that captures institutional knowledge as a side effect of normal work. Unlike knowledge cards (which are explicit), intelligence accumulates **automatically** from all chat participants.

{: .important }
> **Prerequisite for full auto-capture:** Register the VS Code agent hook once (Dashboard → Settings → **Copy hook install command**). Without it, only `@ctx` interactions are captured. With it, every Copilot Chat, `@workspace`, and background agent response feeds the intelligence pipeline.

---

## Three Stores of Intelligence

### 1. Conventions

Structured codebase conventions with confidence tracking:

| Field | Description |
|:------|:------------|
| **Subject** | What the convention covers (e.g., "error handling") |
| **Category** | `architecture`, `naming`, `patterns`, `testing`, `tooling`, `pitfalls` |
| **Content** | The convention itself |
| **Confidence** | `confirmed` ✅, `observed` ⏳, or `inferred` 🔮 |

Conventions start as `observed` when the LLM first extracts them. You can confirm or discard them from the Intelligence tab.

**Example:**
> **Naming → confirmed**: All React components use PascalCase with a `.tsx` extension. Utility functions use camelCase in `.ts` files.

### 2. Tool Hints

Learned search patterns that help the AI navigate your specific codebase:

```
✅ Pattern: Search "TabStripController" not "tab strip controller"
❌ Anti-pattern: "tab strip" returns noise from CSS files
```

Tool hints track **use count** - frequently used hints are prioritized in injection.

### 3. Working Notes

Free-form agent exploration memory for relationships and insights:

| Field | Description |
|:------|:------------|
| **Title** | What the note covers |
| **Content** | Markdown content |
| **Related Files** | Files associated with this note |
| **Related Symbols** | Code symbols referenced |
| **Staleness** | `fresh`, `possibly-stale`, `stale` (file-based tracking) |

Working notes now have **file-based staleness detection**, displayed as 🟢 fresh → ⚠️ possibly-stale → 🔴 stale. Staleness is detected by comparing `relatedFiles` modification times against the note's last update timestamp. Checks run on dashboard open and on file save (debounced 2 s). Controlled by the `enableStalenessTracking` setting.

Working notes are matched by file path and keyword when queried via `#ctx` - only task-relevant notes are returned.

---

## Intelligence Delivery

Intelligence is delivered through two complementary mechanisms — no per-prompt injection budgets to tune.

### Managed Block in `copilot-instructions.md`

ContextManager maintains an **auto-synced managed block** at the bottom of your `.github/copilot-instructions.md` file. This block contains:

- **`#ctx` tool usage instructions** — so every agent knows how to invoke the tool
- **Pinned knowledge card titles** — cards flagged **Pinned** appear as summary lines with their IDs, prompting agents to call `#getCard` when relevant

The managed block is regenerated whenever pinned cards change. You never edit it by hand.

### `#ctx` Tool (On-Demand)

All intelligence is queryable via the `#ctx` tool. Agents invoke it when they need conventions, notes, or hints. Available modes:

| Mode | Purpose |
|:-----|:--------|
| `#ctx query:"error handling"` | Full-text search across cards, conventions, notes |
| `#ctx mode:"list" type:"conventions"` | List all items of a type (`conventions`, `workingNotes`, `toolHints`, `cards`) |
| `#ctx mode:"learn" learnType:"convention" ...` | Store a new convention, tool hint, or working note |
| `#ctx mode:"getCard" id:"<cardId>"` | Read the full content of a knowledge card |
| `#ctx mode:"timeline" observationId:"<id>"` | Observation timeline context around an anchor |
| `#ctx mode:"fetch" observationIds:["<id>"]` | Fetch full observation details by IDs |
| `#ctx mode:"economics"` | Token economics stats |
| `#ctx mode:"retrospect"` | End-of-task reflection and capture |

{: .tip }
Because delivery is on-demand, there are no token budgets to configure. Agents pull exactly the intelligence they need, when they need it.

---

## Auto-Capture

The Auto-Capture service records every AI response as a lightweight observation:

- **Source tracking** - which participant generated the response (Copilot, @workspace, @ctx, etc.)
- **Content-hash deduplication** - identical interactions are never recorded twice (30-second window)
- **Privacy tags** - `<private>content</private>` tags are stripped before storage
- **Token economics** - tracks `discoveryTokens` (original cost) vs `readTokens` (compressed cost)
- **Typed observations** - classified as bugfix 🔴, feature 🟣, discovery 🔵, decision ⚖️, refactor 🔄, or change ✅

### Observation Types

| Type | Emoji | Trigger Keywords |
|:-----|:------|:-----------------|
| Bugfix | 🔴 | fix, bug, error, crash, broken, issue, regression, patch, hotfix |
| Feature | 🟣 | add, implement, create, new feature, build, introduce, support for |
| Refactor | 🔄 | refactor, restructure, reorganize, clean up, rename, extract, move to, split into |
| Decision | ⚖️ | should we, trade-off, decision, chose, approach, alternative, pros and cons, why did, rationale |
| Discovery | 🔵 | how does, what is, explain, understand, investigate, look into, find out, where is, search for |
| Change | ✅ | _(default fallback — no specific keywords)_ |

---

## Auto-Learn

When enabled, a lightweight LLM extraction runs on non-`@ctx` interactions to learn:

- **Conventions** - coding patterns the AI observes in your codebase
- **Working notes** - relationships and insights discovered during exploration
- **Tool hints** - which search terms work and which don't
- **Knowledge cards** - high-confidence cards extracted from conversation context

This means even regular Copilot Chat conversations contribute to your project intelligence.

{: .note }
Auto-Learn fires **one LLM call per captured response** (a small number of tokens per call). This is inexpensive but not free. Disable via `intelligence.autoLearn` in Settings or the Intelligence tab toggle — Auto-Capture (observation recording) continues without it.

{: .note }
Knowledge cards and architecture notes detected by Auto-Capture / Auto-Learn are **staged in the Card Queue** for user review — they are never silently persisted. You remain in full control of what enters your knowledge base.

---

## Session Continuity

ContextManager provides session continuity through two channels:

1. **`copilot-instructions.md` managed block** — pinned card titles and `#ctx` instructions are always visible to the agent, giving it awareness of your project's key conventions and architecture from the first message.
2. **`#ctx` tool** — agents can call `#ctx query:"..."` or `#ctx mode:"getCard" id:"..."` to retrieve prior session context, working notes, and branch state on demand.

{: .note }
Session continuity means the AI never "starts from scratch" - even if you close VS Code and come back the next day.

---

## `@ctx /done` - End-of-Task Retrospective

Run this at the end of a task to capture structured learnings:

```
@ctx /done
```

The retrospective:
1. Extracts outcome summary
2. Calls `retrospect` internally to capture:
   - What worked and what didn't
   - New conventions to add
   - Tool hints worth keeping
   - Knowledge cards to create

---

## Dashboard: Intelligence Tab

The Intelligence tab provides a unified view:

- **Auto-Capture / Auto-Learn toggles** with live stats
- **Observation feed** with per-source filter pills (Copilot, @workspace, @ctx, hook)
- **Convention list** with confidence badges and confirm/edit/discard actions
- **Tool hints** with anti-patterns and delete actions
- **Working notes** with staleness badges, related files, and promote-to-card actions
- **Token Economics** widget showing ROI across all observations
- **AI Distill** - run LLM extraction on selected observations

---

## Next Steps

[Chat Participant →]({% link features/chat-participant.md %})
{: .fs-5 }
