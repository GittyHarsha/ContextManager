/**
 * Types for the BM25 full-text search index.
 * The search index uses SQLite FTS4 (via sql.js WASM) to provide
 * ranked full-text search across all entity types in the extension.
 */

// ─── Entity Types ───────────────────────────────────────────────

/** All searchable entity types in ContextManager. */
export type SearchEntityType =
	| 'card'
	| 'todo'
	| 'cache'
	| 'session'
	| 'agentMessage'
	| 'project'
	| 'learning'
	| 'convention'
	| 'workingNote'
	| 'toolHint'
	| 'observation';

// ─── Search Results ─────────────────────────────────────────────

/** A single result from a full-text search query. */
export interface SearchResult {
	/** The type of entity matched. */
	entityType: SearchEntityType;
	/** The unique ID of the matched entity. */
	entityId: string;
	/** The project this entity belongs to. */
	projectId: string;
	/** Display title for the result. */
	title: string;
	/** FTS4 snippet with match highlighting (uses [...] markers). */
	snippet: string;
	/** BM25 relevance score (lower = more relevant, matching FTS5 bm25() convention). */
	score: number;
	/** Additional metadata about the match (varies by entity type). */
	metadata: Record<string, string>;
}

// ─── Search Options ─────────────────────────────────────────────

/** Options for controlling search behavior. */
export interface SearchOptions {
	/** Filter to specific entity types. If empty/undefined, searches all types. */
	entityTypes?: SearchEntityType[];
	/** Filter to a specific project. If undefined, searches all projects. */
	projectId?: string;
	/** Maximum number of results to return (default 10). */
	limit?: number;
	/** Number of context tokens around match highlights in snippets (default 16). */
	snippetTokens?: number;
}

// ─── Indexing Payloads ──────────────────────────────────────────

/** Data required to index a knowledge card. */
export interface CardIndexPayload {
	id: string;
	projectId: string;
	title: string;
	content: string;
	category: string;
	tags: string;
	source: string;
}

/** Data required to index a TODO. */
export interface TodoIndexPayload {
	id: string;
	projectId: string;
	title: string;
	description: string;
	notes: string;
	status: string;
	priority: string;
}

/** Data required to index a cache entry. */
export interface CacheIndexPayload {
	id: string;
	projectId: string;
	symbolName: string;
	content: string;
	filePath: string;
	type: string;
}

/** Data required to index a branch session. */
export interface SessionIndexPayload {
	id: string;
	projectId: string;
	branchName: string;
	task: string;
	goal: string;
	currentState: string;
	approaches: string;
	decisions: string;
	nextSteps: string;
	blockers: string;
}

/** Data required to index an agent conversation message. */
export interface AgentMessageIndexPayload {
	id: string;
	runId: string;
	todoId: string;
	projectId: string;
	role: string;
	content: string;
}

/** Data required to index a project. */
export interface ProjectIndexPayload {
	id: string;
	name: string;
	description: string;
	goals: string;
	conventions: string;
}

/** Data required to index a learning (convention, tool hint, or working note). */
export interface LearningIndexPayload {
	id: string;
	projectId: string;
	type: 'convention' | 'toolHint' | 'note';
	subject: string;
	content: string;
	category: string;
	relatedFiles: string;
	relatedSymbols: string;
	confidence: string;
}

/** Data required to index an observation (auto-captured chat interaction). */
export interface ObservationIndexPayload {
	id: string;
	projectId: string;
	type: string;
	prompt: string;
	responseSummary: string;
	participant: string;
	filesReferenced: string;
	toolCalls: string;
	timestamp: number;
}
