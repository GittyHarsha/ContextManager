# ContextManager — Positioning & Differentiation

*How ContextManager fits into the VS Code / Copilot ecosystem alongside instruction files, prompt files, and skill files — and why you need all of them.*

---

## The Problem This Extension Solves

Here is the journey most developers go through when they start using Copilot seriously on a real project.

Day one: you open a large, unfamiliar codebase and begin exploring with the agent. You ask about the authentication flow, trace the event propagation path, discover the undocumented service layer, map which modules own which concerns. An hour in, both you and the agent understand the system in a way you couldn't from reading documentation alone. You're building a *shared model of the project* — the real one, with the quirks, the dead code, the accidental coupling, the workaround someone added in 2022.

Then the context window fills. Summarization kicks in. The agent forgets almost everything it learned.

Next session you explain the authentication flow again. And the session after that. And when a new engineer joins the team, you explain it to them for the first time — in a Slack thread that nobody will find in six months.

This is the gap. Every other AI guidance tool in the VS Code ecosystem was designed for something else. ContextManager was designed specifically for this.

---

## The Four-Layer Ecosystem — Where Every Tool Lives

There are four distinct categories of AI guidance in VS Code today. They are not competing — each one solves a different problem. Understanding the boundaries helps you use all of them effectively.

```
┌─────────────────────────────────────────────────────────────────────┐
│  LAYER 1 — GLOBAL BEHAVIOR INSTRUCTIONS                             │
│  .github/copilot-instructions.md · .cursorrules                     │
│                                                                     │
│  "How should the AI behave across everything I do?"                  │
│  → Always use TypeScript strict mode                                │
│  → Never use var. Prefer functional patterns.                       │
│  → Format dates as ISO 8601.                                        │
│                                                                     │
│  Character: Authored by humans · Static · Global · Rarely changes  │
├─────────────────────────────────────────────────────────────────────┤
│  LAYER 2 — REUSABLE TASK WORKFLOWS                                  │
│  *.prompt.md files · VS Code prompt snippets                        │
│                                                                     │
│  "What task do I want to kick off in a consistent way?"             │
│  → /generate-test · /review-pr · /create-component                 │
│  → /write-docs · /scan-for-todos                                    │
│                                                                     │
│  Character: Authored by humans · Static · Task-scoped               │
├─────────────────────────────────────────────────────────────────────┤
│  LAYER 3 — AGENT CAPABILITY DECLARATIONS                            │
│  SKILL.md files (Claude Code · future Copilot agents)               │
│                                                                     │
│  "What workflows can THIS agent execute in THIS project?"           │
│  → publish-extension · run-test-suite · deploy-to-staging          │
│  → create-ado-pr · generate-changelog                               │
│                                                                     │
│  Character: Authored by humans · Static · Capability-scoped         │
├─────────────────────────────────────────────────────────────────────┤
│  LAYER 4 — PROJECT KNOWLEDGE  ← ContextManager lives here           │
│                                                                     │
│  "What does the AI know about THIS project, right now?"             │
│  → Architecture decisions with the reasoning behind them           │
│  → Patterns discovered in code that aren't in any doc              │
│  → Conventions the team settled on after a debate                  │
│  → The auth flow — traced, understood, written down                 │
│  → Tool hints: "search TabStripController not 'tab strip'"          │
│  → What you figured out yesterday that the agent needs today       │
│                                                                     │
│  Character: AI-generated + human-curated · Dynamic · Per-project    │
└─────────────────────────────────────────────────────────────────────┘
```

Layers 1–3 are all **author-first**: you write them at setup time for guidance that stays mostly stable. Layer 4 is **discover-first**: knowledge accumulates dynamically as you and the AI actually work on the project. ContextManager owns Layer 4 — and provides bridges from it back into the others.

---

## What Makes ContextManager Different From Everything Else

### Static files describe the rules. ContextManager records the reasoning.

A `copilot-instructions.md` might say "use the repository pattern." ContextManager captures *why* your specific project uses it, which concrete classes implement it, which ones deviate for a reason, and what the team already debated before landing there. That difference — between a rule and institutional knowledge — is the difference between an AI that follows conventions and an AI that understands a project.

### Knowledge is generated by AI, not just consumed by it.

Every other tool in this ecosystem is author-first: you write the file, the AI reads it. ContextManager inverts this on purpose.

- `@ctx /knowledge` — the AI searches your codebase, synthesizes findings, creates a card
- `@ctx /refine` — the AI improves an existing card with fresh codebase research
- `@ctx /save` — turn any chat answer into a card with one command
- `@ctx /done` — end-of-task retrospective automatically captures what worked, what didn't, which conventions were confirmed, which tool hints are worth keeping
- Subagent tasks (`#ctxSubagent`) auto-create knowledge cards as a side effect of doing work
- Working Notes — the agent writes down non-obvious code relationships while navigating, for future use

The knowledge base does not require you to remember to document. It grows as you work.

### Three kinds of persistent memory, not one.

Most developers think of persistent AI context as "a document I write." ContextManager maintains three distinct stores, each tuned to a different kind of knowledge:

| Store | What it holds | Survives context reset? |
|---|---|---|
| **Knowledge Cards** | Architecture decisions, patterns, deep explanations, ADRs | ✅ Yes |
| **Project Intelligence** | Conventions (confirmed/observed/inferred), tool search hints, working notes about code relationships | ✅ Yes |
| **Branch Sessions** | Task, goal, current state, decisions made, blockers — living document per branch | ✅ Yes |

Each survives context window resets because it lives in your project database, not in the conversation. Each is injectable into prompts. Each is searchable.

### Smart injection — not "dump everything."

Static files give the AI everything in bulk. ContextManager is precise about what goes into each prompt.

- **Progressive disclosure** — Top 3 knowledge cards injected in full; cards 4–7 as 125-token summaries with a pointer to search for more; cards 8+ as metadata only. Keeps prompt tokens under control without sacrificing relevance.
- **Tiered intelligence injection** — Confirmed conventions always injected; task-relevant working notes matched by file/keyword; everything else queryable via `#ctx` or `#searchCards` on demand. Total auto-injection capped at 800 tokens.
- **Staleness signals** — Cards not updated in 30+ days are flagged with ⚠️ at injection time so the AI knows to treat them skeptically.
- **Usage tracking** — Tracks which cards get selected, how often they're injected, which ones are never used. Card Health dashboard surfaces duplicates (Jaccard similarity ≥40%) and dead weight automatically.

The AI gets the most relevant knowledge for what it's actually doing right now — not a firehose.

### Per-project scope, not global scope.

Instruction files apply everywhere. You work on five different codebases; they all get the same instructions. ContextManager is strictly per-project: each project has its own knowledge cards, cached explanations, TODO history, conventions, tool hints, working notes, and branch sessions. Switching projects means the AI's entire knowledge base switches with it instantly.

### Memory that survives context window resets — by design.

This is the core use case the extension was built around. When the context window fills and summarization kicks in, everything the agent learned in that session is gone. ContextManager cards are injected at the start of every new request — they are not stored in the context window, they live in your project database. Resets, session ends, model switches — none of these affect your knowledge base.

### Searchable, not just readable.

A 200-line instruction file is read in bulk, with no way to ask "just show me the part about caching." ContextManager's BM25 full-text search (`#ctx`, `#searchCards`) lets the agent query exactly what it needs and get top-ranked results. The search spans cards, conventions, working notes, tool hints, cached explanations, observations, sessions, and projects simultaneously — with camelCase tokenization, quoted phrase support, prefix matching, and an OR fallback when the exact term returns nothing.

### Team knowledge, not personal notes.

Knowledge cards export to git-tracked Markdown files with YAML frontmatter (`.contextmanager/cards/*.md`). A new team member clones the repo, imports the folder, and immediately has the accumulated project knowledge of the entire team — generated as a side effect of the team doing their actual work, not as a dedicated documentation sprint.

`@ctx /handoff` packages the complete project context for any incoming contributor, human or agent.

And if you need to feed this knowledge to a different agent runtime, ContextManager exports any folder as a `SKILL.md` file compatible with Claude Code. The bridge goes both ways: import any directory of Markdown files as knowledge cards.

---

## How They Co-Exist — A Decision Guide

| Scenario | Right tool |
|---|---|
| "Always use strict null checks, prefer `const`" | `copilot-instructions.md` |
| "When I ask for a test, use this import path and this test structure" | `*.prompt.md` |
| "Here's how to publish this extension, step by step" | `SKILL.md` |
| "Here's what the authentication flow actually does in our app" | ContextManager knowledge card |
| "We tried EventBus and abandoned it — don't go there again" | ContextManager convention (confirmed) |
| "Search `TabStripController` not 'tab strip controller' in this repo" | ContextManager tool hint |
| "What did I figure out about the DB schema last week?" | ContextManager branch session |
| "Refactor the auth module using everything we already know" | ContextManager TODO (with AI agent) |
| "Onboard a new dev without writing a separate doc" | `@ctx /handoff` |
| "Share our project knowledge with Claude Code" | Export cards as `SKILL.md` |

ContextManager also bridges *into* the other layers. A knowledge card that matures into a documented workflow can be exported as a prompt file. A collection of project procedures can be exported as a SKILL.md for any agent runtime that supports it. The tier you start in is not where you have to stay.

---

## The Progression of a Real Project

**Phase 1 — Discovery.**
You explore the codebase with the agent. `@ctx /knowledge` generates cards for each major subsystem as the AI navigates. `@ctx /save` captures key insights from long exploration sessions. The Project Intelligence layer learns which file-naming patterns actually hold in practice, which conventions the codebase violates, and which search terms return noise instead of signal. By end of week one, the AI has a model of the project it doesn't have to rebuild from scratch on day two.

**Phase 2 — Building.**
TODOs drive the work. Each item is a task with an AI agent attached — full codebase tool access, conversation history you can review, the ability to pause, add context, and resume. The agent records its decisions in the branch session living document. `@ctx /done` at the end of each session runs a retrospective that updates conventions, captures new tool hints, and creates cards from anything worth keeping.

**Phase 3 — Cumulative leverage.**
The AI knows the codebase better than it did in phase one — not because the model improved, but because the accumulated knowledge is there at the start of every session. Refactors are faster because architectural context doesn't need re-establishing. Reviews are informed by recorded decisions. The next developer who joins lands in the same place in an hour instead of a week.

---

## Three Personas This Serves

### The Explorer — unfamiliar codebase, discovery-mode
Every key discovery — "this is the main event loop", "these three classes are tightly coupled by accident", "this config flag silently breaks auth in staging" — becomes a knowledge card automatically as the AI does its work. No separate documentation step. Just work, and knowledge accumulates.

### The Builder — backlog-driven, implementation-mode
A TODO in ContextManager is not just a note. It's a task with an autonomous AI agent, full codebase access, a conversation history, and a linked knowledge card that collects insights across runs. The branch session tracks what was decided, why, and what comes next — so context window resets don't reset progress.

### The Tech Lead — growing team, onboarding-mode
The accumulated knowledge from every exploration and implementation session is git-tracked Markdown. New hires get it on day one. The AI gets it on first project launch. One command (`@ctx /handoff`) packages the entire project context for any newcomer — human or agent. The onboarding doc writes itself.

---

## What ContextManager Is Not

- **Not a replacement for `copilot-instructions.md`** — global coding standards belong there, and ContextManager reads your instructions file and includes it in project context automatically.
- **Not a prompt library** — repeatable task templates belong in `.prompt.md` files. ContextManager's 6 card templates are for structuring knowledge cards, not for invoking agents.
- **Not an agent framework** — it works *with* Copilot's native agent mode and tool-calling loop, extending it rather than routing around it.
- **Not a documentation generator** — the cards are working memory for AI interactions. They export to human-readable Markdown as a bridge feature, not as the primary purpose.
- **Not a generic memory MCP server** — every feature is scoped to a project, integrated with git, and surfaced through a dashboard designed specifically for codebase work.

---

## Answering the Skeptics

> *"I already have a prompt file that works fine."*

A prompt file is a configuration — it tells the AI how to handle a task you repeat. ContextManager is a memory — it tells the AI what it already knows about your project so it doesn't have to figure it out again. You need both for the same reason a team needs both a style guide and a wiki.

> *"Won't the AI just figure this stuff out on its own each time?"*

Yes — every time, from scratch, for every session, for every developer. ContextManager makes the AI figure things out once and remember them. The second session is faster than the first. The tenth is faster than the second.

> *"This seems like extra work to maintain."*

Most cards are generated by the AI as a side effect of work it was already doing. `@ctx /done` at the end of a session takes seconds. The Card Health dashboard flags stale and duplicate cards automatically. The return is never re-explaining your codebase architecture again — in this session, the next one, or to the next engineer.

> *"I can just paste context into each chat."*

You can paste it every session, maintain it by hand, and lose it every time you close the window. ContextManager persists it, organizes it by project, makes it searchable, auto-injects the most relevant parts at the right token budget, and keeps it under version control for the whole team.

---

## One-Paragraph Summary

ContextManager is a persistent project memory layer for Copilot and other VS Code agents. Instruction files tell the AI how to behave. Prompt files give it repeatable tasks. Skill files declare its capabilities. ContextManager gives it everything the team has learned about a specific codebase — architecture decisions, discovered patterns, confirmed conventions, tool search hints, explored branch work — stored per-project, searchable via BM25, auto-injected at the right token budget, shareable across the team via git, and growing with every session instead of disappearing at the end of one.

## The Problem With "Just Use a Prompt File"

When developers first discover they can give Copilot persistent guidance, the natural instinct is to write a `.github/copilot-instructions.md` or a few `*.prompt.md` files. Those files are great — for the things they do. But they expose a gap that becomes painfully obvious on any real project.

**Here's the journey almost every team goes through:**

A developer opens a large codebase and starts exploring with Copilot Chat. Together with the agent, they map the authentication flow, discover an undocumented event bus, trace the error propagation path, and learn which files own which concerns. After an hour, both the developer and the agent have built up a rich, nuanced model of the project.

Then the context window fills up. Summarization kicks in. The agent forgets almost everything.

The developer goes back to their prompt file and writes down... what, exactly? They can't capture the full journey. They write a few lines, leave out the edge cases, and move on. Next session, the agent starts from scratch on anything not explicitly written down. Two steps forward, one step back — every single session.

This is the gap ContextManager is designed to fill.

---

## The Ecosystem Map — Where Every Tool Fits

There are four distinct layers of AI guidance in the VS Code ecosystem today. Each solves a different problem. None replaces the others.

```
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 1 — BEHAVIOR INSTRUCTIONS                                │
│  .github/copilot-instructions.md, .cursorrules                  │
│  "How should the AI behave across all my projects?"             │
│  → Code style, tone, don't use var, always add JSDoc            │
│  → Static. Global. Authored by humans. Almost never changes.   │
├─────────────────────────────────────────────────────────────────┤
│  LAYER 2 — REUSABLE PROMPT WORKFLOWS                            │
│  *.prompt.md files, VS Code prompt snippets                     │
│  "What task do I want to kick off repeatedly?"                  │
│  → /create-test, /generate-docs, /review-pr                     │
│  → Static. Task-scoped. Authored by humans.                     │
├─────────────────────────────────────────────────────────────────┤
│  LAYER 3 — AGENT CAPABILITIES                                   │
│  *.skill.md / SKILL.md files (Claude Code, future Copilot)      │
│  "What tools and workflows can THIS agent use?"                 │
│  → publish-extension, run-tests, deploy-staging                 │
│  → Static. Capability-scoped. Authored by humans.               │
├─────────────────────────────────────────────────────────────────┤
│  LAYER 4 — PROJECT KNOWLEDGE  ← ContextManager lives here       │
│  Knowledge cards, cached explanations, branch sessions,         │
│  TODO history, tool-usage patterns                              │
│  "What does the AI know about THIS project?"                    │
│  → Architecture decisions, discovered patterns, codebase quirks │
│  → Dynamic. Project-scoped. Generated by AI + humans together. │
└─────────────────────────────────────────────────────────────────┘
```

Layers 1–3 are all author-first: a human writes them at setup time to configure behavior that remains mostly stable. **Layer 4 is discover-first**: knowledge accumulates dynamically as you and the AI actually work on the project.

ContextManager owns Layer 4 — and bridges into the others.

---

## What Makes ContextManager Different

### Static files describe the job. ContextManager records the journey.

A `copilot-instructions.md` might say "use the repository pattern." ContextManager captures *why* your specific project uses it, *which classes implement it*, *which ones deviate and why*, and the tradeoffs the team already debated. That's the difference between a rule and institutional knowledge.

### It's bidirectional — AI generates knowledge, not just consumes it.

Every other tool in this ecosystem is author-first. You write the file; the AI reads it. ContextManager inverts this:

- `@ctx /knowledge` — the AI researches your codebase and *creates* a card
- `@ctx /refine` — the AI improves an existing card with fresh codebase research  
- `@ctx /save` — turn any chat answer into a card with one command
- Subagent tasks auto-create cards as a side effect of doing work

The knowledge base grows as you work, not just when you remember to document.

### Per-project scope, not global scope.

Instruction files are global. You work on 5 projects, they all get the same instructions. ContextManager is project-scoped: each project has its own cards, cache, TODO history, and branch sessions. Switching projects means the AI's entire knowledge base switches with it.

### Memory that survives context window resets.

This is the core use case. When the context window fills and summarization kicks in, the agent's in-session learning is gone. Selected ContextManager knowledge cards are injected at the top of every request — they don't live in the context window, they live in your project database. They survive resets, session ends, and model switches.

### It's searchable, not just readable.

A 200-line `instructions.md` is read by the AI in bulk. ContextManager's BM25 full-text search (SQLite FTS4) lets the AI query exactly what it needs: `#searchCards "authentication flow"` returns the most relevant cards ranked by relevance, not positional luck. Cross-entity search via `#ctx` spans cards, conventions, working notes, tool hints, cached explanations, observations, and sessions simultaneously.

### Team knowledge, not personal notes.

Knowledge cards export to git-tracked Markdown files (`.contextmanager/cards/*.md`) with YAML frontmatter. A new team member clones the repo, imports the cards, and immediately has the accumulated project knowledge of the whole team. No onboarding doc to write — it was generated as a side effect of the team doing their actual work. Use `@ctx /handoff` to produce a structured onboarding context package for any incoming developer.

---

## How They Co-Exist (They're Complementary, Not Competing)

| Scenario | Best Tool |
|---|---|
| "Always use tabs, never semicolons" | `copilot-instructions.md` |
| "When I ask for tests, use this template" | `*.prompt.md` |
| "Here's how to publish this extension" | `SKILL.md` |
| "Here's what the auth flow actually does in our specific app" | ContextManager knowledge card |
| "The team decided to retire the EventBus pattern — here's why" | ContextManager knowledge card |
| "What did I figure out about the DB schema last Tuesday?" | ContextManager branch session |
| "Refactor this module — here are the constraints" | ContextManager TODO |

ContextManager can also **export to those other formats**:
- Export any folder of cards as a `SKILL.md` file (usable by Claude Code and future agents)
- Export cards as Markdown files for consumption by any tool that can read files
- The bridge goes both ways: import any `.md` files into ContextManager cards

Think of it this way: **instruction, prompt, and skill files are your team's documented policies. ContextManager is your team's accumulated experience.**

---

## The Three Personas ContextManager Serves

### 1. The Explorer
You come to a large, unfamiliar codebase. You spend the first week in deep exploration sessions with Copilot. Every key discovery — "this is the event loop", "these three classes are tightly coupled", "this config flag breaks auth in staging" — becomes a knowledge card automatically as the AI does its work. By week two, the AI already knows the codebase as well as you do. No more re-explaining.

### 2. The Builder
You have a backlog of features and refactors. Each item is a TODO in ContextManager. The AI works through them autonomously with full codebase access, creates linked knowledge cards for insights discovered along the way, and tracks its progress. You review, adjust, and resume. The history of every decision is preserved.

### 3. The Tech Lead
Your team is growing. Onboarding takes weeks because all the "why" knowledge lives in people's heads and Slack threads. With ContextManager, the accumulated knowledge from every exploration and implementation session is git-tracked Markdown. New hires get it on day one. The AI gets it on first launch. One command (`@ctx /handoff`) packages the entire project context for any newcomer — human or agent.

---

## What ContextManager Is Not

To be clear about boundaries:

- **It is not a replacement for `copilot-instructions.md`** — global coding standards still belong there
- **It is not a prompt library** — use `.prompt.md` for repeatable task templates
- **It is not an agent framework** — it works *with* Copilot's agent mode, not around it
- **It is not documentation** — it's working knowledge for AI interactions, not a wiki for humans (though it can export to one)

---

## Quick Summary for Skeptics

> *"I already have a prompt file. Why do I need this?"*

Your prompt file is a configuration. ContextManager is a memory. You need both for the same reason a developer needs both a style guide and a team wiki — one tells you how to work, the other records what you've learned.

> *"Won't the AI just figure this stuff out on its own?"*

Every time, from scratch, as many times as you ask. ContextManager makes it so the AI only has to figure things out once.

> *"This seems like overhead."*

The knowledge cards are generated by the AI as a side effect of work it was already doing. The overhead is typing one command: `@ctx /save` or `@ctx /knowledge`. The return is never re-explaining your codebase again.
