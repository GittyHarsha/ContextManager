'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const SERVER_INFO = {
	name: 'contextmanager',
	version: '1.0.0',
};

const SUPPORTED_PROTOCOL_VERSION = '2024-11-05';
const LOG_FILE = path.join(os.homedir(), '.contextmanager', 'mcp-server.log');

function appendLog(message, details) {
	try {
		fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
		const suffix = details === undefined ? '' : ' ' + JSON.stringify(details);
		fs.appendFileSync(LOG_FILE, '[' + new Date().toISOString() + '] ' + message + suffix + '\n', 'utf8');
	} catch {}
}

function resolveConfigBaseDir() {
	if (process.platform === 'win32') {
		return process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
	}
	if (process.platform === 'darwin') {
		return path.join(os.homedir(), 'Library', 'Application Support');
	}
	return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
}

function getGlobalStorageRoots() {
	const base = resolveConfigBaseDir();
	return [
		path.join(base, 'Code', 'User', 'globalStorage'),
		path.join(base, 'Code - Insiders', 'User', 'globalStorage'),
	];
}

function resolveStorageDir() {
	const explicit = process.env.CONTEXTMANAGER_STORAGE_DIR;
	if (explicit) {
		const explicitPath = path.resolve(explicit);
		if (fs.existsSync(path.join(explicitPath, 'projects.json'))) {
			return explicitPath;
		}
	}

	const candidates = [];
	for (const root of getGlobalStorageRoots()) {
		if (!fs.existsSync(root)) {
			continue;
		}
		for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
			if (!entry.isDirectory() || !entry.name.endsWith('.context-manager')) {
				continue;
			}
			const dir = path.join(root, entry.name);
			const projectsPath = path.join(dir, 'projects.json');
			if (!fs.existsSync(projectsPath)) {
				continue;
			}
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

function readJsonFile(filePath, fallback) {
	try {
		if (!fs.existsSync(filePath)) {
			return fallback;
		}
		return JSON.parse(fs.readFileSync(filePath, 'utf8'));
	} catch {
		return fallback;
	}
}

function loadProjects(storageDir) {
	const projects = readJsonFile(path.join(storageDir, 'projects.json'), []);
	return Array.isArray(projects) ? projects : [];
}

function loadSessions(storageDir) {
	const state = readJsonFile(path.join(storageDir, 'session-routing.json'), {});
	return Array.isArray(state.trackedSessions) ? state.trackedSessions : [];
}

function resolveProject(projects, selector) {
	if (!selector || !String(selector).trim()) {
		return undefined;
	}
	const normalized = String(selector).trim().toLowerCase();
	return projects.find(project =>
		project.id === selector
			|| String(project.name || '').toLowerCase() === normalized
			|| (Array.isArray(project.rootPaths) && project.rootPaths.some(rootPath => String(rootPath).toLowerCase() === normalized))
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

function ensureQueueDirs() {
	const queuePaths = getQueuePaths();
	fs.mkdirSync(queuePaths.cmDir, { recursive: true });
	fs.mkdirSync(queuePaths.sessionRoot, { recursive: true });
	if (!fs.existsSync(queuePaths.queueFile)) {
		fs.writeFileSync(queuePaths.queueFile, '', 'utf8');
	}
}

function getSessionFile(cwd) {
	const key = crypto.createHash('sha256').update(cwd || 'default').digest('hex').slice(0, 24);
	return path.join(getQueuePaths().sessionRoot, key + '.json');
}

function newSessionId() {
	return 'cm-' + Date.now() + '-' + Math.random().toString(36).slice(2, 12);
}

function getOrCreateSessionId(cwd) {
	ensureQueueDirs();
	const sessionFile = getSessionFile(cwd);
	if (fs.existsSync(sessionFile)) {
		try {
			const state = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
			if (state && typeof state.sessionId === 'string' && state.sessionId) {
				state.updatedAt = Date.now();
				fs.writeFileSync(sessionFile, JSON.stringify(state), 'utf8');
				return state.sessionId;
			}
		} catch {}
	}

	const sessionId = newSessionId();
	fs.writeFileSync(sessionFile, JSON.stringify({ sessionId, cwd, updatedAt: Date.now() }), 'utf8');
	return sessionId;
}

function appendWriteIntent(intent, cwd, projectIdHint) {
	ensureQueueDirs();
	const queuePaths = getQueuePaths();
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
	fs.appendFileSync(queuePaths.queueFile, JSON.stringify(entry) + '\n', 'utf8');
	return { sessionId, queueFile: queuePaths.queueFile };
}

function scoreMatch(haystack, query) {
	const normalizedHaystack = String(haystack || '').toLowerCase();
	const normalizedQuery = String(query || '').toLowerCase();
	if (!normalizedQuery) {
		return 0;
	}
	if (normalizedHaystack === normalizedQuery) {
		return 100;
	}
	if (normalizedHaystack.includes(normalizedQuery)) {
		return 50 + normalizedQuery.length;
	}
	return 0;
}

function okResult(text, structuredContent) {
	const result = {
		content: [{ type: 'text', text }],
	};
	if (structuredContent !== undefined) {
		result.structuredContent = structuredContent;
	}
	return result;
}

function errorResult(message) {
	return {
		content: [{ type: 'text', text: message }],
		isError: true,
	};
}

const toolDefinitions = [
	{
		name: 'contextmanager_list_projects',
		description: 'List ContextManager projects from the extension storage.',
		inputSchema: { type: 'object', properties: {}, additionalProperties: false },
	},
	{
		name: 'contextmanager_search_knowledge',
		description: 'Search knowledge cards, conventions, tool hints, and working notes across ContextManager projects.',
		inputSchema: {
			type: 'object',
			properties: {
				query: { type: 'string', minLength: 1 },
				project: { type: 'string' },
				limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
			},
			required: ['query'],
			additionalProperties: false,
		},
	},
	{
		name: 'contextmanager_get_knowledge_card',
		description: 'Read a specific knowledge card by id or exact title.',
		inputSchema: {
			type: 'object',
			properties: {
				project: { type: 'string' },
				id: { type: 'string' },
				title: { type: 'string' },
			},
			additionalProperties: false,
		},
	},
	{
		name: 'contextmanager_list_sessions',
		description: 'List tracked ContextManager sessions and their current binding status.',
		inputSchema: {
			type: 'object',
			properties: {
				project: { type: 'string' },
				status: { type: 'string' },
				limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
			},
			additionalProperties: false,
		},
	},
	{
		name: 'contextmanager_save_card_intent',
		description: 'Queue a save-card write intent for ContextManager.',
		inputSchema: {
			type: 'object',
			properties: {
				title: { type: 'string', minLength: 1 },
				content: { type: 'string', minLength: 1 },
				category: { type: 'string' },
				tags: { type: 'array', items: { type: 'string' } },
				projectIdHint: { type: 'string' },
				cwd: { type: 'string' },
				folderName: { type: 'string' },
				parentFolderName: { type: 'string' },
				source: { type: 'string' },
			},
			required: ['title', 'content'],
			additionalProperties: false,
		},
	},
	{
		name: 'contextmanager_learn_convention_intent',
		description: 'Queue a learn-convention write intent for ContextManager.',
		inputSchema: {
			type: 'object',
			properties: {
				category: { type: 'string', minLength: 1 },
				title: { type: 'string', minLength: 1 },
				content: { type: 'string', minLength: 1 },
				confidence: { type: 'string' },
				learnedFrom: { type: 'string' },
				projectIdHint: { type: 'string' },
				cwd: { type: 'string' },
			},
			required: ['category', 'title', 'content'],
			additionalProperties: false,
		},
	},
	{
		name: 'contextmanager_learn_tool_hint_intent',
		description: 'Queue a learn-tool-hint write intent for ContextManager.',
		inputSchema: {
			type: 'object',
			properties: {
				toolName: { type: 'string', minLength: 1 },
				pattern: { type: 'string', minLength: 1 },
				example: { type: 'string', minLength: 1 },
				antiPattern: { type: 'string' },
				projectIdHint: { type: 'string' },
				cwd: { type: 'string' },
			},
			required: ['toolName', 'pattern', 'example'],
			additionalProperties: false,
		},
	},
	{
		name: 'contextmanager_learn_working_note_intent',
		description: 'Queue a learn-working-note write intent for ContextManager.',
		inputSchema: {
			type: 'object',
			properties: {
				subject: { type: 'string', minLength: 1 },
				insight: { type: 'string', minLength: 1 },
				relatedFiles: { type: 'array', items: { type: 'string' } },
				relatedSymbols: { type: 'array', items: { type: 'string' } },
				discoveredWhile: { type: 'string' },
				projectIdHint: { type: 'string' },
				cwd: { type: 'string' },
			},
			required: ['subject', 'insight'],
			additionalProperties: false,
		},
	},
	{
		name: 'contextmanager_storage_info',
		description: 'Report which ContextManager storage directory and queue files are being used.',
		inputSchema: { type: 'object', properties: {}, additionalProperties: false },
	},
];

const toolHandlers = {
	contextmanager_list_projects() {
		const storageDir = resolveStorageDir();
		const projects = loadProjects(storageDir);
		return okResult(
			projects.length
				? projects.map(project => '- ' + project.name + ' (' + project.id + ')' + (project.rootPaths && project.rootPaths[0] ? ' — ' + project.rootPaths[0] : '')).join('\n')
				: 'No ContextManager projects found.',
			{ storageDir, count: projects.length, projects: projects.map(project => ({ id: project.id, name: project.name, rootPaths: Array.isArray(project.rootPaths) ? project.rootPaths : [] })) }
		);
	},

	contextmanager_search_knowledge(args) {
		if (!args || typeof args.query !== 'string' || !args.query.trim()) {
			return errorResult('query is required.');
		}
		const storageDir = resolveStorageDir();
		const projects = loadProjects(storageDir);
		const scopedProjects = args.project ? [resolveProject(projects, args.project)].filter(Boolean) : projects;
		const limit = Number.isInteger(args.limit) ? Math.max(1, Math.min(50, args.limit)) : 10;
		const results = [];
		for (const project of scopedProjects) {
			for (const card of Array.isArray(project.knowledgeCards) ? project.knowledgeCards : []) {
				results.push({
					kind: 'card',
					projectId: project.id,
					projectName: project.name,
					id: card.id,
					title: card.title,
					detail: card.content,
					score: scoreMatch([card.title, card.content, Array.isArray(card.tags) ? card.tags.join(' ') : ''].join('\n'), args.query),
				});
			}
			for (const convention of Array.isArray(project.conventions) ? project.conventions : []) {
				results.push({
					kind: 'convention',
					projectId: project.id,
					projectName: project.name,
					id: convention.id,
					title: convention.title,
					detail: convention.content,
					score: scoreMatch([convention.title, convention.content, convention.category || ''].join('\n'), args.query),
				});
			}
			for (const toolHint of Array.isArray(project.toolHints) ? project.toolHints : []) {
				results.push({
					kind: 'tool-hint',
					projectId: project.id,
					projectName: project.name,
					id: toolHint.id,
					title: toolHint.toolName + ': ' + toolHint.pattern,
					detail: toolHint.example || toolHint.antiPattern || '',
					score: scoreMatch([toolHint.toolName, toolHint.pattern, toolHint.example || '', toolHint.antiPattern || ''].join('\n'), args.query),
				});
			}
			for (const note of Array.isArray(project.workingNotes) ? project.workingNotes : []) {
				results.push({
					kind: 'working-note',
					projectId: project.id,
					projectName: project.name,
					id: note.id,
					title: note.subject,
					detail: note.insight,
					score: scoreMatch([note.subject, note.insight, Array.isArray(note.relatedFiles) ? note.relatedFiles.join(' ') : ''].join('\n'), args.query),
				});
			}
		}

		const filtered = results.filter(result => result.score > 0).sort((left, right) => right.score - left.score).slice(0, limit);
		return okResult(
			filtered.length ? filtered.map(result => '- [' + result.kind + '] ' + result.title + ' — ' + result.projectName).join('\n') : 'No knowledge matches found for "' + args.query + '".',
			{ storageDir, query: args.query, results: filtered }
		);
	},

	contextmanager_get_knowledge_card(args) {
		if (!args || (!args.id && !args.title)) {
			return errorResult('Provide id or title.');
		}
		const storageDir = resolveStorageDir();
		const projects = loadProjects(storageDir);
		const scopedProjects = args.project ? [resolveProject(projects, args.project)].filter(Boolean) : projects;
		const normalizedTitle = args.title ? String(args.title).trim().toLowerCase() : undefined;
		for (const project of scopedProjects) {
			for (const card of Array.isArray(project.knowledgeCards) ? project.knowledgeCards : []) {
				if (card.id === args.id || (normalizedTitle && String(card.title).toLowerCase() === normalizedTitle)) {
					return okResult('# ' + card.title + '\n\nProject: ' + project.name + '\nCategory: ' + (card.category || 'other') + '\n\n' + card.content, {
						projectId: project.id,
						projectName: project.name,
						card,
					});
				}
			}
		}
		return errorResult('Knowledge card not found.');
	},

	contextmanager_list_sessions(args) {
		const storageDir = resolveStorageDir();
		const projects = loadProjects(storageDir);
		const sessions = loadSessions(storageDir);
		const project = args && args.project ? resolveProject(projects, args.project) : undefined;
		const limit = args && Number.isInteger(args.limit) ? Math.max(1, Math.min(100, args.limit)) : 25;
		const filtered = sessions
			.filter(session => !args || !args.status || session.status === args.status)
			.filter(session => {
				if (!project) {
					return true;
				}
				return Array.isArray(session.bindingSegments) && session.bindingSegments.some(segment => segment && segment.projectId === project.id && segment.endSequence === undefined);
			})
			.sort((left, right) => (Number(right.lastActivityAt) || 0) - (Number(left.lastActivityAt) || 0))
			.slice(0, limit);

		return okResult(
			filtered.length
				? filtered.map(session => '- ' + (session.label || session.sessionId) + ' [' + (session.origin || 'unknown') + '] — ' + (session.status || 'pending') + (typeof session.pendingCaptureCount === 'number' ? ' (' + session.pendingCaptureCount + ' pending)' : '')).join('\n')
				: 'No tracked sessions found.',
			{ storageDir, count: filtered.length, sessions: filtered }
		);
	},

	contextmanager_save_card_intent(args) {
		if (!args || typeof args.title !== 'string' || !args.title.trim() || typeof args.content !== 'string' || !args.content.trim()) {
			return errorResult('title and content are required.');
		}
		const result = appendWriteIntent({
			action: 'save-card',
			title: args.title,
			content: args.content,
			category: args.category,
			tags: Array.isArray(args.tags) ? args.tags : undefined,
			folderName: args.folderName,
			parentFolderName: args.parentFolderName,
			source: args.source,
		}, args.cwd || process.cwd(), args.projectIdHint);
		return okResult('Queued save-card intent for "' + args.title + '".', result);
	},

	contextmanager_learn_convention_intent(args) {
		if (!args || typeof args.category !== 'string' || typeof args.title !== 'string' || typeof args.content !== 'string' || !args.category.trim() || !args.title.trim() || !args.content.trim()) {
			return errorResult('category, title, and content are required.');
		}
		const result = appendWriteIntent({
			action: 'learn-convention',
			category: args.category,
			title: args.title,
			content: args.content,
			confidence: args.confidence,
			learnedFrom: args.learnedFrom,
		}, args.cwd || process.cwd(), args.projectIdHint);
		return okResult('Queued learn-convention intent for "' + args.title + '".', result);
	},

	contextmanager_learn_tool_hint_intent(args) {
		if (!args || typeof args.toolName !== 'string' || typeof args.pattern !== 'string' || typeof args.example !== 'string' || !args.toolName.trim() || !args.pattern.trim() || !args.example.trim()) {
			return errorResult('toolName, pattern, and example are required.');
		}
		const result = appendWriteIntent({
			action: 'learn-tool-hint',
			toolName: args.toolName,
			pattern: args.pattern,
			example: args.example,
			antiPattern: args.antiPattern,
		}, args.cwd || process.cwd(), args.projectIdHint);
		return okResult('Queued learn-tool-hint intent for ' + args.toolName + '.', result);
	},

	contextmanager_learn_working_note_intent(args) {
		if (!args || typeof args.subject !== 'string' || typeof args.insight !== 'string' || !args.subject.trim() || !args.insight.trim()) {
			return errorResult('subject and insight are required.');
		}
		const result = appendWriteIntent({
			action: 'learn-working-note',
			subject: args.subject,
			insight: args.insight,
			relatedFiles: Array.isArray(args.relatedFiles) ? args.relatedFiles : undefined,
			relatedSymbols: Array.isArray(args.relatedSymbols) ? args.relatedSymbols : undefined,
			discoveredWhile: args.discoveredWhile,
		}, args.cwd || process.cwd(), args.projectIdHint);
		return okResult('Queued learn-working-note intent for "' + args.subject + '".', result);
	},

	contextmanager_storage_info() {
		const storageDir = resolveStorageDir();
		const queuePaths = getQueuePaths();
		return okResult('Storage: ' + storageDir + '\nQueue: ' + queuePaths.queueFile + '\nSessions: ' + queuePaths.sessionRoot, {
			storageDir,
			cmDir: queuePaths.cmDir,
			queueFile: queuePaths.queueFile,
			sessionRoot: queuePaths.sessionRoot,
		});
	},
};

function sendMessage(message) {
	const json = JSON.stringify(message);
	process.stdout.write(json + '\n');
}

function sendResponse(id, result) {
	sendMessage({ jsonrpc: '2.0', id, result });
}

function sendError(id, code, message) {
	sendMessage({ jsonrpc: '2.0', id, error: { code, message } });
}

function handleRequest(message) {
	const method = message.method;
	const params = message.params || {};
	appendLog('request', { id: message.id, method });
	if (method === 'initialize') {
		sendResponse(message.id, {
			protocolVersion: typeof params.protocolVersion === 'string' && params.protocolVersion ? params.protocolVersion : SUPPORTED_PROTOCOL_VERSION,
			capabilities: {
				tools: {
					listChanged: false,
				},
			},
			serverInfo: SERVER_INFO,
		});
		appendLog('initialize:ok', { protocolVersion: params.protocolVersion || SUPPORTED_PROTOCOL_VERSION });
		return;
	}

	if (method === 'ping') {
		sendResponse(message.id, {});
		return;
	}

	if (method === 'tools/list') {
		sendResponse(message.id, { tools: toolDefinitions });
		return;
	}

	if (method === 'tools/call') {
		const name = params.name;
		const args = params.arguments || {};
		const handler = toolHandlers[name];
		if (!handler) {
			sendError(message.id, -32601, 'Unknown tool: ' + name);
			return;
		}
		try {
			sendResponse(message.id, handler(args));
		} catch (error) {
			appendLog('tool:error', { name, message: error instanceof Error ? error.message : String(error) });
			sendResponse(message.id, errorResult(error instanceof Error ? error.message : String(error)));
		}
		return;
	}

	if (method === 'notifications/initialized') {
		appendLog('initialized');
		return;
	}

	sendError(message.id, -32601, 'Method not found: ' + method);
}

let textBuffer = '';

function handleParsedMessage(message, raw) {
	if (!message || message.jsonrpc !== '2.0') {
		appendLog('parse:error', { reason: 'invalid-jsonrpc', raw });
		return;
	}

	if (typeof message.method === 'string') {
		handleRequest(message);
	}
}

function consumeHeaderFramedMessages() {
	while (true) {
		let headerEnd = textBuffer.indexOf('\r\n\r\n');
		let separatorLength = 4;
		if (headerEnd === -1) {
			headerEnd = textBuffer.indexOf('\n\n');
			separatorLength = 2;
		}
		if (headerEnd === -1) {
			return false;
		}

		const headerText = textBuffer.slice(0, headerEnd);
		const headers = headerText.split(/\r?\n/);
		let contentLength = -1;
		for (const header of headers) {
			const separator = header.indexOf(':');
			if (separator === -1) {
				continue;
			}
			const name = header.slice(0, separator).trim().toLowerCase();
			const value = header.slice(separator + 1).trim();
			if (name === 'content-length') {
				contentLength = Number.parseInt(value, 10);
			}
		}

		if (!Number.isFinite(contentLength) || contentLength < 0) {
			appendLog('parse:error', { reason: 'invalid-content-length', headerText });
			textBuffer = '';
			return true;
		}

		const messageStart = headerEnd + separatorLength;
		const messageEnd = messageStart + contentLength;
		if (textBuffer.length < messageEnd) {
			return true;
		}

		const json = textBuffer.slice(messageStart, messageEnd);
		textBuffer = textBuffer.slice(messageEnd);

		try {
			handleParsedMessage(JSON.parse(json), json);
		} catch {
			appendLog('parse:error', { reason: 'invalid-json', json });
		}
	}
}

function consumeLineDelimitedMessages() {
	while (true) {
		const newlineIndex = textBuffer.indexOf('\n');
		if (newlineIndex === -1) {
			return;
		}

		const rawLine = textBuffer.slice(0, newlineIndex);
		textBuffer = textBuffer.slice(newlineIndex + 1);
		const line = rawLine.replace(/\r$/, '').trim();
		if (!line) {
			continue;
		}

		try {
			handleParsedMessage(JSON.parse(line), line);
		} catch {
			appendLog('parse:error', { reason: 'invalid-json-line', line });
		}
	}
}

function consumeMessages() {
	const trimmed = textBuffer.trimStart();
	if (trimmed.toLowerCase().startsWith('content-length:')) {
		consumeHeaderFramedMessages();
		return;
	}
	consumeLineDelimitedMessages();
}

appendLog('startup', { pid: process.pid, cwd: process.cwd(), argv: process.argv.slice(1) });

process.stdin.on('data', chunk => {
	textBuffer += chunk.toString('utf8');
	consumeMessages();
});

process.stdin.on('error', error => {
	appendLog('stdin:error', { message: error instanceof Error ? error.message : String(error) });
	console.error('[ContextManager MCP] stdin error:', error);
});

process.on('uncaughtException', error => {
	appendLog('fatal:uncaughtException', { message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined });
	console.error('[ContextManager MCP] fatal error:', error);
	process.exit(1);
});

process.on('unhandledRejection', error => {
	appendLog('fatal:unhandledRejection', { message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined });
	console.error('[ContextManager MCP] fatal rejection:', error);
	process.exit(1);
});