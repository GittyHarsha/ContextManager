---
layout: default
title: Language Model Tools
parent: Features
nav_order: 8
---

# Language Model Tools
{: .fs-8 }

11 tools registered via `vscode.lm.registerTool` — available to **all** agents, not just `@ctx`.
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
| `retrospect` | End-of-task structured learning capture (conventions, tool hints, knowledge cards). |
| `timeline` | Observation timeline — progressive disclosure of observation context. |
| `fetch` | Fetch full observation details by ID. |
| `economics` | Token economics stats. |

**Examples:**

```
#ctx mode:search query:"auth" entityTypes:["convention","workingNote"]
#ctx mode:list type:conventions
#ctx mode:learn learnType:convention category:patterns title:"Error handling" content:"Always use Result<T>"
#ctx mode:retrospect taskSummary:"Refactored auth module"
```

---

### `#searchCards` — Knowledge Card Search

**Tool ID:** `contextManager_semanticSearch`

Embedding-based similarity search across knowledge cards with full content retrieval. Falls back to BM25 keyword search when embeddings are unavailable.

```
#searchCards query:"authentication flow"
```

---

### `#getCard` — Read a Specific Card

**Tool ID:** `contextManager_getCard`

Read a knowledge card by ID with full content, anchors, and staleness warnings. Runs immediately without confirmation (read-only).

---

### `#saveCard` — Save a Knowledge Card

**Tool ID:** `contextManager_saveKnowledgeCard`

Silently saves a knowledge card to the active project. Accepts title, content (markdown), optional category, tags, source, and folder name.

---

### `#editCard` — Edit a Knowledge Card

**Tool ID:** `contextManager_editKnowledgeCard`

Updates fields on an existing knowledge card. Only supplied fields are changed — omitted fields are left as-is.

---

### `#organizeCards` — Organize Knowledge Cards

**Tool ID:** `contextManager_organizeKnowledgeCards`

Organizes cards into folders. Actions: `listFolders`, `createFolder`, `moveCard`, `autoOrganize`.

---

### `#saveCache` — Save a Cache Entry

**Tool ID:** `contextManager_saveCache`

Silently saves a code explanation or analysis note to the cache. Entries are searchable by symbol name.

---

### `#searchCache` — Search Cache Entries

**Tool ID:** `contextManager_searchCache`

Searches cached code explanations and notes by keyword or symbol name.

---

### `#readCache` — Read a Cache Entry

**Tool ID:** `contextManager_readCache`

Reads a specific cached explanation in full by ID or symbol name.

---

### `#editCache` — Edit a Cache Entry

**Tool ID:** `contextManager_editCache`

Updates an existing cache entry's content and/or symbol name by its ID.

---

### `#ctxSubagent` — Autonomous Task Delegation

**Tool ID:** `contextManager_runSubagent`

Launch an autonomous subagent with its own tool-calling loop in an isolated context window.

| Task Type | What It Does |
|:----------|:-------------|
| `executeTodo` | Research and implement a TODO item |
| `generateKnowledge` | Research a topic, create a knowledge card |
| `refineKnowledge` | Improve an existing card with fresh research |
| `research` | General codebase research |
| `analyzeCode` | Deep code analysis — patterns, architecture, relationships |

The subagent gets pre-filled context (project state, card content, TODO details) so it starts working immediately.

**Settings:**
- `subagent.enabled` — enable/disable (default: `true`)
- `subagent.maxIterations` — max tool-calling iterations (default: `50`)
- `subagent.modelFamily` — preferred model family

---

## Auto-Invocation

Copilot can auto-invoke tools based on your question context. For example:

```
"How does the auth module work?"
→ Copilot may auto-invoke #ctx to search your conventions and knowledge cards about auth
```

This works because tools are registered with `disambiguation` entries that describe when they're relevant. The `#ctx` tool is the primary entry point — its broad tag set (`search`, `conventions`, `notes`, `hints`, `knowledge`, `intelligence`, `memory`, `learn`) makes it the most likely auto-invocation target.

---

## Proposed API Tools

These tools auto-activate on VS Code Insiders and gracefully degrade on stable:

| Feature | API | Description |
|:--------|:----|:------------|
| Chat Status Item | `chatStatusItem` | Shows project name, card count in chat panel |
| Participant Variables | `participantVariableProvider` | `#projectInfo`, `#knowledgeCards`, `#card:<title>` |
| Tool Progress | `beginToolInvocation` | Rich progress indicators during tool loops |
| Chat Sessions | `chatSessionsProvider` | TODO agent runs as browsable chat sessions |
| MCP Server | `mcpServerDefinitions` | Lists available MCP servers in `/context` |

---

## Next Steps

[Architecture →]({% link architecture/overview.md %})
{: .fs-5 }
