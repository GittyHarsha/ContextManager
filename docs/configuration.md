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
| `contextManager.autoSelectKnowledgeCards` | `false` | Auto-select relevant cards based on context |
| `contextManager.maxKnowledgeCardsInContext` | `5` | Maximum cards to include in AI prompts (1–20) |
| `contextManager.cacheExpiration` | `30` | Days to keep cached explanations (0 = never) |
| `contextManager.enableContextByDefault` | `true` | Auto-enable context for new projects |

---

## Chat

| Setting | Default | Description |
|:--------|:--------|:------------|
| `contextManager.chat.includeCopilotInstructions` | `true` | Include `.github/copilot-instructions.md` |
| `contextManager.chat.includeReadme` | `true` | Include README.md in project context |

---

## Auto-Capture

| Setting | Default | Description |
|:--------|:--------|:------------|
| `contextManager.autoCapture.enabled` | `true` | Enable automatic observation recording |
| `contextManager.autoCapture.learnFromAllParticipants` | `true` | Learn from non-@ctx interactions |
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
| `contextManager.intelligence.enableTieredInjection` | `true` | Sync intelligence to copilot-instructions.md |
| `contextManager.intelligence.enableStalenessTracking` | `true` | File-based staleness tracking on working notes and knowledge cards |
| `contextManager.intelligence.stalenessAgeDays` | `30` | Days before knowledge cards are flagged as age-stale (7–365) |
| `contextManager.intelligence.tier1MaxTokens` | `400` | Token budget for Tier 1 (always-injected) learnings |
| `contextManager.intelligence.tier2MaxTokens` | `400` | Token budget for Tier 2 (task-relevant) learnings |

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
| `contextManager.intelligence.injectIntoAllParticipants` | `true` | Inject intelligence into all chat participants |
| `contextManager.intelligence.injectConventions` | `true` | Include conventions in auto-injected context |
| `contextManager.intelligence.injectToolHints` | `true` | Include tool hints in auto-injected context |
| `contextManager.intelligence.injectWorkingNotes` | `true` | Include working notes in auto-injected context |
| `contextManager.intelligence.injectKnowledgeCards` | `true` | Include knowledge cards in auto-injected context |
| `contextManager.intelligence.injectionMaxChars` | `0` | Max characters injected per prompt (0 = unlimited) |

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

Customize the system prompts used by the distiller agents. Leave empty to use defaults.

| Setting | Default | Description |
|:--------|:--------|:------------|
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

## Subagent

| Setting | Default | Description |
|:--------|:--------|:------------|
| `contextManager.subagent.enabled` | `true` | Enable the subagent tool |
| `contextManager.subagent.maxIterations` | `50` | Max tool-calling iterations per run (10–200) |
| `contextManager.subagent.modelFamily` | _(auto)_ | Preferred model family |

---

## Explanations

| Setting | Default | Description |
|:--------|:--------|:------------|
| `contextManager.explanation.expandContext` | `true` | Expand surrounding code when explaining |
| `contextManager.explanation.includeReferences` | `true` | Include file references |

---

## Context

| Setting | Default | Description |
|:--------|:--------|:------------|
| `contextManager.context.autoDeselectAfterUse` | `false` | Deselect cards/cache after use |
| `contextManager.context.stubLines` | `5` | Lines of code captured per anchor stub for knowledge cards |

---

## Dashboard

| Setting | Default | Description |
|:--------|:--------|:------------|
| `contextManager.dashboard.defaultTab` | `"overview"` | Tab shown when dashboard opens |
| `contextManager.notifications.showProgress` | `true` | Show progress notifications |

---

## Save As Card

| Setting | Default | Description |
|:--------|:--------|:------------|
| `contextManager.saveAsCard.showFollowups` | `true` | Show 'Save as Knowledge Card' follow-up buttons after @ctx commands |
| `contextManager.saveAsCard.smartMerge` | `true` | Enable smart merge detection when saving knowledge cards |

---

## Tools

| Setting | Default | Description |
|:--------|:--------|:------------|
| `contextManager.tools.backgroundMode` | `true` | Run save/search/read tools silently without confirmation dialogs |

---

## Custom Prompts

Override default system prompts for any command:

| Setting | Default |
|:--------|:--------|
| `contextManager.prompts.chat` | _(built-in)_ |
| `contextManager.prompts.explain` | _(built-in)_ |
| `contextManager.prompts.usage` | _(built-in)_ |
| `contextManager.prompts.relationships` | _(built-in)_ |
| `contextManager.prompts.research` | _(built-in)_ |
| `contextManager.prompts.refine` | _(built-in)_ |
| `contextManager.prompts.globalInstructions` | _(built-in)_ |

Set to an empty string to use the built-in default.
