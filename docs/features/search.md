---
layout: default
title: Search
parent: Features
nav_order: 4
---

# BM25 Full-Text Search
{: .fs-8 }

Fast, ranked search across your entire project memory using SQLite FTS4 via WebAssembly.
{: .fs-5 .fw-300 }

---

## Overview

ContextManager provides search via `#ctx` (mode: search) — a unified tool that ranks results using the BM25 algorithm, the same ranking function used by modern search engines. `#searchCards` remains as a convenience for card-specific search. All search is local, running via sql.js (WebAssembly) with zero native binary dependencies.

---

## Search Tools

### `#ctx` - Cross-Entity Search (mode: search)

Unified search across **all** entity types simultaneously. Replaces the old `#search` tool.

| Entity | What's Indexed |
|:-------|:---------------|
| Knowledge Cards | Title, content, category, tags, source |
| Cached Explanations | Symbol name, content, file path, type |
| Observations | Auto-captured interactions (prompt, response summary, participant) |
| Projects | Project metadata (name, description, goals, conventions) |
| Learnings | Conventions, tool hints, and working notes (subject, content, category) |

{: .note }
> `convention`, `workingNote`, and `toolHint` are searchable as separate fine-grained entity types within the learnings table, allowing targeted filtering.

```
#ctx query:"error handling" maxResults:10
```

Card-specific search is available via `#ctx` with `entityTypes: ['card']`:

```
#ctx query:"authentication flow" entityTypes:["card"]
```

---

## Query Syntax

### Basic Search

```
authentication          → matches any document containing "authentication"
auth*                   → prefix matching: auth, authentication, authorize, etc.
"error handler"         → exact phrase match
```

### Boolean Operators (FTS4)

```
authentication JWT      → AND (both terms must appear)
authentication OR OAuth → OR (either term)
```

### CamelCase Expansion

Queries automatically expand camelCase, PascalCase, and snake_case terms:

```
TabStripController → also searches: tab, strip, controller
user_auth_service  → also searches: user, auth, service
```

---

## Search Strategy

ContextManager uses a 2-tier search strategy for maximum recall:

1. **BM25 FTS4** — Primary search with per-column weights, IDF, and document-length normalization
2. **OR Fallback** — If AND search returns zero results, automatically retries with OR for partial matches

---

## BM25 Ranking

The ranking function computes relevance using:

- **Term Frequency (TF)** - how often the term appears in the document
- **Inverse Document Frequency (IDF)** - rarer terms get higher weight
- **Document Length** - shorter documents are boosted (more focused content)
- **Per-column weights** - title matches rank higher than body matches

This is the same algorithm quality as FTS5's built-in `bm25()`, implemented in JavaScript from `matchinfo('pcnalx')`.

---

## Index Management

### Persistence

The search index is stored at `globalStorageUri/search-fts4.db` and persists between sessions.

### Sync

- **Full rebuild** on activation (loads from project database)
- **Incremental sync** on every mutation (add, edit, delete card/convention/etc.)
- **Auto-save timer** (30s) for crash-safe updates
- **Rebuild lock** prevents race conditions during full rebuilds

### Performance

All file I/O is async (`fs/promises`) - search never blocks the extension host.

---

## Settings

| Setting | Default | Description |
|:--------|:--------|:------------|
| `search.enableFTS` | `true` | Enable BM25 full-text search |
| `search.maxCardResults` | `5` | Max results for card search |
| `search.maxSearchResults` | `10` | Max results for cross-entity search |
| `search.snippetTokens` | `16` | Snippet preview size in tokens |

---

## Next Steps

[Knowledge Cards →]({% link features/knowledge-cards.md %})
{: .fs-5 }
