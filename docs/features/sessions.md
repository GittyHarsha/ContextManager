---
layout: default
title: Session Routing
parent: Features
nav_order: 9
---

# Multi-Project Session Routing
{: .fs-8 }

Track every Copilot chat session, route captures to the right project, and manage unbound events from the Dashboard.
{: .fs-5 .fw-300 }

---

## How It Works

When agent hooks are active, every Copilot chat session emits events (`Stop`, `PreCompact`, `PostToolUse`, etc.) into a shared queue file (`~/.contextmanager/hook-queue.jsonl`). The extension's **HookWatcher** reads these events and needs to know which ContextManager project each session belongs to.

- **Single project** — everything routes automatically. No manual steps needed.
- **Multiple projects** — sessions appear as "unbound" in the Sessions tab until you explicitly bind them to a project. Captures are queued as pending until binding.

---

## The Sessions Tab

Open the Dashboard → **Sessions** tab. Each tracked session shows:

| Column | Description |
|:-------|:------------|
| **Label** | First prompt snippet or auto-generated name |
| **Origin** | Source: `vscode-extension` (VS Code Copilot) or `copilot-cli-plugin` (terminal) |
| **Status** | `pending` (unbound), `bound` (assigned to a project), `dismissed` (hidden) |
| **Pending** | Number of hook events waiting to be materialized into project memory |
| **Last Activity** | Timestamp of the most recent event |

---

## Binding a Session

When a session appears with pending captures and no project assigned:

1. Click **Bind & Import Pending** on the session row
2. Select the target project from the dropdown
3. All queued captures (observations, card queue candidates, intelligence extractions) are materialized into that project immediately

{: .tip }
If you only have one project, binding happens automatically — you won't see unbound sessions.

---

## Rebinding

Already bound a session but want future captures to go to a different project?

1. Click **Rebind From Now** on the session row
2. Select the new target project
3. Future events go to the new project; past captures stay in the original project

This is useful when you switch tasks mid-conversation.

---

## Dismiss vs Delete

| Action | What it does | Reversible? |
|:-------|:-------------|:------------|
| **Dismiss** | Hides the session from the list. If new activity arrives, it reappears automatically. | Yes — new events restore it |
| **Delete** | Permanently removes the session record and all pending (unmaterialized) captures. | No |

---

## Bulk Operations

Select multiple sessions with checkboxes, then use the bulk action buttons:

- **Dismiss Selected** — soft-hide all selected sessions
- **Delete Selected** — permanently remove all selected sessions and their pending captures

{: .note }
Delete confirmation is handled by a VS Code dialog, not the webview.

---

## Disabling Session Tracking

If you don't need session routing at all:

1. Open Dashboard → **Settings** tab → **Session Tracking** section
2. Uncheck **Enable Session Tracking**

Or set `contextManager.sessionTracking.enabled` to `false` in VS Code settings.

When disabled:
- No sessions are recorded
- The Sessions tab stays empty
- Hook capture and auto-capture continue to work independently (they fall back to the active project)

---

## How Project Resolution Works

When a hook event arrives, the extension tries to resolve the target project automatically:

1. **Explicit hint** — the event may carry a `projectIdHint` or `rootHint` (working directory)
2. **Root path match** — if the event's `cwd` matches a project's root paths, that project is used
3. **Active project fallback** — if only one project exists, it's used automatically
4. **Queue as pending** — if none of the above resolve, the event is queued until the user binds the session manually

---

## Filtering

Use the filter controls at the top of the Sessions tab:

- **Status filter** — show only pending, bound, or dismissed sessions
- **Search** — filter by session label or first prompt text
