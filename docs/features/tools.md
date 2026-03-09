---
layout: default
title: Language Model Tools
parent: Features
nav_order: 8
---

# Language Model Tools
{: .fs-8 }

5 tools registered via `vscode.lm.registerTool` — available to **all** agents.
{: .fs-5 .fw-300 }

---

## Overview

ContextManager's tools are available in any Copilot Chat, to background agents, cloud agents, and Codex. Type the `#reference` in chat or the agent can auto-invoke them based on your question.

Project intelligence is delivered via two channels:
1. **`copilot-instructions.md` managed block** — minimal `#ctx` usage instructions plus pinned card titles, injected automatically.
2. **`#ctx` tool** — agents invoke it on demand for search, learning, and observation context.

---

## Tool Reference

### `#ctx` — Unified Project Memory
{: .text-purple-000 }

**Tool ID:** `contextManager_ctx`

The primary tool for all project knowledge operations. Replaces the former `#search`, `#projectContext`, `#projectIntelligence`, and `#branchContext` tools with a single multi-mode interface.

```
#ctx query:"error handling"
```

**Modes:**

| Mode | Description |
|:-----|:------------|
| `search` | BM25 search across all entity types: cards, conventions, workingNotes, toolHints, cache, observations, sessions, agentMessages, projects. Default mode. |
| `list` | List all items of a type: `conventions`, `toolHints`, `workingNotes`, or `cards`. |
| `learn` | Create new intelligence: `convention`, `toolHint`, or `workingNote`. |
| `getCard` | Read a knowledge card by ID. |
| `retrospect` | End-of-task structured learning capture. Accepts arrays of `newConventions`, `newToolHints`, and `knowledgeCards` extracted from the task, plus optional `taskSummary` / `whatWorked` / `whatDidntWork` notes. Persists all items to the active project in one call. |
| `fetch` | Fetch full observation details by ID. |

**Examples:**

```
#ctx mode:search query:"auth" entityTypes:["convention","workingNote"]
#ctx mode:list type:conventions
#ctx mode:learn learnType:convention category:patterns title:"Error handling" content:"Always use Result<T>"
#ctx mode:retrospect taskSummary:"Refactored auth module"
```

---

### `#getCard` — Read a Specific Card

**Tool ID:** `contextManager_getCard`

Read a knowledge card by ID with full content, anchors, and staleness warnings. Runs immediately without confirmation (read-only).

---

### `#saveCard` — Save a Knowledge Card

**Tool ID:** `contextManager_saveKnowledgeCard`

Creates cards, lists knowledge folders, or creates folders from chat. The save flow accepts markdown content plus optional category, tags, source, and folder controls (`folderMode`, `folderName`, `createFolderIfMissing`).

**Examples:**

```
#saveCard title:"Authentication Flow" content:"# Authentication Flow\nUses JWT..." folderMode:"named-folder" folderName:"Security"
#saveCard action:"listFolders"
#saveCard action:"createFolder" folderName:"Runbooks" parentFolderName:"Operations"
```

---

### `#editCard` — Edit a Knowledge Card

**Tool ID:** `contextManager_editKnowledgeCard`

Updates fields on an existing knowledge card. Only supplied fields are changed — omitted fields are left as-is.

---

### `#organizeCards` — Organize Knowledge Cards

**Tool ID:** `contextManager_organizeKnowledgeCards`

Organizes existing cards into folders. Actions: `listFolders`, `createFolder`, `moveCard`, `autoOrganize`.

---

## Auto-Invocation

Copilot can auto-invoke tools based on your question context. For example:

```
"How does the auth module work?"
→ Copilot may auto-invoke #ctx to search your conventions and knowledge cards about auth
```

This works because tools are registered with `disambiguation` entries that describe when they're relevant. The `#ctx` tool is the primary entry point — its broad tag set (`search`, `conventions`, `notes`, `hints`, `knowledge`, `intelligence`, `memory`, `learn`) makes it the most likely auto-invocation target.

---

## Next Steps

[Architecture →]({% link architecture/overview.md %})
{: .fs-5 }
