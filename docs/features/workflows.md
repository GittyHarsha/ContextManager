---
layout: default
title: Custom Workflows
parent: Features
nav_order: 5
---

# Custom Workflows
{: .fs-8 }

User-defined workflow pipelines that render templates against your project knowledge, then either ask the model for markdown output or save the rendered template directly. AI workflow actions can use their own dedicated model family.
{: .fs-5 .fw-300 }

---

## Overview

Workflows let you define reusable operations that combine your project data with a custom template and then either:

- send the rendered template to the LLM and store the markdown result
- save the rendered template directly with no model call

AI workflow actions use the dedicated **Workflow Model** setting (`contextManager.workflows.modelFamily`) when set, so you can keep workflow automation on a different model than background extraction or card synthesis.

Use cases:
- **Summarize recent observations** into a daily digest card
- **Generate onboarding guides** from your conventions and working notes
- **Auto-classify queue items** into themed knowledge cards
- **Audit selected cards** for staleness or gaps
- **Append raw change logs** or structured runbooks without using AI
- **Extract action items** from new queue captures

---

## Creating a Workflow

Open the Dashboard → **Intelligence** tab → scroll to the **Custom Workflows** section → click **+ New Workflow**.

### Workflow Fields

| Field | Description |
|:------|:------------|
| **Name** | Display name for the workflow |
| **Trigger** | When the workflow runs automatically (see [Triggers](#triggers)) |
| **Prompt Template** | The template rendered with `{% raw %}{{variable}}{% endraw %}` placeholders. AI actions send this to the model; template actions save it directly. |
| **Output Action** | Whether to use AI output or the rendered template, and what to do with it |
| **Target Card** | Which card to update (for update/append actions) |
| **Max Items** | Maximum number of items when rendering collection variables (default: 20) |
| **Skip Pattern** | Optional regex. If the LLM output matches, the output action is skipped and the run is recorded as "skipped" |
| **Trigger Filter** | Optional regex. For auto-triggered workflows, only fires when event content matches this pattern |

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

{: .tip }
> For auto-triggered workflows with an update or append action, ContextManager automatically resolves the target card's data into `{% raw %}{{card.title}}{% endraw %}`, `{% raw %}{{card.content}}{% endraw %}`, and `{% raw %}{{card.tags}}{% endraw %}` — even when triggered by events. This lets your template reference existing card content for intelligent merging or direct appends.

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

{: .note }
> You can add a **Trigger Filter** regex to any auto-triggered workflow. The workflow only fires when the event content (queue item text, convention content, card content, or observation summary) matches the filter pattern. Leave blank to fire on all events.

---

## Output Actions

| Action | Behavior |
|:-------|:---------|
| **AI: Create Card** | Sends the rendered template to the LLM, then creates a new knowledge card from the markdown response. Title is extracted from the first heading or generated from the workflow name. Tags `workflow` and the workflow name are auto-added. |
| **AI: Update Card** | Sends the rendered template to the LLM, then replaces the target card content with the markdown response. Requires a target card. |
| **AI: Append to Collector** | Sends the rendered template to the LLM, then appends the markdown response with a dated separator to the target card. Useful for digests and accumulators. Requires a target card. |
| **Template: Create Card** | Skips the model call and creates a new card from the rendered template exactly as written. |
| **Template: Update Card** | Skips the model call and replaces the target card with the rendered template. Requires a target card. |
| **Template: Append to Collector** | Skips the model call and appends the rendered template with a dated separator to the target card. Requires a target card. |

{: .note }
> AI workflow output is stored as markdown. Headings, lists, tables, and code blocks are preserved when cards are created or updated.

---

## Skip Pattern

A workflow can define an optional **Skip Pattern** — a regex tested against the final rendered output before the output action executes. For AI actions this means the model response; for template actions it means the resolved template text. If the pattern matches, the output action is skipped entirely and the run is recorded with a ⏭️ "skipped" status.

This is useful when auto-triggered workflows sometimes produce low-value or placeholder responses. For example, setting the skip pattern to `no relevant content|nothing to report` prevents the workflow from creating or updating cards when the AI has nothing meaningful to say.

---

## Re-Entrancy Protection

Workflows that output to cards (create or update) could theoretically trigger other workflows listening for card-created or card-updated events, creating an infinite loop. ContextManager prevents this with a re-entrancy guard: while a workflow's output action is executing, all other workflow triggers are suppressed.

---

## Execution History

Each workflow tracks its last 15 runs with a timestamp and status: **success** (✅), **skipped** (⏭️), or **error** (❌). The dashboard displays aggregated run counts under each workflow so you can monitor health at a glance — for example, "8✅ 3⏭️ 1❌" tells you the workflow is mostly succeeding but occasionally skipping or failing. Error runs also record the failure reason for debugging.

---

## Dashboard UI

The workflows section appears in the **Intelligence** tab of the Dashboard:

- **Workflow list** — Each workflow shows its name, trigger badge, output action type (`AI` or `Template`), and run status
- **Trigger badges** — Color-coded: blue for auto-queue, gray for manual, purple for event triggers
- **Run button** (▶) — Manually execute any workflow
- **Edit/Delete** — Modify or remove workflows
- **Enable/Disable** toggle — Pause a workflow without deleting it
- **Run history summary** — Each workflow shows aggregated success/skipped/error counts from recent runs
- **Skipped status** (⏭️) — Shown when the skip pattern matched the LLM output
- **Add form** — Clickable variable insertion buttons grouped by category (Queue, Card, Project, Collections, Event), plus output modes for AI-backed or direct template actions

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
| Prompt | `## {% raw %}{{convention.title}}{% endraw %}\n\n{% raw %}{{convention.content}}{% endraw %}` |
| Output | Template: Append to Collector |
| Target Card | (select your changelog card) |

---

## Settings

| Setting | Default | Description |
|:--------|:--------|:------------|
| `contextManager.workflows.modelFamily` | _(auto)_ | Preferred model family for AI workflow actions. Template-only actions ignore this setting. |
| Max Items | `20` | Per-workflow cap on collection variable expansion |
| Skip Pattern | _(empty)_ | Per-workflow regex; if the LLM output matches, the output action is skipped |
| Trigger Filter | _(empty)_ | Per-workflow regex; auto-trigger only fires when event content matches |

Workflows are stored per-project and persist across sessions.

---

## Next Steps

[Distill Pipeline →]({% link features/distill-pipeline.md %})
{: .fs-5 }
