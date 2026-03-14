---
layout: default
title: Project Intelligence
parent: Features
nav_order: 1
---

# Project Intelligence
{: .fs-8 }

Automatically learns conventions, tool hints, and working notes from every AI interaction.
{: .fs-5 .fw-300 }

---

## Overview

The Project Intelligence layer is a three-part learning system that captures institutional knowledge as a side effect of normal work. Unlike knowledge cards (which are explicit), intelligence accumulates **automatically** from all chat participants.

{: .important }
> **Prerequisite for full auto-capture:** Register the VS Code agent hook once (Dashboard → Settings → **🪝 Agent Hooks** → **Install Hooks**). Without it, only interactions during your active chat sessions are captured. With it, every Copilot Chat, `@workspace`, and background agent response feeds the intelligence pipeline.

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

All intelligence is queryable via the `#ctx` tool. Agents invoke it when they need conventions, notes, hints, or queued card candidates. Available modes:

| Mode | Purpose |
|:-----|:--------|
| `#ctx query:"error handling"` | Full-text search across cards, conventions, notes |
| `#ctx mode:"list" type:"conventions"` | List all items of a type (`conventions`, `workingNotes`, `toolHints`, `cards`, `queue`) |
| `#ctx mode:"learn" learnType:"convention" ...` | Store a new convention, tool hint, or working note |
| `#ctx mode:"getCard" id:"<cardId>"` | Read the full content of a knowledge card |
| `#ctx mode:"getQueueItem" id:"<candidateId>"` | Read a queued card candidate in full |
| `#ctx mode:"approveQueueItem" id:"<candidateId>"` | Approve a queued item into a saved knowledge card |
| `#ctx mode:"distillQueue"` | Synthesize queued items into proposed knowledge cards |
| `#ctx mode:"fetch" observationIds:["<id>"]` | Fetch full observation details by IDs |
| `#ctx mode:"retrospect"` | End-of-task reflection and capture |

{: .tip }
Because delivery is on-demand, there are no token budgets to configure. Agents pull exactly the intelligence they need, when they need it.

---

## Auto-Capture

The Auto-Capture service records every AI response as a lightweight observation:

- **Source tracking** - which participant generated the response (Copilot, @workspace, hook, etc.)
- **Content-hash deduplication** - identical interactions are never recorded twice (30-second window)
- **Privacy tags** - `<private>content</private>` tags are stripped before storage
- **Type badges** - observations are classified internally (bugfix, feature, discovery, etc.) and shown as summary counts in the observations header

---

## Auto-Learn

When enabled, a lightweight LLM extraction runs on chat interactions to learn:

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

## Dashboard: Intelligence Tab

The Intelligence tab provides a unified view:

- **Auto-Capture / Auto-Learn toggles** with live stats
- **Observation feed** with per-source filter pills (Copilot, @workspace, hook)
- **Convention list** with confidence badges and confirm/edit/discard actions
- **Tool hints** with anti-patterns and delete actions
- **Working notes** with staleness badges, related files, and promote-to-card actions
- **AI Distill** - run LLM extraction on selected observations

---

## Next Steps

[Knowledge Cards →]({% link features/knowledge-cards.md %})
{: .fs-5 }
