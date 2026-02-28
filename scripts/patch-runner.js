/**
 * Dashboard patch runner v3 — uses exact CRLF + tab whitespace.
 * Handles all 3 remaining fixes for the card pinned/archived/includeInContext feature.
 */
const fs = require('fs');
const path = require('path');

const dashFile = path.resolve(__dirname, '..', 'src', 'dashboard', 'DashboardPanel.ts');
const wsFile   = path.resolve(__dirname, '..', 'src', 'dashboard', 'webviewScript.ts');

let dash = fs.readFileSync(dashFile, 'utf8');
let ws   = fs.readFileSync(wsFile,   'utf8');

const NL = '\r\n'; // file uses CRLF
const T  = '\t';
function L(n, s) { return T.repeat(n) + s; }

let fixes = 0;

/* ─────────────────────────────────────────────────────────────────────────────
 * FIX A: Insert cardBorderColor + cardOpacity variables.
 * Target: insert after `const staleIcon = ...;` and before `\r\n\r\n\t*parts.push`
 * ───────────────────────────────────────────────────────────────────────────── */
// Exact anchor: the staleIcon assignment ends just before the blank line + parts.push
const STALE_ANCHOR = `' : '';${NL}${NL}${L(8, "parts.push(")}`; // 8 tabs = inside 8-deep block

if (dash.includes(STALE_ANCHOR)) {
	const INSERT = [
		L(8, `const cardBorderColor = isSelected ? 'var(--vscode-testing-iconPassed)' : card.pinned ? 'var(--vscode-charts-yellow, #e5c07b)' : 'transparent';`),
		L(8, `const cardOpacity = card.archived ? 'opacity: 0.55;' : '';`),
		``,
	].join(NL);

	dash = dash.replace(STALE_ANCHOR, `' : '';${NL}${NL}${INSERT}${L(8, 'parts.push(')}`);
	console.log('✅ Fix A: cardBorderColor + cardOpacity defined');
	fixes++;
} else {
	console.log('⚠️  Fix A SKIP: anchor not found (already applied?)');
}

/* ─────────────────────────────────────────────────────────────────────────────
 * FIX B: Add pin / includeInContext / archive toggles after 🔧 label </label>.
 * Exact context (11 tabs for span 🔧, 10 tabs for </label>, 9 tabs for </summary>):
 * ───────────────────────────────────────────────────────────────────────────── */
const SUMMARY_CLOSE_OLD =
	L(11, `<span>\uD83D\uDD27</span>`) + NL +
	L(10, `</label>`) + NL +
	L(9,  `</summary>`);

const PIN_FMT     = `\${card.pinned ? 'Pinned \\u2014 click to unpin' : 'Click to pin (shown first in index)'}`;
const CTX_FMT     = `\${card.includeInContext === false ? 'Excluded from knowledge index \\u2014 click to include' : 'Included in knowledge index \\u2014 click to exclude'}`;
const ARCH_FMT    = `\${card.archived ? 'Archived \\u2014 click to restore' : 'Click to archive (hide from index)'}`;

const SUMMARY_CLOSE_NEW =
	L(11, `<span>\uD83D\uDD27</span>`) + NL +
	L(10, `</label>`) + NL +
	// 📌 pin toggle
	L(10, `<label class="knowledge-track-toggle" onclick="event.stopPropagation()" title="${PIN_FMT}">`) + NL +
	L(11, `<input type="checkbox" \${card.pinned ? 'checked' : ''} onchange="setCardFlag('\${card.id}', 'pinned', this.checked)">`) + NL +
	L(11, `<span style="\${card.pinned ? 'opacity:1' : 'opacity:0.4'}">\uD83D\uDCCC</span>`) + NL +
	L(10, `</label>`) + NL +
	// 👁 includeInContext toggle
	L(10, `<label class="knowledge-track-toggle" onclick="event.stopPropagation()" title="${CTX_FMT}">`) + NL +
	L(11, `<input type="checkbox" \${card.includeInContext !== false ? 'checked' : ''} onchange="setCardFlag('\${card.id}', 'includeInContext', this.checked)">`) + NL +
	L(11, `<span style="\${card.includeInContext === false ? 'opacity:0.4' : 'opacity:1'}">\uD83D\uDC41</span>`) + NL +
	L(10, `</label>`) + NL +
	// 🗃 archive toggle
	L(10, `<label class="knowledge-track-toggle" onclick="event.stopPropagation()" title="${ARCH_FMT}">`) + NL +
	L(11, `<input type="checkbox" \${card.archived ? 'checked' : ''} onchange="setCardFlag('\${card.id}', 'archived', this.checked)">`) + NL +
	L(11, `<span style="\${card.archived ? 'opacity:1' : 'opacity:0.4'}">\uD83D\uDDC3\uFE0F</span>`) + NL +
	L(10, `</label>`) + NL +
	L(9,  `</summary>`);

if (dash.includes(SUMMARY_CLOSE_OLD)) {
	dash = dash.replace(SUMMARY_CLOSE_OLD, SUMMARY_CLOSE_NEW);
	console.log('✅ Fix B: pin/context/archive toggles added to card summary');
	fixes++;
} else {
	console.log('⚠️  Fix B SKIP: summary end block not found (already applied?)');
}

/* ─────────────────────────────────────────────────────────────────────────────
 * FIX C: Add pinned/context/archived checkboxes to inline edit form.
 * Target: after card-track-editor </div> and before inline-edit-actions div.
 * Indent: 13 tabs for <input>, 12 tabs for </label>, 11 tabs for </div>
 * ───────────────────────────────────────────────────────────────────────────── */
const EDIT_FORM_OLD =
	L(13, `<span>Track successful tools for this card</span>`) + NL +
	L(12, `</label>`) + NL +
	L(11, `</div>`) + NL +
	L(11, `<div class="inline-edit-actions">`);

const EDIT_FORM_NEW =
	L(13, `<span>Track successful tools for this card</span>`) + NL +
	L(12, `</label>`) + NL +
	L(11, `</div>`) + NL +
	L(11, `<div class="form-group" style="margin-bottom: 8px; display: flex; gap: 16px; flex-wrap: wrap;">`) + NL +
	L(12, `<label style="display: inline-flex; align-items: center; gap: 6px; margin: 0; font-size: 0.9em;">`) + NL +
	L(13, `<input type="checkbox" id="card-pinned-editor-\${card.id}" \${card.pinned ? 'checked' : ''}>`) + NL +
	L(13, `<span>\uD83D\uDCCC Pinned</span>`) + NL +
	L(12, `</label>`) + NL +
	L(12, `<label style="display: inline-flex; align-items: center; gap: 6px; margin: 0; font-size: 0.9em;">`) + NL +
	L(13, `<input type="checkbox" id="card-context-editor-\${card.id}" \${card.includeInContext !== false ? 'checked' : ''}>`) + NL +
	L(13, `<span>\uD83D\uDC41 Include in index</span>`) + NL +
	L(12, `</label>`) + NL +
	L(12, `<label style="display: inline-flex; align-items: center; gap: 6px; margin: 0; font-size: 0.9em;">`) + NL +
	L(13, `<input type="checkbox" id="card-archived-editor-\${card.id}" \${card.archived ? 'checked' : ''}>`) + NL +
	L(13, `<span>\uD83D\uDDC3\uFE0F Archived</span>`) + NL +
	L(12, `</label>`) + NL +
	L(11, `</div>`) + NL +
	L(11, `<div class="inline-edit-actions">`);

if (dash.includes(EDIT_FORM_OLD)) {
	dash = dash.replace(EDIT_FORM_OLD, EDIT_FORM_NEW);
	console.log('✅ Fix C: pinned/context/archived added to inline edit form');
	fixes++;
} else {
	console.log('⚠️  Fix C SKIP: edit form block not found (already applied?)');
	// Debug: find nearby content
	const idx = dash.indexOf('card-track-editor');
	if (idx >= 0) {
		console.log('  Nearby:', JSON.stringify(dash.slice(idx, idx + 500)));
	}
}

/* ─────────────────────────────────────────────────────────────────────────────
 * FIX D: webviewScript.ts — update saveCardEdit to read the new flag fields
 * ───────────────────────────────────────────────────────────────────────────── */
const SAVE_OLD =
`\t\tfunction saveCardEdit(cardId) {
\t\t\tconst titleEl = document.getElementById('card-title-editor-' + cardId);
\t\t\tconst editorEl = document.getElementById('card-editor-' + cardId);
\t\t\tconst trackEl = document.getElementById('card-track-editor-' + cardId);
\t\t\tif (titleEl && editorEl) {
\t\t\t\tsetInteracting(false);
\t\t\t\tvscode.postMessage({
\t\t\t\t\tcommand: 'editKnowledgeCard',
\t\t\t\t\tprojectId: activeProjectId,
\t\t\t\t\tcardId,
\t\t\t\t\tnewTitle: titleEl.value,
\t\t\t\t\tnewContent: editorEl.value,
\t\t\t\t\ttrackToolUsage: !!trackEl?.checked
\t\t\t\t});
\t\t\t}
\t\t}`;

const SAVE_NEW =
`\t\tfunction saveCardEdit(cardId) {
\t\t\tconst titleEl = document.getElementById('card-title-editor-' + cardId);
\t\t\tconst editorEl = document.getElementById('card-editor-' + cardId);
\t\t\tconst trackEl = document.getElementById('card-track-editor-' + cardId);
\t\t\tconst pinnedEl = document.getElementById('card-pinned-editor-' + cardId);
\t\t\tconst contextEl = document.getElementById('card-context-editor-' + cardId);
\t\t\tconst archivedEl = document.getElementById('card-archived-editor-' + cardId);
\t\t\tif (titleEl && editorEl) {
\t\t\t\tsetInteracting(false);
\t\t\t\tvscode.postMessage({
\t\t\t\t\tcommand: 'editKnowledgeCard',
\t\t\t\t\tprojectId: activeProjectId,
\t\t\t\t\tcardId,
\t\t\t\t\tnewTitle: titleEl.value,
\t\t\t\t\tnewContent: editorEl.value,
\t\t\t\t\ttrackToolUsage: !!trackEl?.checked,
\t\t\t\t\t...(pinnedEl ? { pinned: !!pinnedEl.checked } : {}),
\t\t\t\t\t...(contextEl ? { includeInContext: !!contextEl.checked } : {}),
\t\t\t\t\t...(archivedEl ? { archived: !!archivedEl.checked } : {}),
\t\t\t\t});
\t\t\t}
\t\t}`;

// webviewScript.ts uses LF or CRLF?
const wsNl = ws.includes('\r\n') ? '\r\n' : '\n';
const SAVE_OLD_NL = SAVE_OLD.replace(/\n/g, wsNl);
const SAVE_NEW_NL = SAVE_NEW.replace(/\n/g, wsNl);

if (ws.includes(SAVE_OLD_NL)) {
	ws = ws.replace(SAVE_OLD_NL, SAVE_NEW_NL);
	console.log('✅ Fix D: saveCardEdit updated in webviewScript.ts');
	fixes++;
} else {
	// Try without carriage returns
	if (ws.includes(SAVE_OLD)) {
		ws = ws.replace(SAVE_OLD, SAVE_NEW);
		console.log('✅ Fix D (LF): saveCardEdit updated in webviewScript.ts');
		fixes++;
	} else {
		console.log('⚠️  Fix D SKIP: saveCardEdit block not found');
		const idx = ws.indexOf('saveCardEdit');
		if (idx >= 0) console.log('  Nearby:', JSON.stringify(ws.slice(idx, idx+400)));
	}
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Write files
 * ───────────────────────────────────────────────────────────────────────────── */
fs.writeFileSync(dashFile, dash, 'utf8');
fs.writeFileSync(wsFile, ws, 'utf8');
console.log(`\nDone — ${fixes} fixes applied.`);
