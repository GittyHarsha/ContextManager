# TODO Feature Removal Report

## Summary

Removed all UI-facing TODO remnants from the ContextManager extension. Backend handlers and tools were intentionally left in place per instructions.

## What Was Removed

### 1. Sidebar (`src/sidebar/ProjectsTreeProvider.ts`)
- **TODO tree items**: Removed `todo` and `todos-section` from `TreeItemType` union
- **Tree rendering**: Removed `createTodoItem()` and `createTodosSectionItem()` methods
- **Tree children**: Removed `todos-section` from project children; removed `todos-section` expansion logic
- **Project description**: Changed from `"X todos · Y/Z cards"` to `"Y/Z cards"`
- **Sidebar commands**: Removed `contextManager.addTodo`, `contextManager.deleteTodo`, `contextManager.completeTodo`, `contextManager.runTodoAgent` command registrations
- **Import**: Removed `Todo` type import

### 2. Dashboard Settings (`src/dashboard/DashboardPanel.ts`)
- **TODO Agent settings section**: Removed the entire `<details>` block for "TODO Agent" (auto-update status checkbox)
- **Tool sharing checkbox**: Removed "Active TODOs" checkbox from `#projectContext Tool` sharing config
- **Prompt editor**: Removed `/todo` prompt from the custom prompts section
- **Import**: Removed unused `Todo` type import
- **Doc comment**: Updated file-level comment to remove "todos" reference

### 3. Status Bar (`src/extension.ts`)
- **Tooltip**: Removed `**TODOs:** X pending` line from status bar tooltip
- **Variable**: Removed `todoCount` calculation

### 4. Package.json (`package.json`)
- **Commands**: Removed 4 commands: `addTodo`, `deleteTodo`, `completeTodo`, `runTodoAgent`
- **Menu items**: Removed 4 `view/item/context` menu entries for TODO tree items
- **Settings**: Removed `contextManager.todo.autoUpdateStatus` setting
- **Settings**: Removed `contextManager.prompts.todo` setting
- **Dashboard tab enum**: Removed `"todos"` from `dashboard.defaultTab` enum
- **Settings allowlist** (`src/dashboard/messageHandler.ts`): Removed `todo.autoUpdateStatus` and `prompts.todo`

## What Was Left (Intentionally)

### Backend Message Handlers (`src/dashboard/messageHandler.ts`)
- `addTodo`, `updateTodo`, `deleteTodo`, `runTodoAgent` in the message handler allowlist (line 20)
- `continueWithPrompt`, `resumeTodo`, `viewTodoDetails`, `viewTodoHistory` handlers (line 23)
- All case handlers for these messages (lines 269-624)
- **Reason**: These are backend handlers, not UI-facing. Left per instructions.

### Dashboard Webview Script (`src/dashboard/webviewScript.ts`)
- TODO-related JS functions: `showAddTodoForm`, `addTodo`, `toggleTodo`, `deleteTodo`, `runAgent`, `searchTodos`, `filterTodos`, `bulkDeleteTodos`, `bulkCompleteTodos`, etc.
- **Reason**: These are client-side script functions called by the TODO tab HTML. The TODO tab rendering itself was not modified (it's generated dynamically based on project data). These functions are dead code if no TODOs exist but cause no harm.

### Dashboard Styles (`src/dashboard/styles.ts`)
- `.todo-item`, `.todo-status`, `.todo-title` CSS classes
- **Reason**: Unused CSS causes no harm and no UI artifact.

### Package.json (non-UI items)
- `"todo"` keyword (line 30) — SEO/marketplace keyword, harmless
- `/todo` chat participant command (line 105) — backend chat command
- `chatSessions` welcome message mentioning TODOs (line 170-171) — session history UI, minimal impact
- `confirmDelete` description mentioning TODOs (line 400) — minor text, not a visible UI element
- `context.autoDeselectAfterUse` description mentioning TODO (line 470) — settings description text
- Various tool descriptions mentioning TODO in `lm_tools` (lines 1258+) — backend tool metadata

### Other Files
- `src/tools/todoManagerTool.ts` — backend tool, left per instructions
- `src/projects/types.ts` — `Todo` type definition, used by backend code
- `src/dashboard/DashboardPanel.ts` line 1327 — `shareTodos` in default config object (backend default, no UI)
- `src/dashboard/DashboardPanel.ts` line 1985 — research prompt mentioning "TODO Tracking" (prompt text, not UI)

## Remaining References for Future Cleanup

If the TODO feature is fully deprecated, consider removing in a future pass:
1. **Message handlers** in `messageHandler.ts` (lines 269-624)
2. **Webview script functions** in `webviewScript.ts` (all todo-related JS functions)
3. **CSS styles** in `styles.ts` (`.todo-*` classes)
4. **Chat participant command** `/todo` in `package.json`
5. **Tool** `src/tools/todoManagerTool.ts`
6. **Type** `Todo` in `src/projects/types.ts` and `todos` field on `Project`
7. **chatSessions** description text in `package.json`

## Verification

- TypeScript compilation passes (`tsc --noEmit` exits with code 0)
- No sidebar TODO tree items will render (type removed from union)
- No TODO Agent settings section in dashboard Settings tab
- No TODO count in status bar tooltip
