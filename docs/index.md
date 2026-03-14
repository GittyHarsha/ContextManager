---
layout: default
title: Introduction
nav_order: 1
---

# ContextManager - AI Project Memory
{: .fs-9 }

Build a persistent project memory layer for Copilot. Curate knowledge cards, auto-capture project intelligence, search everything with BM25, run AI or template workflows, choose dedicated models for different features, and carry context across every session.
{: .fs-6 .fw-300 }

[Get Started]({% link getting-started.md %}){: .btn .btn-primary .fs-5 .mb-4 .mb-md-0 .mr-2 }
[View on GitHub](https://github.com/GittyHarsha/ContextManager){: .btn .fs-5 .mb-4 .mb-md-0 }

---

## The Problem

Every developer using AI assistants on real codebases hits the same wall:

You spend an hour exploring a large codebase with Copilot - mapping the authentication flow, tracing event propagation, discovering the undocumented service layer. You and the agent build up a rich, shared model of the project. Then the context window fills. Summarization kicks in. **The agent forgets everything**.

Next session, you explain the authentication flow again. And the session after that.

ContextManager was built specifically for this gap - persistent project memory that survives context window resets, session boundaries, and model switches.

---

## Key Features

<div class="feature-grid" markdown="0">
  <div class="feature-card">
    <h4>🧠 Knowledge Cards</h4>
    <p>Create, curate, and inject structured knowledge into every AI interaction. Architecture decisions, patterns, conventions - all searchable and auto-injected.</p>
  </div>
  <div class="feature-card">
    <h4>🔬 Project Intelligence</h4>
    <p>Automatically captures conventions, tool hints, and working notes from all chat interactions. Learns continuously as you work.</p>
  </div>
  <div class="feature-card">
    <h4>💬 Language Model Tools</h4>
    <p>5 tools available to every Copilot agent — search memory, open cards, save cards, edit cards, and organize folders without leaving chat.</p>
  </div>
  <div class="feature-card">
    <h4>🔍 BM25 Search</h4>
    <p>Fast, ranked search across your entire project memory using SQLite FTS4 via WebAssembly. No native binaries needed.</p>
  </div>
  <div class="feature-card">
    <h4>📬 Card Queue</h4>
    <p>Automatic staging buffer that captures AI responses and synthesizes high-quality knowledge card proposals.</p>
  </div>
  <div class="feature-card">
    <h4>⚡ Custom Workflows</h4>
    <p>Define reusable workflows with template variables, event triggers, AI or direct-template output actions, and a dedicated workflow model selector.</p>
  </div>
  <div class="feature-card">
    <h4>📊 Dashboard</h4>
    <p>Centralized management with 5 tabs: Intelligence, Knowledge, Sessions, Context, and Settings, including model routing, import/export, and multi-project session binding.</p>
  </div>
  <div class="feature-card">
    <h4>🔗 Works Everywhere</h4>
    <p>Project memory is available across Copilot Chat, background agents, cloud agents, and Codex through tool-based access and auto-injected context.</p>
  </div>
</div>
---

## How It Works

{::nomarkdown}
<pre class="mermaid">
graph TD
    A[You work with Copilot normally] --> B[Auto-Capture and Intelligence Layer]
    B --> C[Knowledge Cards grow as you work]
    C --> D[Every new session starts informed]

    style A fill:#1f6feb,stroke:#388bfd,color:#fff
    style B fill:#1158c7,stroke:#388bfd,color:#fff
    style C fill:#1f6feb,stroke:#388bfd,color:#fff
    style D fill:#238636,stroke:#3fb950,color:#fff
</pre>
{:/nomarkdown}
The AI never starts from scratch again. Each session builds on everything that came before it.

---

## Where ContextManager Fits

There are four layers of AI guidance in VS Code. Each solves a different problem:

| Layer | Tool | Character |
|:------|:-----|:----------|
| **Global Behavior** | `.github/copilot-instructions.md` | Static, global, human-authored |
| **Task Workflows** | `*.prompt.md` files | Static, task-scoped, human-authored |
| **Agent Capabilities** | `SKILL.md` files | Static, capability-scoped, human-authored |
| **Project Knowledge** | **ContextManager** ← | Dynamic, per-project, AI-generated + human-curated |

Layers 1–3 are author-first: you write them at setup time. Layer 4 is discover-first: knowledge accumulates dynamically as you and the AI work on the project.

---

## Quick Start

> **1.** Install the extension from VS Code Marketplace
>
> **2.** Click 📖 in the Activity Bar → Create a project
>
> **3.** Chat with Copilot normally — ContextManager runs silently in the background
>
> **4.** Once a week: open the Dashboard → Knowledge tab → Card Queue section → click **Distill into Cards** to review captured knowledge
>
> **5.** Every new session starts informed automatically — no special commands needed

[Installation →]({% link installation.md %})
{: .fs-5 }

---

## System Requirements

- **VS Code** 1.100.0 or higher
- **GitHub Copilot** - required for AI features (language model API)
- Any programming language - optimized for TypeScript/JavaScript, C/C++, Python, C#

---

## What's New in v2.10.0

- **Dedicated model selectors** — choose separate model families for background extraction, AI workflows, and AI card synthesis
- **Workflow expansion** — combine AI-backed and template-only actions, event triggers, target-aware card updates, and skip-pattern suppression
- **Folder-aware card flows** — `#saveCard` can list folders, create folders, and save directly into a named folder
- **Dashboard resilience** — in-progress edits in the dashboard are protected from background refresh disruptions

See the [full changelog]({% link changelog.md %}) for complete version history.
