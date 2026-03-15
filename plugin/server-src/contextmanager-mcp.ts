import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { McpServer, StdioServerTransport } from '@modelcontextprotocol/server';
import * as z from 'zod';

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
	const key = Buffer.from(cwd).toString('base64url').slice(0, 48) || 'default';
	return path.join(sessionRoot, `${key}.json`);
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

async function main(): Promise<void> {
	const transport = new StdioServerTransport();
	await server.connect(transport);
}

main().catch(error => {
	console.error('[ContextManager MCP] fatal error:', error);
	process.exit(1);
});