/**
 * SearchIndex — BM25 full-text search over all ContextManager entities.
 *
 * Uses sql.js (SQLite compiled to WebAssembly) with FTS4 virtual tables.
 * Acts as a **search index only** — Memento remains the source of truth.
 * The index is rebuilt from Memento data on activation, and kept in sync
 * via incremental updates on every write.
 *
 * Architecture:
 *  - 8 FTS4 virtual tables (cards, todos, cache, sessions, agent messages, projects, learnings, observations)
 *  - BM25 ranking computed in JS from matchinfo('pcnalx')
 *  - unicode61 tokenizer for good code-identifier handling
 *  - DB persisted to globalStorageUri/search.db between sessions
 */

import * as vscode from 'vscode';
import initSqlJs, { type Database } from 'sql.js';
import * as path from 'path';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import {
	SearchResult,
	SearchOptions,
	SearchEntityType,
	CardIndexPayload,
	TodoIndexPayload,
	CacheIndexPayload,
	SessionIndexPayload,
	AgentMessageIndexPayload,
	ProjectIndexPayload,
	LearningIndexPayload,
	ObservationIndexPayload,
} from './types';

// Re-export types for convenience
export { SearchResult, SearchOptions, SearchEntityType } from './types';

// ─── Constants ──────────────────────────────────────────────────

const DB_FILENAME = 'search-fts4.db';
const DEFAULT_LIMIT = 10;  // overridden by config at call sites
const SNIPPET_TOKENS = 16; // overridden by config at call sites

// FTS4 tokenizer: unicode61 handles camelCase/snake_case well,
// remove_diacritics=2 normalizes accented characters
const TOKENIZER = `tokenize=unicode61 "remove_diacritics=2"`;

/**
 * Compute BM25 score from FTS4 matchinfo('pcnalx') blob.
 *
 * matchinfo('pcnalx') returns an array of uint32 values:
 *   p = number of matchable phrases in query
 *   c = number of user-defined columns
 *   n = total rows in the FTS table
 *   a[c] = avg tokens per column
 *   l[c] = tokens in this row's column
 *   x[p][c][3] = { hits_this_row, hits_all_rows, docs_with_hit }
 *
 * @param matchInfoRaw - Raw Uint8Array from matchinfo('pcnalx')
 * @param weights - Per-column weight array (higher = more important)
 * @param k1 - BM25 term-frequency saturation (default 1.2)
 * @param b  - BM25 document-length normalization (default 0.75)
 * @returns Negative score (lower = better, matching FTS5 bm25() convention for sort compatibility)
 */
function bm25FromMatchInfo(
	matchInfoRaw: Uint8Array | number[],
	weights: number[],
	k1 = 1.2,
	b = 0.75,
): number {
	// Parse uint32 little-endian values from the blob
	const ints: number[] = [];
	if (matchInfoRaw instanceof Uint8Array) {
		const view = new DataView(matchInfoRaw.buffer, matchInfoRaw.byteOffset, matchInfoRaw.byteLength);
		for (let i = 0; i < matchInfoRaw.byteLength; i += 4) {
			ints.push(view.getUint32(i, true));
		}
	} else {
		// Already an array of numbers (some sql.js versions)
		ints.push(...matchInfoRaw);
	}

	const p = ints[0]; // phrases
	const c = ints[1]; // columns
	const n = ints[2]; // total docs
	// a[0..c-1] = avg tokens per column, starting at index 3
	// l[0..c-1] = tokens in this row, starting at index 3+c
	// x[phrase][col] = { hitsThisRow, hitsAllRows, docsWithHit } starting at 3+2*c

	let score = 0;
	for (let phrase = 0; phrase < p; phrase++) {
		for (let col = 0; col < c; col++) {
			const w = col < weights.length ? weights[col] : 1;
			if (w === 0) { continue; }

			const xBase = 3 + 2 * c + (phrase * c + col) * 3;
			const hitsThisRow = ints[xBase];
			// const hitsAllRows = ints[xBase + 1]; // unused in standard BM25
			const docsWithHit = ints[xBase + 2];

			if (hitsThisRow === 0 || docsWithHit === 0) { continue; }

			const avgDl = ints[3 + col] || 1;
			const dl = ints[3 + c + col] || 1;

			// IDF
			const idf = Math.log((n - docsWithHit + 0.5) / (docsWithHit + 0.5) + 1);
			// TF with length normalization
			const tf = (hitsThisRow * (k1 + 1)) / (hitsThisRow + k1 * (1 - b + b * dl / avgDl));

			score += w * idf * tf;
		}
	}

	// Return negative so lower = better when sorting ascending
	return -score;
}

// ─── SearchIndex ────────────────────────────────────────────────

export class SearchIndex implements vscode.Disposable {
	private db: Database | undefined;
	private dbPath: string | undefined;
	private initPromise: Promise<void> | undefined;
	private dirty = false;
	private _rebuilding = false;
	private _freshDb = false;
	private _saveTimer: ReturnType<typeof setInterval> | undefined;
	private outputChannel: vscode.OutputChannel;

	constructor(
		private readonly context: vscode.ExtensionContext,
	) {
		this.outputChannel = vscode.window.createOutputChannel('ContextManager Search');
	}

	// ─── Lifecycle ──────────────────────────────────────────────

	/**
	 * Initialize the SQLite database (lazy — called on first use or explicitly).
	 * Loads existing DB from disk if available, otherwise creates fresh schema.
	 */
	async initialize(): Promise<void> {
		if (this.db) { return; }
		if (this.initPromise) { return this.initPromise; }
		this.initPromise = this._doInit();
		return this.initPromise;
	}

	private async _doInit(): Promise<void> {
		try {
			// Locate the WASM binary bundled with the extension
			const wasmPath = path.join(
				this.context.extensionPath,
				'out',
				'sql-wasm.wasm',
			);

			// Load WASM binary asynchronously, fall back to node_modules for dev
			let wasmBinary: Buffer | undefined;
			try {
				wasmBinary = await fsp.readFile(wasmPath);
			} catch {
				// Dev fallback: load from node_modules
				const devPath = path.join(
					this.context.extensionPath,
					'node_modules',
					'sql.js',
					'dist',
					'sql-wasm.wasm',
				);
				try {
					wasmBinary = await fsp.readFile(devPath);
				} catch {
					// No local WASM — sql.js will attempt to fetch it
				}
			}

			const SQL = await initSqlJs({
				wasmBinary: wasmBinary ? wasmBinary.buffer.slice(wasmBinary.byteOffset, wasmBinary.byteOffset + wasmBinary.byteLength) as ArrayBuffer : undefined,
			});

			// Try loading existing DB from disk
			const storagePath = this.context.globalStorageUri.fsPath;
			await fsp.mkdir(storagePath, { recursive: true });
			this.dbPath = path.join(storagePath, DB_FILENAME);

			try {
				const data = await fsp.readFile(this.dbPath);
				this.db = new SQL.Database(new Uint8Array(data));
				this.log('Loaded existing search index from disk');
				// Validate schema — if tables are missing, recreate
				this.ensureSchema();
				this.startAutoSave();
				return;
			} catch {
				// No existing DB or corrupt — create fresh
			}

			// Create fresh DB
			this.db = new SQL.Database();
			this._freshDb = true;
			this.createSchema();
			this.startAutoSave();
			this.log('Created new search index');
		} catch (err: any) {
			if (err?.message?.includes('no such module: fts')) {
				this.log('FTS4 not available in this sql.js build — search index disabled (extension works without it)');
				this.db = undefined;
				return;
			}
			this.log(`Failed to initialize search index: ${err.message}`);
			throw err;
		}
	}

	/**
	 * Persist the database to disk.
	 */
	async save(): Promise<void> {
		if (!this.db || !this.dbPath || !this.dirty) { return; }
		try {
			const data = this.db.export();
			await fsp.writeFile(this.dbPath, Buffer.from(data));
			this.dirty = false;
		} catch (err: any) {
			this.log(`Failed to save search index: ${err.message}`);
		}
	}

	/**
	 * Save and close the database.
	 */
	dispose(): void {
		// Stop auto-save timer
		if (this._saveTimer) {
			clearInterval(this._saveTimer);
			this._saveTimer = undefined;
		}
		if (this.db) {
			try {
				// Synchronous best-effort save on dispose (dispose must be sync)
				if (this.dirty && this.dbPath) {
					const data = this.db.export();
					fs.writeFileSync(this.dbPath, Buffer.from(data));
				}
				this.db.close();
			} catch {
				// Best-effort on dispose
			}
			this.db = undefined;
		}
		this.outputChannel.dispose();
	}

	/** Start periodic auto-save (every 30s when dirty). */
	private startAutoSave(): void {
		if (this._saveTimer) { return; }
		this._saveTimer = setInterval(() => {
			if (this.dirty) {
				this.save().catch(() => {});
			}
		}, 30_000);
	}

	/** Whether the index is currently being rebuilt (skip incremental writes). */
	get isRebuilding(): boolean { return this._rebuilding; }

	/** Whether the search index is initialized and ready. */
	get isReady(): boolean {
		return this.db !== undefined;
	}

	/**
	 * Whether the index needs a full rebuild (fresh DB with no saved data).
	 * A restored-from-disk DB already contains indexed data from the previous
	 * session and will be kept up-to-date by incremental indexing methods.
	 */
	get needsRebuild(): boolean {
		return this._freshDb;
	}

	// ─── Schema ─────────────────────────────────────────────────

	private createSchema(): void {
		if (!this.db) { return; }

		this.db.run(`
			CREATE VIRTUAL TABLE IF NOT EXISTS cards_fts USING fts4(
				id, project_id,
				title, content, category, tags, source,
				${TOKENIZER},
				notindexed=id, notindexed=project_id
			);
		`);

		this.db.run(`
			CREATE VIRTUAL TABLE IF NOT EXISTS todos_fts USING fts4(
				id, project_id,
				title, description, notes, status, priority,
				${TOKENIZER},
				notindexed=id, notindexed=project_id, notindexed=status, notindexed=priority
			);
		`);

		this.db.run(`
			CREATE VIRTUAL TABLE IF NOT EXISTS cache_fts USING fts4(
				id, project_id,
				symbol_name, content, file_path, type,
				${TOKENIZER},
				notindexed=id, notindexed=project_id, notindexed=type
			);
		`);

		this.db.run(`
			CREATE VIRTUAL TABLE IF NOT EXISTS sessions_fts USING fts4(
				id, project_id,
				branch_name, task, goal, current_state,
				approaches, decisions, next_steps, blockers,
				${TOKENIZER},
				notindexed=id, notindexed=project_id
			);
		`);

		this.db.run(`
			CREATE VIRTUAL TABLE IF NOT EXISTS agent_messages_fts USING fts4(
				id, run_id, todo_id, project_id,
				role, content,
				${TOKENIZER},
				notindexed=id, notindexed=run_id, notindexed=todo_id, notindexed=project_id,
				notindexed=role
			);
		`);

		this.db.run(`
			CREATE VIRTUAL TABLE IF NOT EXISTS projects_fts USING fts4(
				id,
				name, description, goals, conventions,
				${TOKENIZER},
				notindexed=id
			);
		`);

		this.db.run(`
			CREATE VIRTUAL TABLE IF NOT EXISTS learnings_fts USING fts4(
				id, project_id, type,
				subject, content, category,
				related_files, related_symbols,
				confidence,
				${TOKENIZER},
				notindexed=id, notindexed=project_id, notindexed=type,
				notindexed=category, notindexed=confidence
			);
		`);

		this.db.run(`
			CREATE VIRTUAL TABLE IF NOT EXISTS observations_fts USING fts4(
				id, project_id, type,
				prompt, response_summary,
				participant,
				files_referenced, tool_calls,
				timestamp_epoch,
				${TOKENIZER},
				notindexed=id, notindexed=project_id, notindexed=type,
				notindexed=participant, notindexed=timestamp_epoch
			);
		`);
	}

	/** Ensure all FTS4 tables exist (handles schema upgrades incrementally). */
	private ensureSchema(): void {
		if (!this.db) { return; }
		const requiredTables = ['cards_fts', 'todos_fts', 'cache_fts', 'sessions_fts', 'agent_messages_fts', 'projects_fts', 'learnings_fts', 'observations_fts'];
		const existing = new Set<string>();
		const rows = this.db.exec("SELECT name FROM sqlite_master WHERE type='table'");
		if (rows.length > 0) {
			for (const row of rows[0].values) {
				existing.add(row[0] as string);
			}
		}
		const missing = requiredTables.filter(t => !existing.has(t));
		if (missing.length > 0) {
			this.log(`Schema missing tables: ${missing.join(', ')} — creating incrementally`);
			// Only create missing tables — never drop existing ones
			this.createSchema(); // Uses CREATE IF NOT EXISTS, safe to call
		}
	}

	// ─── Query Preprocessing ────────────────────────────────────

	/**
	 * Split camelCase / PascalCase identifiers into individual words.
	 * e.g. "camelCase" → ["camel", "Case"], "HTMLParser" → ["HTML", "Parser"]
	 */
	private splitCamelCase(word: string): string[] {
		return word
			.replace(/([a-z])([A-Z])/g, '$1 $2')     // camelCase → camel Case
			.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2') // HTMLParser → HTML Parser
			.replace(/[_\-]/g, ' ')                     // snake_case → snake case
			.split(/\s+/)
			.filter(w => w.length > 0);
	}

	/**
	 * Convert a user query into FTS4 MATCH syntax.
	 * - Quoted phrases are preserved as-is
	 * - Short words (≤3 chars) become prefix queries: term*
	 * - Longer words are used as exact terms (no prefix) for precision
	 * - camelCase/PascalCase/snake_case terms are expanded
	 * - Words are joined with implicit AND
	 * - Special FTS4 characters are escaped
	 */
	private preprocessQuery(query: string, useOr = false): string {
		if (!query?.trim()) { return ''; }

		// FTS4 reserved operators (case-sensitive)
		const RESERVED = new Set(['AND', 'OR', 'NOT', 'NEAR']);

		const tokens: string[] = [];
		let remaining = query.trim();

		// Extract quoted phrases first
		const quoteRegex = /"([^"]+)"/g;
		let match: RegExpExecArray | null;
		while ((match = quoteRegex.exec(remaining)) !== null) {
			// Sanitize: remove column filter syntax (e.g. "title:") inside quotes
			const cleaned = match[1].replace(/\w+:/g, '');
			if (cleaned.trim()) {
				tokens.push(`"${cleaned.trim()}"`);
			}
		}
		// Remove quoted parts from remaining
		remaining = remaining.replace(quoteRegex, '').trim();

		// Split remaining into words, expand camelCase, apply smart matching
		if (remaining) {
			const rawWords = remaining.split(/\s+/).filter(Boolean);
			const expandedWords: string[] = [];

			for (const word of rawWords) {
				// Strip FTS4 special chars
				const escaped = word.replace(/[*^(){}[\]:]/g, '');
				if (!escaped || RESERVED.has(escaped)) {
					continue;
				}

				// Expand camelCase/PascalCase/snake_case
				const parts = this.splitCamelCase(escaped);
				if (parts.length > 1) {
					// Add both the original and the split parts
					expandedWords.push(escaped);
					for (const part of parts) {
						if (part.length >= 2 && !RESERVED.has(part.toUpperCase())) {
							expandedWords.push(part);
						}
					}
				} else {
					expandedWords.push(escaped);
				}
			}

			// Deduplicate (case-insensitive)
			const seen = new Set<string>();
			for (const word of expandedWords) {
				const lower = word.toLowerCase();
				if (seen.has(lower)) { continue; }
				seen.add(lower);

				// Short words (≤3 chars): prefix match for flexibility
				// Longer words: exact match for precision
				if (word.length <= 3) {
					tokens.push(`${word}*`);
				} else {
					tokens.push(word);
				}
			}
		}

		// Join with AND (default) or OR (fallback mode)
		return tokens.join(useOr ? ' OR ' : ' ');
	}

	/**
	 * Run a search with automatic OR fallback when AND returns no results.
	 */
	private preprocessQueryWithFallback(query: string): { ftsQuery: string; usedOr: boolean } {
		const andQuery = this.preprocessQuery(query, false);
		return { ftsQuery: andQuery, usedOr: false };
	}

	// ─── Full Rebuild ───────────────────────────────────────────

	/**
	 * Full rebuild of the search index from Memento data.
	 * Called on extension activation.
	 */
	async rebuild(
		projects: Array<{
			id: string;
			name: string;
			description?: string;
			context: { goals?: string; conventions?: string };
			knowledgeCards: Array<{ id: string; title: string; content: string; category: string; tags?: string[]; source?: string }>;
			todos: Array<{
				id: string; title: string; description?: string; notes?: string; status: string; priority: string;
				agentRuns: Array<{
					id: string; conversationHistory: Array<{ role: string; content: string }>;
				}>;
			}>;
			trackedBranches?: Array<{
				branchName: string;
				sessions: Array<{
					id: string; task: string; goal?: string; currentState: string;
					approaches: string[]; decisions: string[]; nextSteps: string[]; blockers: string[];
				}>;
			}>;
			conventions?: Array<{ id: string; title: string; content: string; category: string; confidence: string }>;
			toolHints?: Array<{ id: string; toolName: string; pattern: string; example: string }>;
			workingNotes?: Array<{ id: string; subject: string; insight: string; relatedFiles: string[]; relatedSymbols: string[]; confidence: string }>;
		}>,
		cacheEntries: Array<{ id: string; projectId?: string; symbolName: string; content: string; filePath?: string; type: string }>,
	): Promise<void> {
		await this.initialize();
		if (!this.db) { return; }

		this._rebuilding = true;
		try {
			await this._doRebuild(projects, cacheEntries);
		} finally {
			this._rebuilding = false;
		}
	}

	private async _doRebuild(
		projects: Parameters<SearchIndex['rebuild']>[0],
		cacheEntries: Parameters<SearchIndex['rebuild']>[1],
	): Promise<void> {
		if (!this.db) { return; }

		// Wrap entire rebuild in a single transaction for much better throughput
		this.db.run('BEGIN TRANSACTION');
		try {
			// Clear everything
			const tables = ['cards_fts', 'todos_fts', 'cache_fts', 'sessions_fts', 'agent_messages_fts', 'projects_fts', 'learnings_fts'];
			for (const table of tables) {
				this.db.run(`DELETE FROM ${table}`);
			}

		let cardCount = 0, todoCount = 0, cacheCount = 0, sessionCount = 0, msgCount = 0, learningCount = 0;

		for (const project of projects) {
			// Index project metadata
			this.indexProjectSync({
				id: project.id,
				name: project.name,
				description: project.description || '',
				goals: project.context.goals || '',
				conventions: project.context.conventions || '',
			});

			// Index knowledge cards
			for (const card of project.knowledgeCards) {
				this.indexCardSync({
					id: card.id,
					projectId: project.id,
					title: card.title,
					content: card.content,
					category: card.category,
					tags: card.tags?.join(', ') || '',
					source: card.source || '',
				});
				cardCount++;
			}

			// Index todos and their agent messages
			for (const todo of project.todos) {
				this.indexTodoSync({
					id: todo.id,
					projectId: project.id,
					title: todo.title,
					description: todo.description || '',
					notes: todo.notes || '',
					status: todo.status,
					priority: todo.priority,
				});
				todoCount++;

				// Index conversation messages from agent runs
				for (const run of todo.agentRuns) {
					for (let i = 0; i < run.conversationHistory.length; i++) {
						const msg = run.conversationHistory[i];
						if (msg.content && msg.content.trim()) {
							this.indexAgentMessageSync({
								id: `${run.id}_msg${i}`,
								runId: run.id,
								todoId: todo.id,
								projectId: project.id,
								role: msg.role,
								content: msg.content,
							});
							msgCount++;
						}
					}
				}
			}

			// Index branch sessions
			if (project.trackedBranches) {
				for (const branch of project.trackedBranches) {
					for (const session of branch.sessions) {
						this.indexSessionSync({
							id: session.id,
							projectId: project.id,
							branchName: branch.branchName,
							task: session.task,
							goal: session.goal || '',
							currentState: session.currentState,
							approaches: session.approaches.join('; '),
							decisions: session.decisions.join('; '),
							nextSteps: session.nextSteps.join('; '),
							blockers: session.blockers.join('; '),
						});
						sessionCount++;
					}
				}
			}

			// Index learnings (conventions, tool hints, working notes)
			if (project.conventions) {
				for (const c of project.conventions) {
					this.indexLearningSync({
						id: c.id, projectId: project.id, type: 'convention',
						subject: c.title, content: c.content,
						category: c.category, relatedFiles: '', relatedSymbols: '',
						confidence: c.confidence,
					});
					learningCount++;
				}
			}
			if (project.toolHints) {
				for (const h of project.toolHints) {
					this.indexLearningSync({
						id: h.id, projectId: project.id, type: 'toolHint',
						subject: h.toolName, content: `${h.pattern} ${h.example}`,
						category: 'tooling', relatedFiles: '', relatedSymbols: '',
						confidence: 'observed',
					});
					learningCount++;
				}
			}
			if (project.workingNotes) {
				for (const n of project.workingNotes) {
					this.indexLearningSync({
						id: n.id, projectId: project.id, type: 'note',
						subject: n.subject, content: n.insight,
						category: '', relatedFiles: n.relatedFiles.join(' '),
						relatedSymbols: n.relatedSymbols.join(' '),
						confidence: n.confidence,
					});
					learningCount++;
				}
			}
		}

		// Index cache entries
		for (const entry of cacheEntries) {
			this.indexCacheEntrySync({
				id: entry.id,
				projectId: entry.projectId || '',
				symbolName: entry.symbolName,
				content: entry.content,
				filePath: entry.filePath || '',
				type: entry.type,
			});
			cacheCount++;
		}

		this.dirty = true;
		this.db.run('COMMIT');
		await this.save();

		this.log(
			`Index rebuilt: ${cardCount} cards, ${todoCount} todos, ${cacheCount} cache, ` +
			`${sessionCount} sessions, ${msgCount} messages, ${projects.length} projects, ${learningCount} learnings`
		);
		} catch (err) {
			this.db.run('ROLLBACK');
			throw err;
		}
	}

	// ─── Incremental Indexing: Knowledge Cards ──────────────────

	async indexCard(payload: CardIndexPayload): Promise<void> {
		if (this._rebuilding) { return; }
		await this.initialize();
		this.removeByIdSync('cards_fts', payload.id);
		this.indexCardSync(payload);
		this.dirty = true;
	}

	async removeCard(cardId: string): Promise<void> {
		if (this._rebuilding) { return; }
		await this.initialize();
		this.removeByIdSync('cards_fts', cardId);
		this.dirty = true;
	}

	private indexCardSync(p: CardIndexPayload): void {
		// Expand camelCase in title/tags for better tokenization
		const expandedTitle = this.expandForIndex(p.title);
		const expandedTags = this.expandForIndex(p.tags);
		this.db?.run(
			'INSERT INTO cards_fts(id, project_id, title, content, category, tags, source) VALUES (?, ?, ?, ?, ?, ?, ?)',
			[p.id, p.projectId, expandedTitle, p.content, p.category, expandedTags, p.source],
		);
	}

	/**
	 * Expand camelCase/PascalCase/snake_case terms in text for better FTS tokenization.
	 * Appends split words so both original and parts are searchable.
	 */
	private expandForIndex(text: string): string {
		if (!text) { return text; }
		const words = text.split(/\s+/);
		const expanded: string[] = [];
		for (const word of words) {
			expanded.push(word);
			const parts = this.splitCamelCase(word);
			if (parts.length > 1) {
				for (const part of parts) {
					if (part.length >= 2) { expanded.push(part); }
				}
			}
		}
		return expanded.join(' ');
	}

	// ─── Incremental Indexing: TODOs ────────────────────────────

	async indexTodo(payload: TodoIndexPayload): Promise<void> {
		if (this._rebuilding) { return; }
		await this.initialize();
		this.removeByIdSync('todos_fts', payload.id);
		this.indexTodoSync(payload);
		this.dirty = true;
	}

	async removeTodo(todoId: string): Promise<void> {
		if (this._rebuilding) { return; }
		await this.initialize();
		this.removeByIdSync('todos_fts', todoId);
		this.dirty = true;
	}

	private indexTodoSync(p: TodoIndexPayload): void {
		this.db?.run(
			'INSERT INTO todos_fts(id, project_id, title, description, notes, status, priority) VALUES (?, ?, ?, ?, ?, ?, ?)',
			[p.id, p.projectId, p.title, p.description, p.notes, p.status, p.priority],
		);
	}

	// ─── Incremental Indexing: Cache Entries ────────────────────

	async indexCacheEntry(payload: CacheIndexPayload): Promise<void> {
		if (this._rebuilding) { return; }
		await this.initialize();
		this.removeByIdSync('cache_fts', payload.id);
		this.indexCacheEntrySync(payload);
		this.dirty = true;
	}

	async removeCacheEntry(entryId: string): Promise<void> {
		if (this._rebuilding) { return; }
		await this.initialize();
		this.removeByIdSync('cache_fts', entryId);
		this.dirty = true;
	}

	private indexCacheEntrySync(p: CacheIndexPayload): void {
		this.db?.run(
			'INSERT INTO cache_fts(id, project_id, symbol_name, content, file_path, type) VALUES (?, ?, ?, ?, ?, ?)',
			[p.id, p.projectId, p.symbolName, p.content, p.filePath, p.type],
		);
	}

	// ─── Incremental Indexing: Branch Sessions ──────────────────

	async indexSession(payload: SessionIndexPayload): Promise<void> {
		if (this._rebuilding) { return; }
		await this.initialize();
		this.removeByIdSync('sessions_fts', payload.id);
		this.indexSessionSync(payload);
		this.dirty = true;
	}

	async removeSession(sessionId: string): Promise<void> {
		if (this._rebuilding) { return; }
		await this.initialize();
		this.removeByIdSync('sessions_fts', sessionId);
		this.dirty = true;
	}

	private indexSessionSync(p: SessionIndexPayload): void {
		this.db?.run(
			'INSERT INTO sessions_fts(id, project_id, branch_name, task, goal, current_state, approaches, decisions, next_steps, blockers) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
			[p.id, p.projectId, p.branchName, p.task, p.goal, p.currentState, p.approaches, p.decisions, p.nextSteps, p.blockers],
		);
	}

	// ─── Incremental Indexing: Agent Messages ───────────────────

	async indexAgentMessage(payload: AgentMessageIndexPayload): Promise<void> {
		if (this._rebuilding) { return; }
		await this.initialize();
		this.removeByIdSync('agent_messages_fts', payload.id);
		this.indexAgentMessageSync(payload);
		this.dirty = true;
	}

	async removeAgentRun(runId: string): Promise<void> {
		if (this._rebuilding) { return; }
		await this.initialize();
		if (!this.db) { return; }
		this.db.run('DELETE FROM agent_messages_fts WHERE run_id = ?', [runId]);
		this.dirty = true;
	}

	private indexAgentMessageSync(p: AgentMessageIndexPayload): void {
		this.db?.run(
			'INSERT INTO agent_messages_fts(id, run_id, todo_id, project_id, role, content) VALUES (?, ?, ?, ?, ?, ?)',
			[p.id, p.runId, p.todoId, p.projectId, p.role, p.content],
		);
	}

	// ─── Incremental Indexing: Projects ─────────────────────────

	async indexProject(payload: ProjectIndexPayload): Promise<void> {
		if (this._rebuilding) { return; }
		await this.initialize();
		this.removeByIdSync('projects_fts', payload.id);
		this.indexProjectSync(payload);
		this.dirty = true;
	}

	async removeProject(projectId: string): Promise<void> {
		if (this._rebuilding) { return; }
		await this.initialize();
		this.removeByIdSync('projects_fts', projectId);
		// Also remove all entities belonging to this project
		if (this.db) {
			for (const table of ['cards_fts', 'todos_fts', 'cache_fts', 'sessions_fts', 'agent_messages_fts']) {
				this.db.run(`DELETE FROM ${table} WHERE project_id = ?`, [projectId]);
			}
		}
		this.dirty = true;
	}

	private indexProjectSync(p: ProjectIndexPayload): void {
		this.db?.run(
			'INSERT INTO projects_fts(id, name, description, goals, conventions) VALUES (?, ?, ?, ?, ?)',
			[p.id, p.name, p.description, p.goals, p.conventions],
		);
	}

	// ─── Incremental Indexing: Learnings ────────────────────────

	async indexLearning(payload: LearningIndexPayload): Promise<void> {
		if (this._rebuilding) { return; }
		await this.initialize();
		this.removeByIdSync('learnings_fts', payload.id);
		this.indexLearningSync(payload);
		this.dirty = true;
	}

	async removeLearning(learningId: string): Promise<void> {
		if (this._rebuilding) { return; }
		await this.initialize();
		this.removeByIdSync('learnings_fts', learningId);
		this.dirty = true;
	}

	private indexLearningSync(l: LearningIndexPayload): void {
		const expandedSubject = this.expandForIndex(l.subject);
		this.db?.run(
			'INSERT INTO learnings_fts(id, project_id, type, subject, content, category, related_files, related_symbols, confidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
			[l.id, l.projectId, l.type, expandedSubject, l.content, l.category, l.relatedFiles, l.relatedSymbols, l.confidence],
		);
	}

	// ─── Observation Indexing ───────────────────────────────────

	/** Index an auto-captured observation for FTS search + timeline. */
	indexObservation(o: ObservationIndexPayload): void {
		if (this._rebuilding || !this.db) { return; }
		try {
			this.removeByIdSync('observations_fts', o.id);
			this.db.run(
				'INSERT INTO observations_fts(id, project_id, type, prompt, response_summary, participant, files_referenced, tool_calls, timestamp_epoch) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
				[o.id, o.projectId, o.type, o.prompt, o.responseSummary, o.participant, o.filesReferenced, o.toolCalls, o.timestamp],
			);
			this.dirty = true;
		} catch { /* best-effort */ }
	}

	/** Remove an observation by ID. */
	removeObservation(observationId: string): void {
		if (this._rebuilding || !this.db) { return; }
		this.removeByIdSync('observations_fts', observationId);
		this.dirty = true;
	}

	/**
	 * Search learnings (conventions, tool hints, working notes) using BM25.
	 */
	async searchLearnings(
		projectId: string,
		query: string,
		types?: ('convention' | 'toolHint' | 'note')[],
		limit: number = 10,
	): Promise<SearchResult[]> {
		await this.initialize();
		if (!this.db || !query.trim()) { return []; }

		const ftsQuery = this.preprocessQuery(query);
		if (!ftsQuery) { return []; }

		const results = this._searchLearningsWithQuery(ftsQuery, projectId, types, limit);

		// OR fallback
		if (results.length === 0) {
			const orQuery = this.preprocessQuery(query, true);
			if (orQuery && orQuery !== ftsQuery) {
				return this._searchLearningsWithQuery(orQuery, projectId, types, limit);
			}
		}

		return results;
	}

	private _searchLearningsWithQuery(
		ftsQuery: string,
		projectId: string,
		types: ('convention' | 'toolHint' | 'note')[] | undefined,
		limit: number,
	): SearchResult[] {
		if (!this.db) { return []; }

		try {
			// FTS4: use matchinfo for BM25, snippet with FTS4 arg order
			// learnings_fts columns: id(0), project_id(1), type(2), subject(3), content(4), category(5), related_files(6), related_symbols(7), confidence(8)
			let sql = `SELECT id, project_id, type, subject, content, category, confidence,
				snippet(learnings_fts, '[', ']', '...', 4, 16) as snip,
				matchinfo(learnings_fts, 'pcnalx') as mi
				FROM learnings_fts WHERE learnings_fts MATCH ? AND project_id = ?`;
			const params: any[] = [ftsQuery, projectId];

			if (types && types.length > 0) {
				sql += ` AND type IN (${types.map(() => '?').join(',')})`;
				params.push(...types);
			}

			sql += ` LIMIT ?`;
			params.push(limit * 3); // over-fetch, then rank & trim in JS

			const rows = this.db.exec(sql, params);
			if (rows.length === 0) { return []; }

			// learnings_fts has 9 columns; weights for indexed ones:
			// id(0)=0, project_id(1)=0, type(2)=0, subject(3)=10, content(4)=5, category(5)=0, related_files(6)=2, related_symbols(7)=2, confidence(8)=0
			const weights = [0, 0, 0, 10, 5, 0, 2, 2, 0];

			const scored = rows[0].values.map((row: any[]) => ({
				entityType: 'learning' as SearchEntityType,
				entityId: row[0] as string,
				projectId: row[1] as string,
				title: row[3] as string,
				snippet: row[7] as string,
				score: bm25FromMatchInfo(row[8] as Uint8Array, weights),
				metadata: {
					type: row[2] as string,
					category: row[5] as string,
					confidence: row[6] as string,
				},
			}));

			scored.sort((a, b) => a.score - b.score);
			return scored.slice(0, limit);
		} catch (e) {
			this.log(`Learning search error: ${e}`);
			return [];
		}
	}

	// ─── Helpers ────────────────────────────────────────────────

	private removeByIdSync(table: string, id: string): void {
		this.db?.run(`DELETE FROM ${table} WHERE id = ?`, [id]);
	}

	private log(message: string): void {
		const ts = new Date().toISOString().substring(11, 19);
		this.outputChannel.appendLine(`[${ts}] ${message}`);
	}

	// ─── Search: Cards Only ─────────────────────────────────────

	/**
	 * Search knowledge cards only (replaces the old keyword fallback).
	 * Returns cards ranked by BM25 relevance.
	 */
	async searchCards(
		projectId: string,
		query: string,
		topK: number = 5,
		snippetTokens: number = SNIPPET_TOKENS,
	): Promise<SearchResult[]> {
		await this.initialize();
		if (!this.db) { return []; }

		const ftsQuery = this.preprocessQuery(query);
		if (!ftsQuery) { return []; }

		const results = this._searchCardsWithQuery(ftsQuery, projectId, topK, snippetTokens);

		// OR fallback: if AND returned nothing, retry with OR
		if (results.length === 0) {
			const orQuery = this.preprocessQuery(query, true);
			if (orQuery && orQuery !== ftsQuery) {
				return this._searchCardsWithQuery(orQuery, projectId, topK, snippetTokens);
			}
		}

		return results;
	}

	private _searchCardsWithQuery(
		ftsQuery: string,
		projectId: string,
		topK: number,
		snippetTokens: number,
	): SearchResult[] {
		if (!this.db) { return []; }

		try {
			// cards_fts columns: id(0), project_id(1), title(2), content(3), category(4), tags(5), source(6)
			// FTS4 snippet: snippet(table, startMatch, endMatch, ellipsis, colIdx, numTokens)
			const stmt = this.db.prepare(`
				SELECT id, project_id, title, content, category, tags,
					snippet(cards_fts, '[', ']', '...', 3, ${snippetTokens}) as snip,
					matchinfo(cards_fts, 'pcnalx') as mi
				FROM cards_fts
				WHERE cards_fts MATCH ?
				AND project_id = ?
				LIMIT ?
			`);
			stmt.bind([ftsQuery, projectId, topK * 3]); // over-fetch for BM25 re-rank

			// weights: id=0, project_id=0, title=10, content=5, category=2, tags=1, source=1
			const weights = [0, 0, 10.0, 5.0, 2.0, 1.0, 1.0];

			const results: SearchResult[] = [];
			while (stmt.step()) {
				const row = stmt.getAsObject();
				results.push({
					entityType: 'card',
					entityId: row.id as string,
					projectId: row.project_id as string,
					title: row.title as string,
					snippet: row.snip as string || (row.content as string).substring(0, 200),
					score: bm25FromMatchInfo(row.mi as Uint8Array, weights),
					metadata: {
						category: row.category as string,
						tags: row.tags as string,
						fullContent: row.content as string,
					},
				});
			}
			stmt.free();

			// Sort by BM25 score (lower = better) and trim
			results.sort((a, b) => a.score - b.score);
			return results.slice(0, topK);
		} catch (err: any) {
			this.log(`Card search error for query: ${err.message}`);
			return [];
		}
	}

	// ─── Search: Cross-Entity ───────────────────────────────────

	/**
	 * Cross-entity full-text search with BM25 ranking.
	 * Queries all (or filtered) FTS4 tables and merges results by score.
	 */
	async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
		await this.initialize();
		if (!this.db) { return []; }

		const ftsQuery = this.preprocessQuery(query);
		if (!ftsQuery) { return []; }

		const limit = Math.min(Math.max(options?.limit ?? DEFAULT_LIMIT, 1), 50);
		const snippetTokens = options?.snippetTokens ?? SNIPPET_TOKENS;
		const types = options?.entityTypes ?? ['card', 'todo', 'cache', 'session', 'agentMessage', 'project', 'observation', 'convention', 'workingNote', 'toolHint'];
		const projectFilter = options?.projectId;

		let allResults = this._searchAllTables(ftsQuery, types, projectFilter, snippetTokens);

		// OR fallback: if AND returned nothing, retry with OR
		if (allResults.length === 0) {
			const orQuery = this.preprocessQuery(query, true);
			if (orQuery && orQuery !== ftsQuery) {
				allResults = this._searchAllTables(orQuery, types, projectFilter, snippetTokens);
			}
		}

		// Sort by BM25 score (lower = more relevant)
		allResults.sort((a, b) => a.score - b.score);

		return allResults.slice(0, limit);
	}

	private _searchAllTables(
		ftsQuery: string,
		types: SearchEntityType[],
		projectFilter: string | undefined,
		snippetTokens: number,
	): SearchResult[] {
		const allResults: SearchResult[] = [];

		if (types.includes('card')) {
			allResults.push(...this.searchTable(ftsQuery, 'card', projectFilter, snippetTokens));
		}
		if (types.includes('todo')) {
			allResults.push(...this.searchTable(ftsQuery, 'todo', projectFilter, snippetTokens));
		}
		if (types.includes('cache')) {
			allResults.push(...this.searchTable(ftsQuery, 'cache', projectFilter, snippetTokens));
		}
		if (types.includes('session')) {
			allResults.push(...this.searchTable(ftsQuery, 'session', projectFilter, snippetTokens));
		}
		if (types.includes('agentMessage')) {
			allResults.push(...this.searchTable(ftsQuery, 'agentMessage', projectFilter, snippetTokens));
		}
		if (types.includes('project')) {
			allResults.push(...this.searchTable(ftsQuery, 'project', projectFilter, snippetTokens));
		}
		if (types.includes('observation')) {
			allResults.push(...this.searchTable(ftsQuery, 'observation', projectFilter, snippetTokens));
		}
		if (types.includes('learning') || types.includes('convention') || types.includes('workingNote') || types.includes('toolHint')) {
			const learningTypes: string[] = [];
			if (types.includes('learning')) {
				learningTypes.push('convention', 'note', 'toolHint');
			} else {
				if (types.includes('convention')) { learningTypes.push('convention'); }
				if (types.includes('workingNote')) { learningTypes.push('note'); }
				if (types.includes('toolHint')) { learningTypes.push('toolHint'); }
			}
			allResults.push(...this._searchLearningsForUnifiedSearch(ftsQuery, projectFilter, snippetTokens, learningTypes));
		}

		return allResults;
	}

	/**
	 * Search learnings_fts (conventions, tool hints, working notes) for unified search results.
	 */
	private _searchLearningsForUnifiedSearch(
		ftsQuery: string,
		projectFilter: string | undefined,
		_snippetTokens: number,
		learningTypes?: string[],
	): SearchResult[] {
		if (!this.db) { return []; }
		try {
			let sql = `SELECT id, project_id, type, subject, content, category, confidence,
				snippet(learnings_fts, '[', ']', '...', 4, 16) as snip,
				matchinfo(learnings_fts, 'pcnalx') as mi
				FROM learnings_fts WHERE learnings_fts MATCH ?`;
			const params: any[] = [ftsQuery];
			if (projectFilter) {
				sql += ` AND project_id = ?`;
				params.push(projectFilter);
			}
			if (learningTypes && learningTypes.length > 0 && learningTypes.length < 3) {
				sql += ` AND type IN (${learningTypes.map(() => '?').join(',')})`;
				params.push(...learningTypes);
			}
			const stmt = this.db.prepare(sql);
			stmt.bind(params);
			const results: SearchResult[] = [];
			// learnings_fts columns: id(0), project_id(1), type(2), subject(3), content(4), category(5), related_files(6), related_symbols(7), confidence(8)
			const weights = [0, 0, 0, 10, 5, 0, 2, 2, 0];
			while (stmt.step()) {
				const row = stmt.getAsObject();
				const typeLabels: Record<string, string> = { convention: '🏗 Convention', toolHint: '🔧 Tool Hint', note: '📌 Working Note' };
				// Map DB type to fine-grained SearchEntityType
				const entityTypeMap: Record<string, SearchEntityType> = { convention: 'convention', toolHint: 'toolHint', note: 'workingNote' };
				results.push({
					entityType: entityTypeMap[row.type as string] || 'learning',
					entityId: row.id as string,
					projectId: row.project_id as string,
					title: `${typeLabels[row.type as string] || row.type} — ${row.subject}`,
					snippet: row.snip as string || (row.content as string || '').substring(0, 200),
					score: bm25FromMatchInfo(row.mi as Uint8Array, weights),
					metadata: {
						type: row.type as string,
						category: row.category as string || '',
						confidence: row.confidence as string || '',
					},
				});
			}
			stmt.free();
			results.sort((a, b) => a.score - b.score);
			console.log(`[SearchIndex] learnings_fts search: "${ftsQuery}" types=${JSON.stringify(learningTypes)} → ${results.length} results`);
			return results;
		} catch (err) {
			console.warn('[SearchIndex] learnings_fts search failed:', err);
			return [];
		}
	}

	/**
	 * Search a single FTS4 table, returning normalized SearchResult[].
	 */
	private searchTable(
		ftsQuery: string,
		entityType: SearchEntityType,
		projectFilter?: string,
		snippetTokens: number = SNIPPET_TOKENS,
	): SearchResult[] {
		if (!this.db) { return []; }

		try {
			// FTS4 snippet arg order: snippet(table, startMatch, endMatch, ellipsis, colIdx, numTokens)
			// Column indices refer to position in CREATE TABLE statement
			switch (entityType) {
				// cards_fts: id(0), project_id(1), title(2), content(3), category(4), tags(5), source(6)
				case 'card': return this.searchTableImpl(
					ftsQuery, 'card', 'cards_fts',
					`SELECT id, project_id, title,
						snippet(cards_fts, '[', ']', '...', 3, ${snippetTokens}) as snip,
						matchinfo(cards_fts, 'pcnalx') as mi,
						category, tags
					FROM cards_fts WHERE cards_fts MATCH ?`,
					[0, 0, 10.0, 5.0, 2.0, 1.0, 1.0],
					projectFilter,
					row => ({
						title: row.title as string,
						metadata: { category: row.category as string, tags: row.tags as string },
					}),
				);

				// todos_fts: id(0), project_id(1), title(2), description(3), notes(4), status(5), priority(6)
				case 'todo': return this.searchTableImpl(
					ftsQuery, 'todo', 'todos_fts',
					`SELECT id, project_id, title,
						snippet(todos_fts, '[', ']', '...', 3, ${snippetTokens}) as snip,
						matchinfo(todos_fts, 'pcnalx') as mi,
						status, priority
					FROM todos_fts WHERE todos_fts MATCH ?`,
					[0, 0, 10.0, 5.0, 3.0, 0, 0],
					projectFilter,
					row => ({
						title: row.title as string,
						metadata: { status: row.status as string, priority: row.priority as string },
					}),
				);

				// cache_fts: id(0), project_id(1), symbol_name(2), content(3), file_path(4), type(5)
				case 'cache': return this.searchTableImpl(
					ftsQuery, 'cache', 'cache_fts',
					`SELECT id, project_id, symbol_name as title,
						snippet(cache_fts, '[', ']', '...', 3, ${snippetTokens}) as snip,
						matchinfo(cache_fts, 'pcnalx') as mi,
						file_path, type
					FROM cache_fts WHERE cache_fts MATCH ?`,
					[0, 0, 5.0, 5.0, 2.0, 0],
					projectFilter,
					row => ({
						title: row.title as string,
						metadata: { filePath: row.file_path as string, type: row.type as string },
					}),
				);

				// sessions_fts: id(0), project_id(1), branch_name(2), task(3), goal(4), current_state(5), approaches(6), decisions(7), next_steps(8), blockers(9)
				case 'session': return this.searchTableImpl(
					ftsQuery, 'session', 'sessions_fts',
					`SELECT id, project_id, task as title,
						snippet(sessions_fts, '[', ']', '...', 3, ${snippetTokens}) as snip,
						matchinfo(sessions_fts, 'pcnalx') as mi,
						branch_name
					FROM sessions_fts WHERE sessions_fts MATCH ?`,
					[0, 0, 5.0, 10.0, 5.0, 3.0, 2.0, 2.0, 2.0, 2.0],
					projectFilter,
					row => ({
						title: row.title as string,
						metadata: { branchName: row.branch_name as string },
					}),
				);

				// agent_messages_fts: id(0), run_id(1), todo_id(2), project_id(3), role(4), content(5)
				case 'agentMessage': return this.searchTableImpl(
					ftsQuery, 'agentMessage', 'agent_messages_fts',
					`SELECT id, project_id, role as title,
						snippet(agent_messages_fts, '[', ']', '...', 5, ${snippetTokens}) as snip,
						matchinfo(agent_messages_fts, 'pcnalx') as mi,
						todo_id, run_id
					FROM agent_messages_fts WHERE agent_messages_fts MATCH ?`,
					[0, 0, 0, 0, 0, 5.0],
					projectFilter,
					row => ({
						title: `Agent message (${row.title as string})`,
						metadata: { todoId: row.todo_id as string, runId: row.run_id as string },
					}),
				);

				// projects_fts: id(0), name(1), description(2), goals(3), conventions(4)
				case 'project': return this.searchTableImpl(
					ftsQuery, 'project', 'projects_fts',
					`SELECT id, id as project_id, name as title,
						snippet(projects_fts, '[', ']', '...', 2, ${snippetTokens}) as snip,
						matchinfo(projects_fts, 'pcnalx') as mi
					FROM projects_fts WHERE projects_fts MATCH ?`,
					[0, 5.0, 3.0, 3.0, 2.0],
					undefined, // project filter doesn't apply to projects table
					row => ({
						title: row.title as string,
						metadata: {},
					}),
				);

				// observations_fts: id(0), project_id(1), type(2), prompt(3), response_summary(4), participant(5), files_referenced(6), tool_calls(7), timestamp_epoch(8)
				case 'observation': return this.searchTableImpl(
					ftsQuery, 'observation', 'observations_fts',
					`SELECT id, project_id, prompt as title,
						snippet(observations_fts, '[', ']', '...', 4, ${snippetTokens}) as snip,
						matchinfo(observations_fts, 'pcnalx') as mi,
						type, participant, timestamp_epoch
					FROM observations_fts WHERE observations_fts MATCH ?`,
					[0, 0, 0, 10.0, 5.0, 0, 3.0, 2.0, 0],
					projectFilter,
					row => ({
						title: (row.title as string).substring(0, 120),
						metadata: {
							type: row.type as string,
							participant: row.participant as string,
							timestamp: String(row.timestamp_epoch),
						},
					}),
				);

				default: return [];
			}
		} catch (err: any) {
			this.log(`Search error in ${entityType}: ${err.message}`);
			return [];
		}
	}

	/**
	 * Generic search implementation for one FTS4 table.
	 * Fetches matchinfo, computes BM25 in JS, sorts, and returns top results.
	 */
	private searchTableImpl(
		ftsQuery: string,
		entityType: SearchEntityType,
		_tableName: string,
		baseSql: string,
		weights: number[],
		projectFilter: string | undefined,
		extractRow: (row: Record<string, unknown>) => { title: string; metadata: Record<string, string> },
	): SearchResult[] {
		if (!this.db) { return []; }

		let sql = baseSql;
		const params: (string | number)[] = [ftsQuery];

		if (projectFilter) {
			sql += ' AND project_id = ?';
			params.push(projectFilter);
		}

		sql += ' LIMIT 60'; // Over-fetch, rank in JS, then trim

		const stmt = this.db.prepare(sql);
		stmt.bind(params);

		const results: SearchResult[] = [];
		while (stmt.step()) {
			const row = stmt.getAsObject();
			const { title, metadata } = extractRow(row);
			results.push({
				entityType,
				entityId: row.id as string,
				projectId: row.project_id as string,
				title,
				snippet: row.snip as string || '',
				score: bm25FromMatchInfo(row.mi as Uint8Array, weights),
				metadata,
			});
		}
		stmt.free();

		// Sort by BM25 score (negative = lower is better) and return top 20
		results.sort((a, b) => a.score - b.score);
		return results.slice(0, 20);
	}

	// ─── Stats ──────────────────────────────────────────────────

	/**
	 * Get counts of indexed entities by type. Useful for status display.
	 */
	async getStats(): Promise<Record<SearchEntityType, number>> {
		await this.initialize();
		const stats: Record<SearchEntityType, number> = {
			card: 0, todo: 0, cache: 0, session: 0, agentMessage: 0, project: 0, learning: 0, convention: 0, workingNote: 0, toolHint: 0, observation: 0,
		};
		if (!this.db) { return stats; }

		const tableMap: Record<string, string> = {
			card: 'cards_fts',
			todo: 'todos_fts',
			cache: 'cache_fts',
			session: 'sessions_fts',
			agentMessage: 'agent_messages_fts',
			project: 'projects_fts',
			learning: 'learnings_fts',
			observation: 'observations_fts',
		};

		for (const [type, table] of Object.entries(tableMap)) {
			try {
				const result = this.db.exec(`SELECT COUNT(*) FROM ${table}`);
				if (result.length > 0 && result[0].values.length > 0) {
					stats[type as SearchEntityType] = result[0].values[0][0] as number;
				}
			} catch { /* table may not exist yet */ }
		}

		return stats;
	}
}
