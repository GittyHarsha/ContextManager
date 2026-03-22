import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export const CM_DIR = path.join(os.homedir(), '.contextmanager');
const REGISTRY_FILE = path.join(CM_DIR, 'agent-registry.json');

export type AgentStatus = 'active' | 'idle' | 'stopped';

export interface TerminalInfo {
	type: 'psmux' | 'tmux' | 'vscode' | 'raw';
	paneId?: string;
	windowId?: string;
	sessionName?: string;
}

export interface AgentEntry {
	sessionId: string;
	origin: string;
	cwd: string;
	project?: string;
	label?: string;
	status: AgentStatus;
	terminal?: TerminalInfo;
	registeredAt: number;
	lastSeenAt: number;
	stoppedAt?: number;
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
			// Backfill status for old entries
			for (const agent of Object.values(this._state!.agents)) {
				if (!agent.status) { agent.status = 'active'; }
			}
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
			existing.status = 'active';
			existing.stoppedAt = undefined;
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
			status: 'active',
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
			if (agent.status === 'stopped') { agent.status = 'active'; }
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

	setTerminal(sessionId: string, terminal: TerminalInfo): void {
		const state = this._load();
		const agent = state.agents[sessionId];
		if (agent) {
			agent.terminal = terminal;
			this._save();
		}
	}

	setStatus(sessionId: string, status: AgentStatus): void {
		const state = this._load();
		const agent = state.agents[sessionId];
		if (agent) {
			agent.status = status;
			if (status === 'stopped') { agent.stoppedAt = Date.now(); }
			this._save();
		}
	}

	get(sessionId: string): AgentEntry | undefined {
		const state = this._load();
		return state.agents[sessionId];
	}

	list(filter?: { project?: string; status?: AgentStatus }): AgentEntry[] {
		const state = this._load();
		let agents = Object.values(state.agents);
		if (filter?.project) {
			agents = agents.filter(a => a.project === filter.project);
		}
		if (filter?.status) {
			agents = agents.filter(a => a.status === filter.status);
		}
		return agents.sort((a, b) => b.lastSeenAt - a.lastSeenAt);
	}

	remove(sessionId: string): void {
		const state = this._load();
		delete state.agents[sessionId];
		this._save();
	}

	/** Mark stale agents as stopped instead of deleting. Returns count marked. */
	prune(staleMs: number = 30 * 60 * 1000): number {
		const state = this._load();
		const cutoff = Date.now() - staleMs;
		let count = 0;
		for (const agent of Object.values(state.agents)) {
			if (agent.status !== 'stopped' && agent.lastSeenAt < cutoff) {
				agent.status = 'stopped';
				agent.stoppedAt = Date.now();
				count++;
			}
		}
		if (count > 0) { this._save(); }
		return count;
	}

	/** Actually delete agents stopped longer than maxAge (default 7 days). */
	purge(maxAge: number = 7 * 24 * 60 * 60 * 1000): number {
		const state = this._load();
		const cutoff = Date.now() - maxAge;
		const purgeIds = Object.keys(state.agents).filter(id => {
			const a = state.agents[id];
			return a.status === 'stopped' && (a.stoppedAt || a.lastSeenAt) < cutoff;
		});
		for (const id of purgeIds) { delete state.agents[id]; }
		if (purgeIds.length > 0) { this._save(); }
		return purgeIds.length;
	}

	dispose(): void {
		this._state = undefined;
	}
}
