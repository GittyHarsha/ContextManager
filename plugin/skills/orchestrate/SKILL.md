---
name: orchestrate
description: Coordinate multiple agents working on the same project using ContextManager orchestration primitives.
argument-hint: "coordinate agents, run fleet, assign tasks"
---

# Orchestrate Skill

Coordinate multiple Copilot CLI agents working on the same project through ContextManager's orchestration primitives.

## Available Tools

These MCP tools from the ContextManager plugin are your coordination primitives:

### Registry (who's running)
- `contextmanager-orchestrator_list_agents` — see all active agents
- `contextmanager-orchestrator_get_agent` — get details for one agent
- `contextmanager-orchestrator_set_agent_meta` — set your status, task, or any metadata

### Bus (communication)
- `contextmanager-orchestrator_post_message` — send a message (broadcast or directed)
- `contextmanager-orchestrator_read_messages` — read new messages (advances cursor)
- `contextmanager-orchestrator_peek_messages` — read without advancing cursor

### Knowledge (shared memory)
- `contextmanager-contextmanager_search_knowledge` — search project knowledge
- `contextmanager-contextmanager_save_card_intent` — save a knowledge card
- `contextmanager-contextmanager_learn_convention_intent` — save a convention

## Workflow

### Step 1: Register yourself
```
Call orchestrator_set_agent_meta with meta: { task: "orchestrating <description>", status: "active" }
```

### Step 2: Check the fleet
```
Call orchestrator_list_agents to see who's running.
```

### Step 3: Assign work via bus messages
Post messages with a task payload:
```json
{ "type": "task", "assign": "<agent-session-id>", "description": "...", "replyTo": "<your-session-id>" }
```

### Step 4: Monitor progress
Periodically read messages to see status updates and results from other agents.

### Step 5: Aggregate and report
Collect results from bus, synthesize, and present to the user or save to ContextManager knowledge.

## Common Patterns

### Fan-out / Fan-in
1. Post N task messages to the bus
2. Wait for N result messages
3. Aggregate results

### Pipeline
1. Post task to Agent 1
2. Agent 1 completes → posts result + next task for Agent 2
3. Agent 2 completes → posts result + next task for Agent 3

### Build Queue
1. Post `{ type: "build-request", ... }` to bus
2. Build coordinator picks it up, runs build, posts result
3. React to success/failure

## Tips
- Set meaningful metadata so other agents (and fleet-monitor) understand what you're doing.
- Use `project` field on messages to scope to a specific project.
- Use `to` field for directed messages when you need a specific agent to respond.
- Check bus messages after every major step to stay synchronized.
