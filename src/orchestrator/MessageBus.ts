import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const CM_DIR = path.join(os.homedir(), '.contextmanager');
const BUS_FILE = path.join(CM_DIR, 'agent-bus.jsonl');
const CURSORS_FILE = path.join(CM_DIR, 'bus-cursors.json');

const DEFAULT_TTL_SEC = 86400; // 24 hours

export interface BusMessage {
	id: string;
	from: string;
	to?: string;
	project?: string;
	timestamp: number;
	ttl?: number;
	payload: unknown;
}

type CursorsState = Record<string, { offset: number }>;

let idCounter = 0;

function generateId(): string {
	const now = Date.now().toString(36);
	const rand = Math.random().toString(36).slice(2, 8);
	return `${now}-${rand}-${(idCounter++).toString(36)}`;
}

export class MessageBus {

	private _loadCursors(): CursorsState {
		try {
			return JSON.parse(fs.readFileSync(CURSORS_FILE, 'utf8'));
		} catch {
			return {};
		}
	}

	private _saveCursors(cursors: CursorsState): void {
		try {
			fs.mkdirSync(CM_DIR, { recursive: true });
			fs.writeFileSync(CURSORS_FILE, JSON.stringify(cursors, null, 2), 'utf8');
		} catch (err) {
			console.warn('[MessageBus] saveCursors error:', err);
		}
	}

	post(msg: Omit<BusMessage, 'id' | 'timestamp'>): BusMessage {
		const full: BusMessage = {
			id: generateId(),
			timestamp: Date.now(),
			ttl: msg.ttl ?? DEFAULT_TTL_SEC,
			...msg,
		};
		try {
			fs.mkdirSync(CM_DIR, { recursive: true });
			fs.appendFileSync(BUS_FILE, JSON.stringify(full) + '\n', 'utf8');
		} catch (err) {
			console.warn('[MessageBus] post error:', err);
		}
		return full;
	}

	/** Read messages visible to agentId, advancing the read cursor. */
	read(agentId: string, opts?: { project?: string; limit?: number }): BusMessage[] {
		const msgs = this._readFrom(agentId, opts);
		// Advance cursor to end of file
		const cursors = this._loadCursors();
		try {
			const stat = fs.statSync(BUS_FILE);
			cursors[agentId] = { offset: stat.size };
			this._saveCursors(cursors);
		} catch { /* file may not exist */ }
		return msgs;
	}

	/** Read messages visible to agentId WITHOUT advancing cursor. */
	peek(agentId: string, opts?: { project?: string; limit?: number }): BusMessage[] {
		return this._readFrom(agentId, opts);
	}

	/** Get last N messages regardless of cursor (for dashboard). */
	recent(opts?: { project?: string; limit?: number }): BusMessage[] {
		const limit = opts?.limit ?? 20;
		const all = this._readAllMessages();
		const now = Date.now();
		return all
			.filter(m => !this._isExpired(m, now))
			.filter(m => !opts?.project || !m.project || m.project === opts.project)
			.slice(-limit);
	}

	/** Rewrite bus file without expired messages. Returns count removed. */
	compact(): number {
		const all = this._readAllMessages();
		const now = Date.now();
		const alive = all.filter(m => !this._isExpired(m, now));
		const removed = all.length - alive.length;
		if (removed > 0) {
			try {
				const data = alive.map(m => JSON.stringify(m)).join('\n') + (alive.length > 0 ? '\n' : '');
				const tmp = BUS_FILE + '.tmp';
				fs.writeFileSync(tmp, data, 'utf8');
				fs.renameSync(tmp, BUS_FILE);
			} catch (err) {
				console.warn('[MessageBus] compact error:', err);
			}
		}
		return removed;
	}

	private _readFrom(agentId: string, opts?: { project?: string; limit?: number }): BusMessage[] {
		const cursors = this._loadCursors();
		const offset = cursors[agentId]?.offset ?? 0;
		const limit = opts?.limit ?? 50;
		const now = Date.now();

		let content: string;
		try {
			const buf = Buffer.alloc(0);
			const fd = fs.openSync(BUS_FILE, 'r');
			const stat = fs.fstatSync(fd);
			const readSize = stat.size - offset;
			if (readSize <= 0) { fs.closeSync(fd); return []; }
			const readBuf = Buffer.alloc(readSize);
			fs.readSync(fd, readBuf, 0, readSize, offset);
			fs.closeSync(fd);
			content = readBuf.toString('utf8');
		} catch {
			return [];
		}

		const messages: BusMessage[] = [];
		for (const line of content.split('\n')) {
			if (!line.trim()) { continue; }
			try {
				const msg: BusMessage = JSON.parse(line);
				if (this._isExpired(msg, now)) { continue; }
				if (msg.to && msg.to !== agentId) { continue; }
				if (opts?.project && msg.project && msg.project !== opts.project) { continue; }
				messages.push(msg);
			} catch { /* skip malformed lines */ }
		}

		return messages.slice(-limit);
	}

	private _readAllMessages(): BusMessage[] {
		try {
			const content = fs.readFileSync(BUS_FILE, 'utf8');
			return content.split('\n')
				.filter(line => line.trim())
				.map(line => { try { return JSON.parse(line); } catch { return null; } })
				.filter((m): m is BusMessage => m !== null);
		} catch {
			return [];
		}
	}

	private _isExpired(msg: BusMessage, now: number): boolean {
		if (!msg.ttl) { return false; }
		return (now - msg.timestamp) > msg.ttl * 1000;
	}

	dispose(): void {
		// nothing to clean up
	}
}
