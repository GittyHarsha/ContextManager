# ContextManager Copilot CLI Plugin

This directory is now a real GitHub Copilot CLI plugin package.

Current scope:
- installable plugin manifest in `plugin.json`
- plugin root hook config in `hooks.json`
- plugin MCP config in `.mcp.json`
- bundled stdio MCP server in `server/contextmanager-mcp.js`
- reference hook config in `hooks/copilot-cli-hooks.json`
- Cross-platform queue writer scripts in `scripts/capture.ps1` and `scripts/capture.sh`
- Cross-platform explicit write-intent helpers in `scripts/write-intent.ps1` and `scripts/write-intent.sh`
- Session correlation via a synthetic persisted session ID per working directory under `~/.contextmanager/plugin-sessions/`
- VS Code command `ContextManager: Install Copilot CLI Plugin Hooks` to generate a project-ready hook config

Current behavior:
- emits normalized `SessionStart`, `SessionEnd`, `UserPromptSubmitted`, `PostToolUse`, and `ErrorOccurred` events into `~/.contextmanager/hook-queue.jsonl`
- tags events with `origin = "copilot-cli-plugin"`
- reuses `~/.contextmanager/session-context.txt` for prompt/session context injection
- can append normalized `WriteIntent` entries for explicit save/learn operations without direct writes to project storage
- exposes a local MCP server named `contextmanager` with project listing, knowledge search/read, session listing, and write-intent queue tools

Current limitations:
- no plugin skills yet
- MCP write operations are currently queued as intents and materialized by the VS Code extension, not written directly by the MCP process
- Copilot CLI hook docs do not document a stable session ID, so the scripts synthesize one locally per working directory

Preferred setup for GitHub Copilot CLI:
1. From this repository root, run `copilot plugin install ./plugin`.
2. Restart the Copilot CLI session or reinstall after local plugin changes, because Copilot caches installed plugin contents.
3. Start the ContextManager VS Code extension so `HookWatcher` is ingesting `~/.contextmanager/hook-queue.jsonl`.
4. Verify the MCP server with `/mcp show contextmanager` inside Copilot CLI.

Repository install options:
1. Local path install: `copilot plugin install ./plugin`
2. Direct repo install with plugin path: `copilot plugin install GittyHarsha/ContextManager:plugin`

Alternate non-plugin setup:
1. Run `ContextManager: Install Copilot CLI Plugin Hooks` from VS Code.
2. That command copies the scripts into `~/.contextmanager/scripts/copilot-cli/` and writes `.github/hooks/contextmanager-copilot-cli-hooks.json` for the active project.
3. This is useful if you want repo-level hook wiring without going through `copilot plugin install`.

Planned next steps:
1. Expand MCP tools from read plus queued writes into direct update/delete coverage.
2. Add plugin install/status help inside the dashboard.
3. Add shared Claude Code hook config using the same event contract.