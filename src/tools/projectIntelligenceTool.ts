/**
 * Project Intelligence Tool — manage conventions, tool hints, working notes, and retrospectives.
 */

import * as vscode from 'vscode';
import { ProjectManager } from '../projects/ProjectManager';
import { SearchIndex } from '../search/SearchIndex';

interface IProjectIntelligenceParams {
	action: 'learnConvention' | 'learnToolHint' | 'learnNote' | 'queryNotes' | 'searchLearnings' | 'listConventions' | 'updateConvention' | 'retrospect';
	// learnConvention
	category?: 'architecture' | 'naming' | 'patterns' | 'testing' | 'tooling' | 'pitfalls';
	title?: string;
	content?: string;
	confidence?: 'observed' | 'inferred';
	learnedFrom?: string;
	conventionId?: string;
	// learnToolHint
	toolName?: string;
	pattern?: string;
	antiPattern?: string;
	example?: string;
	// learnNote
	subject?: string;
	insight?: string;
	relatedFiles?: string[];
	relatedSymbols?: string[];
	discoveredWhile?: string;
	// queryNotes / searchLearnings
	query?: string;
	files?: string[];
	types?: ('convention' | 'toolHint' | 'note')[];
	limit?: number;
	// retrospect
	taskSummary?: string;
	whatWorked?: string[];
	whatDidntWork?: string[];
	newConventions?: Array<{ category: string; title: string; content: string }>;
	newToolHints?: Array<{ toolName: string; pattern: string; antiPattern?: string; example: string }>;
	knowledgeCards?: Array<{ title: string; content: string; category: string; anchors?: Array<{ filePath: string; symbolName?: string; startLine?: number; endLine?: number; stubContent: string }> }>;
}

export class ProjectIntelligenceTool implements vscode.LanguageModelTool<IProjectIntelligenceParams> {
	constructor(
		private readonly projectManager: ProjectManager,
		private readonly searchIndex?: SearchIndex,
	) {}

	async invoke(
		options: vscode.LanguageModelToolInvocationOptions<IProjectIntelligenceParams>,
		_token: vscode.CancellationToken,
	): Promise<vscode.LanguageModelToolResult> {
		const activeProject = this.projectManager.getActiveProject();
		if (!activeProject) {
			return this.text('No active project in ContextManager.');
		}
		const projectId = activeProject.id;
		const { action } = options.input;

		switch (action) {
			case 'learnConvention': {
				const { category, title, content, confidence, learnedFrom } = options.input;
				if (!category || !title || !content) {
					return this.text('Missing required fields: category, title, content.');
				}
				// Cap confidence: AI can set 'observed' or 'inferred' only, never 'confirmed'
				const safeConfidence = (confidence === 'inferred' || confidence === 'observed') ? confidence : 'observed';
				const conv = await this.projectManager.addConvention(
					projectId, category, title, content, safeConfidence, learnedFrom
				);
				return this.text(conv
					? `✅ Convention learned: [${category}] "${title}" (${safeConfidence})`
					: 'Failed to save convention.'
				);
			}

			case 'updateConvention': {
				const { conventionId, title, content, confidence, category } = options.input;
				if (!conventionId) { return this.text('Missing conventionId.'); }
				const updates: any = {};
				if (title) { updates.title = title; }
				if (content) { updates.content = content; }
				if (confidence) { updates.confidence = confidence; }
				if (category) { updates.category = category; }
				const ok = await this.projectManager.updateConvention(projectId, conventionId, updates);
				return this.text(ok ? '✅ Convention updated.' : 'Convention not found.');
			}

			case 'listConventions': {
				const conventions = this.projectManager.getConventions(projectId);
				const filtered = options.input.confidence
					? conventions.filter(c => c.confidence === options.input.confidence)
					: conventions;
				if (filtered.length === 0) {
					return this.text('No conventions found.');
				}
				const lines = filtered.map(c =>
					`- [${c.category}] **${c.title}** (ID: ${c.id}): ${c.content.slice(0, 150)}${c.content.length > 150 ? '…' : ''} (${c.confidence})`
				);
				return this.text(`## Conventions (${filtered.length})\n${lines.join('\n')}`);
			}

			case 'learnToolHint': {
				const { toolName, pattern, example, antiPattern } = options.input;
				if (!toolName || !pattern || !example) {
					return this.text('Missing required fields: toolName, pattern, example.');
				}
				const hint = await this.projectManager.addToolHint(projectId, toolName, pattern, example, antiPattern);
				return this.text(hint
					? `✅ Tool hint learned: search "${pattern}"${antiPattern ? ` not "${antiPattern}"` : ''}`
					: 'Failed to save tool hint.'
				);
			}

			case 'learnNote': {
				const { subject, insight, relatedFiles, relatedSymbols, discoveredWhile } = options.input;
				if (!subject || !insight) {
					return this.text('Missing required fields: subject, insight.');
				}
				const note = await this.projectManager.addWorkingNote(
					projectId, subject, insight, relatedFiles || [], relatedSymbols || [], discoveredWhile
				);
				return this.text(note
					? `📌 Note saved: "${subject}" (${(relatedFiles || []).length} related files)`
					: 'Failed to save working note.'
				);
			}

			case 'queryNotes': {
				const notes = this.projectManager.queryWorkingNotes(
					projectId, options.input.query, options.input.files
				);
				if (notes.length === 0) {
					return this.text('No matching working notes found.');
				}
				const lines = notes.slice(0, options.input.limit || 10).map(n => {
					const stale = n.staleness !== 'fresh' ? ` ⚠️ ${n.staleness}` : '';
					return `### 📌 ${n.subject} (ID: ${n.id})${stale}\n${n.insight.slice(0, 300)}${n.insight.length > 300 ? '…' : ''}\n` +
						(n.relatedFiles.length > 0 ? `Files: ${n.relatedFiles.join(', ')}\n` : '') +
						(n.relatedSymbols.length > 0 ? `Symbols: ${n.relatedSymbols.join(', ')}\n` : '');
				});
				return this.text(`## Working Notes (${notes.length})\n${lines.join('\n')}`);
			}

			case 'searchLearnings': {
				const { query, types, limit } = options.input;
				if (!query) { return this.text('Missing required field: query.'); }
				if (!this.searchIndex) {
					// Fallback: keyword search on working notes
					const notes = this.projectManager.queryWorkingNotes(projectId, query);
					if (notes.length === 0) { return this.text('No matching learnings found (FTS not available).'); }
					const lines = notes.slice(0, limit || 10).map(n => `- 📌 ${n.subject} (ID: ${n.id}): ${n.insight.slice(0, 100)}…`);
					return this.text(`## Search Results\n${lines.join('\n')}`);
				}
				const results = await this.searchIndex.searchLearnings(projectId, query, types, limit || 10);
				if (results.length === 0) { return this.text(`No learnings found for "${query}".`); }
				const typeIcons: Record<string, string> = { convention: '🏗', toolHint: '🔧', note: '📌' };
				const lines = results.map(r =>
					`- ${typeIcons[r.metadata.type] || '•'} [${r.metadata.type}] **${r.title}**: ${r.snippet}`
				);
				return this.text(`## Learnings matching "${query}" (${results.length})\n${lines.join('\n')}`);
			}

			case 'retrospect': {
				const { taskSummary, whatWorked, whatDidntWork, newConventions, newToolHints, knowledgeCards } = options.input;
				const results: string[] = ['## 📋 Retrospective Processed\n'];

				// Save new conventions
				if (newConventions && newConventions.length > 0) {
					for (const c of newConventions) {
						await this.projectManager.addConvention(
							projectId,
							(c.category || 'patterns') as any,
							c.title, c.content, 'observed', taskSummary
						);
					}
					results.push(`- ✅ ${newConventions.length} convention(s) learned`);
				}

				// Save new tool hints
				if (newToolHints && newToolHints.length > 0) {
					for (const h of newToolHints) {
						await this.projectManager.addToolHint(projectId, h.toolName, h.pattern, h.example, h.antiPattern);
					}
					results.push(`- ✅ ${newToolHints.length} tool hint(s) saved`);
				}

				// Save knowledge cards
				if (knowledgeCards && knowledgeCards.length > 0) {
					for (const card of knowledgeCards) {
						const cardAnchors = card.anchors?.map(a => ({
							filePath: a.filePath,
							symbolName: a.symbolName,
							startLine: a.startLine,
							endLine: a.endLine,
							stubContent: a.stubContent,
							capturedAt: Date.now(),
							verified: true,
						}));
						await this.projectManager.addKnowledgeCard(
							projectId, card.title, card.content,
							(card.category || 'note') as any, [], taskSummary,
							undefined, undefined, undefined, cardAnchors
						);
					}
					results.push(`- ✅ ${knowledgeCards.length} knowledge card(s) created`);
				}

				return this.text(results.join('\n'));
			}

			default:
				return this.text(`Unknown action "${action}".`);
		}
	}

	private text(msg: string): vscode.LanguageModelToolResult {
		return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(msg)]);
	}

	async prepareInvocation(
		options: vscode.LanguageModelToolInvocationPrepareOptions<IProjectIntelligenceParams>,
		_token: vscode.CancellationToken,
	) {
		const action = options.input?.action ?? 'queryNotes';
		const messages: Record<string, string> = {
			learnConvention: `Learning convention: "${options.input?.title || '...'}"`,
			learnToolHint: `Learning tool hint: "${options.input?.pattern || '...'}"`,
			learnNote: `Saving note: "${options.input?.subject || '...'}"`,
			queryNotes: `Querying working notes...`,
			searchLearnings: `Searching learnings for "${options.input?.query || '...'}"`,
			listConventions: 'Listing conventions...',
			updateConvention: 'Updating convention...',
			retrospect: 'Processing end-of-task retrospective...',
		};
		return {
			invocationMessage: messages[action] ?? `Project intelligence (${action})...`,
		};
	}
}
