/**
 * Search tools — BM25 full-text search and unified #ctx tool.
 */

import * as vscode from 'vscode';
import { ConfigurationManager } from '../config';
import { ProjectManager } from '../projects/ProjectManager';
import { SearchIndex } from '../search/SearchIndex';
import type { SearchEntityType } from '../search/types';
import type { AutoCaptureService } from '../autoCapture';

// ─── Interfaces ─────────────────────────────────────────────────

interface ICtxToolParams {
	/** Natural-language search query. Required for search mode. */
	query?: string;
	/** Filter to specific entity types. If omitted, searches all types. */
	entityTypes?: SearchEntityType[];
	/** Maximum results to return. Default 10, max 50. */
	limit?: number;
	/**
	 * Tool mode:
	 * - "search" (default): BM25 search with fine-grained entity type filters
	 * - "list": List all items of a given type (conventions, workingNotes, toolHints, cards)
	 * - "learn": Create a convention, tool hint, or working note
	 * - "getCard": Read a knowledge card by ID
	 * - "fetch": Full observation details by IDs
	 * - "retrospect": End-of-task retrospective
	 */
	mode?: 'search' | 'list' | 'learn' | 'getCard' | 'fetch' | 'retrospect';
	/** For list mode: which type to list */
	type?: 'conventions' | 'workingNotes' | 'toolHints' | 'cards';
	/** For learn mode: what to learn */
	learnType?: 'convention' | 'toolHint' | 'workingNote';
	// learn convention fields
	category?: 'architecture' | 'naming' | 'patterns' | 'testing' | 'tooling' | 'pitfalls';
	title?: string;
	content?: string;
	confidence?: 'observed' | 'inferred';
	learnedFrom?: string;
	// learn tool hint fields
	toolName?: string;
	pattern?: string;
	antiPattern?: string;
	example?: string;
	// learn working note fields
	subject?: string;
	insight?: string;
	relatedFiles?: string[];
	relatedSymbols?: string[];
	discoveredWhile?: string;
	// getCard
	id?: string;
	/** Array of observation IDs to fetch full details (for mode="fetch"). */
	observationIds?: string[];
	// retrospect fields
	taskSummary?: string;
	whatWorked?: string[];
	whatDidntWork?: string[];
	newConventions?: Array<{ category: string; title: string; content: string }>;
	newToolHints?: Array<{ toolName: string; pattern: string; antiPattern?: string; example: string }>;
	knowledgeCards?: Array<{ title: string; content: string; category: string; anchors?: Array<{ filePath: string; symbolName?: string; startLine?: number; endLine?: number; stubContent: string }> }>;
}

// ─── Unified #ctx Tool (Search + List + Learn + Read) ───────────

export class CtxTool implements vscode.LanguageModelTool<ICtxToolParams> {
	constructor(
		private readonly projectManager: ProjectManager,
		private readonly searchIndex: SearchIndex,
		private readonly autoCapture?: AutoCaptureService,
	) {}

	async invoke(
		options: vscode.LanguageModelToolInvocationOptions<ICtxToolParams>,
		_token: vscode.CancellationToken
	): Promise<vscode.LanguageModelToolResult> {
		const mode = options.input.mode || 'search';

		switch (mode) {
			case 'list': return this._handleList(options.input);
			case 'learn': return this._handleLearn(options.input);
			case 'getCard': return this._handleGetCard(options.input);
			case 'retrospect': return this._handleRetrospect(options.input);
			case 'fetch': return this._handleFetch(options.input);
			case 'search': default: return this._handleSearch(options.input);
		}
	}

	private _text(msg: string): vscode.LanguageModelToolResult {
		return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(msg)]);
	}

	// ── List mode ──

	private _handleList(input: ICtxToolParams): vscode.LanguageModelToolResult {
		const activeProject = this.projectManager.getActiveProject();
		if (!activeProject) { return this._text('No active project.'); }
		const projectId = activeProject.id;

		switch (input.type) {
			case 'conventions': {
				const conventions = this.projectManager.getConventions(projectId);
				if (conventions.length === 0) { return this._text('No conventions found.'); }
				const lines = conventions.map(c =>
					`- [${c.category}] **${c.title}** (ID: ${c.id}): ${c.content.slice(0, 150)}${c.content.length > 150 ? '…' : ''} (${c.confidence}${c.enabled ? '' : ', disabled'})`
				);
				return this._text(`## Conventions (${conventions.length})\n${lines.join('\n')}`);
			}
			case 'toolHints': {
				const hints = this.projectManager.getToolHints(projectId);
				if (hints.length === 0) { return this._text('No tool hints found.'); }
				const lines = hints.map(h =>
					`- 🔧 **${h.pattern}**${h.antiPattern ? ` (not "${h.antiPattern}")` : ''} — ${h.example} (used ${h.useCount}x, ID: ${h.id})`
				);
				return this._text(`## Tool Hints (${hints.length})\n${lines.join('\n')}`);
			}
			case 'workingNotes': {
				const notes = this.projectManager.getWorkingNotes(projectId);
				if (notes.length === 0) { return this._text('No working notes found.'); }
				const lines = notes.map(n => {
					const stale = n.staleness !== 'fresh' ? ` ⚠️ ${n.staleness}` : '';
					return `- 📌 **${n.subject}** (ID: ${n.id})${stale}: ${n.insight.slice(0, 150)}${n.insight.length > 150 ? '…' : ''}` +
						(n.relatedFiles.length > 0 ? ` [files: ${n.relatedFiles.slice(0, 3).join(', ')}]` : '');
				});
				return this._text(`## Working Notes (${notes.length})\n${lines.join('\n')}`);
			}
			case 'cards': {
				const cards = this.projectManager.getKnowledgeCards(projectId).filter(c => !c.archived);
				if (cards.length === 0) { return this._text('No knowledge cards found.'); }
				const lines = cards.map(c => {
					const pin = c.pinned ? ' 📌' : '';
					return `- **${c.title}** [${c.category}]${pin} — ID: ${c.id}`;
				});
				return this._text(`## Knowledge Cards (${cards.length})\nUse \`mode: "getCard", id: "<cardId>"\` to read full content.\n${lines.join('\n')}`);
			}
			default:
				return this._text('Unknown list type. Use: "conventions", "workingNotes", "toolHints", or "cards".');
		}
	}

	// ── Learn mode ──

	private async _handleLearn(input: ICtxToolParams): Promise<vscode.LanguageModelToolResult> {
		const activeProject = this.projectManager.getActiveProject();
		if (!activeProject) { return this._text('No active project.'); }
		const projectId = activeProject.id;

		switch (input.learnType) {
			case 'convention': {
				const { category, title, content, confidence, learnedFrom } = input;
				if (!category || !title || !content) { return this._text('Missing: category, title, content.'); }
				const safeConfidence = (confidence === 'inferred' || confidence === 'observed') ? confidence : 'observed';
				const conv = await this.projectManager.addConvention(projectId, category, title, content, safeConfidence, learnedFrom);
				return this._text(conv ? `✅ Convention learned: [${category}] "${title}"` : 'Failed to save convention.');
			}
			case 'toolHint': {
				const { toolName, pattern, example, antiPattern } = input;
				if (!toolName || !pattern || !example) { return this._text('Missing: toolName, pattern, example.'); }
				const hint = await this.projectManager.addToolHint(projectId, toolName, pattern, example, antiPattern);
				return this._text(hint ? `✅ Tool hint learned: search "${pattern}"` : 'Failed to save tool hint.');
			}
			case 'workingNote': {
				const { subject, insight, relatedFiles, relatedSymbols, discoveredWhile } = input;
				if (!subject || !insight) { return this._text('Missing: subject, insight.'); }
				const note = await this.projectManager.addWorkingNote(projectId, subject, insight, relatedFiles || [], relatedSymbols || [], discoveredWhile);
				return this._text(note ? `📌 Note saved: "${subject}"` : 'Failed to save note.');
			}
			default:
				return this._text('Unknown learnType. Use: "convention", "toolHint", or "workingNote".');
		}
	}

	// ── GetCard mode ──

	private _handleGetCard(input: ICtxToolParams): vscode.LanguageModelToolResult {
		const activeProject = this.projectManager.getActiveProject();
		if (!activeProject) { return this._text('No active project.'); }
		if (!input.id) { return this._text('Missing: id (knowledge card ID).'); }
		const card = this.projectManager.getKnowledgeCards(activeProject.id).find(c => c.id === input.id);
		if (!card) { return this._text(`Card not found: ${input.id}`); }
		const parts = [
			`## ${card.title} [${card.category}]`,
			card.pinned ? '📌 Pinned' : '',
			card.tags?.length ? `**Tags:** ${card.tags.join(', ')}` : '',
			'',
			card.content,
		].filter(Boolean);
		if ((card as any).anchors?.length) {
			parts.push('\n### Anchors');
			for (const a of (card as any).anchors) {
				parts.push(`- \`${a.filePath}\`${a.symbolName ? ` — ${a.symbolName}` : ''}${a.startLine ? ` (L${a.startLine}-${a.endLine || a.startLine})` : ''}`);
			}
		}
		return this._text(parts.join('\n'));
	}

	// ── Retrospect mode ──

	private async _handleRetrospect(input: ICtxToolParams): Promise<vscode.LanguageModelToolResult> {
		const activeProject = this.projectManager.getActiveProject();
		if (!activeProject) { return this._text('No active project.'); }
		const projectId = activeProject.id;
		const results: string[] = ['## 📋 Retrospective Processed\n'];

		if (input.newConventions?.length) {
			for (const c of input.newConventions) {
				await this.projectManager.addConvention(projectId, (c.category || 'patterns') as any, c.title, c.content, 'observed', input.taskSummary);
			}
			results.push(`- ✅ ${input.newConventions.length} convention(s) learned`);
		}
		if (input.newToolHints?.length) {
			for (const h of input.newToolHints) {
				await this.projectManager.addToolHint(projectId, h.toolName, h.pattern, h.example, h.antiPattern);
			}
			results.push(`- ✅ ${input.newToolHints.length} tool hint(s) saved`);
		}
		if (input.knowledgeCards?.length) {
			for (const card of input.knowledgeCards) {
				const cardAnchors = card.anchors?.map(a => ({
					filePath: a.filePath, symbolName: a.symbolName, startLine: a.startLine,
					endLine: a.endLine, stubContent: a.stubContent, capturedAt: Date.now(), verified: true,
				}));
				await this.projectManager.addKnowledgeCard(projectId, card.title, card.content, (card.category || 'note') as any, [], input.taskSummary, undefined, undefined, undefined, cardAnchors);
			}
			results.push(`- ✅ ${input.knowledgeCards.length} knowledge card(s) created`);
		}
		return this._text(results.join('\n'));
	}

	// ── Search mode (BM25) ──

	private async _handleSearch(input: ICtxToolParams): Promise<vscode.LanguageModelToolResult> {
		if (!ConfigurationManager.searchEnableFTS) {
			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart('Full-text search is disabled. Enable it via `contextManager.search.enableFTS` setting.')
			]);
		}

		const query = input.query;
		if (!query?.trim()) {
			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart('No query provided for full-text search.')
			]);
		}

		const activeProject = this.projectManager.getActiveProject();

		const results = await this.searchIndex.search(query, {
			entityTypes: input.entityTypes,
			projectId: activeProject?.id,
			limit: input.limit ?? ConfigurationManager.searchMaxSearchResults,
			snippetTokens: ConfigurationManager.searchSnippetTokens,
		});

		// Debug: log entity type breakdown
		const typeCounts: Record<string, number> = {};
		for (const r of results) { typeCounts[r.entityType] = (typeCounts[r.entityType] || 0) + 1; }
		console.log(`[#ctx search] query="${query}", entityTypes=${JSON.stringify(input.entityTypes ?? 'all')}, results=${results.length}, breakdown=${JSON.stringify(typeCounts)}`);

		if (results.length === 0) {
			const requestedTypes = input.entityTypes;
			const includesCards = !requestedTypes || requestedTypes.includes('card');
			if (activeProject && includesCards) {
				const fallback = this.keywordCardFallback(activeProject.id, query, Math.min(input.limit ?? 10, 10));
				if (fallback.length > 0) {
					const parts: string[] = [];
					parts.push(`## Full-Text Search Results for: "${query}"`);
					parts.push(`BM25 returned no results; using card fallback (${fallback.length} match(es)).\n`);
					for (const card of fallback) {
						parts.push(`### [📝 Knowledge Card] ${card.title}`);
						parts.push(`**Category:** ${card.category}${card.tags?.length ? ` | **Tags:** ${card.tags.join(', ')}` : ''}`);
						parts.push(`> ${card.content.substring(0, 260).replace(/\n/g, '\n> ')}${card.content.length > 260 ? '…' : ''}`);
						parts.push('');
					}
					return new vscode.LanguageModelToolResult([
						new vscode.LanguageModelTextPart(parts.join('\n'))
					]);
				}
			}
			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart(`No results found for "${query}" across all entity types.`)
			]);
		}

		// Format results grouped by entity type
		const parts: string[] = [];
		parts.push(`## Full-Text Search Results for: "${query}"`);
		parts.push(`Found ${results.length} result(s) across project memory:\n`);

		// Type display labels and icons
		const typeLabels: Record<string, string> = {
			card: '\uD83D\uDCDD Knowledge Card',
			todo: '\u2611\uFE0F TODO',
			cache: '\uD83D\uDCBE Cached Explanation',
			session: '\uD83D\uDD00 Branch Session',
			agentMessage: '\uD83E\uDD16 Agent Message',
			project: '\uD83D\uDCC1 Project',
			observation: '\uD83D\uDD35 Observation',
			learning: '\uD83C\uDFAF Learning',
			convention: '\uD83C\uDFD7 Convention',
			workingNote: '\uD83D\uDCCC Working Note',
			toolHint: '\uD83D\uDD27 Tool Hint',
		};

		for (const result of results) {
			const typeLabel = typeLabels[result.entityType] || result.entityType;
			const score = Math.abs(result.score).toFixed(2);
			parts.push(`### [${typeLabel}] ${result.title} — relevance ${score}`);

			// Add type-specific metadata
			if (result.entityType === 'card' && result.metadata.category) {
				parts.push(`**Category:** ${result.metadata.category}${result.metadata.tags ? ` | **Tags:** ${result.metadata.tags}` : ''}`);
			} else if (result.entityType === 'todo') {
				parts.push(`**Status:** ${result.metadata.status} | **Priority:** ${result.metadata.priority}`);
			} else if (result.entityType === 'cache') {
				parts.push(`**Symbol:** ${result.title}${result.metadata.filePath ? ` | **File:** ${result.metadata.filePath}` : ''}`);
			} else if (result.entityType === 'session') {
				parts.push(`**Branch:** ${result.metadata.branchName}`);
			} else if (result.entityType === 'observation') {
				const { OBSERVATION_TYPE_EMOJI } = require('../autoCapture');
				const obsEmoji = OBSERVATION_TYPE_EMOJI[result.metadata.type] || '📝';
				parts.push(`${obsEmoji} **Type:** ${result.metadata.type} | **From:** ${result.metadata.participant} | **ID:** ${result.entityId}`);
			parts.push(`_Use \`mode: "fetch", observationIds: ["${result.entityId}"]\` for full details._`);
			} else if (result.entityType === 'learning' || result.entityType === 'convention' || result.entityType === 'workingNote' || result.entityType === 'toolHint') {
				parts.push(`**Type:** ${result.metadata.type}${result.metadata.category ? ` | **Category:** ${result.metadata.category}` : ''}${result.metadata.confidence ? ` | **Confidence:** ${result.metadata.confidence}` : ''}`);
			}

			// Snippet with highlighting
			if (result.snippet) {
				parts.push(`> ${result.snippet.replace(/\n/g, '\n> ')}`);
			}
			parts.push('');
		}

		return new vscode.LanguageModelToolResult([
			new vscode.LanguageModelTextPart(parts.join('\n'))
		]);
	}

	async prepareInvocation(
		options: vscode.LanguageModelToolInvocationPrepareOptions<ICtxToolParams>,
		_token: vscode.CancellationToken
	) {
		const mode = options.input?.mode || 'search';
		const messages: Record<string, string> = {
			search: `Searching project memory for "${options.input?.query || '...'}"${options.input?.entityTypes?.length ? ` (${options.input.entityTypes.join(', ')})` : ''}`,
			list: `Listing ${options.input?.type || 'items'}...`,
			learn: `Learning ${options.input?.learnType || 'item'}: "${options.input?.title || options.input?.subject || options.input?.pattern || '...'}"`,
			getCard: `Reading card ${options.input?.id || '...'}`,
			fetch: `Fetching observation details...`,
			retrospect: `Processing retrospective...`,
		};
		return { invocationMessage: messages[mode] ?? `#ctx (${mode})...` };
	}

	// ─── 3-Layer Search: Fetch Mode ─────────────────────────────

	private _handleFetch(input: ICtxToolParams): vscode.LanguageModelToolResult {
		if (!this.autoCapture) {
			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart('Fetch mode requires auto-capture service.')
			]);
		}

		const ids = input.observationIds;
		if (!ids?.length) {
			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart('Fetch mode requires `observationIds` array. Use search mode first to find IDs.')
			]);
		}

		const { OBSERVATION_TYPE_EMOJI } = require('../autoCapture');
		const parts: string[] = [];
		parts.push(`## Full Observation Details (${ids.length} requested)`);

		let found = 0;
		for (const id of ids.slice(0, 20)) {
			const obs = this.autoCapture.getObservationById(id);
			if (!obs) {
				parts.push(`\n### ❌ ${id} — not found`);
				continue;
			}
			found++;

			const emoji = OBSERVATION_TYPE_EMOJI[obs.type] || '📝';
			const date = new Date(obs.timestamp).toLocaleString();
			parts.push(`\n### ${emoji} ${obs.type.toUpperCase()} — ${date}`);
			parts.push(`**ID:** ${obs.id}`);
			parts.push(`**Participant:** ${obs.participant}`);
			parts.push(`**Discovery tokens:** ${obs.discoveryTokens.toLocaleString()} | **Read tokens:** ${obs.readTokens.toLocaleString()} | **Savings:** ${obs.discoveryTokens - obs.readTokens} tokens`);

			parts.push(`\n**Prompt:**\n${obs.prompt}`);
			parts.push(`\n**Response:**\n${obs.responseSummary}`);

			if (obs.filesReferenced?.length > 0) {
				parts.push(`\n**Files Referenced:** ${obs.filesReferenced.join(', ')}`);
			}
			if (obs.toolCalls?.length) {
				parts.push(`\n**Tool Calls (${obs.toolCalls.length}):**`);
				for (const tc of obs.toolCalls) {
					parts.push(`- \`${tc.name}\`${tc.input ? `: ${tc.input.substring(0, 100)}` : ''}`);
				}
			}
		}

		if (found === 0) {
			parts.push('\nNo matching observations found. IDs may have been evicted from the circular buffer.');
		}

		return new vscode.LanguageModelToolResult([
			new vscode.LanguageModelTextPart(parts.join('\n'))
		]);
	}

	private keywordCardFallback(projectId: string, query: string, limit: number): Array<{ title: string; category: string; tags?: string[]; content: string }> {
		const cards = this.projectManager.getKnowledgeCards(projectId);
		if (!cards.length) {
			return [];
		}

		const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
		const scored = cards.map(card => {
			const title = (card.title || '').toLowerCase();
			const body = `${card.content || ''} ${(card.tags || []).join(' ')}`.toLowerCase();
			let score = 0;
			for (const term of terms) {
				if (title.includes(term)) {
					score += 3;
				} else if (body.includes(term)) {
					score += 1;
				}
			}
			if (title.includes(query.toLowerCase())) {
				score += 8;
			}
			return { card, score };
		}).filter(r => r.score > 0);

		scored.sort((a, b) => b.score - a.score);
		return scored.slice(0, Math.max(1, limit)).map(r => ({
			title: r.card.title,
			category: r.card.category,
			tags: r.card.tags,
			content: r.card.content,
		}));
	}
}
