import * as vscode from 'vscode';
import type { SearchIndex } from './search/SearchIndex';

/**
 * Cache entry with project association and metadata.
 */
export interface CacheEntry {
	id: string;
	key: string;
	content: string;
	symbolName: string;
	filePath?: string;
	lineNumber?: number;
	type: 'explain' | 'usage' | 'relationships';
	projectId?: string;  // Associated project, or undefined for global
	cachedAt: number;
	selected?: boolean;  // Include in context (like knowledge cards)
	referenceFiles?: string[];  // File paths to include as context when this cache is selected
}

/**
 * Cache for storing AI explanations in workspace state.
 * Supports project-based filtering and rich metadata.
 */
export class ExplanationCache {
	private static readonly CACHE_KEY = 'codeExplainer.cache.v2';
	private _searchIndex: SearchIndex | undefined;
	private _onDidChangeCache = new vscode.EventEmitter<void>();
	readonly onDidChangeCache = this._onDidChangeCache.event;

	constructor(private context: vscode.ExtensionContext) {}

	/** Attach the FTS5 search index for incremental updates on mutations. */
	setSearchIndex(index: SearchIndex): void {
		this._searchIndex = index;
	}

	dispose() {
		this._onDidChangeCache.dispose();
	}

	/**
	 * Get a cached explanation by key.
	 */
	get(key: string, projectId?: string): string | undefined {
		const entries = this.getAllEntries();
		// If projectId specified, only match that project's cache
		const entry = entries.find(e => 
			e.key === key && 
			(projectId === undefined || e.projectId === projectId)
		);
		return entry?.content;
	}

	/**
	 * Get full cache entry by key.
	 */
	getEntry(key: string, projectId?: string): CacheEntry | undefined {
		const entries = this.getAllEntries();
		return entries.find(e => 
			e.key === key && 
			(projectId === undefined || e.projectId === projectId)
		);
	}

	/**
	 * Store an explanation in the cache with metadata.
	 */
	set(
		key: string, 
		content: string, 
		metadata: {
			symbolName: string;
			type: 'explain' | 'usage' | 'relationships';
			filePath?: string;
			lineNumber?: number;
			projectId?: string;
			referenceFiles?: string[];
		}
	): void {
		const entries = this.getAllEntries();
		
		// Remove existing entry with same key and project
		const filtered = entries.filter(e => 
			!(e.key === key && e.projectId === metadata.projectId)
		);
		
		// Add new entry
		const entry: CacheEntry = {
			id: `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
			key,
			content,
			symbolName: metadata.symbolName,
			type: metadata.type,
			filePath: metadata.filePath,
			lineNumber: metadata.lineNumber,
			projectId: metadata.projectId,
			cachedAt: Date.now(),
			referenceFiles: metadata.referenceFiles
		};
		filtered.push(entry);
		
		this.saveEntries(filtered);
		this._onDidChangeCache.fire();

		// Index in FTS
		this._searchIndex?.indexCacheEntry({
			id: entry.id, projectId: entry.projectId || '',
			symbolName: entry.symbolName, content: entry.content,
			filePath: entry.filePath || '', type: entry.type,
		});
	}

	/**
	 * Check if a key exists in the cache.
	 */
	has(key: string, projectId?: string): boolean {
		return this.get(key, projectId) !== undefined;
	}

	/**
	 * Get all cache entries.
	 */
	getAllEntries(): CacheEntry[] {
		return this.context.workspaceState.get<CacheEntry[]>(ExplanationCache.CACHE_KEY) || [];
	}

	/**
	 * Get cache entries for a specific project.
	 */
	getEntriesForProject(projectId: string | undefined): CacheEntry[] {
		const entries = this.getAllEntries();
		if (projectId === undefined) {
			// Return entries with no project (global)
			return entries.filter(e => !e.projectId);
		}
		return entries.filter(e => e.projectId === projectId);
	}

	/**
	 * Remove a cache entry by id.
	 */
	remove(entryId: string): void {
		const entries = this.getAllEntries().filter(e => e.id !== entryId);
		this.saveEntries(entries);

		// Remove from FTS
		this._searchIndex?.removeCacheEntry(entryId);
	}

	/**
	 * Update a cache entry's content.
	 */
	updateEntry(entryId: string, updates: { content?: string; symbolName?: string }): boolean {
		const entries = this.getAllEntries();
		const entry = entries.find(e => e.id === entryId);
		if (entry) {
			if (updates.content !== undefined) {
				entry.content = updates.content;
			}
			if (updates.symbolName !== undefined) {
				entry.symbolName = updates.symbolName;
			}
			this.saveEntries(entries);
			return true;
		}
		return false;
	}

	/**
	 * Get a cache entry by id.
	 */
	getEntryById(entryId: string): CacheEntry | undefined {
		return this.getAllEntries().find(e => e.id === entryId);
	}

	/**
	 * Clear all cache entries.
	 */
	clear(): void {
		this.saveEntries([]);
	}

	/**
	 * Clear cache for a specific project.
	 */
	clearForProject(projectId: string): void {
		const entries = this.getAllEntries().filter(e => e.projectId !== projectId);
		this.saveEntries(entries);
	}

	/**
	 * Get the number of cached entries.
	 */
	size(): number {
		return this.getAllEntries().length;
	}

	/**
	 * Toggle selection of a cache entry (for context inclusion).
	 */
	toggleCacheSelection(entryId: string): boolean {
		const entries = this.getAllEntries();
		const entry = entries.find(e => e.id === entryId);
		if (entry) {
			entry.selected = !entry.selected;
			this.saveEntries(entries);
			return entry.selected;
		}
		return false;
	}

	/**
	 * Get selected cache entries for a project (or global if projectId is undefined).
	 */
	getSelectedEntries(projectId: string | undefined): CacheEntry[] {
		const entries = this.getEntriesForProject(projectId);
		return entries.filter(e => e.selected);
	}

	/**
	 * Get IDs of all selected cache entries for a project.
	 */
	getSelectedEntryIds(projectId: string | undefined): string[] {
		return this.getSelectedEntries(projectId).map(e => e.id);
	}

	/**
	 * Deselect all selected cache entries for a project.
	 * Used when auto-deselect after use is enabled.
	 */
	deselectAllEntries(projectId: string | undefined): void {
		const entries = this.getAllEntries();
		let changed = false;
		
		entries.forEach(entry => {
			if (entry.selected && entry.projectId === projectId) {
				entry.selected = false;
				changed = true;
			}
		});
		
		if (changed) {
			this.saveEntries(entries);
		}
	}

	private saveEntries(entries: CacheEntry[]): void {
		this.context.workspaceState.update(ExplanationCache.CACHE_KEY, entries);
		this._onDidChangeCache.fire();
	}
}

/**
 * Generate a cache key from command, symbol, and references.
 */
export function generateCacheKey(
	command: string,
	symbol: string,
	references: readonly vscode.ChatPromptReference[] | undefined
): string {
	const refPart = references?.map(r => {
		if (r.value instanceof vscode.Uri) {
			return r.value.toString();
		} else if (r.value instanceof vscode.Location) {
			return `${r.value.uri.toString()}:${r.value.range.start.line}`;
		}
		return String(r.value);
	}).join('|') || '';

	return `${command}:${symbol}:${refPart}`;
}
