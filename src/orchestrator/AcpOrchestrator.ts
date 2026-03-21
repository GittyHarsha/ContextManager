/**
 * AcpOrchestrator — spawns and controls Copilot CLI agents via ACP (Agent Client Protocol).
 *
 * Each managed agent runs as `copilot --acp --port <port>` and accepts prompts programmatically.
 * The orchestrator can push prompts to agents, read streaming responses, and coordinate work.
 *
 * Usage:
 *   const orch = new AcpOrchestrator();
 *   const agent = await orch.spawn({ name: 'auth-agent', port: 3001, cwd: '/project', agent: 'build-coordinator' });
 *   const response = await orch.prompt(agent.name, 'Check orchestrator messages and act on them');
 *   await orch.stop(agent.name);
 */

import * as net from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';

const CM_DIR = path.join(os.homedir(), '.contextmanager');
const FLEET_FILE = path.join(CM_DIR, 'acp-fleet.json');

export interface AcpAgentConfig {
	name: string;
	port: number;
	cwd?: string;
	agent?: string;       // custom agent name (--agent flag)
	allowAll?: boolean;
	autopilot?: boolean;
	mcpServers?: string[];
}

export interface AcpAgentState {
	name: string;
	port: number;
	cwd: string;
	agent?: string;
	pid?: number;
	sessionId?: string;
	status: 'starting' | 'ready' | 'busy' | 'stopped' | 'error';
	startedAt: number;
	lastPromptAt?: number;
	error?: string;
}

interface FleetState {
	agents: Record<string, AcpAgentState>;
	updatedAt: number;
}

export class AcpOrchestrator {
	private processes = new Map<string, ChildProcess>();
	private connections = new Map<string, any>(); // ACP ClientSideConnection

	/** Load fleet state from disk */
	private _loadFleet(): FleetState {
		try {
			return JSON.parse(fs.readFileSync(FLEET_FILE, 'utf8'));
		} catch {
			return { agents: {}, updatedAt: Date.now() };
		}
	}

	private _saveFleet(state: FleetState): void {
		state.updatedAt = Date.now();
		fs.mkdirSync(CM_DIR, { recursive: true });
		const tmp = FLEET_FILE + '.tmp';
		fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
		fs.renameSync(tmp, FLEET_FILE);
	}

	private _updateAgent(name: string, updates: Partial<AcpAgentState>): void {
		const fleet = this._loadFleet();
		if (fleet.agents[name]) {
			Object.assign(fleet.agents[name], updates);
			this._saveFleet(fleet);
		}
	}

	/** Check if a port is available */
	private async _isPortFree(port: number): Promise<boolean> {
		return new Promise((resolve) => {
			const server = net.createServer();
			server.once('error', () => resolve(false));
			server.once('listening', () => { server.close(); resolve(true); });
			server.listen(port, '127.0.0.1');
		});
	}

	/** Wait for an ACP server to start accepting connections */
	private async _waitForPort(port: number, timeoutMs: number = 30000): Promise<boolean> {
		const start = Date.now();
		while (Date.now() - start < timeoutMs) {
			const connected = await new Promise<boolean>((resolve) => {
				const socket = net.createConnection({ port, host: '127.0.0.1' }, () => {
					socket.destroy();
					resolve(true);
				});
				socket.on('error', () => resolve(false));
				socket.setTimeout(1000, () => { socket.destroy(); resolve(false); });
			});
			if (connected) { return true; }
			await new Promise(r => setTimeout(r, 500));
		}
		return false;
	}

	/** Spawn a new Copilot ACP agent */
	async spawn(config: AcpAgentConfig): Promise<AcpAgentState> {
		const { name, port, cwd, agent, allowAll, autopilot } = config;

		// Check if already running
		const fleet = this._loadFleet();
		const existing = fleet.agents[name];
		if (existing && existing.status === 'ready') {
			return existing;
		}

		// Check port
		const free = await this._isPortFree(port);
		if (!free) {
			throw new Error(`Port ${port} is already in use`);
		}

		// Build command args
		const args = ['--acp', '--port', String(port)];
		if (agent) { args.push('--agent', agent); }
		if (allowAll) { args.push('--allow-all'); }
		if (autopilot) { args.push('--autopilot'); }

		const agentState: AcpAgentState = {
			name,
			port,
			cwd: cwd || process.cwd(),
			agent,
			status: 'starting',
			startedAt: Date.now(),
		};

		// Spawn process
		const executable = process.env.COPILOT_CLI_PATH || 'copilot';
		const proc = spawn(executable, args, {
			cwd: cwd || process.cwd(),
			stdio: ['pipe', 'pipe', 'pipe'],
			detached: true,
		});

		agentState.pid = proc.pid;
		this.processes.set(name, proc);

		// Save initial state
		fleet.agents[name] = agentState;
		this._saveFleet(fleet);

		// Handle process exit
		proc.on('exit', (code) => {
			this.processes.delete(name);
			this.connections.delete(name);
			this._updateAgent(name, { status: 'stopped', error: code ? `exit code ${code}` : undefined });
		});

		// Collect stderr for debugging
		let stderr = '';
		proc.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

		// Wait for ACP server to start
		const ready = await this._waitForPort(port, 30000);
		if (!ready) {
			proc.kill();
			this._updateAgent(name, { status: 'error', error: `Failed to start ACP server on port ${port}. stderr: ${stderr.slice(0, 500)}` });
			throw new Error(`Agent ${name} failed to start on port ${port}`);
		}

		this._updateAgent(name, { status: 'ready' });
		return this._loadFleet().agents[name];
	}

	/** Connect to an already-running ACP agent via TCP and send a prompt */
	async prompt(name: string, text: string): Promise<string> {
		const fleet = this._loadFleet();
		const agent = fleet.agents[name];
		if (!agent) { throw new Error(`Agent ${name} not found in fleet`); }
		if (agent.status !== 'ready') { throw new Error(`Agent ${name} is ${agent.status}, not ready`); }

		this._updateAgent(name, { status: 'busy', lastPromptAt: Date.now() });

		try {
			// Dynamic import ACP SDK (ESM)
			const acp = await import('@agentclientprotocol/sdk');

			// Connect via TCP
			const socket = net.createConnection({ port: agent.port, host: '127.0.0.1' });
			await new Promise<void>((resolve, reject) => {
				socket.once('connect', resolve);
				socket.once('error', reject);
			});

			// Create web-compatible streams from Node socket
			const { Readable, Writable } = await import('node:stream');
			const output = Writable.toWeb(socket as any) as WritableStream<Uint8Array>;
			const input = Readable.toWeb(socket as any) as ReadableStream<Uint8Array>;
			const stream = acp.ndJsonStream(output, input);

			// Collect response
			let responseText = '';
			const client: any = {
				async requestPermission() {
					return { outcome: { outcome: 'approved' } };
				},
				async sessionUpdate(params: any) {
					const update = params.update;
					if (update.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text') {
						responseText += update.content.text;
					}
				},
			};

			const connection = new acp.ClientSideConnection((_agent: any) => client, stream);

			await connection.initialize({
				protocolVersion: acp.PROTOCOL_VERSION,
				clientCapabilities: {},
			});

			const session = await connection.newSession({
				cwd: agent.cwd,
				mcpServers: [],
			});

			await connection.prompt({
				sessionId: session.sessionId,
				prompt: [{ type: 'text', text }],
			});

			// Cleanup
			socket.destroy();
			this._updateAgent(name, { status: 'ready', sessionId: session.sessionId });

			return responseText;
		} catch (err: any) {
			this._updateAgent(name, { status: 'ready', error: err.message });
			throw err;
		}
	}

	/** Stop a running ACP agent */
	async stop(name: string): Promise<void> {
		const proc = this.processes.get(name);
		if (proc) {
			proc.kill('SIGTERM');
			this.processes.delete(name);
		}
		this.connections.delete(name);
		this._updateAgent(name, { status: 'stopped' });
	}

	/** List all fleet agents and their status */
	list(): AcpAgentState[] {
		const fleet = this._loadFleet();
		return Object.values(fleet.agents).sort((a, b) => b.startedAt - a.startedAt);
	}

	/** Get a specific agent */
	get(name: string): AcpAgentState | undefined {
		return this._loadFleet().agents[name];
	}

	/** Remove a stopped agent from the fleet */
	remove(name: string): void {
		const fleet = this._loadFleet();
		const agent = fleet.agents[name];
		if (agent && agent.status !== 'stopped') {
			this.stop(name);
		}
		delete fleet.agents[name];
		this._saveFleet(fleet);
	}

	/** Stop all agents */
	async stopAll(): Promise<void> {
		for (const name of this.processes.keys()) {
			await this.stop(name);
		}
	}
}
