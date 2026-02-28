/**
 * Card Canvas — tile rendering & tool call viewer for the Knowledge tab.
 *
 * Provides reusable rendering functions for:
 * - Card tiles (both KnowledgeCard and QueuedCardCandidate)
 * - Tool call viewer (compact badge, full detail, evidence grouping)
 * - Rich editor panel HTML skeleton
 */

import { escapeHtml, formatAge } from './htmlHelpers';
import type { KnowledgeCard, QueuedCardCandidate, ToolCallRecord, AnchorStub } from '../projects/types';

// ─── Category badge helpers ────────────────────────────────────

const CATEGORIES = ['architecture', 'pattern', 'convention', 'explanation', 'note', 'other'] as const;

function categoryBadge(cat: string): string {
	const cls = CATEGORIES.includes(cat as any) ? `cat-${cat}` : 'cat-other';
	return `<span class="card-tile-category ${cls}">${escapeHtml(cat)}</span>`;
}

// ─── Tool Call Viewer ──────────────────────────────────────────

/** File path regex — matches common patterns like /path/to/file.ts:42 or C:\path\file.ts */
const FILE_PATH_RE = /(?:[A-Z]:\\[\w\\.\-]+|(?:\/|\.\.?\/)[\w/.\-]+)(?::(\d+)(?::(\d+))?)?/g;

function linkifyFilePaths(text: string): string {
	return escapeHtml(text).replace(
		/(?:[A-Z]:\\[\w\\.\-]+|(?:\/|\.\.?\/)[\w\/.\-]+)(?::(\d+)(?::(\d+))?)?/g,
		(match) => `<span class="tc-file-link" data-path="${escapeHtml(match)}" title="Open in editor">${escapeHtml(match)}</span>`,
	);
}

/** Compact tool call badge for card tiles — "🔧 3" */
export function renderToolCallBadge(toolCalls: ToolCallRecord[]): string {
	if (!toolCalls || toolCalls.length === 0) { return ''; }
	const names = toolCalls.slice(0, 4).map(tc => escapeHtml(tc.toolName)).join(', ');
	const more = toolCalls.length > 4 ? ` +${toolCalls.length - 4}` : '';
	return `<span class="tc-viewer-badge" title="${names}${more}">🔧 ${toolCalls.length}</span>`;
}

/** Full tool call viewer panel for the editor */
export function renderToolCallViewer(toolCalls: ToolCallRecord[], collapsed = true): string {
	if (!toolCalls || toolCalls.length === 0) { return ''; }
	return `<div class="tc-viewer">
		<div class="tc-viewer-header" onclick="this.nextElementSibling.classList.toggle('collapsed')">
			<span>🔧 ${toolCalls.length} Tool Call${toolCalls.length > 1 ? 's' : ''}</span>
			<span style="margin-left:auto; font-size:0.82em; opacity:0.5;">▼</span>
		</div>
		<div class="tc-viewer-body${collapsed ? ' collapsed' : ''}">
			${toolCalls.map(tc => renderToolCallRow(tc)).join('')}
		</div>
	</div>`;
}

/** Single tool call row */
function renderToolCallRow(tc: ToolCallRecord): string {
	const inputText = (tc.input || '').substring(0, 500);
	const outputText = (tc.output || '').substring(0, 500);
	const inputTruncated = (tc.input || '').length > 500;
	const outputTruncated = (tc.output || '').length > 500;

	return `<div class="tc-call-row">
		<span class="tc-call-name">${escapeHtml(tc.toolName)}</span>
		${inputText ? `
			<div class="tc-call-label">Input</div>
			<div class="tc-call-section${inputTruncated ? ' truncated' : ''}">${linkifyFilePaths(inputText)}</div>
			${inputTruncated ? '<span class="tc-show-more" onclick="this.previousElementSibling.classList.remove(\'truncated\'); this.remove();">Show more…</span>' : ''}
		` : ''}
		${outputText ? `
			<div class="tc-call-label">Output</div>
			<div class="tc-call-section${outputTruncated ? ' truncated' : ''}">${linkifyFilePaths(outputText)}</div>
			${outputTruncated ? '<span class="tc-show-more" onclick="this.previousElementSibling.classList.remove(\'truncated\'); this.remove();">Show more…</span>' : ''}
		` : ''}
	</div>`;
}

/** Evidence-grouped tool calls for multi-select composition */
export function renderToolCallEvidence(groups: Array<{ title: string; toolCalls: ToolCallRecord[] }>): string {
	if (!groups || groups.length === 0) { return ''; }
	const rows = groups.map(g => {
		if (!g.toolCalls || g.toolCalls.length === 0) { return ''; }
		return `<div class="tc-evidence-group">
			<div class="tc-evidence-label">Evidence from: ${escapeHtml(g.title)}</div>
			${g.toolCalls.map(tc => renderToolCallRow(tc)).join('')}
		</div>`;
	}).filter(Boolean).join('');
	if (!rows) { return ''; }

	return `<div class="tc-viewer">
		<div class="tc-viewer-header" onclick="this.nextElementSibling.classList.toggle('collapsed')">
			<span>🔧 Evidence — ${groups.reduce((n, g) => n + (g.toolCalls?.length || 0), 0)} Tool Calls</span>
			<span style="margin-left:auto; font-size:0.82em; opacity:0.5;">▼</span>
		</div>
		<div class="tc-viewer-body">${rows}</div>
	</div>`;
}

// ─── Card Tile Rendering ───────────────────────────────────────

interface TileOptions {
	isSelected?: boolean;
	isQueue?: boolean;
}

/** Render a card tile for the grid — works for both saved cards and queue candidates */
export function renderCardTile(item: KnowledgeCard | QueuedCardCandidate, opts: TileOptions = {}): string {
	const isQueue = opts.isQueue ?? false;
	const isSelected = opts.isSelected ?? false;

	// Normalize fields across both types
	const id = item.id;
	const title = isQueue
		? (item as QueuedCardCandidate).suggestedTitle || 'Untitled'
		: (item as KnowledgeCard).title;
	const category = isQueue
		? ((item as QueuedCardCandidate).suggestedCategory || (item as QueuedCardCandidate).category || 'note')
		: (item as KnowledgeCard).category;
	const content = isQueue
		? (item as QueuedCardCandidate).suggestedContent || (item as QueuedCardCandidate).response || ''
		: (item as KnowledgeCard).content;
	const toolCalls: ToolCallRecord[] = isQueue
		? ((item as QueuedCardCandidate).toolCalls || [])
		: [];
	const tags = isQueue ? [] : ((item as KnowledgeCard).tags || []);
	const confidence = isQueue ? (item as QueuedCardCandidate).confidenceScore : undefined;
	const participant = isQueue ? (item as QueuedCardCandidate).participant : undefined;
	const timestamp = isQueue ? (item as QueuedCardCandidate).createdAt : (item as KnowledgeCard).updated;
	const pinned = !isQueue && (item as KnowledgeCard).pinned;
	const archived = !isQueue && (item as KnowledgeCard).archived;

	// Snippet: first 120 chars of content, strip markdown
	const snippet = content.replace(/[#*`_~\[\]]/g, '').substring(0, 120).trim();

	const classes = [
		'card-tile',
		isQueue ? 'queue-tile' : '',
		isSelected ? 'selected' : '',
		archived ? 'archived' : '',
	].filter(Boolean).join(' ');

	return `<div class="${classes}" data-tile-id="${escapeHtml(id)}" data-tile-type="${isQueue ? 'queue' : 'card'}">
		<div class="card-tile-actions">
			<button class="tile-edit-btn" data-id="${escapeHtml(id)}" title="Edit">✏️</button>
			<button class="tile-dismiss-btn" data-id="${escapeHtml(id)}" title="${isQueue ? 'Remove from queue' : 'Delete card'}">✕</button>
		</div>
		<div class="card-tile-header">
			<input type="checkbox" class="tile-select-cb" data-id="${escapeHtml(id)}"
				${isSelected ? 'checked' : ''} onclick="event.stopPropagation()" title="${isQueue ? 'Select for actions' : 'Include in context'}">
			<span class="card-tile-title">${pinned ? '📌 ' : ''}${escapeHtml(title)}</span>
		</div>
		<div class="card-tile-meta">
			${categoryBadge(category)}
			${renderToolCallBadge(toolCalls)}
			${participant ? `<span>via ${escapeHtml(participant)}</span>` : ''}
			${timestamp ? `<span>${formatAge(timestamp)}</span>` : ''}
		</div>
		${tags.length > 0 ? `<div class="card-tile-tags">${tags.slice(0, 5).map(t =>
			`<span class="tag-pill">${escapeHtml(t)}</span>`
		).join('')}${tags.length > 5 ? `<span class="tag-pill">+${tags.length - 5}</span>` : ''}</div>` : ''}
		<div class="card-tile-snippet">${escapeHtml(snippet)}${content.length > 120 ? '…' : ''}</div>
		${confidence !== undefined ? `<div class="confidence-bar"><div class="confidence-bar-fill" style="width:${Math.round(confidence * 100)}%" title="Confidence: ${Math.round(confidence * 100)}%"></div></div>` : ''}
	</div>`;
}

// ─── Sub-tabs ──────────────────────────────────────────────────

export function renderKnowledgeSubtabs(cardCount: number, queueCount: number, activeSubtab: string): string {
	return `<div class="knowledge-subtabs">
		<div class="knowledge-subtab${activeSubtab === 'cards' ? ' active' : ''}" data-subtab="cards" onclick="switchKnowledgeSubtab('cards')">
			📚 Knowledge Cards<span class="subtab-badge">${cardCount}</span>
		</div>
		<div class="knowledge-subtab${activeSubtab === 'queue' ? ' active' : ''}" data-subtab="queue" onclick="switchKnowledgeSubtab('queue')">
			📬 Card Queue<span class="subtab-badge">${queueCount}</span>
		</div>
	</div>`;
}

// ─── Multi-Select Action Bar ───────────────────────────────────

export function renderMultiSelectBar(isQueueView: boolean): string {
	return `<div class="multi-select-bar" id="multi-select-bar">
		<span class="select-count" id="select-count">0 selected</span>
		<button onclick="composeFromSelected()" title="Open editor with selected items as source material">📝 New Card from Selected</button>
		<button onclick="aiSynthesizeSelected()" title="AI merges selected items into one card draft">✨ AI Synthesize</button>
		${isQueueView ? `<button onclick="bulkQuickSave()" title="Save all selected with suggested values">💾 Quick Save All</button>` : ''}
		<button class="secondary" onclick="dismissSelected()" title="${isQueueView ? 'Remove selected from queue' : 'Delete selected cards'}">${isQueueView ? '✕ Remove Selected' : '🗑 Delete Selected'}</button>
		<span style="flex:1"></span>
		<button class="secondary" onclick="clearTileSelection()">Clear Selection</button>
	</div>`;
}

// ─── Rich Editor Panel (HTML skeleton) ─────────────────────────

export function renderEditorPanel(): string {
	return `<div class="card-editor-panel" id="card-editor-panel">
		<div class="card-editor-panel-header">
			<h4 id="editor-panel-title">Edit Card</h4>
			<button class="secondary" onclick="closeCardEditor()" style="padding:2px 8px;">✕ Close</button>
		</div>
		<div class="card-editor-split">
			<div class="card-editor-form">
				<div>
					<label for="editor-title">Title</label>
					<input type="text" id="editor-title" placeholder="Card title…">
				</div>
				<div style="display:flex; gap:10px;">
					<div style="flex:1;">
						<label for="editor-category">Category</label>
						<select id="editor-category">
							<option value="architecture">Architecture</option>
							<option value="pattern">Pattern</option>
							<option value="convention">Convention</option>
							<option value="explanation">Explanation</option>
							<option value="note" selected>Note</option>
							<option value="other">Other</option>
						</select>
					</div>
				</div>
				<div>
					<label>Tags</label>
					<div class="tags-editor" id="editor-tags">
						<input type="text" id="editor-tag-input" placeholder="Add tag…"
							onkeydown="if(event.key==='Enter'){event.preventDefault();addEditorTag(this.value);this.value='';}">
					</div>
				</div>
				<div>
					<label for="editor-content">Content <span style="opacity:0.5; font-size:0.85em;">(Markdown)</span></label>
					<textarea id="editor-content" placeholder="Write card content in markdown…" oninput="updateEditorPreview()"></textarea>
				</div>
				<div id="editor-toolcalls-container"></div>
				<div id="editor-source-container"></div>
				<div id="editor-anchors-container"></div>
			</div>
			<div class="card-editor-preview" id="editor-preview">
				<p style="opacity:0.4; font-style:italic;">Live preview will appear here…</p>
			</div>
		</div>
		<div class="card-editor-footer">
			<button id="editor-save-btn" onclick="saveCardFromEditor()">💾 Save</button>
			<button class="secondary" onclick="closeCardEditor()">Cancel</button>
			<button class="secondary" id="editor-ai-btn" onclick="aiDraftFromEditor()" title="Generate or improve content with AI">✨ AI Draft</button>
			<span style="flex:1"></span>
			<span id="editor-status" style="font-size:0.82em; opacity:0.5;"></span>
		</div>
	</div>`;
}

// ─── Anchor pills rendering ───────────────────────────────────

export function renderAnchorPills(anchors: AnchorStub[]): string {
	if (!anchors || anchors.length === 0) { return ''; }
	return `<div style="margin-top:8px;">
		<label style="font-size:0.82em; font-weight:600; opacity:0.8;">📌 Anchored Code</label>
		<div class="anchor-pills">
			${anchors.map(a => {
				const label = a.symbolName
					? `${a.symbolName} (${a.filePath.split(/[/\\]/).pop()})`
					: `${a.filePath.split(/[/\\]/).pop()}${a.startLine ? `:${a.startLine}` : ''}`;
				return `<span class="anchor-pill" data-path="${escapeHtml(a.filePath)}" data-line="${a.startLine || 0}" title="${escapeHtml(a.filePath)}${a.startLine ? `:${a.startLine}` : ''}${a.verified ? ' ✓' : ''}">📌 ${escapeHtml(label)}</span>`;
			}).join('')}
		</div>
	</div>`;
}

// ─── Source material for editor ────────────────────────────────

export function renderSourceMaterial(items: Array<{ title: string; prompt: string; response: string }>): string {
	if (!items || items.length === 0) { return ''; }
	return items.map(item => `<details class="editor-source-material">
		<summary>📄 ${escapeHtml(item.title)}</summary>
		<div class="source-content">
			<div style="margin-bottom:6px;"><strong>Prompt:</strong> ${escapeHtml(item.prompt.substring(0, 300))}${item.prompt.length > 300 ? '…' : ''}</div>
			<div><strong>Response:</strong> ${escapeHtml(item.response.substring(0, 500))}${item.response.length > 500 ? '…' : ''}</div>
		</div>
	</details>`).join('');
}

// ─── Anchor generation from tool calls ─────────────────────────

/** Tool names that represent file-read operations */
const FILE_READ_TOOLS = new Set([
	'readFile', 'view', 'get_file_contents', 'cat', 'read_file',
	'vscode_readFile', 'readDocument', 'getFileContents',
]);

/** Extract AnchorStub entries from tool calls (file-read calls → anchors) */
export function extractAnchorsFromToolCalls(toolCalls: ToolCallRecord[]): AnchorStub[] {
	if (!toolCalls || toolCalls.length === 0) { return []; }
	const anchors: AnchorStub[] = [];
	const seen = new Set<string>();

	for (const tc of toolCalls) {
		if (!FILE_READ_TOOLS.has(tc.toolName)) { continue; }
		if (!tc.output || tc.output.length < 10) { continue; }

		// Try to extract file path from input
		const inputText = tc.input || '';
		let filePath: string | undefined;
		let startLine: number | undefined;
		let endLine: number | undefined;

		// Try JSON input first (e.g., {"path": "...", "startLine": 10})
		try {
			const parsed = JSON.parse(inputText);
			filePath = parsed.path || parsed.filePath || parsed.file || parsed.uri;
			startLine = parsed.startLine || parsed.start_line || parsed.line;
			endLine = parsed.endLine || parsed.end_line;
		} catch {
			// Try plain path extraction
			const pathMatch = inputText.match(/(?:[A-Z]:\\[\w\\.\-]+|(?:\/|\.\.?\/)[\w/.\-]+)/);
			if (pathMatch) { filePath = pathMatch[0]; }
			const lineMatch = inputText.match(/:(\d+)/);
			if (lineMatch) { startLine = parseInt(lineMatch[1], 10); }
		}

		if (!filePath) { continue; }

		// Dedup by filePath+startLine
		const key = `${filePath}:${startLine || 0}`;
		if (seen.has(key)) { continue; }
		seen.add(key);

		anchors.push({
			filePath,
			startLine,
			endLine,
			stubContent: tc.output.substring(0, 500),
			capturedAt: Date.now(),
			verified: true,
		});
	}

	return anchors;
}
