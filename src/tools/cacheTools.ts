/**
 * Cache tools — save, search, read, and edit cached explanations.
 */

import * as vscode from 'vscode';
import { ExplanationCache } from '../cache';
import { ConfigurationManager } from '../config';
import { ProjectManager } from '../projects/ProjectManager';
import { SearchIndex } from '../search/SearchIndex';

// ─── Interfaces ─────────────────────────────────────────────────

interface ISaveCacheParams {
	/** Symbol or concept name for this cache entry. */
	symbolName: string;
	/** The explanation/content to cache. */
	content: string;
	/** Type of cached content. Default: 'explain'. */
	type?: 'explain' | 'usage' | 'relationships';
	/** Optional file path the explanation relates to. */
	filePath?: string;
	/** Optional line number within filePath. */
	lineNumber?: number;
}

interface ISearchCacheParams {
	/** Keyword or phrase to search for in cache entries. */
	query: string;
	/** Maximum results to return. Default 10. */
	limit?: number;
}

interface IReadCacheParams {
	/** Cache entry ID (exact). */
	id?: string;
	/** Symbol name to look up (finds the most recent match). */
	symbolName?: string;
	/** Type filter when using symbolName. Optional. */
	type?: 'explain' | 'usage' | 'relationships';
}

interface IEditCacheParams {
	/** Cache entry ID to edit. */
	id: string;
	/** Replacement content. Omit to keep existing. */
	content?: string;
	/** Replacement symbol name. Omit to keep existing. */
	symbolName?: string;
}

// ─── Save Cache Tool ─────────────────────────────────────────────

/**
 * Silently saves a code explanation or note to the cache without interrupting the chat session.
 * No confirmation required — runs in background.
 */
export class SaveCacheTool implements vscode.LanguageModelTool<ISaveCacheParams> {
	constructor(
		private readonly cache: ExplanationCache,
		private readonly projectManager: ProjectManager,
	) {}

	async invoke(
		options: vscode.LanguageModelToolInvocationOptions<ISaveCacheParams>,
		_token: vscode.CancellationToken,
	): Promise<vscode.LanguageModelToolResult> {
		const { symbolName, content, type = 'explain', filePath, lineNumber } = options.input;

		if (!symbolName?.trim()) {
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('symbolName is required.')]);
		}
		if (!content?.trim()) {
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('content is required.')]);
		}

		const project = this.projectManager.getActiveProject();
		const projectId = project?.id;
		const key = `${type}:${symbolName.trim()}`;

		this.cache.set(key, content.trim(), {
			symbolName: symbolName.trim(),
			type,
			filePath,
			lineNumber,
			projectId,
		});

		// Retrieve the entry to get its auto-generated ID
		const entry = this.cache.getEntry(key, projectId);

		return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(
			`Cached explanation for "${symbolName}" (type: ${type})${entry ? ` — ID: ${entry.id}` : ''}${project ? `\nProject: ${project.name}` : ''}`
		)]);
	}

	async prepareInvocation(
		options: vscode.LanguageModelToolInvocationPrepareOptions<ISaveCacheParams>,
		_token: vscode.CancellationToken,
	) {
		const sym = options.input?.symbolName ?? 'symbol';
		const msg = `Caching explanation for "${sym}"...`;
		if (ConfigurationManager.toolsBackgroundMode) {
			return { invocationMessage: msg };
		}
		return {
			invocationMessage: msg,
			confirmationMessages: {
				title: 'Save to Cache',
				message: new vscode.MarkdownString(`Cache explanation for **"${sym}"** (type: ${options.input?.type ?? 'explain'})?`),
			},
		};
	}
}

// ─── Search Cache Tool ───────────────────────────────────────────

/**
 * Searches cached explanations by keyword/symbol name match.
 * Filters to the active project's cache.
 */
export class SearchCacheTool implements vscode.LanguageModelTool<ISearchCacheParams> {
	constructor(
		private readonly cache: ExplanationCache,
		private readonly projectManager: ProjectManager,
		private readonly searchIndex?: SearchIndex,
	) {}

	async invoke(
		options: vscode.LanguageModelToolInvocationOptions<ISearchCacheParams>,
		_token: vscode.CancellationToken,
	): Promise<vscode.LanguageModelToolResult> {
		const { query, limit = 10 } = options.input;

		if (!query?.trim()) {
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('query is required.')]);
		}

		const project = this.projectManager.getActiveProject();

		// Try FTS search first if available
		if (this.searchIndex?.isReady && ConfigurationManager.searchEnableFTS) {
			try {
				const results = await this.searchIndex.search(query, {
					entityTypes: ['cache'],
					projectId: project?.id,
					limit,
					snippetTokens: ConfigurationManager.searchSnippetTokens,
				});

				if (results.length > 0) {
					const parts: string[] = [`## Cache Search Results for: "${query}" (${results.length} found)\n`];
					for (const r of results) {
						const score = Math.abs(r.score).toFixed(2);
						parts.push(`### ${r.title} — relevance ${score}`);
						if (r.metadata.filePath) { parts.push(`File: ${r.metadata.filePath}`); }
						parts.push(`ID: ${r.entityId}`);
						if (r.snippet) { parts.push(`> ${r.snippet.replace(/\n/g, '\n> ')}`); }
						parts.push('');
					}
					return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(parts.join('\n'))]);
				}
			} catch { /* fall through to keyword search */ }
		}

		// Keyword fallback
		const entries = project
			? this.cache.getEntriesForProject(project.id)
			: this.cache.getAllEntries();

		const q = query.toLowerCase();
		const terms = q.split(/\s+/).filter(Boolean);

		const matched = entries
			.map(e => {
				const haystack = `${e.symbolName} ${e.content} ${e.filePath ?? ''}`.toLowerCase();
				const hits = terms.filter(t => haystack.includes(t)).length;
				return { e, hits };
			})
			.filter(x => x.hits > 0)
			.sort((a, b) => b.hits - a.hits)
			.slice(0, limit);

		if (matched.length === 0) {
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(
				`No cached entries found matching "${query}"${project ? ` in project "${project.name}"` : ''}.`
			)]);
		}

		const parts: string[] = [`## Cache Search Results for: "${query}" (${matched.length} found)\n`];
		for (const { e } of matched) {
			parts.push(`### ${e.symbolName} [${e.type}]`);
			if (e.filePath) { parts.push(`File: ${e.filePath}${e.lineNumber !== undefined ? `:${e.lineNumber}` : ''}`); }
			parts.push(`ID: ${e.id} | Cached: ${new Date(e.cachedAt).toLocaleDateString()}`);
			// Show a snippet (first 300 chars)
			const snippet = e.content.length > 300 ? e.content.substring(0, 297) + '...' : e.content;
			parts.push(`> ${snippet.replace(/\n/g, '\n> ')}`);
			parts.push('');
		}

		return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(parts.join('\n'))]);
	}

	async prepareInvocation(
		options: vscode.LanguageModelToolInvocationPrepareOptions<ISearchCacheParams>,
		_token: vscode.CancellationToken,
	) {
		const q = options.input?.query ?? '...';
		const msg = `Searching cache for "${q}"...`;
		if (ConfigurationManager.toolsBackgroundMode) {
			return { invocationMessage: msg };
		}
		return {
			invocationMessage: msg,
			confirmationMessages: {
				title: 'Search Cache',
				message: new vscode.MarkdownString(`Search cached explanations for **"${q}"**?`),
			},
		};
	}
}

// ─── Read Cache Tool ─────────────────────────────────────────────

/**
 * Reads a specific cache entry in full by its ID or symbol name.
 */
export class ReadCacheTool implements vscode.LanguageModelTool<IReadCacheParams> {
	constructor(
		private readonly cache: ExplanationCache,
		private readonly projectManager: ProjectManager,
	) {}

	async invoke(
		options: vscode.LanguageModelToolInvocationOptions<IReadCacheParams>,
		_token: vscode.CancellationToken,
	): Promise<vscode.LanguageModelToolResult> {
		const { id, symbolName, type } = options.input;

		if (!id && !symbolName) {
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(
				'Provide either id or symbolName to identify the cache entry.'
			)]);
		}

		let entry = id ? this.cache.getEntryById(id) : undefined;

		if (!entry && symbolName) {
			const project = this.projectManager.getActiveProject();
			const all = project
				? this.cache.getEntriesForProject(project.id)
				: this.cache.getAllEntries();

			const sym = symbolName.trim().toLowerCase();
			const candidates = all.filter(e =>
				e.symbolName.toLowerCase() === sym &&
				(type === undefined || e.type === type)
			);

			// Most recent first
			entry = candidates.sort((a, b) => b.cachedAt - a.cachedAt)[0];
		}

		if (!entry) {
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(
				id
					? `No cache entry found with ID "${id}".`
					: `No cache entry found for symbol "${symbolName}"${type ? ` (type: ${type})` : ''}.`
			)]);
		}

		const parts: string[] = [];
		parts.push(`## Cache Entry: ${entry.symbolName} [${entry.type}]`);
		parts.push(`**ID:** ${entry.id}`);
		if (entry.filePath) {
			parts.push(`**File:** ${entry.filePath}${entry.lineNumber !== undefined ? `:${entry.lineNumber}` : ''}`);
		}
		parts.push(`**Cached:** ${new Date(entry.cachedAt).toLocaleString()}`);
		if (entry.projectId) { parts.push(`**Project:** ${entry.projectId}`); }
		parts.push('');
		parts.push(entry.content);

		return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(parts.join('\n'))]);
	}

	async prepareInvocation(
		options: vscode.LanguageModelToolInvocationPrepareOptions<IReadCacheParams>,
		_token: vscode.CancellationToken,
	) {
		const label = options.input?.symbolName ?? options.input?.id ?? 'cache entry';
		const msg = `Reading cache: "${label}"...`;
		if (ConfigurationManager.toolsBackgroundMode) {
			return { invocationMessage: msg };
		}
		return {
			invocationMessage: msg,
			confirmationMessages: {
				title: 'Read Cache Entry',
				message: new vscode.MarkdownString(`Read cached entry for **"${label}"**?`),
			},
		};
	}
}

// ─── Edit Cache Tool ──────────────────────────────────────────────

/**
 * Updates an existing cache entry's content and/or symbol name.
 * Only supplied fields are changed.
 */
export class EditCacheTool implements vscode.LanguageModelTool<IEditCacheParams> {
	constructor(
		private readonly cache: ExplanationCache,
	) {}

	async invoke(
		options: vscode.LanguageModelToolInvocationOptions<IEditCacheParams>,
		_token: vscode.CancellationToken,
	): Promise<vscode.LanguageModelToolResult> {
		const { id, content, symbolName } = options.input;

		if (!id?.trim()) {
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('id is required.')]);
		}

		const entry = this.cache.getEntryById(id.trim());
		if (!entry) {
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(
				`No cache entry found with ID "${id}".`
			)]);
		}

		if (content === undefined && symbolName === undefined) {
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(
				'No fields to update. Provide at least one of: content, symbolName.'
			)]);
		}

		const updates: { content?: string; symbolName?: string } = {};
		if (content !== undefined) { updates.content = content.trim(); }
		if (symbolName !== undefined) { updates.symbolName = symbolName.trim(); }

		const ok = this.cache.updateEntry(id.trim(), updates);
		if (!ok) {
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(
				`Failed to update cache entry "${id}".`
			)]);
		}

		const changed = Object.keys(updates).join(', ');
		const sym = updates.symbolName ?? entry.symbolName;
		return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(
			`Cache entry updated: "${sym}" (ID: ${id})\nUpdated fields: ${changed}`
		)]);
	}

	async prepareInvocation(
		options: vscode.LanguageModelToolInvocationPrepareOptions<IEditCacheParams>,
		_token: vscode.CancellationToken,
	) {
		const id = options.input?.id ?? 'cache entry';
		const msg = `Editing cache entry "${id}"...`;
		if (ConfigurationManager.toolsBackgroundMode) {
			return { invocationMessage: msg };
		}
		return {
			invocationMessage: msg,
			confirmationMessages: {
				title: 'Edit Cache Entry',
				message: new vscode.MarkdownString(`Update cache entry **"${id}"**?`),
			},
		};
	}
}
