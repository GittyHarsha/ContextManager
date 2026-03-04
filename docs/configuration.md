---
layout: default
title: Configuration
nav_order: 6
---

# Configuration
{: .fs-9 }

All settings are accessible from the **⚙ Settings** tab in the Dashboard or via VS Code's settings JSON.
{: .fs-6 .fw-300 }

---

## General

| Setting | Default | Description |
|:--------|:--------|:------------|
| `contextManager.showStatusBar` | `true` | Show active project in the status bar |
| `contextManager.confirmDelete` | `true` | Confirmation dialog before deleting items |
| `contextManager.maxKnowledgeCardsInContext` | `10` | Maximum cards to include in AI prompts (1–20) |

---

## Auto-Capture

| Setting | Default | Description |
|:--------|:--------|:------------|
| `contextManager.autoCapture.enabled` | `true` | Enable automatic observation recording |
| `contextManager.autoCapture.learnFromAllParticipants` | `true` | Learn from all chat participant interactions |
| `contextManager.autoCapture.maxObservations` | `50` | Max observations in circular buffer |

---

## Auto-Distill

| Setting | Default | Description |
|:--------|:--------|:------------|
| `contextManager.autoDistill.enabled` | `true` | Automatically distill observations into conventions and knowledge cards at compaction checkpoints |
| `contextManager.autoDistill.intervalMinutes` | `30` | Minimum minutes between automatic distillation runs per project |
| `contextManager.autoDistill.dedupThreshold` | `0.8` | Jaccard similarity threshold for duplicate detection (0.5–1.0) |

---

## Project Intelligence

| Setting | Default | Description |
|:--------|:--------|:------------|
| `contextManager.intelligence.enableTieredInjection` | `true` | Auto-inject conventions and top tool hints into every chat prompt (Tier 1+2) |
| `contextManager.intelligence.enableStalenessTracking` | `true` | File-based staleness tracking on working notes and knowledge cards |
| `contextManager.intelligence.stalenessAgeDays` | `30` | Days before knowledge cards are flagged as age-stale (7–365) |
| `contextManager.intelligence.tier1MaxTokens` | `400` | Token budget for Tier 1 (always-injected) learnings (100–1000) |
| `contextManager.intelligence.tier2MaxTokens` | `400` | Token budget for Tier 2 (task-relevant) learnings (100–1000) |

### Auto-Learn

| Setting | Default | Description |
|:--------|:--------|:------------|
| `contextManager.intelligence.autoLearn` | `true` | Enable the auto-learning pipeline |
| `contextManager.intelligence.autoLearn.useLLM` | `true` | Use lightweight LLM call for extraction instead of regex-only |
| `contextManager.intelligence.autoLearn.modelFamily` | _(auto)_ | Preferred model family for auto-learn LLM extraction (dynamic dropdown in dashboard) |
| `contextManager.intelligence.autoLearn.showInChat` | `true` | Show auto-learn results as a notification toast |
| `contextManager.intelligence.autoLearn.extractConventions` | `true` | Extract conventions from response text |
| `contextManager.intelligence.autoLearn.extractToolHints` | `true` | Extract tool hints from search fail→success patterns |
| `contextManager.intelligence.autoLearn.extractWorkingNotes` | `true` | Extract working notes from file co-access patterns |
| `contextManager.intelligence.autoLearn.conventionsPerRun` | `1` | Max conventions to extract per interaction |
| `contextManager.intelligence.autoLearn.hintsPerRun` | `3` | Max tool hints to extract per interaction |
| `contextManager.intelligence.autoLearn.notesPerRun` | `2` | Max working notes to extract per interaction |
| `contextManager.intelligence.autoLearn.maxConventions` | `15` | Max inferred conventions per project |
| `contextManager.intelligence.autoLearn.maxToolHints` | `20` | Max tool hints per project |
| `contextManager.intelligence.autoLearn.maxWorkingNotes` | `30` | Max inferred working notes per project |
| `contextManager.intelligence.autoLearn.expiryDays` | `0` | Auto-expire inferred learnings after N days (0 = disabled) |
| `contextManager.intelligence.autoLearn.discardThreshold` | `5` | Suppress a category after N discards (0 = disabled) |

### Intelligence Injection

| Setting | Default | Description |
|:--------|:--------|:------------|
| `contextManager.intelligence.injectConventions` | `true` | Include conventions in auto-injected context |
| `contextManager.intelligence.injectToolHints` | `true` | Include tool hints in auto-injected context |
| `contextManager.intelligence.injectWorkingNotes` | `true` | Include working notes in auto-injected context |
| `contextManager.intelligence.injectKnowledgeCards` | `true` | Include knowledge cards in auto-injected context |

---

## Card Queue

| Setting | Default | Description |
|:--------|:--------|:------------|
| `contextManager.cardQueue.enabled` | `true` | Enable automatic response queuing |
| `contextManager.cardQueue.minResponseLength` | `300` | Min response length to queue (50–5000) |
| `contextManager.cardQueue.distillBatchSize` | `2` | Candidates processed per LLM call during distillation |
| `contextManager.cardQueue.maxCardsPerDistill` | `12` | Max knowledge cards to extract per distill run |
| `contextManager.cardQueue.maxSize` | `30` | Max candidates in the review queue |

---

## Prompt Customization

Customize the system prompts used by the distill pipelines. Leave empty to use defaults.

| Setting | Default | Description |
|:--------|:--------|:------------|
| `contextManager.prompts.globalInstructions` | _(empty)_ | Global custom instructions appended to all prompts |
| `contextManager.prompts.distillObservations` | _(built-in)_ | System prompt for distilling observations into conventions, tool hints, and working notes |
| `contextManager.prompts.distillQueue` | _(built-in)_ | System prompt for synthesizing card queue candidates into knowledge cards |
| `contextManager.prompts.synthesizeCard` | _(built-in)_ | System prompt for the dashboard's "Synthesize Card" action |

---

## Search

| Setting | Default | Description |
|:--------|:--------|:------------|
| `contextManager.search.enableFTS` | `true` | Enable BM25 full-text search |
| `contextManager.search.maxCardResults` | `5` | Max results for card search |
| `contextManager.search.maxSearchResults` | `10` | Max results for cross-entity search |
| `contextManager.search.snippetTokens` | `16` | Snippet preview size in tokens |

---

## Explanations

| Setting | Default | Description |
|:--------|:--------|:------------|
| `contextManager.explanation.expandContext` | `true` | Expand surrounding code when explaining |

---

## Context

| Setting | Default | Description |
|:--------|:--------|:------------|
| `contextManager.context.stubLines` | `5` | Lines of code captured per anchor stub for knowledge cards |

---

## Save As Card

| Setting | Default | Description |
|:--------|:--------|:------------|
| `contextManager.saveAsCard.smartMerge` | `true` | Enable smart merge detection when saving knowledge cards |

---

## Tools

| Setting | Default | Description |
|:--------|:--------|:------------|
| `contextManager.tools.backgroundMode` | `true` | Run save/search/read tools silently without confirmation dialogs |

---

## Experimental

| Setting | Default | Description |
|:--------|:--------|:------------|
| `contextManager.experimental.enableProposedApi` | `false` | Enable proposed VS Code APIs for enhanced features like Smart Select embeddings. Requires VS Code Insiders. |
