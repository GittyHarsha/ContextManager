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

Unlike conversation history that disappears when the context window fills, knowledge cards live in your project database. Cards checked (selected) in the Knowledge tab are automatically injected into every Copilot prompt via the agent hook system.

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

### Generate with AI

Click **Generate with AI** in the Knowledge tab to create a card from a topic prompt. This uses the VS Code Language Model API directly (`vscode.lm.selectChatModels()`):

1. Enter a topic (e.g., "authentication flow", "error handling patterns")
2. The LLM researches your existing cards to avoid duplication
3. A cancellable progress notification tracks generation
4. The resulting card is saved directly to your knowledge base

Uses the active Copilot Chat model for that chat session.

### AI Synthesis with Custom Prompt

Select one or more items in the card queue and click **✨ AI Synthesize**. The editor panel opens with:

- A **custom prompt** textarea where you can provide specific instructions (e.g., "Focus on security implications", "Write as an onboarding guide")
- Click **✨ AI Draft** to generate the card

If no custom prompt is provided, the default synthesis prompt is used. Custom prompts are injected as a `## User's Custom Instructions` section in the LLM prompt, between the system instructions and the source material.

AI Draft / Synthesize uses the dedicated **Card Synthesis Model** setting (`knowledgeCards.synthesisModelFamily`) when set.

### From Copilot Chat with Tools

Use Language Model Tools when you want to create a card immediately from a chat session:

**Save a new card — `#saveCard`**
```
#saveCard title:"Authentication Flow" content:"The auth system uses JWT..." category:"architecture"
```

**List or create folders from chat — `#saveCard`**
```
#saveCard action:"listFolders"
#saveCard action:"createFolder" folderName:"Security" parentFolderName:"Architecture"
#saveCard title:"Authentication Flow" content:"# Authentication Flow\nThe auth system uses JWT..." folderMode:"named-folder" folderName:"Security"
```

**Edit an existing card — `#editCard`**
```
#editCard id:"card-id" content:"Updated content..."
```

**Organize cards into folders — `#organizeCards`**
```
#organizeCards
```

---

## Refining Cards

Cards improve over time. Use the dashboard to refine them:

1. Open the Dashboard → **Knowledge** tab
2. Click **Edit** on any card to modify content directly
3. Right-click a card → **Refine with AI** for AI-assisted updates

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

### Tags

Cards can have **tags** — 2–5 lowercase keywords for filtering and search. Tags are:

- **Auto-generated** by the LLM when cards are created via the distill pipeline or AI synthesis
- **Editable** in the card editor
- **Propagated** through the full distill → approve chain (individual and batch approval)

---

## Progressive Disclosure

Not all cards are injected equally. ContextManager uses a 3-tier system to optimize token usage:

| Tier | Cards | What's Injected | Tokens |
|:-----|:------|:-----------------|:-------|
| **Full** | Top 3 selected | Complete card content | up to ~2000 each |
| **Summary** | Cards 4–7 | 125-token summary + search pointer | ~125 each |
| **Metadata** | Cards 8+ | Title + category only | ~20 each |

This keeps prompt tokens under control while preserving access to all knowledge. The AI can always find a card with `#ctx` and then open the full content with `#getCard`.

### copilot-instructions.md Managed Block

Cards marked **Pinned** have their titles listed in the auto-managed block inside `copilot-instructions.md`. This block also includes `#ctx` tool usage instructions, so agents know how to search for more:

- **Pinned cards** — titles listed in the managed block (always visible to all agents)
- **On demand** — any card is accessible via `#ctx` and `#getCard` — agents can request full content when needed
- **Search** — `#ctx query:"topic"` searches across all cards, conventions, notes, and more

### Hook Injection via Knowledge Tab Selection

Cards checked in the Knowledge tab are included in the `session-context.txt` file that the `UserPromptSubmit` hook reads. This means selected cards are injected as a system message into **every** Copilot prompt. The dashboard's "Inject into Every Prompt" section lets you optionally add a custom instruction and toggle full card content inclusion. Archived cards are automatically excluded.

---

## Folders & Organization

Cards can be organized into a hierarchical folder structure:

- **Create folders** from the Dashboard Knowledge tab
- **Drag-and-drop** cards between folders
- **Nested folders** - folders can contain subfolders
- **Collapsible sections** - each folder collapses independently

{: .note }
New cards auto-assign to the best-matching folder based on content similarity.

You can also list folders, create folders, or save directly into a named folder from Copilot Chat with `#saveCard`.

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

[Search →]({% link features/search.md %})
{: .fs-5 }
