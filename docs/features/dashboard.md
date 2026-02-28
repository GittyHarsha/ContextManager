---
layout: default
title: Dashboard
parent: Features
nav_order: 7
---

# Dashboard
{: .fs-8 }

Centralized management for all ContextManager features - 6 tabs, one WebView.
{: .fs-5 .fw-300 }

---

## Opening the Dashboard

- Click the **status bar item** (shows active project name)
- Run command: `ContextManager: Open Dashboard`
- Click the **📖** icon in the Activity Bar → project → Dashboard

---

## Tab Overview

| Tab | What's Inside |
|:----|:-------------|
| **Overview** | Project stats, context injection toggle, quick actions |
| **🧠 Intelligence** | Auto-Capture/Auto-Learn controls, observations feed, AI Distill |
| **Knowledge** | All cards with search, filter, folders, select/deselect, inline editing, card health, card queue |
| **Cache** | Cached explanations with selection, editing, conversion to cards |
| **Context** | Project goals, conventions, tool hints, working notes, key files |
| **⚙ Settings** | All extension settings editable in-dashboard, data import/export |

---

## Overview Tab

- **Project stats** - knowledge cards (selected/total), cached explanations
- **Context injection toggle** - enable/disable for this project
- **Quick actions** - 🧠 Intelligence, Edit Context, View Cache

---

## Intelligence Tab

The command center for the intelligence pipeline:

### Controls
- **Auto-Capture** ON/OFF toggle with observation count
- **Auto-Learn** ON/OFF toggle
- **🤖 Distill Observations** button — extract conventions, tool hints, and working notes from observations

### Observations Feed
- Per-source filter pills: dynamically generated from observation sources
- Each observation shows type emoji, participant, timestamp, prompt preview
- Actions: Promote to convention (🏗), Promote to working note (📝), Delete (✕)

---

## Knowledge Tab

### Card Management
- **Search bar** - keyword filtering across all cards
- **Category filter** - architecture, pattern, convention, explanation, note, all
- **Folder tree** - collapsible hierarchy with drag-and-drop
- **Card actions** - Select, Edit, Delete, Refine, 📌 Pin, 👁 Include, 🗃 Archive, 🌐 Global

### Inline Editing
- Click Edit on any card to expand the editor
- Auto-sizing textarea (min 300px, max 80vh)
- Scroll position preserved during edit
- Rendered markdown preview with LaTeX support

### Card Health
- Collapsible analytics section
- Total / selected / stale / never-used counts
- Top 5 most-used cards
- Duplicate detection (Jaccard ≥80%)

### Card Queue
- Pending count, Distill into Cards, Clear Queue
- Check items to include in distill, or save individual items directly as cards
- See [Card Queue]({% link features/card-queue.md %}) for details

### Context Menu
Replace, Delete, Refine with AI, Create Card from Selection, Ask Question

---

## Cache Tab

- **Auto-cached** results from `/explain`, `/usage`, `/relationships`
- **Selectable** - check entries to include in AI prompts
- **Editable** - rename or modify content inline
- **Convert to card** - promote a cache entry to a knowledge card
- **Configurable expiration** - days to keep (0 = never)

---

## Context Tab

### Project Metadata
- Project name, goals, key files
- Auto-saves on edit (800ms debounce)

### 🏗 Conventions
- Codebase conventions learned by the agent
- Enable/disable toggle per convention
- Edit, delete actions
- Injected into all AI prompts when enabled

### 🔧 Tool Hints
- Search patterns that work (and don't work) in this codebase
- Checkbox selection for prompt injection
- If none selected, top 5 by recency are injected by default

### 📝 Working Notes
- Insights discovered during codebase exploration
- Expandable details with staleness badges (🟢 fresh, ⚠️ possibly-stale, 🔴 stale)
- Matched by file path for task-relevant injection
- Actions: Mark Fresh, Discard, Delete

---

## Settings Tab

All extension settings editable directly in the dashboard - no need to open VS Code settings JSON.

### Data Management
- **📦 Export All Data** / **Import Data** - full dump/restore
- **Export Current Project** / **Import Project** - single-project with duplicate handling

---

## Keyboard Shortcuts

| Shortcut | Action |
|:---------|:-------|
| `1`–`6` | Switch tabs |
| `Ctrl+K` | Focus search |
| `Ctrl+Shift+K` | Deselect all cards |
| `Ctrl+N` | New card |

---

## Rendering

- **Markdown** - full rendering with headers, lists, code blocks, blockquotes, tables
- **LaTeX** - `$...$` inline, `$$...$$` display, KaTeX with MathML output
- **Mermaid** - ` ```mermaid ` blocks displayed as styled code blocks with syntax highlighting
- **Code syntax** - language-tagged code blocks with VS Code theme colors

---

## Next Steps

[Language Model Tools →]({% link features/tools.md %})
{: .fs-5 }
