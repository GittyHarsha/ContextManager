---
layout: default
title: Getting Started
nav_order: 3
---

# Getting Started
{: .fs-9 }

Set up once. ContextManager works in the background from that point forward.
{: .fs-6 .fw-300 }

---

## Step 1 — Create a Project

1. Click the **📖 book icon** in the Activity Bar
2. Click **+** to create a new project
3. Name your project (e.g., "my-app")
4. Select the workspace folders that belong to this project
5. Open the **Dashboard** (click the status bar item or run `ContextManager: Open Dashboard`)

Your project is now active. ContextManager will capture knowledge from all future Copilot interactions in this workspace.

{: .tip }
ContextManager auto-discovers `.github/copilot-instructions.md` and `README.md` and includes them in project context.

---

## Step 2 — (One-time) Register the Hook

To capture responses from **all** chat participants — not just `@ctx` — register the VS Code agent hook once:

1. Open the Dashboard → **Settings** tab
2. Click **Copy hook install command**
3. Paste and run it in your terminal — it registers `capture.ps1` as a VS Code agent `Stop` hook

{: .note }
Without the hook, intelligence still accumulates from `@ctx` interactions. With the hook, every Copilot Chat, `@workspace`, and background agent response is also captured automatically.

---

## Step 3 — Chat Normally

Just use Copilot as you normally would:

```
What does the AuthController class do?
How is the error handling pipeline structured?
Explain the retry logic in NetworkClient.
```

ContextManager captures intelligence silently in the background:

| What's captured | How |
|:----------------|:----|
| **Conventions** | LLM extracts coding patterns from responses |
| **Tool Hints** | Learned search terms that work for your codebase |
| **Working Notes** | Code relationships and insights discovered during exploration |
| **Card Candidates** | High-confidence knowledge staged in the Card Queue for review |

No commands. No setup. It just runs.

---

## Step 4 — Review the Queue (Once a Week)

AI responses accumulate in the **Card Queue**. When you have a few:

1. Open the Dashboard → **Queue** tab
2. Click **Distill into Cards** — one LLM call synthesizes all queued items into card proposals
3. Review proposals: click **+ Add Card** for ones worth keeping (or **Approve All**)
4. If a similar card already exists, a **merge picker** appears — merge is the default action

{: .tip }
You don't need to review the queue every session. Weekly or per-feature review is plenty.

---

## Step 5 — Sessions Start Informed

From now on, every new Copilot session automatically receives context two ways:

- **`copilot-instructions.md` managed block**: ContextManager auto-syncs a managed section into your `.github/copilot-instructions.md` containing `#ctx` tool usage instructions and pinned card titles. VS Code always includes this file, so every agent starts informed.
- **`#ctx` tool**: Available to all agents for on-demand search, list, learn, and getCard across all project knowledge — no `@ctx` participant required.

The AI knows your architecture, conventions, and recent discoveries without you repeating yourself.

---

## Optional: `@ctx` Manual Controls

Everything above happens automatically. Use `@ctx` only when you want explicit control:

**Exploration**

| What you want | Command |
|:--------------|:--------|
| Ask questions with full project context (default) | `@ctx /chat How is the auth pipeline structured?` |
| Deep-dive explanation of a symbol/concept | `@ctx /explain AuthController` |
| Explain why code is used at a location | `@ctx /usage Why is retry logic here?` |
| Show class hierarchies and architecture | `@ctx /relationships NetworkClient` |
| Show current project context | `@ctx /context` |

**Knowledge creation**

| What you want | Command |
|:--------------|:--------|
| Research a topic and create a card | `@ctx /knowledge Research the auth flow` |
| Improve an existing card with fresh research | `@ctx /refine` |
| Answer a question and save as a card | `@ctx /save How does error handling work?` |
| Save the last AI response as a card | `@ctx /add` |
| [Experimental] Generate doc comments | `@ctx /doc` |

**Workflow**

| What you want | Command |
|:--------------|:--------|
| Work on a TODO with full project context | `@ctx /todo Implement the caching layer` |
| End-of-task retrospective | `@ctx /done` |
| Generate handoff document | `@ctx /handoff` |
| Scan cards for staleness | `@ctx /audit` |
| Generate architectural overview | `@ctx /map` |

---

## The Flywheel

{::nomarkdown}
<pre class="mermaid">
graph TD
    A[Work with Copilot normally] --> B[Knowledge captured in background]
    B --> C[Queue: review and approve cards]
    C --> D[Cards injected into every future session]
    D --> E[Copilot starts informed]
    E --> A

    style A fill:#7c3aed,stroke:#a78bfa,color:#fff
    style B fill:#2563eb,stroke:#58a6ff,color:#fff
    style C fill:#059669,stroke:#3fb950,color:#fff
    style D fill:#2563eb,stroke:#58a6ff,color:#fff
    style E fill:#7c3aed,stroke:#a78bfa,color:#fff
</pre>
{:/nomarkdown}

Each session builds on everything that came before it.

---

## LM Tools Reference

11 Language Model Tools available to all agents:

```
#ctx                   — unified search, list, learn, getCard across all knowledge
#searchCards           — search knowledge cards
#getCard               — read a specific knowledge card by ID
#ctxSubagent           — delegate complex tasks to an autonomous agent
#saveCard              — save a new knowledge card
#editCard              — edit an existing card
#organizeCards         — organize cards into folders
#searchCache           — search cached explanations
#readCache             — read a cached explanation
#saveCache             — save a cache entry
#editCache             — edit a cache entry
```

---

## Next Steps

[Features →]({% link features/index.md %})
{: .fs-5 }
