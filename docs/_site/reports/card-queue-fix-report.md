# Card Queue Fix Report

## Root Cause Analysis

### 1. Clear Queue button not working
**Root cause**: CSP blocks inline `onclick="clearQueue()"` on the button.
**Handler status**: The `clearCardQueue` message handler in `messageHandler.ts` (line ~1400) is **correct**. It validates `projectId`, checks queue exists, shows a modal confirmation dialog, calls `projectManager.clearCardQueue()`, and updates the UI.
**Fix**: Replaced inline `onclick` with CSS class `.queue-clear-btn` and added a delegated click handler in `webviewScript.ts`. The handler is now CSP-safe.

### 2. No individual card selection (CRITICAL BUG)
**Root cause**: The `distillQueue()` function collects selected items via `document.querySelectorAll('.queue-select-cb:checked')`, but **no individual checkboxes existed on candidate cards**. Only a "Select All" checkbox was rendered. This meant:
- `distillQueue()` always found 0 checked items → always showed "No items selected" error
- Even if CSP was fixed, distill would never work without individual checkboxes
- Users had no way to select/deselect individual candidates

**Fix**: Added `<input type="checkbox" class="queue-select-cb" data-id="...">` to each candidate card's summary row in `DashboardPanel.ts`.

### 3. Distill into Cards button not working
**Root cause**: Two compounding issues:
1. CSP blocks inline `onclick="distillQueue()"` (same as Clear Queue)
2. Missing individual checkboxes meant 0 items were ever selected (see #2 above)

**Handler status**: The `distillQueue` message handler in `messageHandler.ts` (line ~1190) is **correct**. It supports both full-queue and selected-subset distillation via `message.candidateIds`, calls `ctx.autoCapture.distillQueue()`, and handles errors properly.
**Fix**: Added `.queue-distill-btn` class with delegated handler, and individual checkboxes now provide selectable items.

## What Was Fixed

### DashboardPanel.ts
- **Individual checkboxes**: Added `.queue-select-cb` checkbox with `data-id` attribute to each candidate card in the queue summary row
- **Delegated-friendly buttons**: Replaced inline `onclick` handlers on all queue buttons with CSS classes and `data-candidate-id` attributes:
  - `.queue-reject-btn` — remove individual item
  - `.queue-approve-btn` — save individual item as card
  - `.queue-edit-btn` — edit and save individual item
  - `.queue-distill-btn` — bulk distill selected items
  - `.queue-clear-btn` — clear entire queue
- **Select All**: Removed inline `onchange` from `#queue-select-all` checkbox (now handled by delegated `change` listener)

### webviewScript.ts
- **Delegated click handlers**: Extended the existing `document.addEventListener('click', ...)` delegation block to handle all queue button classes (CSP-safe)
- **`toggleCandidateSelection(indexOrCheckbox)`**: New function that:
  - Accepts an index (number) or checkbox element
  - Toggles the checkbox state when called by index
  - Updates visual indicator (opacity/border) on parent card
  - Syncs "Select All" checkbox state (checked/indeterminate/unchecked)
- **`updateCandidateVisual(checkbox)`**: Helper that dims deselected cards (opacity 0.55, transparent border) and highlights selected ones
- **Delegated `change` handler**: Listens for `change` events on `#queue-select-all` and `.queue-select-cb` elements, routing to `toggleAllQueueItems` and `toggleCandidateSelection` respectively
- **`toggleAllQueueItems`**: Updated to also call `updateCandidateVisual` for each checkbox so visual state is consistent
- Exposed `toggleCandidateSelection` on `window` for programmatic access

## What Depends on CSP Fix (Another Agent)

The delegated event handlers added here make queue buttons work **regardless of CSP policy**. However, the following still use inline handlers in other parts of the dashboard and depend on CSP being fixed:
- Settings checkboxes (`onchange="updateSetting(...)"`  in auto-learn settings)
- Other tab buttons and inline interactions outside the card queue section

The card queue section is now fully CSP-safe via delegation.

## Individual Card Selection — Implementation Details

### Visual Behavior
- Each candidate card has a 16×16 checkbox at the left of its summary row
- All checkboxes start **checked** (matching the "Select All" default)
- Deselected cards fade to 55% opacity with transparent left border
- Selected cards show full opacity with the standard panel border

### Selection Tracking
- Selection is tracked via native checkbox state (no separate JS array needed)
- `distillQueue()` reads selection at call time: `document.querySelectorAll('.queue-select-cb:checked')`
- "Select All" checkbox shows indeterminate state when some (not all) items are selected

### API
- `toggleCandidateSelection(index)` — programmatically toggle by index
- `toggleCandidateSelection(checkboxElement)` — toggle by element reference
- `toggleAllQueueItems(checked)` — set all checkboxes to given state

## Message Handler Verification Summary

| Command | Handler Location | Status |
|---------|-----------------|--------|
| `clearCardQueue` | messageHandler.ts ~L1400 | ✅ Correct — confirms, clears, updates UI |
| `distillQueue` | messageHandler.ts ~L1190 | ✅ Correct — supports subset selection via `candidateIds` |
| `approveCandidate` | messageHandler.ts ~L1267 | ✅ Correct — duplicate detection, merge support |
| `rejectCandidate` | messageHandler.ts ~L1318 | ✅ Correct — delegates to `projectManager.rejectQueuedCard` |
| `editAndApproveCandidate` | messageHandler.ts ~L1329 | ✅ Correct — input boxes, duplicate detection, merge |
| `approveDistilledCard` | messageHandler.ts ~L1223 | ✅ Correct — duplicate detection, merge support |
