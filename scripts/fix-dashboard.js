/**
 * Patch script v2: adds pinned/archived/includeInContext UI to card template.
 * Uses exact CRLF + tab counts from the file.
 * Run with: node scripts/fix-dashboard.js
 */
const fs = require('fs');
const path = require('path');

const dashboardFile = path.join(__dirname, '..', 'src', 'dashboard', 'DashboardPanel.ts');
let content = fs.readFileSync(dashboardFile, 'utf8');
let changes = 0;

// ─────────────────────────────────────────────────────────────────────────────
// Fix 1: Add cardBorderColor and cardOpacity helper variables
// ─────────────────────────────────────────────────────────────────────────────
const OLD_STALE = `const isStale = (Date.now() - (card.updated || card.created || 0)) > 30 * 24 * 60 * 60 * 1000;
								const staleIcon = isStale ? '<span title="Stale: not updated in 30+ days" style="color: var(--vscode-warningForeground); margin-left: 4px;">⚠️</span>' : '';`;

const NEW_STALE = `const isStale = (Date.now() - (card.updated || card.created || 0)) > 30 * 24 * 60 * 60 * 1000;
								const staleIcon = isStale ? '<span title="Stale: not updated in 30+ days" style="color: var(--vscode-warningForeground); margin-left: 4px;">⚠️</span>' : '';
								const cardBorderColor = isSelected ? 'var(--vscode-testing-iconPassed)' : card.pinned ? 'var(--vscode-charts-yellow, #e5c07b)' : 'transparent';
								const cardOpacity = card.archived ? 'opacity: 0.55;' : '';`;

if (content.includes(OLD_STALE)) {
	content = content.replace(OLD_STALE, NEW_STALE);
	console.log('✅ Fix 1: Added cardBorderColor + cardOpacity variables');
	changes++;
} else {
	console.log('❌ Fix 1 MISS: stale block not found');
}

// ─────────────────────────────────────────────────────────────────────────────
// Fix 2: Update <details> element to use the new variables
// ─────────────────────────────────────────────────────────────────────────────
const OLD_DETAILS = `style="border-left: 3px solid \${isSelected ? 'var(--vscode-testing-iconPassed)' : 'transparent'}; padding-left: 12px; margin-left: \${isRoot ? 0 : 8}px;">`;
const NEW_DETAILS = `style="border-left: 3px solid \${cardBorderColor}; padding-left: 12px; margin-left: \${isRoot ? 0 : 8}px; \${cardOpacity}">`;

if (content.includes(OLD_DETAILS)) {
	content = content.replace(OLD_DETAILS, NEW_DETAILS);
	console.log('✅ Fix 2: Updated <details> style for pinned/archived');
	changes++;
} else {
	console.log('❌ Fix 2 MISS: details style not found');
}

// ─────────────────────────────────────────────────────────────────────────────
// Fix 3: Add pin/context/archive toggles after the 🔧 trackToolUsage label
// ─────────────────────────────────────────────────────────────────────────────
const OLD_SUMMARY_END = `										<label class="knowledge-track-toggle" onclick="event.stopPropagation()" title="Track successful tool usage for this card">
											<input type="checkbox" \${card.trackToolUsage ? 'checked' : ''} onchange="toggleCardToolUsage('\${card.id}', this.checked)">
											<span>🔧</span>
										</label>
									</summary>`;

const NEW_SUMMARY_END = `										<label class="knowledge-track-toggle" onclick="event.stopPropagation()" title="Track successful tool usage for this card">
											<input type="checkbox" \${card.trackToolUsage ? 'checked' : ''} onchange="toggleCardToolUsage('\${card.id}', this.checked)">
											<span>🔧</span>
										</label>
										<label class="knowledge-track-toggle" onclick="event.stopPropagation()" title="\${card.pinned ? 'Pinned — click to unpin' : 'Click to pin (shown first in index)'}">
											<input type="checkbox" \${card.pinned ? 'checked' : ''} onchange="setCardFlag('\${card.id}', 'pinned', this.checked)">
											<span style="\${card.pinned ? 'opacity:1' : 'opacity:0.4'}">📌</span>
										</label>
										<label class="knowledge-track-toggle" onclick="event.stopPropagation()" title="\${card.includeInContext === false ? 'Excluded from knowledge index — click to include' : 'Included in knowledge index — click to exclude'}">
											<input type="checkbox" \${card.includeInContext !== false ? 'checked' : ''} onchange="setCardFlag('\${card.id}', 'includeInContext', this.checked)">
											<span style="\${card.includeInContext === false ? 'opacity:0.4' : 'opacity:1'}">👁</span>
										</label>
										<label class="knowledge-track-toggle" onclick="event.stopPropagation()" title="\${card.archived ? 'Archived — click to restore' : 'Click to archive (hide from index)'}">
											<input type="checkbox" \${card.archived ? 'checked' : ''} onchange="setCardFlag('\${card.id}', 'archived', this.checked)">
											<span style="\${card.archived ? 'opacity:1' : 'opacity:0.4'}">🗃</span>
										</label>
									</summary>`;

if (content.includes(OLD_SUMMARY_END)) {
	content = content.replace(OLD_SUMMARY_END, NEW_SUMMARY_END);
	console.log('✅ Fix 3: Added pin/context/archive toggle buttons');
	changes++;
} else {
	console.log('❌ Fix 3 MISS: summary end block not found');
}

// ─────────────────────────────────────────────────────────────────────────────
// Fix 4: Add pinned/context/archived checkboxes to inline edit form
// ─────────────────────────────────────────────────────────────────────────────
const OLD_EDIT_FORM = `										<div class="form-group" style="margin-bottom: 8px;">
												<label style="display: inline-flex; align-items: center; gap: 8px; margin: 0; font-size: 0.9em;">
													<input type="checkbox" id="card-track-editor-\${card.id}" \${card.trackToolUsage ? 'checked' : ''}>
													<span>Track successful tools for this card</span>
												</label>
											</div>
											<div class="inline-edit-actions">`;

const NEW_EDIT_FORM = `										<div class="form-group" style="margin-bottom: 8px;">
												<label style="display: inline-flex; align-items: center; gap: 8px; margin: 0; font-size: 0.9em;">
													<input type="checkbox" id="card-track-editor-\${card.id}" \${card.trackToolUsage ? 'checked' : ''}>
													<span>Track successful tools for this card</span>
												</label>
											</div>
											<div class="form-group" style="margin-bottom: 8px; display: flex; gap: 16px; flex-wrap: wrap;">
												<label style="display: inline-flex; align-items: center; gap: 6px; margin: 0; font-size: 0.9em;">
													<input type="checkbox" id="card-pinned-editor-\${card.id}" \${card.pinned ? 'checked' : ''}>
													<span>📌 Pinned</span>
												</label>
												<label style="display: inline-flex; align-items: center; gap: 6px; margin: 0; font-size: 0.9em;">
													<input type="checkbox" id="card-context-editor-\${card.id}" \${card.includeInContext !== false ? 'checked' : ''}>
													<span>👁 Include in index</span>
												</label>
												<label style="display: inline-flex; align-items: center; gap: 6px; margin: 0; font-size: 0.9em;">
													<input type="checkbox" id="card-archived-editor-\${card.id}" \${card.archived ? 'checked' : ''}>
													<span>🗃 Archived</span>
												</label>
											</div>
											<div class="inline-edit-actions">`;

if (content.includes(OLD_EDIT_FORM)) {
	content = content.replace(OLD_EDIT_FORM, NEW_EDIT_FORM);
	console.log('✅ Fix 4: Added pinned/context/archived to inline edit form');
	changes++;
} else {
	console.log('❌ Fix 4 MISS: edit form block not found');
}

// ─────────────────────────────────────────────────────────────────────────────
fs.writeFileSync(dashboardFile, content, 'utf8');
console.log(`\nDone — ${changes}/4 fixes applied to DashboardPanel.ts`);
