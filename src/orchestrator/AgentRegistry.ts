import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export const CM_DIR = path.join(os.homedir(), '.contextmanager');
const REGISTRY_FILE = path.join(CM_DIR, 'agent-registry.json');

export interface AgentEntry {
	sessionId: string;
	origin: string;
	cwd: string;
	project?: string;
	label?: string;
	registeredAt: number;
	lastSeenAt: number;
	meta: Record<string, unknown>;
}

interface RegistryState {
	agents: Record<string, AgentEntry>;
	updatedAt: number;
}

export class AgentRegistry {
	private _state: RegistryState | undefined;

	private _load(): RegistryState {
		if (this._state) { return this._state; }
		try {
			const raw = fs.readFileSync(REGISTRY_FILE, 'utf8');
			this._state = JSON.parse(raw);
			return this._state!;
		} catch {
			this._state = { agents: {}, updatedAt: Date.now() };
			return this._state;
		}
	}

	private _save(): void {
		const state = this._load();
		state.updatedAt = Date.now();
		try {
			fs.mkdirSync(CM_DIR, { recursive: true });
			const tmp = REGISTRY_FILE + '.tmp';
			fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
			fs.renameSync(tmp, REGISTRY_FILE);
		} catch (err) {
			console.warn('[AgentRegistry] save error:', err);
		}
	}

	/** Invalidate cached state so next read picks up external changes */
	invalidate(): void {
		this._state = undefined;
	}

	register(sessionId: string, origin: string, cwd: string, label?: string): AgentEntry {
		const state = this._load();
		const existing = state.agents[sessionId];
		const now = Date.now();

		if (existing) {
			existing.lastSeenAt = now;
			if (label) { existing.label = label; }
			if (cwd) { existing.cwd = cwd; }
			this._save();
			return existing;
		}

		const entry: AgentEntry = {
			sessionId,
			origin,
			cwd,
			label,
			registeredAt: now,
			lastSeenAt: now,
			meta: {},
		};
		state.agents[sessionId] = entry;
		this._save();
		return entry;
	}

	heartbeat(sessionId: string): void {
		const state = this._load();
		const agent = state.agents[sessionId];
		if (agent) {
			agent.lastSeenAt = Date.now();
			this._save();
		}
	}

	setMeta(sessionId: string, meta: Record<string, unknown>): void {
		const state = this._load();
		const agent = state.agents[sessionId];
		if (agent) {
			agent.meta = { ...agent.meta, ...meta };
			this._save();
		}
	}

	setProject(sessionId: string, project: string): void {
		const state = this._load();
		const agent = state.agents[sessionId];
		if (agent) {
			agent.project = project;
			this._save();
		}
	}

	get(sessionId: string): AgentEntry | undefined {
		const state = this._load();
		return state.agents[sessionId];
	}

	list(filter?: { project?: string }): AgentEntry[] {
		const state = this._load();
		let agents = Object.values(state.agents);
		if (filter?.project) {
			agents = agents.filter(a => a.project === filter.project);
		}
		return agents.sort((a, b) => b.lastSeenAt - a.lastSeenAt);
	}

	remove(sessionId: string): void {
		const state = this._load();
		delete state.agents[sessionId];
		this._save();
	}

	/** Remove agents not seen within staleMs (default 30 minutes). Returns count pruned. */
	prune(staleMs: number = 30 * 60 * 1000): number {
		const state = this._load();
		const cutoff = Date.now() - staleMs;
		const staleIds = Object.keys(state.agents).filter(id => state.agents[id].lastSeenAt < cutoff);
		for (const id of staleIds) {
			delete state.agents[id];
		}
		if (staleIds.length > 0) { this._save(); }
		return staleIds.length;
	}

	dispose(): void {
		this._state = undefined;
	}
}
