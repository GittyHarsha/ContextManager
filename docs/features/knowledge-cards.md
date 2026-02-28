---
layout: default
title: Knowledge Cards
parent: Features
nav_order: 3
---

# Knowledge Cards
{: .fs-8 }

Persistent, structured AI memory that survives context window resets, session boundaries, and model switches.
{: .fs-5 .fw-300 }

---

## What Are Knowledge Cards?

Knowledge cards are structured notes - architecture decisions, coding conventions, discovered patterns, deep explanations - that you curate and select to automatically enhance all Copilot responses.

Unlike conversation history that disappears when the context window fills, knowledge cards live in your project database. They are injected at the start of every AI interaction.

---

## Creating Cards

### Automatically via the Card Queue (Recommended)

The lowest-friction path. ContextManager monitors all Copilot interactions and stages high-confidence knowledge in the **Card Queue** automatically. When you're ready:

1. Open the Dashboard → **Knowledge** tab → **Card Queue** section
2. Click **Distill into Cards** — one LLM call synthesizes all queued items
3. Review proposals and click **+ Add Card** for ones worth keeping

See [Card Queue]({% link features/card-queue.md %}) for details on the capture pipeline, smart-merge, and distillation.

### From the Dashboard

Open the Dashboard → Knowledge tab → **+ New Card**. Select a template:

| Template | Best For |
|:---------|:---------|
| General | Quick notes and insights |
| Architecture Decision Record | Design decisions with context and consequences |
| API Reference | Endpoints, parameters, return types |
| Debugging Guide | Common issues and their solutions |
| Code Pattern | Reusable patterns found in the codebase |
| Onboarding Note | Things a new developer needs to know |

### Manual Creation with `@ctx` Commands

Use these when you want to create a card immediately, on demand:

**Research & generate — `/knowledge`**
```
@ctx /knowledge Research the observer pattern in this codebase
```
The AI searches your codebase, reads relevant files, synthesizes findings, and creates a structured card.

**Answer + save — `/save`**
```
@ctx /save How does authentication work in this project?
```
This answers your question AND saves the response as a card. One command, two outcomes.

**Save last response — `/add`**
```
@ctx /add
```
Saves the most recent AI response in the current chat as a knowledge card.

---

## Refining Cards

Cards improve over time. Use AI to update them with fresh research:

```
@ctx /refine
```

The AI picks a card, researches your codebase for new information, and updates the card content - using workspace file access, tool-calling loops, and full project context.

{: .tip }
You can also select text on a card in the Dashboard, right-click → "Refine Selection with AI" for targeted updates.

---

## Card Categories

Each card is categorized for organization and filtering:

| Category | Icon | Purpose |
|:---------|:-----|:--------|
| `architecture` | 🏗️ | System design, component relationships |
| `pattern` | 🔄 | Reusable code patterns |
| `convention` | 📐 | Team coding standards |
| `explanation` | 📖 | Deep-dive explanations |
| `note` | 📝 | General working notes |
| `other` | 🔖 | Uncategorized or miscellaneous |

---

## Progressive Disclosure

Not all cards are injected equally. ContextManager uses a 3-tier system to optimize token usage:

| Tier | Cards | What's Injected | Tokens |
|:-----|:------|:-----------------|:-------|
| **Full** | Top 3 selected | Complete card content | up to ~2000 each |
| **Summary** | Cards 4–7 | 125-token summary + search pointer | ~125 each |
| **Metadata** | Cards 8+ | Title + category only | ~20 each |

This keeps prompt tokens under control while preserving access to all knowledge. The AI can always ask for the full content of any card via `#getCard` or `#searchCards`.

### copilot-instructions.md Managed Block

Cards marked **Pinned** or **Include in Context** have their titles listed in the auto-managed block inside `copilot-instructions.md`. This block also includes `#ctx` tool usage instructions, so agents know how to search for more:

- **Pinned cards** — titles listed in the managed block (always visible to all agents)
- **On demand** — any card is accessible via `#getCard` or `#searchCards` — agents can request full content when needed
- **Search** — `#ctx query:"topic"` searches across all cards, conventions, notes, and more

---

## Folders & Organization

Cards can be organized into a hierarchical folder structure:

- **Create folders** from the Dashboard Knowledge tab
- **Drag-and-drop** cards between folders
- **Nested folders** - folders can contain subfolders
- **Collapsible sections** - each folder collapses independently

{: .note }
New cards auto-assign to the best-matching folder based on content similarity.

---

## Card Flags

Three boolean flags control card behavior:

| Flag | Icon | Effect |
|:-----|:-----|:-------|
| **Pinned** | 📌 | Card appears at the top of the Knowledge tab |
| **Include in Context** | 👁 | Card is always included in AI prompts (bypasses selection) |
| **Archived** | 🗃 | Card is hidden from the main view |

---

## Staleness Detection

Cards not updated in 30+ days are flagged with ⚠️ in both the dashboard and during prompt injection. This signals to the AI that the information may be outdated and should be verified.

Use `@ctx /audit` to scan all cards for staleness - checking if referenced files still exist and flagging content that may be outdated.

---

## Card Health Dashboard

A collapsible analytics section in the Knowledge tab shows:

- **Total / Selected / Stale / Never-used** card counts
- **Top 5 most-used cards** by injection count
- **Duplicate detection** - Jaccard similarity ≥40% flags near-duplicate cards
- **Usage tracking** - selection count, injection count, last-selected timestamp

---

## Sharing & Export

### Git-Tracked Markdown

Export cards as `.md` files with YAML frontmatter to `.contextmanager/cards/`:

```yaml
---
title: Authentication Flow
category: architecture
createdAt: 2026-02-15
---

The authentication system uses JWT tokens with...
```

A new team member clones the repo, imports the folder, and immediately has the team's accumulated knowledge.

### Import from Markdown

Recursively import `.md` files from any directory as knowledge cards with auto-folder assignment.

### Staleness Indicators

Cards in the dashboard show staleness at a glance:

- **⚠️ File-stale** — Anchor files or reference files have been modified since the card was last updated. The card content may no longer be accurate.
- **⏳ Age-stale** — The card hasn't been updated in N days (configurable via `stalenessAgeDays`, default 30). Consider reviewing.

Staleness checks run automatically when the dashboard opens and on every file save.

---

## Next Steps

[Project Intelligence →]({% link features/project-intelligence.md %})
{: .fs-5 }
