---
layout: default
title: FAQ
nav_order: 7
---

# Frequently Asked Questions
{: .fs-9 }

---

## General

### How is this different from `.github/copilot-instructions.md`?

They complement each other. ContextManager now auto-syncs a managed block **into** your `.github/copilot-instructions.md` containing `#ctx` tool discovery instructions and pinned card titles. The instruction file provides the always-on baseline (VS Code includes it in every prompt), while ContextManager adds structured, selectable, taggable knowledge cards with per-project organization, a learning intelligence layer, BM25 search, and a full dashboard. Instruction files describe rules; ContextManager records the reasoning behind them.

### Does my context persist across VS Code restarts?

Yes. All data (projects, knowledge cards, intelligence, observations) is stored on disk in JSON files. Nothing is lost when VS Code restarts or the context window resets.

### Can Copilot see my context without any special commands?

Yes. ContextManager auto-syncs a managed block into `.github/copilot-instructions.md` with `#ctx` tool discovery instructions and pinned card titles — VS Code always includes this file, so every agent starts informed. Type `#ctx` in any Copilot Chat query for on-demand access to all project knowledge. All 6 Language Model Tools are available to background agents, cloud agents, and Codex.

### Is my data sent anywhere?

Project data (cards, intelligence, observations) is stored locally. The only external communication is standard VS Code language model API calls - the same API Copilot Chat uses for any conversation. No data is sent to ContextManager-specific servers.

---

## Knowledge Cards

### How many cards can I have?

There's no hard limit on the number of cards. The `maxKnowledgeCardsInContext` setting (default: 10) controls how many are injected into AI prompts, not how many you can create.

### Do all cards go into every prompt?

No. **Selected cards** (checked in the Knowledge tab) are injected into every prompt via the agent hook system. **Pinned cards** also have their titles in the `copilot-instructions.md` managed block. For additional cards, agents can search on demand via `#ctx` or `#searchCards`. Archived cards are automatically excluded from injection.

### How do I share cards with my team?

Export cards as git-tracked Markdown files to `.contextmanager/cards/`. Team members clone the repo and import the folder. Use "Export Cards to Filesystem" for multi-file markdown export.

### What are global cards?

Global cards are a planned feature that will allow sharing cards across all projects. This is not yet implemented.

---

## Intelligence

### What's the difference between Auto-Capture and Auto-Learn?

**Auto-Capture** records every AI response as a lightweight observation (always on, zero LLM cost).

**Auto-Learn** runs an LLM extraction on chat interactions to learn conventions, tool hints, and working notes (configurable, moderate LLM cost).

### How does staleness tracking work?

Working notes track `relatedFiles`. ContextManager checks file modification times to determine if those files have changed since the note was last updated:
- **🟢 Fresh** — files unchanged
- **⚠️ Possibly stale** — some files modified
- **🔴 Stale** — significant changes

Knowledge cards also show staleness indicators: ⚠️ file-stale (anchor/reference files changed) and ⏳ age-stale (not updated in N days, configurable via `stalenessAgeDays`). Checks run on dashboard open and file save.

### What are tool hints?

Learned search patterns specific to your codebase. Example: "Search `TabStripController` not `tab strip controller`" - the first returns precise results, the second returns CSS noise. The AI uses these to navigate more efficiently.

---

## Search

### What search technology is used?

SQLite FTS4 via sql.js (WebAssembly). No native binaries required - works everywhere VS Code runs. BM25 ranking is computed in JavaScript from `matchinfo('pcnalx')`.

### Does search work offline?

Yes. The search index is local and doesn't require any network connection.

---

## Card Queue

### Does the card queue use LLM calls?

**Queueing**: No. Responses are silently queued at zero LLM cost.

**Distilling**: Yes. When you click "Distill into Cards," a single LLM call synthesizes all queued items into card proposals.

### How many items can be in the queue?

Maximum 30. Oldest items are evicted when the cap is exceeded (FIFO).

---

## Hooks

### Do I need hooks for ContextManager to work?

No. Hooks are optional. All core features work without hooks. Hooks enable automatic capture from VS Code Copilot's native transcript - enriching the card queue and observation buffer without manual intervention.

### Why doesn't the Stop hook fire for VS Code Copilot?

This is a known VS Code limitation. ContextManager works around it by harvesting completed turns from the Copilot transcript during `PostToolUse` events, using ID-based deduplication.

---

## Performance

### Does ContextManager slow down VS Code?

Minimal impact. Key design choices:
- In-memory caching - disk reads only on startup
- Async I/O - search index never blocks the extension host
- Debounced processing - hook queue batches entries at 400ms intervals
- Circular buffer - observation count is bounded (default: 50)

### How much disk space does it use?

Typically 1–5 MB per project. The search index is usually under 1 MB. The VSIX itself is ~9.5 MB (mostly sql.js WebAssembly + Mermaid.js).
