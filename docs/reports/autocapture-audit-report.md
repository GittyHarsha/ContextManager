# Auto-Capture / Intelligence Tab — Full Audit Report

**Date:** 2025-01-XX
**Scope:** Intelligence tab in `codebase-navigator/src/dashboard/`
**Files audited:**
- `DashboardPanel.ts` — HTML rendering (lines 426–607)
- `webviewScript.ts` — Client-side functions (lines 920–1042, 1260–1315)
- `messageHandler.ts` — Backend command handlers (lines 17–44, 170–222)
- `autoCapture.ts` — Service layer (lines 440–627)

---

## 1. Complete Inventory of Interactive Elements

### Auto-Capture Card (DashboardPanel.ts:440–458)

| # | Control | Handler | Function/Target | Status |
|---|---------|---------|-----------------|--------|
| 1 | Auto-Capture enable checkbox | `onchange` | `updateSetting('autoCapture.enabled', ...)` | ❌ CSP-blocked |
| 2 | Learn from all chats checkbox | `onchange` | `updateSetting('autoCapture.learnFromAllParticipants', ...)` | ❌ CSP-blocked |
| 3 | Buffer size number input | `onchange` | `updateSetting('autoCapture.maxObservations', ...)` | ❌ CSP-blocked |

### Auto-Learn Card (DashboardPanel.ts:461–488)

| # | Control | Handler | Function/Target | Status |
|---|---------|---------|-----------------|--------|
| 4 | Auto-Learn enable checkbox | `onchange` | `updateSetting('intelligence.autoLearn', ...)` | ❌ CSP-blocked |
| 5 | Use LLM checkbox | `onchange` | `updateSetting('intelligence.autoLearn.useLLM', ...)` | ❌ CSP-blocked |
| 6 | Inject into prompts checkbox | `onchange` | `updateSetting('intelligence.enableTieredInjection', ...)` | ❌ CSP-blocked |
| 7 | Show notifications checkbox | `onchange` | `updateSetting('intelligence.autoLearn.showInChat', ...)` | ❌ CSP-blocked |
| 8 | 🤖 Distill Observations button | `onclick` | `vscode.postMessage({command:'distillObservations',...})` | ❌ CSP-blocked |
| 9 | 📋 Review Learnings button | `onclick` | `switchTab('context')` | ❌ CSP-blocked (logic correct) |

### Observation Feed (DashboardPanel.ts:543–606)

| # | Control | Handler | Function/Target | Status |
|---|---------|---------|-----------------|--------|
| 10 | Filter: All pill | `onclick` | `obsFilter('all')` | ❌ CSP-blocked (function exists) |
| 11 | Filter: Source pills (dynamic) | `onclick` | `obsFilter('${src}')` | ❌ CSP-blocked (function exists) |
| 12 | Clear source 🗑 buttons (dynamic) | `onclick` | `clearObsBySource('${src}')` | ❌ CSP-blocked (function exists) |
| 13 | 🤖 Distill with AI button | `onclick` | `vscode.postMessage({command:'distillObservations',...})` | ❌ CSP-blocked |
| 14 | 🏗 Promote to convention (per obs) | `onclick` | `vscode.postMessage({command:'promoteObservation',...,target:'convention'})` | ❌ CSP-blocked + **Bug #2** |
| 15 | 📝 Promote to working note (per obs) | `onclick` | `vscode.postMessage({command:'promoteObservation',...,target:'note'})` | ❌ CSP-blocked + **Bug #2** |
| 16 | ✕ Delete observation (per obs) | `onclick` | `deleteObs('${o.id}', this)` | ❌ CSP-blocked (function exists) |

### Distill Review Modal (DashboardPanel.ts:590–605)

| # | Control | Handler | Function/Target | Status |
|---|---------|---------|-----------------|--------|
| 17 | Cancel button | `onclick` | `closeDistillModal()` | ❌ CSP-blocked (function exists) |
| 18 | 💾 Save Selected button | `onclick` | `saveDistillSelected()` | ❌ CSP-blocked + **Bug #1** |

**Total: 18 interactive elements, ALL CSP-blocked via inline handlers.**

---

## 2. Issues Found BEYOND CSP

### Bug #1: Tool Hints Silently Dropped During Distillation Save

**Severity:** Medium
**Location:** `webviewScript.ts:1017–1037` (`saveDistillSelected()`)

**Problem:**
The distillation modal renders four categories from the AI response:
- `convention` (data-cat="convention") — ✅ handled
- `toolHint` (data-cat="toolHint") — ❌ **NOT handled**
- `note` (data-cat="note") — ✅ handled
- `card` (data-cat="card") — ✅ handled

The `saveDistillSelected()` function only has branches for `convention`, `note`, and `card`. When a user checks tool hints and clicks "Save Selected", those tool hints are silently discarded.

**Root cause:** There is no `addToolHint` command in the message handler. Tool hints can only be saved via `projectManager.addToolHint()` called from the autoLearn service or project intelligence tools — there's no webview→backend path.

**Fix needed:**
1. Add an `addToolHint` command to `messageHandler.ts` that calls `projectManager.addToolHint()`
2. Add the `'addToolHint'` command to the `ALLOWED_COMMANDS` set
3. Add a `cat === 'toolHint'` branch in `saveDistillSelected()` that posts the `addToolHint` message

---

### Bug #2: Observation Promote Buttons Are No-Ops

**Severity:** Low-Medium
**Location:**
- Backend: `messageHandler.ts:189–197` (`promoteObservation` handler)
- Frontend: `webviewScript.ts:1312–1314` (`observationPromotePrefill` handler)

**Problem:**
The backend correctly fetches the observation, extracts content, and sends an `observationPromotePrefill` message with `{ target, content, obsId }`. However, the webview handler simply calls `switchTab('intelligence')` and **ignores the `target` and `content` fields entirely**.

The comment in messageHandler says "Send prefill back to the webview to open the right form" — but no form is opened and no content is prefilled.

**Impact:** The "Promote to convention" (🏗) and "Promote to working note" (📝) buttons on each observation row do nothing useful — they just switch to a tab the user is already on.

**Fix needed:** The `observationPromotePrefill` handler should either:
- Open an add-convention or add-working-note form prefilled with the observation content, OR
- Directly save the observation as a convention/working note via postMessage

---

### Non-Issue: `window.*` Assignments Incomplete but Not a Bug

Some observation functions (`clearObsBySource`, `deleteConvention`, `editConvention`, etc.) lack explicit `window.x = x` assignments. Since they are function declarations at the top level of the `<script>` block, they are globally accessible regardless. The existing `window.` assignments (e.g., `window.obsFilter`) are redundant but harmless.

---

## 3. Backend Handler & Allowlist Verification

### ALLOWED_COMMANDS (messageHandler.ts:17–44)

All auto-capture commands present: ✅
- `deleteObservation` ✅
- `clearObservationsBySource` ✅
- `promoteObservation` ✅
- `distillObservations` ✅
- `updateConvention`, `deleteConvention`, `discardConvention` ✅
- `discardWorkingNote`, `updateWorkingNote`, `deleteWorkingNote` ✅
- `promoteNoteToCard` ✅
- `deleteToolHint`, `toggleToolHintSelection` ✅
- `toggleConventionSelection`, `resetDiscardCount` ✅
- **Missing:** `addToolHint` (see Bug #1)

### SETTING_ALLOWLIST (messageHandler.ts:50–88)

All auto-capture settings present: ✅
- `autoCapture.enabled`, `autoCapture.learnFromAllParticipants`, `autoCapture.maxObservations` ✅
- `intelligence.autoLearn`, `intelligence.autoLearn.useLLM`, `intelligence.autoLearn.showInChat` ✅
- `intelligence.enableTieredInjection` ✅

---

## 4. End-to-End Flow Traces

### Flow 1: "Distill Observations" Button

```
1. User clicks "🤖 Distill Observations" button (DashboardPanel.ts:485)
2. onclick="vscode.postMessage({command:'distillObservations',maxObs:40})"
   ❌ BLOCKED by CSP — inline handler never fires
   --- If CSP is fixed: ---
3. Message reaches messageHandler.ts:200 (case 'distillObservations')
4. Validates autoCapture service exists and active project selected
5. Sends {command:'distillResult', status:'loading'} → modal shows spinner
6. Calls autoCapture.distillObservations(40, projectId) (autoCapture.ts:537)
7. Filters unprocessed observations, selects LLM model, sends prompt
8. Parses JSON response into {conventions, toolHints, workingNotes, cards}
9. Marks observations as learningsExtracted=true, persists to disk
10. Sends {command:'distillResult', result} back to webview
11. webviewScript.ts:1265 receives distillResult
12. Renders checkboxes for each category in the distill modal
13. User checks desired items, clicks "Save Selected"
14. saveDistillSelected() iterates checked items:
    - conventions → posts 'updateConvention' ✅
    - toolHints → SILENTLY DROPPED ❌ (Bug #1)
    - notes → posts 'updateWorkingNote' ✅
    - cards → posts 'approveDistilledCard' ✅
15. Backend saves conventions/notes, calls ctx.update() to re-render
```

### Flow 2: "Review Learnings" Button

```
1. User clicks "📋 Review Learnings" button (DashboardPanel.ts:486)
2. onclick="switchTab('context')"
   ❌ BLOCKED by CSP — inline handler never fires
   --- If CSP is fixed: ---
3. switchTab('context') executes (webviewScript.ts:47)
4. Hides all tab content, shows #tab-context
5. Updates tab bar active state, saves state via vscode.setState()
6. Posts {command:'webviewInteracting',tab:'context'} to backend
7. Context tab displays conventions, tool hints, working notes
   ✅ This flow is correct — navigates to review/edit learned items
```

### Flow 3: Observation Filter

```
1. User clicks source filter pill, e.g. "copilot" (DashboardPanel.ts:553)
2. onclick="obsFilter('copilot')"
   ❌ BLOCKED by CSP
   --- If CSP is fixed: ---
3. obsFilter('copilot') executes (webviewScript.ts:989)
4. Iterates #obs-table tbody tr[data-src] rows
5. Shows rows matching source, hides others
6. Updates pill active state
   ✅ Pure client-side filtering — correct logic
```

---

## 5. Auto-Capture Service Health Check

**File:** `autoCapture.ts`

| Method | Status | Notes |
|--------|--------|-------|
| `getRecentObservations()` | ✅ Working | Filters by age and optional projectId |
| `getObservationById()` | ✅ Working | Simple array find |
| `getTokenEconomics()` | ✅ Working | Read-only aggregation |
| `deleteObservation()` | ✅ Working | Removes + persists + updates FTS |
| `clearObservationsWhere()` | ✅ Working | Predicate-based removal |
| `distillObservations()` | ✅ Working | LLM-based extraction, marks processed |
| `distillQueue()` | ✅ Working | LLM-based card extraction from queue |

The service layer is solid. No bugs found in the backend logic.

---

## 6. Summary & Recommendations

### Issues to fix (prioritized):

1. **CSP inline handler blocking (all 18 elements)** — Another agent is fixing this. All `onclick` and `onchange` attributes need to be converted to delegated event listeners or `addEventListener` calls.

2. **Bug #1: Add toolHint save path in distill modal** — Add `addToolHint` command to message handler and handle `toolHint` category in `saveDistillSelected()`. Without this, AI-extracted tool hints are silently lost.

3. **Bug #2: Implement observation promote prefill** — The `observationPromotePrefill` webview handler should actually use the `target` and `content` data to create a convention or working note, rather than just switching tabs.

### Already working correctly:
- All ALLOWED_COMMANDS and SETTING_ALLOWLIST entries are complete
- All observation management functions exist and have correct logic
- distillObservations end-to-end pipeline works (except toolHint save)
- Token economics widget renders correctly (read-only)
- Service layer (autoCapture.ts) has no bugs
- Context tab correctly exists for "Review Learnings" navigation
