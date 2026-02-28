---
layout: default
title: Card Queue
parent: Features
nav_order: 2
---

# Card Queue
{: .fs-8 }

Automatic staging buffer that captures AI responses and synthesizes high-quality knowledge card proposals.
{: .fs-5 .fw-300 }

---

## Overview

The Card Queue solves a fundamental problem: most valuable insights from AI conversations are never captured because the developer is focused on the task at hand, not on documentation.

ContextManager silently queues every AI response that meets a minimum length threshold. When you're ready, a single "Distill" action synthesizes all queued responses into knowledge card proposals - surfacing cross-cutting patterns that no single response contains clearly enough on its own.

Cards extracted by the [Auto-Capture / Auto-Learn]({% link features/project-intelligence.md %}) service are also staged here rather than being silently created. Every auto-detected knowledge card and architecture note lands in the queue for your review first.

---

## How It Works

{::nomarkdown}
<pre class="mermaid">
graph TD
    A[AI Response over 300 chars] --> B[Automatically queued]
    B --> C[Tool call evidence captured]
    C --> D[User clicks Distill into Cards]
    D --> E[Single LLM call synthesizes all]
    E --> F[Card proposals with scores]
    F --> G[One-click Add Card or Approve All]

    style A fill:#7c3aed,stroke:#a78bfa,color:#fff
    style B fill:#2563eb,stroke:#58a6ff,color:#fff
    style D fill:#d97706,stroke:#fbbf24,color:#fff
    style E fill:#d97706,stroke:#fbbf24,color:#fff
    style G fill:#059669,stroke:#3fb950,color:#fff
</pre>
{:/nomarkdown}
### Zero-Cost Capture

Unlike previous designs, the Card Queue does **not** run an LLM call per response to assess worthiness. Every response over the minimum length is silently queued at zero cost. Quality judgement happens once, at distill time.

### Cross-Response Synthesis

The `distillQueue()` pipeline reads the entire card queue in one LLM call and:

- Identifies cross-cutting themes across multiple responses
- Generates card proposals with titles, categories, and content
- Assigns confidence scores (0–1)
- Maps each proposal to `sourceIndices[]` showing which responses contributed
- Surfaces insights that span multiple conversations

---

## Tool Call Evidence

When responses are captured via the agent hook system, tool calls are captured alongside:

| Field | Description |
|:------|:------------|
| **Tool Name** | Which tool was used (e.g., `read_file`, `grep_search`) |
| **Input** | Truncated input arguments (≤200 chars per call) |
| **Count** | Total tool calls per turn (capped at 10) |

This evidence helps the AI feel confident that the knowledge was already investigated - reducing redundant codebase exploration when distilling.

---

## Dashboard UI

The Card Queue lives in the **Intelligence tab** at the bottom:

- **📬 Card Queue** header with pending count
- **Distill into Cards** button - runs the synthesis pipeline
- **Clear Queue** - remove all queued items
- **Raw items accordion** - collapsible list showing each queued response:
  - Participant source and prompt preview
  - Response character count
  - 🔧 Tool call badge (when present)
  - Rendered response content (collapsible)
  - Tool call details (collapsible monospace list)
  - Per-item ✕ removal

### Distill Results

After distilling, results appear inline in the Intelligence tab:

- Category badge and confidence percentage
- Content preview
- Reasoning explanation
- Source indices linking to original responses
- **+ Add Card** button per proposal
- **Approve All** for batch creation

### Smart-Merge on Approval

When you approve any card (from distill results or the raw queue), ContextManager checks existing cards for similarity using Jaccard word-set overlap. If a similar card is found (≥ 30% overlap), a QuickPick appears:

- **Create new card** — proceed as normal
- **Merge into: [existing title] (XX% similar)** — append the new card's content to the existing card with a dated separator

This prevents duplicate cards from accumulating as auto-capture and distill run over time.

---

## Settings

| Setting | Default | Description |
|:--------|:--------|:------------|
| `cardQueue.enabled` | `true` | Enable automatic response queuing |
| `cardQueue.minResponseLength` | `300` | Minimum response length to queue (50–5000) |

### Queue Limits

- **Maximum 30 items** - oldest items evicted when cap is exceeded (FIFO)
- **Tool calls capped at 10** per response - to control token budget
- **Tool inputs truncated to 200 chars** - aggressive truncation for budget control

---

## Pipeline Architecture

{::nomarkdown}
<pre class="mermaid">
graph TD
    A[capture.ps1] --> B[hook-queue.jsonl]
    B --> C[HookWatcher.processEntry]
    C --> D[queueCardCandidate]
    D --> E[createQueuedCard]
    E --> F[ProjectManager.addToCardQueue]
    F --> G[Dashboard - Intelligence tab]

    style A fill:#d97706,stroke:#fbbf24,color:#fff
    style C fill:#2563eb,stroke:#58a6ff,color:#fff
    style F fill:#2563eb,stroke:#58a6ff,color:#fff
    style G fill:#059669,stroke:#3fb950,color:#fff

Note: the Auto-Capture service (`autoCapture.ts`) feeds the same queue — auto-detected knowledge cards enter at **`ProjectManager.addToCardQueue`**, never bypassing user review.
</pre>
{:/nomarkdown}
---

## Next Steps

[Dashboard →]({% link features/dashboard.md %})
{: .fs-5 }
