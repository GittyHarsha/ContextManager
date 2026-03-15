/**
 * Storage layer for projects and cache data.
 * Uses globalStorageUri (disk files) for large data; globalState only for tiny metadata.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Project, CachedExplanation, PendingHookEvent, SessionBindingSegment, SessionOrigin, SessionRoutingState, TrackedSession, createSessionRoutingState } from './types';

// Legacy globalState keys — only used during one-time migration
const PROJECTS_KEY = 'codeExplainer.projects';
const ACTIVE_PROJECT_KEY = 'codeExplainer.activeProjectId';
const CACHE_KEY = 'codeExplainer.explanationCache';

// Disk file names under globalStorageUri
const PROJECTS_FILE = 'projects.json';
const SESSION_ROUTING_FILE = 'session-routing.json';

function normalizeSessionOrigin(origin: unknown): SessionOrigin {
	return origin === 'vscode-extension'
		|| origin === 'copilot-cli-plugin'
		|| origin === 'claude-code-plugin'
		|| origin === 'unknown'
		? origin
		: 'unknown';
}

function normalizeBindingSegment(segment: any): SessionBindingSegment | undefined {
	if (!segment || typeof segment.sessionId !== 'string' || typeof segment.projectId !== 'string') {
		return undefined;
	}

	const now = Date.now();
	return {
		id: typeof segment.id === 'string' && segment.id ? segment.id : `${segment.sessionId}-${segment.projectId}-${segment.startSequence ?? now}`,
		sessionId: segment.sessionId,
		projectId: segment.projectId,
		startSequence: typeof segment.startSequence === 'number' ? segment.startSequence : 0,
		endSequence: typeof segment.endSequence === 'number' ? segment.endSequence : undefined,
		reason: segment.reason === 'rebind' || segment.reason === 'auto-link' ? segment.reason : 'initial-bind',
		createdAt: typeof segment.createdAt === 'number' ? segment.createdAt : now,
		updatedAt: typeof segment.updatedAt === 'number' ? segment.updatedAt : now,
	};
}

function normalizeTrackedSession(session: any): TrackedSession | undefined {
	if (!session || typeof session.sessionId !== 'string' || !session.sessionId.trim()) {
		return undefined;
	}

	const now = Date.now();
	const bindingSegments = Array.isArray(session.bindingSegments)
		? session.bindingSegments
			.map((segment: any) => normalizeBindingSegment(segment))
			.filter((segment: SessionBindingSegment | undefined): segment is SessionBindingSegment => !!segment)
		: [];
	const createdAt = typeof session.createdAt === 'number' ? session.createdAt : now;
	const updatedAt = typeof session.updatedAt === 'number' ? session.updatedAt : createdAt;
	const lastActivityAt = typeof session.lastActivityAt === 'number' ? session.lastActivityAt : updatedAt;
	const pendingCaptureCount = typeof session.pendingCaptureCount === 'number' ? session.pendingCaptureCount : 0;
	const hasOpenBinding = bindingSegments.some((segment: SessionBindingSegment) => segment.endSequence === undefined);
	const status = session.status === 'bound'
		|| session.status === 'ended'
		|| session.status === 'dismissed'
		|| session.status === 'pending'
		? session.status
		: (hasOpenBinding ? 'bound' : 'pending');

	return {
		sessionId: session.sessionId,
		origin: normalizeSessionOrigin(session.origin),
		status,
		label: typeof session.label === 'string' && session.label.trim() ? session.label : `Session ${session.sessionId.slice(0, 8)}`,
		bindingToken: typeof session.bindingToken === 'string' ? session.bindingToken : undefined,
		firstPromptSnippet: typeof session.firstPromptSnippet === 'string' ? session.firstPromptSnippet : undefined,
		rootHint: typeof session.rootHint === 'string' ? session.rootHint : undefined,
		cwd: typeof session.cwd === 'string' ? session.cwd : undefined,
		createdAt,
		updatedAt,
		lastActivityAt,
		endedAt: typeof session.endedAt === 'number' ? session.endedAt : undefined,
		dismissedAt: typeof session.dismissedAt === 'number' ? session.dismissedAt : undefined,
		pendingCaptureCount,
		bindingSegments,
		metadata: session.metadata && typeof session.metadata === 'object' && !Array.isArray(session.metadata)
			? session.metadata as Record<string, string | number | boolean>
			: undefined,
	};
}

function normalizePendingHookEvent(event: any): PendingHookEvent | undefined {
	if (!event || typeof event.sessionId !== 'string' || !event.sessionId.trim()) {
		return undefined;
	}

	const now = Date.now();
	return {
		id: typeof event.id === 'string' && event.id ? event.id : `${event.sessionId}-${event.sequence ?? now}`,
		sessionId: event.sessionId,
		origin: normalizeSessionOrigin(event.origin),
		sequence: typeof event.sequence === 'number' ? event.sequence : 0,
		eventType: typeof event.eventType === 'string' && event.eventType ? event.eventType : 'Unknown',
		queuedAt: typeof event.queuedAt === 'number' ? event.queuedAt : now,
		status: event.status === 'backfilled' || event.status === 'discarded' ? event.status : 'pending',
		projectIdHint: typeof event.projectIdHint === 'string' ? event.projectIdHint : undefined,
		rootHint: typeof event.rootHint === 'string' ? event.rootHint : undefined,
		payload: event.payload,
		materializedAt: typeof event.materializedAt === 'number' ? event.materializedAt : undefined,
	};
}

export class Storage {
	// In-memory cache — populated on first read, kept in sync on every write
	private _projectsCache: Project[] | null = null;
	private _sessionRoutingCache: SessionRoutingState | null = null;

	constructor(private context: vscode.ExtensionContext) {}

	// ─── Internal helpers ───────────────────────────────────────

	private get storagePath(): string {
		return this.context.globalStorageUri.fsPath;
	}

	private ensureStorageDir(): void {
		if (!fs.existsSync(this.storagePath)) {
			fs.mkdirSync(this.storagePath, { recursive: true });
		}
	}

	private readDiskFile<T>(filename: string, fallback: T): T {
		try {
			const filePath = path.join(this.storagePath, filename);
			if (fs.existsSync(filePath)) {
				return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
			}
		} catch (err) {
			console.error(`[Storage] Failed to read ${filename}:`, err);
		}
		return fallback;
	}

	private writeDiskFile(filename: string, data: unknown): void {
		try {
			this.ensureStorageDir();
			fs.writeFileSync(path.join(this.storagePath, filename), JSON.stringify(data), 'utf8');
		} catch (err) {
			console.error(`[Storage] Failed to write ${filename}:`, err);
		}
	}

	// ============ Projects ============

	getProjects(): Project[] {
		// Serve from memory cache if already loaded
		if (this._projectsCache !== null) {
			return this._projectsCache;
		}
		const diskFile = path.join(this.storagePath, PROJECTS_FILE);
		if (fs.existsSync(diskFile)) {
			this._projectsCache = this.readDiskFile<Project[]>(PROJECTS_FILE, []);
			return this._projectsCache;
		}
		// One-time migration from globalState → disk
		const fromState = this.context.globalState.get<Project[]>(PROJECTS_KEY, []);
		this._projectsCache = fromState;
		this.writeDiskFile(PROJECTS_FILE, fromState);
		this.context.globalState.update(PROJECTS_KEY, undefined);
		return this._projectsCache;
	}

	saveProjects(projects: Project[]): Thenable<void> {
		this._projectsCache = projects;  // Keep memory in sync
		this.writeDiskFile(PROJECTS_FILE, projects);
		// Clear legacy globalState entry (no-op after first migration)
		return this.context.globalState.update(PROJECTS_KEY, undefined);
	}

	getSessionRoutingState(): SessionRoutingState {
		if (this._sessionRoutingCache !== null) {
			return this._sessionRoutingCache;
		}

		const state = this.readDiskFile<SessionRoutingState>(
			SESSION_ROUTING_FILE,
			createSessionRoutingState(),
		);
		this._sessionRoutingCache = {
			...createSessionRoutingState(),
			...state,
			trackedSessions: Array.isArray(state.trackedSessions)
				? state.trackedSessions
					.map(session => normalizeTrackedSession(session))
					.filter((session): session is TrackedSession => !!session)
				: [],
			pendingHookEvents: Array.isArray(state.pendingHookEvents)
				? state.pendingHookEvents
					.map(event => normalizePendingHookEvent(event))
					.filter((event): event is PendingHookEvent => !!event)
				: [],
			nextSequence: typeof state.nextSequence === 'number' && state.nextSequence > 0 ? state.nextSequence : 1,
			updatedAt: typeof state.updatedAt === 'number' ? state.updatedAt : Date.now(),
		};
		return this._sessionRoutingCache;
	}

	saveSessionRoutingState(state: SessionRoutingState): void {
		this._sessionRoutingCache = {
			...state,
			updatedAt: Date.now(),
		};
		this.writeDiskFile(SESSION_ROUTING_FILE, this._sessionRoutingCache);
	}

	getActiveProjectId(): string | undefined {
		return this.context.globalState.get<string>(ACTIVE_PROJECT_KEY);
	}

	setActiveProjectId(projectId: string | undefined): Thenable<void> {
		return this.context.globalState.update(ACTIVE_PROJECT_KEY, projectId);
	}

	// ============ Cache ============

	getCache(): CachedExplanation[] {
		// Use workspaceState for cache (workspace-specific)
		return this.context.workspaceState.get<CachedExplanation[]>(CACHE_KEY, []);
	}

	saveCache(cache: CachedExplanation[]): Thenable<void> {
		return this.context.workspaceState.update(CACHE_KEY, cache);
	}

	// Get cache for specific project
	getCacheForProject(projectId: string): CachedExplanation[] {
		return this.getCache().filter(c => c.projectId === projectId);
	}

	// Add single cache entry
	async addCacheEntry(entry: CachedExplanation): Promise<void> {
		const cache = this.getCache();
		// Replace existing entry with same id, or add new
		const existingIndex = cache.findIndex(c => c.id === entry.id);
		if (existingIndex >= 0) {
			cache[existingIndex] = entry;
		} else {
			cache.push(entry);
		}
		await this.saveCache(cache);
	}

	// Remove cache entry
	async removeCacheEntry(entryId: string): Promise<void> {
		const cache = this.getCache().filter(c => c.id !== entryId);
		await this.saveCache(cache);
	}

	// Clear all cache
	async clearCache(): Promise<void> {
		await this.saveCache([]);
	}

	// Clear cache for project
	async clearCacheForProject(projectId: string): Promise<void> {
		const cache = this.getCache().filter(c => c.projectId !== projectId);
		await this.saveCache(cache);
	}
}
