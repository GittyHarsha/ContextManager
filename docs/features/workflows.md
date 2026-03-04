---
layout: default
title: Custom AI Workflows
parent: Features
nav_order: 5
---

# Custom AI Workflows
{: .fs-8 }

User-defined AI pipelines that execute custom prompts against your project knowledge and take action on the results.
{: .fs-5 .fw-300 }

---

## Overview

Workflows let you define reusable AI operations that combine your project data with a custom prompt template, send it to the LLM, and automatically create or update knowledge cards with the result.

Use cases:
- **Summarize recent observations** into a daily digest card
- **Generate onboarding guides** from your conventions and working notes
- **Auto-classify queue items** into themed knowledge cards
- **Audit selected cards** for staleness or gaps
- **Extract action items** from new queue captures

---

## Creating a Workflow

Open the Dashboard → **Intelligence** tab → scroll to the **Custom AI Workflows** section → click **+ New Workflow**.

### Workflow Fields

| Field | Description |
|:------|:------------|
| **Name** | Display name for the workflow |
| **Trigger** | When the workflow runs automatically (see [Triggers](#triggers)) |
| **Prompt Template** | The prompt sent to the LLM, using `{% raw %}{{variable}}{% endraw %}` placeholders |
| **Output Action** | What to do with the LLM response |
| **Target Card** | Which card to update (for update/append actions) |
| **Max Items** | Maximum number of items when rendering collection variables (default: 20) |

---

## Template Variables
{: #template-variables }

Prompt templates use `{% raw %}{{namespace.field}}{% endraw %}` syntax to inject data from your project. Click the variable buttons in the form to insert them.

### Queue Variables

| Variable | Description |
|:---------|:------------|
| `{% raw %}{{queue.prompt}}{% endraw %}` | The user's prompt from a queued item |
| `{% raw %}{{queue.response}}{% endraw %}` | The AI response from a queued item |
| `{% raw %}{{queue.participant}}{% endraw %}` | Which chat participant produced It |
| `{% raw %}{{queue.toolCalls}}{% endraw %}` | Tool calls made during the interaction |

### Card Variables

| Variable | Description |
|:---------|:------------|
| `{% raw %}{{card.title}}{% endraw %}` | Title of the target card |
| `{% raw %}{{card.content}}{% endraw %}` | Content of the target card |
| `{% raw %}{{card.tags}}{% endraw %}` | Comma-separated tags of the target card |

### Project Variables

| Variable | Description |
|:---------|:------------|
| `{% raw %}{{project.name}}{% endraw %}` | Active project name |
| `{% raw %}{{project.description}}{% endraw %}` | Project description |
| `{% raw %}{{project.conventions}}{% endraw %}` | All enabled conventions (formatted list) |

### Collection Variables

These expand to multiple items, capped by the **Max Items** setting:

| Variable | Description |
|:---------|:------------|
| `{% raw %}{{cards.all}}{% endraw %}` | All knowledge cards (title + content + tags) |
| `{% raw %}{{cards.selected}}{% endraw %}` | Only selected/checked cards |
| `{% raw %}{{conventions.all}}{% endraw %}` | All enabled conventions |
| `{% raw %}{{toolHints.all}}{% endraw %}` | All tool hints |
| `{% raw %}{{workingNotes.all}}{% endraw %}` | All enabled working notes |
| `{% raw %}{{observations.recent}}{% endraw %}` | Observations from the last 24 hours |

### Event Variables

Available when a workflow is triggered by an entity event:

| Variable | Description |
|:---------|:------------|
| `{% raw %}{{convention.title}}{% endraw %}` | Title of the convention that triggered the workflow |
| `{% raw %}{{convention.content}}{% endraw %}` | Content of the triggering convention |
| `{% raw %}{{observation.summary}}{% endraw %}` | Summary of the observation that triggered the workflow |
| `{% raw %}{{observation.files}}{% endraw %}` | Files referenced in the triggering observation |

---

## Triggers
{: #triggers }

Triggers control when a workflow runs automatically:

| Trigger | Description |
|:--------|:------------|
| **Manual** | Only runs when you click the ▶ Run button |
| **Auto-Queue** | Fires when a new item is added to the card queue |
| **Both** | Fires on queue item **and** available for manual run |
| **Convention Learned** | Fires when a new convention is discovered |
| **Card Created** | Fires when a knowledge card is created |
| **Card Updated** | Fires when a knowledge card is updated |
| **Observation Created** | Fires when an observation is captured |

{: .tip }
> Event triggers (convention-learned, card-created, card-updated, observation-created) fire automatically in the background. The triggering entity's data is available via the corresponding event variables.

---

## Output Actions

| Action | Behavior |
|:-------|:---------|
| **Create Card** | Creates a new knowledge card from the LLM output. Title is extracted from the first heading or generated from the workflow name. Tags `workflow` and the workflow name are auto-added. |
| **Update Card** | Replaces the content of the target card with the LLM output. Requires a target card to be selected. |
| **Append to Collector** | Appends the LLM output (with a dated separator) to the target card. Useful for running logs, digests, and accumulators. |

---

## Re-Entrancy Protection

Workflows that output to cards (create or update) could theoretically trigger other workflows listening for card-created or card-updated events, creating an infinite loop. ContextManager prevents this with a re-entrancy guard: while a workflow's output action is executing, all other workflow triggers are suppressed.

---

## Dashboard UI

The workflows section appears in the **Intelligence** tab of the Dashboard:

- **Workflow list** — Each workflow shows its name, trigger badge, output action, and run status
- **Trigger badges** — Color-coded: blue for auto-queue, gray for manual, purple for event triggers
- **Run button** (▶) — Manually execute any workflow
- **Edit/Delete** — Modify or remove workflows
- **Enable/Disable** toggle — Pause a workflow without deleting it
- **Add form** — Clickable variable insertion buttons grouped by category (Queue, Card, Project, Collections, Event)

---

## Example Workflows

### Daily Observation Digest

| Setting | Value |
|:--------|:------|
| Name | Daily Observation Digest |
| Trigger | Manual |
| Prompt | `Summarize these recent observations into a concise daily digest with key themes and action items:` `{% raw %}{{observations.recent}}{% endraw %}` |
| Output | Create Card |
| Max Items | 50 |

### Auto-Classify Queue Items

| Setting | Value |
|:--------|:------|
| Name | Auto-Classify |
| Trigger | Auto-Queue |
| Prompt | `Given this AI interaction: {% raw %}{{queue.prompt}}{% endraw %} / {% raw %}{{queue.response}}{% endraw %} — Classify it and write a concise knowledge card. Consider existing conventions: {% raw %}{{conventions.all}}{% endraw %}` |
| Output | Create Card |

### Convention Change Log

| Setting | Value |
|:--------|:------|
| Name | Convention Change Log |
| Trigger | Convention Learned |
| Prompt | `A new convention was learned: "{% raw %}{{convention.title}}{% endraw %}": {% raw %}{{convention.content}}{% endraw %}. Write a brief changelog entry explaining what changed and why.` |
| Output | Append to Collector |
| Target Card | (select your changelog card) |

---

## Settings

| Setting | Default | Description |
|:--------|:--------|:------------|
| Max Items | `20` | Per-workflow cap on collection variable expansion |

Workflows are stored per-project and persist across sessions.

---

## Next Steps

[Distill Pipeline →]({% link features/distill-pipeline.md %})
{: .fs-5 }
