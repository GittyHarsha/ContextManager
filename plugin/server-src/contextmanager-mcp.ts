import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

type SessionOrigin = 'vscode-extension' | 'copilot-cli-plugin' | 'claude-code-plugin' | 'unknown';

type ProjectRecord = {
	id: string;
	name: string;
	description?: string;
	rootPaths?: string[];
	knowledgeCards?: Array<{
		id: string;
		title: string;
		content: string;
		category?: string;
		tags?: string[];
		updated?: number;
		created?: number;
		source?: string;
	}>;
	conventions?: Array<{
		id: string;
		title: string;
		content: string;
		category?: string;
		confidence?: string;
	}>;
	toolHints?: Array<{
		id: string;
		toolName: string;
		pattern: string;
		example?: string;
		antiPattern?: string;
	}>;
	workingNotes?: Array<{
		id: string;
		subject: string;
		insight: string;
		relatedFiles?: string[];
		relatedSymbols?: string[];
	}>;
};

type SessionRecord = {
	sessionId: string;
	origin?: SessionOrigin;
	status?: string;
	label?: string;
	firstPromptSnippet?: string;
	lastActivityAt?: number;
	pendingCaptureCount?: number;
	bindingSegments?: Array<{
		projectId: string;
		endSequence?: number;
	}>;
};

function resolveConfigBaseDir(): string {
	if (process.platform === 'win32') {
		return process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
	}
	if (process.platform === 'darwin') {
		return path.join(os.homedir(), 'Library', 'Application Support');
	}
	return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
}

function getGlobalStorageRoots(): string[] {
	const base = resolveConfigBaseDir();
	if (process.platform === 'win32' || process.platform === 'darwin') {
		return [
			path.join(base, 'Code', 'User', 'globalStorage'),
			path.join(base, 'Code - Insiders', 'User', 'globalStorage'),
		];
	}
	return [
		path.join(base, 'Code', 'User', 'globalStorage'),
		path.join(base, 'Code - Insiders', 'User', 'globalStorage'),
	];
}

function resolveStorageDir(): string {
	const explicit = process.env.CONTEXTMANAGER_STORAGE_DIR;
	if (explicit) {
		const explicitPath = path.resolve(explicit);
		if (fs.existsSync(path.join(explicitPath, 'projects.json'))) {
			return explicitPath;
		}
	}

	const candidates: Array<{ dir: string; mtime: number }> = [];
	for (const root of getGlobalStorageRoots()) {
		if (!fs.existsSync(root)) { continue; }
		for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
			if (!entry.isDirectory() || !entry.name.endsWith('.context-manager')) { continue; }
			const dir = path.join(root, entry.name);
			const projectsPath = path.join(dir, 'projects.json');
			if (!fs.existsSync(projectsPath)) { continue; }
			const stat = fs.statSync(projectsPath);
			candidates.push({ dir, mtime: stat.mtimeMs });
		}
	}

	if (candidates.length === 0) {
		throw new Error('Could not locate ContextManager storage. Set CONTEXTMANAGER_STORAGE_DIR to the extension globalStorage directory.');
	}

	candidates.sort((left, right) => right.mtime - left.mtime);
	return candidates[0].dir;
}

function readJsonFile<T>(filePath: string, fallback: T): T {
	try {
		if (!fs.existsSync(filePath)) {
			return fallback;
		}
		return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
	} catch {
		return fallback;
	}
}

function loadProjects(storageDir: string): ProjectRecord[] {
	const projects = readJsonFile<ProjectRecord[]>(path.join(storageDir, 'projects.json'), []);
	return Array.isArray(projects) ? projects : [];
}

function saveProjects(storageDir: string, projects: ProjectRecord[]): void {
	fs.writeFileSync(path.join(storageDir, 'projects.json'), JSON.stringify(projects, null, 2), 'utf8');
}

function loadSessions(storageDir: string): SessionRecord[] {
	const state = readJsonFile<{ trackedSessions?: SessionRecord[] }>(path.join(storageDir, 'session-routing.json'), {});
	return Array.isArray(state.trackedSessions) ? state.trackedSessions : [];
}

function resolveProject(projects: ProjectRecord[], selector?: string): ProjectRecord | undefined {
	if (!selector?.trim()) {
		return undefined;
	}
	const normalized = selector.trim().toLowerCase();
	return projects.find(project =>
		project.id === selector
		|| project.name.toLowerCase() === normalized
		|| (project.rootPaths || []).some(rootPath => rootPath.toLowerCase() === normalized)
	);
}

function getQueuePaths() {
	const cmDir = path.join(os.homedir(), '.contextmanager');
	return {
		cmDir,
		queueFile: path.join(cmDir, 'hook-queue.jsonl'),
		sessionRoot: path.join(cmDir, 'plugin-sessions'),
	};
}

function ensureQueueDirs(): void {
	const { cmDir, queueFile, sessionRoot } = getQueuePaths();
	fs.mkdirSync(cmDir, { recursive: true });
	fs.mkdirSync(sessionRoot, { recursive: true });
	if (!fs.existsSync(queueFile)) {
		fs.writeFileSync(queueFile, '', 'utf8');
	}
}

function getSessionFile(cwd: string): string {
	const { sessionRoot } = getQueuePaths();
	// Match the capture script's SHA256-based key (PowerShell: SHA256(cwd).Substring(0, 24))
	const crypto = require('node:crypto') as typeof import('node:crypto');
	const hash = crypto.createHash('sha256').update(cwd).digest('hex').slice(0, 24);
	return path.join(sessionRoot, `${hash}.json`);
}

function newSessionId(): string {
	return `cm-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function getOrCreateSessionId(cwd: string): string {
	ensureQueueDirs();
	const sessionFile = getSessionFile(cwd);
	if (fs.existsSync(sessionFile)) {
		try {
			const state = JSON.parse(fs.readFileSync(sessionFile, 'utf8')) as { sessionId?: string };
			if (state.sessionId) {
				return state.sessionId;
			}
		} catch {}
	}
	const sessionId = newSessionId();
	fs.writeFileSync(sessionFile, JSON.stringify({ sessionId, cwd, updatedAt: Date.now() }), 'utf8');
	return sessionId;
}

function appendWriteIntent(intent: Record<string, unknown>, cwd: string, projectIdHint?: string): { sessionId: string; queueFile: string } {
	ensureQueueDirs();
	const { queueFile } = getQueuePaths();
	const sessionId = getOrCreateSessionId(cwd);
	const entry = {
		hookType: 'WriteIntent',
		sessionId,
		timestamp: Date.now(),
		cwd,
		rootHint: cwd,
		origin: 'copilot-cli-plugin',
		participant: 'copilot-cli',
		projectIdHint: projectIdHint || '',
		writeIntent: intent,
	};
	fs.appendFileSync(queueFile, `${JSON.stringify(entry)}\n`, 'utf8');
	return { sessionId, queueFile };
}

function scoreMatch(haystack: string, query: string): number {
	const normalizedHaystack = haystack.toLowerCase();
	const normalizedQuery = query.toLowerCase();
	if (!normalizedQuery) { return 0; }
	if (normalizedHaystack === normalizedQuery) { return 100; }
	if (normalizedHaystack.includes(normalizedQuery)) { return 50 + normalizedQuery.length; }
	return 0;
}

function textResult(text: string, structuredContent?: Record<string, unknown>) {
	return structuredContent
		? { content: [{ type: 'text' as const, text }], structuredContent }
		: { content: [{ type: 'text' as const, text }] };
}

const server = new McpServer({
	name: 'contextmanager',
	version: '1.0.0',
});

server.registerTool(
	'contextmanager_list_projects',
	{
		description: 'List ContextManager projects from the extension storage.',
		inputSchema: z.object({}),
	},
	async () => {
		const storageDir = resolveStorageDir();
		const projects = loadProjects(storageDir);
		return textResult(
			projects.length
				? projects.map(project => `- ${project.name} (${project.id})${project.rootPaths?.[0] ? ` — ${project.rootPaths[0]}` : ''}`).join('\n')
				: 'No ContextManager projects found.',
			{ storageDir, count: projects.length, projects: projects.map(project => ({ id: project.id, name: project.name, rootPaths: project.rootPaths || [] })) },
		);
	},
);

server.registerTool(
	'contextmanager_create_project',
	{
		description: 'Create a new ContextManager project. Projects scope knowledge cards, conventions, and agent sessions.',
		inputSchema: z.object({
			name: z.string().min(1).describe('Project name'),
			description: z.string().optional().describe('Short project description'),
			rootPaths: z.array(z.string()).optional().describe('Root filesystem paths for this project'),
		}),
	},
	async ({ name, description, rootPaths }) => {
		const storageDir = resolveStorageDir();
		const projects = loadProjects(storageDir);
		if (projects.some(p => p.name.toLowerCase() === name.toLowerCase())) {
			return textResult(`Project "${name}" already exists.`);
		}
		const id = `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
		const project: ProjectRecord = {
			id, name,
			description: description || '',
			rootPaths: rootPaths || [process.cwd()],
			knowledgeCards: [],
			conventions: [],
			toolHints: [],
			workingNotes: [],
		};
		projects.push(project);
		saveProjects(storageDir, projects);
		return textResult(`Created project "${name}" (id: ${id})`, { project: { id, name, rootPaths: project.rootPaths } });
	},
);

server.registerTool(
	'contextmanager_rename_project',
	{
		description: 'Rename an existing ContextManager project.',
		inputSchema: z.object({
			project: z.string().min(1).describe('Current project name or ID'),
			newName: z.string().min(1).describe('New project name'),
		}),
	},
	async ({ project: selector, newName }) => {
		const storageDir = resolveStorageDir();
		const projects = loadProjects(storageDir);
		const target = resolveProject(projects, selector);
		if (!target) { return textResult(`Project "${selector}" not found.`); }
		if (projects.some(p => p.id !== target.id && p.name.toLowerCase() === newName.toLowerCase())) {
			return textResult(`A project named "${newName}" already exists.`);
		}
		const oldName = target.name;
		target.name = newName;
		saveProjects(storageDir, projects);
		return textResult(`Renamed "${oldName}" → "${newName}" (id: ${target.id})`);
	},
);

server.registerTool(
	'contextmanager_update_project',
	{
		description: 'Update a project\'s description, root paths, or context (goals, conventions text, key files).',
		inputSchema: z.object({
			project: z.string().min(1).describe('Project name or ID'),
			description: z.string().optional().describe('New project description'),
			rootPaths: z.array(z.string()).optional().describe('Updated root filesystem paths'),
			goals: z.string().optional().describe('Project goals text'),
			conventions: z.string().optional().describe('Project conventions text (free-form, separate from auto-learned conventions)'),
			keyFiles: z.array(z.string()).optional().describe('Key files list'),
		}),
	},
	async ({ project: selector, description, rootPaths, goals, conventions, keyFiles }) => {
		const storageDir = resolveStorageDir();
		const projects = loadProjects(storageDir);
		const target = resolveProject(projects, selector);
		if (!target) { return textResult(`Project "${selector}" not found.`); }
		const changes: string[] = [];
		if (description !== undefined) { target.description = description; changes.push('description'); }
		if (rootPaths !== undefined) { target.rootPaths = rootPaths; changes.push('rootPaths'); }
		// Context fields are stored under target.context (may not exist yet)
		const ctx = (target as any).context || {};
		if (goals !== undefined) { ctx.goals = goals; changes.push('goals'); }
		if (conventions !== undefined) { ctx.conventions = conventions; changes.push('conventions'); }
		if (keyFiles !== undefined) { ctx.keyFiles = keyFiles; changes.push('keyFiles'); }
		if (changes.length > 0) { (target as any).context = ctx; }
		saveProjects(storageDir, projects);
		return textResult(changes.length > 0
			? `Updated project "${target.name}": ${changes.join(', ')}`
			: `No changes made to "${target.name}".`);
	},
);

server.registerTool(
	'contextmanager_search_knowledge',
	{
		description: 'Search knowledge cards, conventions, tool hints, and working notes across ContextManager projects.',
		inputSchema: z.object({
			query: z.string().min(1),
			project: z.string().optional(),
			limit: z.number().int().min(1).max(50).default(10),
		}),
	},
	async ({ query, project, limit }) => {
		const storageDir = resolveStorageDir();
		const projects = loadProjects(storageDir);
		const scopedProjects = project ? [resolveProject(projects, project)].filter((item): item is ProjectRecord => !!item) : projects;
		const results = scopedProjects.flatMap(projectRecord => {
			const cards = (projectRecord.knowledgeCards || []).map(card => ({
				kind: 'card',
				projectId: projectRecord.id,
				projectName: projectRecord.name,
				id: card.id,
				title: card.title,
				detail: card.content,
				score: scoreMatch(`${card.title}\n${card.content}\n${(card.tags || []).join(' ')}`, query),
			}));
			const conventions = (projectRecord.conventions || []).map(convention => ({
				kind: 'convention',
				projectId: projectRecord.id,
				projectName: projectRecord.name,
				id: convention.id,
				title: convention.title,
				detail: convention.content,
				score: scoreMatch(`${convention.title}\n${convention.content}\n${convention.category || ''}`, query),
			}));
			const toolHints = (projectRecord.toolHints || []).map(toolHint => ({
				kind: 'tool-hint',
				projectId: projectRecord.id,
				projectName: projectRecord.name,
				id: toolHint.id,
				title: `${toolHint.toolName}: ${toolHint.pattern}`,
				detail: toolHint.example || toolHint.antiPattern || '',
				score: scoreMatch(`${toolHint.toolName}\n${toolHint.pattern}\n${toolHint.example || ''}\n${toolHint.antiPattern || ''}`, query),
			}));
			const notes = (projectRecord.workingNotes || []).map(note => ({
				kind: 'working-note',
				projectId: projectRecord.id,
				projectName: projectRecord.name,
				id: note.id,
				title: note.subject,
				detail: note.insight,
				score: scoreMatch(`${note.subject}\n${note.insight}\n${(note.relatedFiles || []).join(' ')}`, query),
			}));
			return [...cards, ...conventions, ...toolHints, ...notes];
		}).filter(result => result.score > 0)
			.sort((left, right) => right.score - left.score)
			.slice(0, limit);

		return textResult(
			results.length
				? results.map(result => `- [${result.kind}] ${result.title} — ${result.projectName}`).join('\n')
				: `No knowledge matches found for "${query}".`,
			{ storageDir, query, results },
		);
	},
);

server.registerTool(
	'contextmanager_get_knowledge_card',
	{
		description: 'Read a specific knowledge card by id or exact title.',
		inputSchema: z.object({
			project: z.string().optional(),
			id: z.string().optional(),
			title: z.string().optional(),
		}).refine(value => !!value.id || !!value.title, 'Provide id or title.'),
	},
	async ({ project, id, title }) => {
		const storageDir = resolveStorageDir();
		const projects = loadProjects(storageDir);
		const scopedProjects = project ? [resolveProject(projects, project)].filter((item): item is ProjectRecord => !!item) : projects;
		const normalizedTitle = title?.trim().toLowerCase();
		for (const projectRecord of scopedProjects) {
			const card = (projectRecord.knowledgeCards || []).find(item => item.id === id || item.title.toLowerCase() === normalizedTitle);
			if (!card) { continue; }
			return textResult(
				`# ${card.title}\n\nProject: ${projectRecord.name}\nCategory: ${card.category || 'other'}\n\n${card.content}`,
				{ projectId: projectRecord.id, projectName: projectRecord.name, card },
			);
		}
		return { content: [{ type: 'text' as const, text: 'Knowledge card not found.' }], isError: true };
	},
);

server.registerTool(
	'contextmanager_list_sessions',
	{
		description: 'List tracked ContextManager sessions and their current binding status.',
		inputSchema: z.object({
			project: z.string().optional(),
			status: z.string().optional(),
			limit: z.number().int().min(1).max(100).default(25),
		}),
	},
	async ({ project, status, limit }) => {
		const storageDir = resolveStorageDir();
		const projects = loadProjects(storageDir);
		const sessions = loadSessions(storageDir);
		const projectRecord = project ? resolveProject(projects, project) : undefined;
		const filtered = sessions
			.filter(session => !status || session.status === status)
			.filter(session => {
				if (!projectRecord) { return true; }
				return (session.bindingSegments || []).some(segment => segment.projectId === projectRecord.id && segment.endSequence === undefined);
			})
			.sort((left, right) => (right.lastActivityAt || 0) - (left.lastActivityAt || 0))
			.slice(0, limit);

		return textResult(
			filtered.length
				? filtered.map(session => `- ${session.label || session.sessionId} [${session.origin || 'unknown'}] — ${session.status || 'pending'}${typeof session.pendingCaptureCount === 'number' ? ` (${session.pendingCaptureCount} pending)` : ''}`).join('\n')
				: 'No tracked sessions found.',
			{ storageDir, count: filtered.length, sessions: filtered },
		);
	},
);

server.registerTool(
	'contextmanager_save_card_intent',
	{
		description: 'Queue a save-card write intent for ContextManager.',
		inputSchema: z.object({
			title: z.string().min(1),
			content: z.string().min(1),
			category: z.string().optional(),
			tags: z.array(z.string()).optional(),
			projectIdHint: z.string().optional(),
			cwd: z.string().optional(),
			folderName: z.string().optional(),
			parentFolderName: z.string().optional(),
			source: z.string().optional(),
		}),
	},
	async ({ cwd, projectIdHint, ...intent }) => {
		const result = appendWriteIntent({ action: 'save-card', ...intent }, cwd || process.cwd(), projectIdHint);
		return textResult(`Queued save-card intent for "${intent.title}".`, result);
	},
);

server.registerTool(
	'contextmanager_learn_convention_intent',
	{
		description: 'Queue a learn-convention write intent for ContextManager.',
		inputSchema: z.object({
			category: z.string().min(1),
			title: z.string().min(1),
			content: z.string().min(1),
			confidence: z.string().optional(),
			learnedFrom: z.string().optional(),
			projectIdHint: z.string().optional(),
			cwd: z.string().optional(),
		}),
	},
	async ({ cwd, projectIdHint, ...intent }) => {
		const result = appendWriteIntent({ action: 'learn-convention', ...intent }, cwd || process.cwd(), projectIdHint);
		return textResult(`Queued learn-convention intent for "${intent.title}".`, result);
	},
);

server.registerTool(
	'contextmanager_learn_tool_hint_intent',
	{
		description: 'Queue a learn-tool-hint write intent for ContextManager.',
		inputSchema: z.object({
			toolName: z.string().min(1),
			pattern: z.string().min(1),
			example: z.string().min(1),
			antiPattern: z.string().optional(),
			projectIdHint: z.string().optional(),
			cwd: z.string().optional(),
		}),
	},
	async ({ cwd, projectIdHint, ...intent }) => {
		const result = appendWriteIntent({ action: 'learn-tool-hint', ...intent }, cwd || process.cwd(), projectIdHint);
		return textResult(`Queued learn-tool-hint intent for ${intent.toolName}.`, result);
	},
);

server.registerTool(
	'contextmanager_learn_working_note_intent',
	{
		description: 'Queue a learn-working-note write intent for ContextManager.',
		inputSchema: z.object({
			subject: z.string().min(1),
			insight: z.string().min(1),
			relatedFiles: z.array(z.string()).optional(),
			relatedSymbols: z.array(z.string()).optional(),
			discoveredWhile: z.string().optional(),
			projectIdHint: z.string().optional(),
			cwd: z.string().optional(),
		}),
	},
	async ({ cwd, projectIdHint, ...intent }) => {
		const result = appendWriteIntent({ action: 'learn-working-note', ...intent }, cwd || process.cwd(), projectIdHint);
		return textResult(`Queued learn-working-note intent for "${intent.subject}".`, result);
	},
);

server.registerTool(
	'contextmanager_storage_info',
	{
		description: 'Report which ContextManager storage directory and queue files are being used.',
		inputSchema: z.object({}),
	},
	async () => {
		const storageDir = resolveStorageDir();
		const queuePaths = getQueuePaths();
		return textResult(
			`Storage: ${storageDir}\nQueue: ${queuePaths.queueFile}\nSessions: ${queuePaths.sessionRoot}`,
			{ storageDir, ...queuePaths },
		);
	},
);

// ── Orchestrator Primitives ─────────────────────────────────────────

const REGISTRY_FILE = path.join(os.homedir(), '.contextmanager', 'agent-registry.json');
const BUS_FILE = path.join(os.homedir(), '.contextmanager', 'agent-bus.jsonl');
const BUS_CURSORS_FILE = path.join(os.homedir(), '.contextmanager', 'bus-cursors.json');

function readRegistry(): Record<string, unknown>[] {
	try {
		const data = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
		return Object.values(data.agents || {});
	} catch { return []; }
}

function updateRegistryMeta(sessionId: string, meta: Record<string, unknown>): void {
	const { cmDir } = getQueuePaths();
	fs.mkdirSync(cmDir, { recursive: true });
	let data: { agents: Record<string, Record<string, unknown>>; updatedAt: number };
	try { data = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8')); } catch { data = { agents: {}, updatedAt: Date.now() }; }
	const agent = data.agents[sessionId];
	if (agent) {
		agent.meta = { ...(agent.meta as Record<string, unknown> || {}), ...meta };
		agent.lastSeenAt = Date.now();
	} else {
		// Auto-register if not found
		const cwd = process.cwd();
		data.agents[sessionId] = {
			sessionId, origin: 'copilot-cli-plugin', cwd,
			registeredAt: Date.now(), lastSeenAt: Date.now(), meta,
		};
	}
	data.updatedAt = Date.now();
	const tmp = REGISTRY_FILE + '.tmp';
	fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
	fs.renameSync(tmp, REGISTRY_FILE);
}

function generateBusId(): string {
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function readBusCursors(): Record<string, { offset: number }> {
	try { return JSON.parse(fs.readFileSync(BUS_CURSORS_FILE, 'utf8')); } catch { return {}; }
}

function saveBusCursors(cursors: Record<string, { offset: number }>): void {
	fs.writeFileSync(BUS_CURSORS_FILE, JSON.stringify(cursors, null, 2), 'utf8');
}

// ── Orchestrator MCP Tools ──────────────────────────────────────────

server.registerTool(
	'orchestrator_list_agents',
	{
		description: 'List all active agent sessions in the orchestrator registry. Optionally filter by project.',
		inputSchema: z.object({
			project: z.string().optional().describe('Filter agents by project name'),
		}),
	},
	async ({ project }) => {
		let agents = readRegistry() as Array<Record<string, unknown>>;
		if (project) {
			agents = agents.filter(a => a.project === project);
		}
		if (agents.length === 0) {
			return textResult('No active agents found.', { agents: [] });
		}
		const summary = agents.map(a => {
			const meta = Object.keys(a.meta as Record<string, unknown> || {}).length > 0
				? ` | meta: ${JSON.stringify(a.meta)}` : '';
			const age = Math.round((Date.now() - (a.lastSeenAt as number)) / 1000);
			return `- [${a.origin}] ${a.label || 'unnamed'} | project: ${a.project || 'unbound'} | cwd: ${a.cwd} | last seen: ${age}s ago${meta}`;
		}).join('\n');
		return textResult(`Active agents (${agents.length}):\n${summary}`, { agents });
	},
);

server.registerTool(
	'orchestrator_get_agent',
	{
		description: 'Get full details for a specific agent session by its session ID.',
		inputSchema: z.object({
			sessionId: z.string().min(1).describe('The session ID of the agent to look up'),
		}),
	},
	async ({ sessionId }) => {
		const agents = readRegistry() as Array<Record<string, unknown>>;
		const agent = agents.find(a => a.sessionId === sessionId);
		if (!agent) { return textResult(`Agent ${sessionId} not found.`); }
		return textResult(JSON.stringify(agent, null, 2), { agent });
	},
);

server.registerTool(
	'orchestrator_set_agent_meta',
	{
		description: 'Set arbitrary metadata on your agent entry (status, task, phase, or any custom data). Creates entry if missing.',
		inputSchema: z.object({
			meta: z.record(z.string(), z.unknown()).describe('Key-value metadata to merge into your agent entry'),
		}),
	},
	async ({ meta }) => {
		const cwd = process.cwd();
		const sessionId = getOrCreateSessionId(cwd);
		updateRegistryMeta(sessionId, meta);
		return textResult(`Updated meta for agent ${sessionId}: ${JSON.stringify(meta)}`);
	},
);

server.registerTool(
	'orchestrator_post_message',
	{
		description: 'Post a message to the agent bus. Other agents will see it on their next read. Payload can be any JSON.',
		inputSchema: z.object({
			to: z.string().optional().describe('Recipient session ID (omit for broadcast)'),
			project: z.string().optional().describe('Scope message to a project (omit for global)'),
			payload: z.unknown().describe('Message content — any JSON'),
		}),
	},
	async ({ to, project, payload }) => {
		const { cmDir } = getQueuePaths();
		fs.mkdirSync(cmDir, { recursive: true });
		const cwd = process.cwd();
		const sessionId = getOrCreateSessionId(cwd);
		const msg = { id: generateBusId(), from: sessionId, to, project, timestamp: Date.now(), ttl: 86400, payload };
		fs.appendFileSync(BUS_FILE, JSON.stringify(msg) + '\n', 'utf8');
		return textResult(`Message posted (id: ${msg.id}, from: ${sessionId}${to ? `, to: ${to}` : ''})`);
	},
);

server.registerTool(
	'orchestrator_read_messages',
	{
		description: 'Read unread messages for this agent from the bus. Advances your read cursor.',
		inputSchema: z.object({
			project: z.string().optional().describe('Filter messages by project'),
			limit: z.number().int().min(1).max(50).default(10).describe('Max messages to return'),
		}),
	},
	async ({ project, limit }) => {
		const cwd = process.cwd();
		const sessionId = getOrCreateSessionId(cwd);
		const cursors = readBusCursors();
		const offset = cursors[sessionId]?.offset ?? 0;
		const now = Date.now();

		let content: string;
		try {
			const fd = fs.openSync(BUS_FILE, 'r');
			const stat = fs.fstatSync(fd);
			const readSize = stat.size - offset;
			if (readSize <= 0) { fs.closeSync(fd); return textResult('No new messages.', { messages: [] }); }
			const buf = Buffer.alloc(readSize);
			fs.readSync(fd, buf, 0, readSize, offset);
			fs.closeSync(fd);
			content = buf.toString('utf8');
			// Advance cursor
			cursors[sessionId] = { offset: stat.size };
			saveBusCursors(cursors);
		} catch { return textResult('No messages (bus file not found).', { messages: [] }); }

		const messages: unknown[] = [];
		for (const line of content.split('\n')) {
			if (!line.trim()) { continue; }
			try {
				const msg = JSON.parse(line);
				if (msg.ttl && (now - msg.timestamp) > msg.ttl * 1000) { continue; }
				if (msg.to && msg.to !== sessionId) { continue; }
				if (project && msg.project && msg.project !== project) { continue; }
				messages.push(msg);
			} catch { /* skip */ }
		}

		const result = messages.slice(-limit);
		if (result.length === 0) { return textResult('No new messages.', { messages: [] }); }
		const summary = result.map((m: any) => `- [${m.from}${m.to ? ` → ${m.to}` : ''}]: ${JSON.stringify(m.payload)}`).join('\n');
		return textResult(`${result.length} message(s):\n${summary}`, { messages: result });
	},
);

server.registerTool(
	'orchestrator_peek_messages',
	{
		description: 'Peek at messages without advancing your read cursor. Good for monitoring.',
		inputSchema: z.object({
			project: z.string().optional().describe('Filter messages by project'),
			limit: z.number().int().min(1).max(50).default(10).describe('Max messages to return'),
		}),
	},
	async ({ project, limit }) => {
		const now = Date.now();
		let lines: string[];
		try { lines = fs.readFileSync(BUS_FILE, 'utf8').split('\n').filter(l => l.trim()); } catch { return textResult('No messages.', { messages: [] }); }

		const messages: unknown[] = [];
		for (const line of lines) {
			try {
				const msg = JSON.parse(line);
				if (msg.ttl && (now - msg.timestamp) > msg.ttl * 1000) { continue; }
				if (project && msg.project && msg.project !== project) { continue; }
				messages.push(msg);
			} catch { /* skip */ }
		}

		const result = messages.slice(-limit);
		if (result.length === 0) { return textResult('No messages.', { messages: [] }); }
		const summary = result.map((m: any) => `- [${m.from}${m.to ? ` → ${m.to}` : ''}]: ${JSON.stringify(m.payload)}`).join('\n');
		return textResult(`${result.length} message(s):\n${summary}`, { messages: result });
	},
);

async function main(): Promise<void> {
	const transport = new StdioServerTransport();
	await server.connect(transport);
}

main().catch(error => {
	console.error('[ContextManager MCP] fatal error:', error);
	process.exit(1);
});