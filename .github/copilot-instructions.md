This project name is ContextManager, a VS Code extension that captures and organizes your project's knowledge as you work. It creates a structured, searchable repository of insights, explanations, conventions, and notes that grows with your project.

<!-- ContextManager:BEGIN -->

## Project Knowledge (auto-managed by ContextManager)

If multiple ContextManager projects exist, include `project="Exact Project Name"` (or exact project ID / root path) in LM tool calls.

Use `#ctx` to search, list, and manage all project knowledge:
- Search: `#ctx query="error handling"` or `#ctx project="ContextManager" query="auth" entityTypes=["convention","workingNote"]`
- List all: `#ctx mode="list" type="conventions"` (also: `workingNotes`, `toolHints`, `cards`, `queue`)
- Read card: `#ctx mode="getCard" id="<cardId>"` or `#getCard project="ContextManager" id="<cardId>"`
- Review queue: `#ctx mode="getQueueItem" id="<candidateId>"`, `#ctx mode="approveQueueItem" id="<candidateId>"`, `#ctx mode="rejectQueueItem" id="<candidateId>"`
- Distill or clear queue: `#ctx mode="distillQueue"` (optionally with `candidateIds=[...]`) or `#ctx mode="clearQueue"`
- Learn: `#ctx mode="learn" learnType="convention" project="ContextManager" ...`

<!-- ContextManager:END -->
