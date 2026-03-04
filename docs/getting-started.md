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

To capture responses from **all** chat participants, register the VS Code agent hook once:

1. Open the Dashboard → **Settings** tab
2. Expand the **🪝 Agent Hooks** section
3. Click **Install Hooks** — this copies `capture.ps1` to `~/.contextmanager/scripts/` and writes `hooks.json` to `.github/hooks/`

{: .note }
Without the hook, intelligence still accumulates from auto-capture during your active chat sessions. With the hook, every Copilot Chat, `@workspace`, and background agent response is also captured automatically.

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

1. Open the Dashboard → **Knowledge** tab → **📬 Card Queue** subtab
2. Click **🤖 Distill into Cards** — one LLM call synthesizes all queued items into card proposals
3. Review proposals: click **✓ Add** for ones worth keeping (or **Approve All**)
4. If a similar card already exists, a **merge picker** appears — merge is the default action

{: .tip }
You don't need to review the queue every session. Weekly or per-feature review is plenty.

---

## Step 5 — Sessions Start Informed

From now on, every new Copilot session automatically receives context two ways:

- **`copilot-instructions.md` managed block**: ContextManager auto-syncs a managed section into your `.github/copilot-instructions.md` containing `#ctx` tool usage instructions and pinned card titles. VS Code always includes this file, so every agent starts informed.
- **`#ctx` tool**: Available to all agents for on-demand search, list, learn, and getCard across all project knowledge.

The AI knows your architecture, conventions, and recent discoveries without you repeating yourself.

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

    style A fill:#1f6feb,stroke:#388bfd,color:#fff
    style B fill:#1158c7,stroke:#388bfd,color:#fff
    style C fill:#238636,stroke:#3fb950,color:#fff
    style D fill:#1158c7,stroke:#388bfd,color:#fff
    style E fill:#1f6feb,stroke:#388bfd,color:#fff
</pre>
{:/nomarkdown}

Each session builds on everything that came before it.

---

## LM Tools Reference

5 Language Model Tools available to all agents:

```
#ctx                   — unified search, list, learn, getCard across all knowledge
#getCard               — read a specific knowledge card by ID
#saveCard              — save a new knowledge card
#editCard              — edit an existing card
#organizeCards         — organize cards into folders
```

---

## Optional: Custom AI Workflows

Once you have knowledge accumulating, you can automate recurring AI tasks:

1. Open the Dashboard → **Intelligence** tab → **Custom AI Workflows**
2. Click **+ New Workflow** and define a prompt template using `{{variable}}` placeholders
3. Choose a trigger — manual, auto-queue, or event-based (convention-learned, card-created, etc.)
4. Set the output action — create card, update card, or append to a collector card

Workflows run against your project data and produce structured output automatically. See [Custom AI Workflows]({% link features/workflows.md %}) for details.

---

## Next Steps

[Features →]({% link features/index.md %})
{: .fs-5 }
