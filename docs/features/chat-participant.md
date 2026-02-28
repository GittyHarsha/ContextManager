---
layout: default
title: Chat Participant
parent: Features
nav_order: 8
---

# Chat Participant (`@ctx`)
{: .fs-8 }

Manual control commands for when you want to direct ContextManager explicitly. All of this is optional — ContextManager works fully in the background without a single `@ctx` command.
{: .fs-5 .fw-300 }

{: .note }
> **You don't need these commands.** ContextManager captures knowledge, injects intelligence, and maintains session continuity automatically from all Copilot interactions. Use `@ctx` when you want to give explicit instructions, trigger a retrospective, or create cards on demand.

---

## Overview

Type `@ctx` in Copilot Chat to access the ContextManager chat participant. Every command automatically includes your selected knowledge cards, cached explanations, and project intelligence as context.

---

## Commands

### `/chat` - Ask with Project Context
{: .d-inline-block }
Default
{: .label .label-green }

Ask any question with full project context injected. This is the default command when you type `@ctx` without a slash command.

```
@ctx How does the caching layer work?
@ctx /chat What's the difference between Service A and Service B?
```

### `/explain` - Deep-Dive Explanation

Get a thorough explanation of a symbol, class, module, or concept. Results are auto-cached.

```
@ctx /explain AuthenticationService
```

{: .tip }
You can also right-click any symbol in the editor → **Explain** for the same result.

### `/usage` - Explain Why Code Is Used

Understand why a specific piece of code exists at a particular location.

```
@ctx /usage Why is EventEmitter used here instead of callbacks?
```

### `/relationships` - Show Architecture

Display class hierarchies, component relationships, and architectural patterns.

```
@ctx /relationships Show the inheritance tree of BaseController
```

### `/todo` - Work on a TODO

Work on a TODO item with full project context injected.

```
@ctx /todo Fix the authentication bug in LoginService
```

### `/knowledge` - Research & Generate Card

The AI researches your codebase and creates a structured knowledge card.

```
@ctx /knowledge Research the observer pattern in this codebase
@ctx /knowledge How does dependency injection work here?
```

### `/refine` - Improve a Card

Pick an existing knowledge card and improve it with fresh codebase research.

```
@ctx /refine
```

The AI uses the full tool-calling loop - it can read files, search, and navigate your entire codebase to update the card.

### `/save` - Answer + Save as Card

Answer a question and save the response as a knowledge card in one step.

```
@ctx /save How does the error handling pipeline work?
```

### `/add` - Save Last Response as Card

Save the most recent AI response from the current chat session as a card.

```
@ctx /add
```

### `/done` - End-of-Task Retrospective

Capture structured learnings from the current task.

```
@ctx /done
```

Extracts: outcome summary, new conventions, tool hints, and creates knowledge cards from insights.

### `/handoff` - Generate Handoff Document

Package the complete project context - knowledge cards, conventions, intelligence - into a handoff document for another engineer.

```
@ctx /handoff
```

### `/audit` - Knowledge Freshness Scan

Scan all knowledge cards for staleness: check if referenced files still exist, flag outdated content.

```
@ctx /audit
```

### `/map` - Architectural Overview

Generate an architectural overview of a module or directory with entry points, relationships, and data flow.

```
@ctx /map src/auth/
```

### `/context` - Show Current Context

Display the current project context - metadata, selected cards, cached explanations, intelligence summary.

```
@ctx /context
```

### `/doc` - Generate Doc Comments
{: .d-inline-block }
Experimental
{: .label .label-yellow }

Generate and apply doc comments to selected code. Requires VS Code Insiders for inline diff support.

```
@ctx /doc
```

---

## Context Injection

Every `@ctx` command automatically injects:

1. **Project metadata** - name, goals, root paths
2. **Selected knowledge cards** - via progressive disclosure (full → summary → metadata)
3. **Selected cache entries** - previously cached explanations
4. **Project intelligence** - conventions, tool hints, relevant working notes
5. **Copilot instructions** - `.github/copilot-instructions.md` (if present)
6. **README** - `README.md` (if present)

---

## Followup Suggestions

After each response, `@ctx` suggests contextual followup actions:

- **📥 Add last response as card** - after `/chat` and `/save`
- **🔍 Search for more** - when the response references searchable topics
- **📖 Explain deeper** - for complex explanations

---

## Next Steps

[Search →]({% link features/search.md %})
{: .fs-5 }
