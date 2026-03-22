"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const fs = __importStar(require("node:fs"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const mcp_js_1 = require("@modelcontextprotocol/sdk/server/mcp.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const zod_1 = require("zod");
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
    }
    catch {
        return fallback;
    }
}
function loadProjects(storageDir) {
    const projects = readJsonFile(path.join(storageDir, 'projects.json'), []);
    return Array.isArray(projects) ? projects : [];
}
function saveProjects(storageDir, projects) {
    fs.writeFileSync(path.join(storageDir, 'projects.json'), JSON.stringify(projects, null, 2), 'utf8');
}
function loadSessions(storageDir) {
    const state = readJsonFile(path.join(storageDir, 'session-routing.json'), {});
    return Array.isArray(state.trackedSessions) ? state.trackedSessions : [];
}
function resolveProject(projects, selector) {
    if (!selector?.trim()) {
        return undefined;
    }
    const normalized = selector.trim().toLowerCase();
    return projects.find(project => project.id === selector
        || project.name.toLowerCase() === normalized
        || (project.rootPaths || []).some(rootPath => rootPath.toLowerCase() === normalized));
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
    const { cmDir, queueFile, sessionRoot } = getQueuePaths();
    fs.mkdirSync(cmDir, { recursive: true });
    fs.mkdirSync(sessionRoot, { recursive: true });
    if (!fs.existsSync(queueFile)) {
        fs.writeFileSync(queueFile, '', 'utf8');
    }
}
function getSessionFile(cwd) {
    const { sessionRoot } = getQueuePaths();
    // Match the capture script's SHA256-based key (PowerShell: SHA256(cwd).Substring(0, 24))
    const crypto = require('node:crypto');
    const hash = crypto.createHash('sha256').update(cwd).digest('hex').slice(0, 24);
    return path.join(sessionRoot, `${hash}.json`);
}
function newSessionId() {
    return `cm-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}
function getOrCreateSessionId(cwd) {
    ensureQueueDirs();
    const sessionFile = getSessionFile(cwd);
    if (fs.existsSync(sessionFile)) {
        try {
            const state = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
            if (state.sessionId) {
                return state.sessionId;
            }
        }
        catch { }
    }
    const sessionId = newSessionId();
    fs.writeFileSync(sessionFile, JSON.stringify({ sessionId, cwd, updatedAt: Date.now() }), 'utf8');
    return sessionId;
}
function appendWriteIntent(intent, cwd, projectIdHint) {
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
function scoreMatch(haystack, query) {
    const normalizedHaystack = haystack.toLowerCase();
    const normalizedQuery = query.toLowerCase();
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
function textResult(text, structuredContent) {
    return structuredContent
        ? { content: [{ type: 'text', text }], structuredContent }
        : { content: [{ type: 'text', text }] };
}
const server = new mcp_js_1.McpServer({
    name: 'contextmanager',
    version: '1.0.0',
});
server.registerTool('contextmanager_list_projects', {
    description: 'List ContextManager projects from the extension storage.',
    inputSchema: zod_1.z.object({}),
}, async () => {
    const storageDir = resolveStorageDir();
    const projects = loadProjects(storageDir);
    return textResult(projects.length
        ? projects.map(project => `- ${project.name} (${project.id})${project.rootPaths?.[0] ? ` — ${project.rootPaths[0]}` : ''}`).join('\n')
        : 'No ContextManager projects found.', { storageDir, count: projects.length, projects: projects.map(project => ({ id: project.id, name: project.name, rootPaths: project.rootPaths || [] })) });
});
server.registerTool('contextmanager_create_project', {
    description: 'Create a new ContextManager project. Projects scope knowledge cards, conventions, and agent sessions.',
    inputSchema: zod_1.z.object({
        name: zod_1.z.string().min(1).describe('Project name'),
        description: zod_1.z.string().optional().describe('Short project description'),
        rootPaths: zod_1.z.array(zod_1.z.string()).optional().describe('Root filesystem paths for this project'),
    }),
}, async ({ name, description, rootPaths }) => {
    const storageDir = resolveStorageDir();
    const projects = loadProjects(storageDir);
    if (projects.some(p => p.name.toLowerCase() === name.toLowerCase())) {
        return textResult(`Project "${name}" already exists.`);
    }
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
    const project = {
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
});
server.registerTool('contextmanager_rename_project', {
    description: 'Rename an existing ContextManager project.',
    inputSchema: zod_1.z.object({
        project: zod_1.z.string().min(1).describe('Current project name or ID'),
        newName: zod_1.z.string().min(1).describe('New project name'),
    }),
}, async ({ project: selector, newName }) => {
    const storageDir = resolveStorageDir();
    const projects = loadProjects(storageDir);
    const target = resolveProject(projects, selector);
    if (!target) {
        return textResult(`Project "${selector}" not found.`);
    }
    if (projects.some(p => p.id !== target.id && p.name.toLowerCase() === newName.toLowerCase())) {
        return textResult(`A project named "${newName}" already exists.`);
    }
    const oldName = target.name;
    target.name = newName;
    saveProjects(storageDir, projects);
    return textResult(`Renamed "${oldName}" → "${newName}" (id: ${target.id})`);
});
server.registerTool('contextmanager_update_project', {
    description: 'Update a project\'s description, root paths, or context (goals, conventions text, key files).',
    inputSchema: zod_1.z.object({
        project: zod_1.z.string().min(1).describe('Project name or ID'),
        description: zod_1.z.string().optional().describe('New project description'),
        rootPaths: zod_1.z.array(zod_1.z.string()).optional().describe('Updated root filesystem paths'),
        goals: zod_1.z.string().optional().describe('Project goals text'),
        conventions: zod_1.z.string().optional().describe('Project conventions text (free-form, separate from auto-learned conventions)'),
        keyFiles: zod_1.z.array(zod_1.z.string()).optional().describe('Key files list'),
    }),
}, async ({ project: selector, description, rootPaths, goals, conventions, keyFiles }) => {
    const storageDir = resolveStorageDir();
    const projects = loadProjects(storageDir);
    const target = resolveProject(projects, selector);
    if (!target) {
        return textResult(`Project "${selector}" not found.`);
    }
    const changes = [];
    if (description !== undefined) {
        target.description = description;
        changes.push('description');
    }
    if (rootPaths !== undefined) {
        target.rootPaths = rootPaths;
        changes.push('rootPaths');
    }
    // Context fields are stored under target.context (may not exist yet)
    const ctx = target.context || {};
    if (goals !== undefined) {
        ctx.goals = goals;
        changes.push('goals');
    }
    if (conventions !== undefined) {
        ctx.conventions = conventions;
        changes.push('conventions');
    }
    if (keyFiles !== undefined) {
        ctx.keyFiles = keyFiles;
        changes.push('keyFiles');
    }
    if (changes.length > 0) {
        target.context = ctx;
    }
    saveProjects(storageDir, projects);
    return textResult(changes.length > 0
        ? `Updated project "${target.name}": ${changes.join(', ')}`
        : `No changes made to "${target.name}".`);
});
server.registerTool('contextmanager_search_knowledge', {
    description: 'Search knowledge cards, conventions, tool hints, and working notes across ContextManager projects.',
    inputSchema: zod_1.z.object({
        query: zod_1.z.string().min(1),
        project: zod_1.z.string().optional(),
        limit: zod_1.z.number().int().min(1).max(50).default(10),
    }),
}, async ({ query, project, limit }) => {
    const storageDir = resolveStorageDir();
    const projects = loadProjects(storageDir);
    const scopedProjects = project ? [resolveProject(projects, project)].filter((item) => !!item) : projects;
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
    return textResult(results.length
        ? results.map(result => `- [${result.kind}] ${result.title} — ${result.projectName}`).join('\n')
        : `No knowledge matches found for "${query}".`, { storageDir, query, results });
});
server.registerTool('contextmanager_get_knowledge_card', {
    description: 'Read a specific knowledge card by id or exact title.',
    inputSchema: zod_1.z.object({
        project: zod_1.z.string().optional(),
        id: zod_1.z.string().optional(),
        title: zod_1.z.string().optional(),
    }).refine(value => !!value.id || !!value.title, 'Provide id or title.'),
}, async ({ project, id, title }) => {
    const storageDir = resolveStorageDir();
    const projects = loadProjects(storageDir);
    const scopedProjects = project ? [resolveProject(projects, project)].filter((item) => !!item) : projects;
    const normalizedTitle = title?.trim().toLowerCase();
    for (const projectRecord of scopedProjects) {
        const card = (projectRecord.knowledgeCards || []).find(item => item.id === id || item.title.toLowerCase() === normalizedTitle);
        if (!card) {
            continue;
        }
        return textResult(`# ${card.title}\n\nProject: ${projectRecord.name}\nCategory: ${card.category || 'other'}\n\n${card.content}`, { projectId: projectRecord.id, projectName: projectRecord.name, card });
    }
    return { content: [{ type: 'text', text: 'Knowledge card not found.' }], isError: true };
});
server.registerTool('contextmanager_list_sessions', {
    description: 'List tracked ContextManager sessions and their current binding status.',
    inputSchema: zod_1.z.object({
        project: zod_1.z.string().optional(),
        status: zod_1.z.string().optional(),
        limit: zod_1.z.number().int().min(1).max(100).default(25),
    }),
}, async ({ project, status, limit }) => {
    const storageDir = resolveStorageDir();
    const projects = loadProjects(storageDir);
    const sessions = loadSessions(storageDir);
    const projectRecord = project ? resolveProject(projects, project) : undefined;
    const filtered = sessions
        .filter(session => !status || session.status === status)
        .filter(session => {
        if (!projectRecord) {
            return true;
        }
        return (session.bindingSegments || []).some(segment => segment.projectId === projectRecord.id && segment.endSequence === undefined);
    })
        .sort((left, right) => (right.lastActivityAt || 0) - (left.lastActivityAt || 0))
        .slice(0, limit);
    return textResult(filtered.length
        ? filtered.map(session => `- ${session.label || session.sessionId} [${session.origin || 'unknown'}] — ${session.status || 'pending'}${typeof session.pendingCaptureCount === 'number' ? ` (${session.pendingCaptureCount} pending)` : ''}`).join('\n')
        : 'No tracked sessions found.', { storageDir, count: filtered.length, sessions: filtered });
});
server.registerTool('contextmanager_bind_session', {
    description: 'Bind a tracked session to a ContextManager project. Pending captures will be assigned to that project.',
    inputSchema: zod_1.z.object({
        sessionId: zod_1.z.string().min(1).describe('Session ID to bind'),
        project: zod_1.z.string().min(1).describe('Project name or ID to bind to'),
    }),
}, async ({ sessionId, project: projectSelector }) => {
    const storageDir = resolveStorageDir();
    const projects = loadProjects(storageDir);
    const target = resolveProject(projects, projectSelector);
    if (!target) {
        return textResult(`Project "${projectSelector}" not found.`);
    }
    const routingPath = path.join(storageDir, 'session-routing.json');
    const state = readJsonFile(routingPath, { trackedSessions: [] });
    const sessions = state.trackedSessions || [];
    const session = sessions.find(s => s.sessionId === sessionId);
    if (!session) {
        return textResult(`Session "${sessionId}" not found.`);
    }
    // End any active binding
    const segments = session.bindingSegments || [];
    for (const seg of segments) {
        if (seg.endSequence === undefined) {
            seg.endSequence = 0; // close previous binding
        }
    }
    // Add new binding
    segments.push({ projectId: target.id });
    session.bindingSegments = segments;
    session.status = 'bound';
    state.updatedAt = Date.now();
    fs.writeFileSync(routingPath, JSON.stringify(state, null, 2), 'utf8');
    return textResult(`Bound session "${session.label || sessionId}" to project "${target.name}".`);
});
function generateId() {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}
function resolveProjectForWrite(projects, project, cwd) {
    if (project) {
        return resolveProject(projects, project);
    }
    if (cwd) {
        const normalized = cwd.toLowerCase();
        const match = projects.find(p => (p.rootPaths || []).some((rp) => normalized === rp.toLowerCase() || normalized.startsWith(rp.toLowerCase() + path.sep)));
        if (match) {
            return match;
        }
    }
    if (projects.length === 1) {
        return projects[0];
    }
    return undefined;
}
server.registerTool('contextmanager_save_card', {
    description: 'Save a knowledge card to a ContextManager project. Writes directly to storage.',
    inputSchema: zod_1.z.object({
        title: zod_1.z.string().min(1).describe('Card title'),
        content: zod_1.z.string().min(1).describe('Card content (markdown supported)'),
        project: zod_1.z.string().optional().describe('Project name or ID. Auto-resolved from cwd if omitted.'),
        category: zod_1.z.string().optional().describe('Card category (e.g. architecture, explanation, note)'),
        tags: zod_1.z.array(zod_1.z.string()).optional().describe('Tags for the card'),
        source: zod_1.z.string().optional().describe('Where this knowledge came from'),
    }),
}, async ({ title, content, project: projectHint, category, tags, source }) => {
    const storageDir = resolveStorageDir();
    const projects = loadProjects(storageDir);
    const proj = resolveProjectForWrite(projects, projectHint, process.cwd());
    if (!proj) {
        return textResult('Could not resolve project. Provide project name or ensure cwd matches a project root path.');
    }
    if (!proj.knowledgeCards) {
        proj.knowledgeCards = [];
    }
    // Dedup by title + category
    const existing = proj.knowledgeCards.find((c) => c.title?.toLowerCase() === title.toLowerCase() && (c.category || 'note') === (category || 'note'));
    if (existing) {
        existing.content = content;
        existing.updated = Date.now();
        if (tags) {
            existing.tags = tags;
        }
        if (source) {
            existing.source = source;
        }
        saveProjects(storageDir, projects);
        return textResult(`Updated existing card "${title}" in project "${proj.name}".`, { cardId: existing.id });
    }
    const card = {
        id: generateId(), title, content,
        category: category || 'note',
        tags: tags || [], source: source || 'MCP tool',
        created: Date.now(), updated: Date.now(),
        pinned: false, archived: false, includeInContext: true, isGlobal: false,
    };
    proj.knowledgeCards.push(card);
    saveProjects(storageDir, projects);
    return textResult(`Saved card "${title}" to project "${proj.name}".`, { cardId: card.id });
});
server.registerTool('contextmanager_learn_convention', {
    description: 'Save a convention to a ContextManager project. Writes directly to storage.',
    inputSchema: zod_1.z.object({
        category: zod_1.z.string().min(1).describe('Convention category (architecture, naming, patterns, testing, tooling, pitfalls)'),
        title: zod_1.z.string().min(1).describe('Convention title'),
        content: zod_1.z.string().min(1).describe('Convention description'),
        project: zod_1.z.string().optional().describe('Project name or ID'),
        confidence: zod_1.z.string().optional().describe('Confidence level (observed, inferred)'),
        learnedFrom: zod_1.z.string().optional().describe('Source of this convention'),
    }),
}, async ({ category, title, content, project: projectHint, confidence, learnedFrom }) => {
    const storageDir = resolveStorageDir();
    const projects = loadProjects(storageDir);
    const proj = resolveProjectForWrite(projects, projectHint, process.cwd());
    if (!proj) {
        return textResult('Could not resolve project.');
    }
    if (!proj.conventions) {
        proj.conventions = [];
    }
    const existing = proj.conventions.find((c) => c.title?.toLowerCase() === title.toLowerCase());
    if (existing) {
        existing.content = content;
        existing.updatedAt = Date.now();
        if (confidence) {
            existing.confidence = confidence;
        }
        saveProjects(storageDir, projects);
        return textResult(`Updated convention "${title}" in project "${proj.name}".`, { id: existing.id });
    }
    const conv = {
        id: generateId(), category, title, content,
        confidence: confidence || 'observed',
        learnedFrom: learnedFrom || 'MCP tool',
        enabled: true,
        createdAt: Date.now(), updatedAt: Date.now(),
    };
    proj.conventions.push(conv);
    saveProjects(storageDir, projects);
    return textResult(`Saved convention "${title}" to project "${proj.name}".`, { id: conv.id });
});
server.registerTool('contextmanager_learn_tool_hint', {
    description: 'Save a tool hint to a ContextManager project. Writes directly to storage.',
    inputSchema: zod_1.z.object({
        toolName: zod_1.z.string().min(1).describe('Name of the tool'),
        pattern: zod_1.z.string().min(1).describe('Usage pattern'),
        example: zod_1.z.string().min(1).describe('Example usage'),
        antiPattern: zod_1.z.string().optional().describe('Anti-pattern to avoid'),
        project: zod_1.z.string().optional().describe('Project name or ID'),
    }),
}, async ({ toolName, pattern, example, antiPattern, project: projectHint }) => {
    const storageDir = resolveStorageDir();
    const projects = loadProjects(storageDir);
    const proj = resolveProjectForWrite(projects, projectHint, process.cwd());
    if (!proj) {
        return textResult('Could not resolve project.');
    }
    if (!proj.toolHints) {
        proj.toolHints = [];
    }
    const existing = proj.toolHints.find((h) => h.toolName?.toLowerCase() === toolName.toLowerCase() && h.pattern?.toLowerCase() === pattern.toLowerCase());
    if (existing) {
        existing.useCount = (existing.useCount || 0) + 1;
        existing.updatedAt = Date.now();
        saveProjects(storageDir, projects);
        return textResult(`Updated tool hint for "${toolName}" (use count: ${existing.useCount}).`, { id: existing.id });
    }
    const hint = {
        id: generateId(), toolName, pattern, example,
        antiPattern: antiPattern || '',
        useCount: 1,
        createdAt: Date.now(), updatedAt: Date.now(),
    };
    proj.toolHints.push(hint);
    saveProjects(storageDir, projects);
    return textResult(`Saved tool hint for "${toolName}" to project "${proj.name}".`, { id: hint.id });
});
server.registerTool('contextmanager_learn_working_note', {
    description: 'Save a working note to a ContextManager project. Writes directly to storage.',
    inputSchema: zod_1.z.object({
        subject: zod_1.z.string().min(1).describe('Note subject'),
        insight: zod_1.z.string().min(1).describe('The insight or observation'),
        relatedFiles: zod_1.z.array(zod_1.z.string()).optional().describe('Related file paths'),
        relatedSymbols: zod_1.z.array(zod_1.z.string()).optional().describe('Related code symbols'),
        discoveredWhile: zod_1.z.string().optional().describe('What task this was discovered during'),
        project: zod_1.z.string().optional().describe('Project name or ID'),
    }),
}, async ({ subject, insight, relatedFiles, relatedSymbols, discoveredWhile, project: projectHint }) => {
    const storageDir = resolveStorageDir();
    const projects = loadProjects(storageDir);
    const proj = resolveProjectForWrite(projects, projectHint, process.cwd());
    if (!proj) {
        return textResult('Could not resolve project.');
    }
    if (!proj.workingNotes) {
        proj.workingNotes = [];
    }
    const existing = proj.workingNotes.find((n) => n.subject?.toLowerCase() === subject.toLowerCase());
    if (existing) {
        existing.insight = insight;
        existing.updatedAt = Date.now();
        if (relatedFiles) {
            existing.relatedFiles = relatedFiles;
        }
        saveProjects(storageDir, projects);
        return textResult(`Updated working note "${subject}" in project "${proj.name}".`, { id: existing.id });
    }
    const note = {
        id: generateId(), subject, insight,
        relatedFiles: relatedFiles || [], relatedSymbols: relatedSymbols || [],
        discoveredWhile: discoveredWhile || '',
        confidence: 'observed', enabled: true, staleness: 'fresh',
        createdAt: Date.now(), updatedAt: Date.now(),
    };
    proj.workingNotes.push(note);
    saveProjects(storageDir, projects);
    return textResult(`Saved working note "${subject}" to project "${proj.name}".`, { id: note.id });
});
server.registerTool('contextmanager_storage_info', {
    description: 'Report which ContextManager storage directory and queue files are being used.',
    inputSchema: zod_1.z.object({}),
}, async () => {
    const storageDir = resolveStorageDir();
    const queuePaths = getQueuePaths();
    return textResult(`Storage: ${storageDir}\nQueue: ${queuePaths.queueFile}\nSessions: ${queuePaths.sessionRoot}`, { storageDir, ...queuePaths });
});
// ── Orchestrator Primitives ─────────────────────────────────────────
const REGISTRY_FILE = path.join(os.homedir(), '.contextmanager', 'agent-registry.json');
function readRegistry() {
    try {
        const data = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
        return Object.values(data.agents || {});
    }
    catch {
        return [];
    }
}
function updateRegistryMeta(sessionId, meta) {
    const { cmDir } = getQueuePaths();
    fs.mkdirSync(cmDir, { recursive: true });
    let data;
    try {
        data = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
    }
    catch {
        data = { agents: {}, updatedAt: Date.now() };
    }
    const agent = data.agents[sessionId];
    if (agent) {
        agent.meta = { ...(agent.meta || {}), ...meta };
        agent.lastSeenAt = Date.now();
    }
    else {
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
// ── Orchestrator MCP Tools ──────────────────────────────────────────
server.registerTool('orchestrator_list_agents', {
    description: 'List all active agent sessions in the orchestrator registry. Optionally filter by project.',
    inputSchema: zod_1.z.object({
        project: zod_1.z.string().optional().describe('Filter agents by project name'),
        status: zod_1.z.string().optional().describe('Filter by status: active, idle, stopped. Omit for all.'),
    }),
}, async ({ project, status }) => {
    let agents = readRegistry();
    if (project) {
        agents = agents.filter(a => a.project === project);
    }
    if (status) {
        agents = agents.filter(a => (a.status || 'active') === status);
    }
    if (agents.length === 0) {
        return textResult('No agents found.', { agents: [] });
    }
    const summary = agents.map(a => {
        const meta = Object.keys(a.meta || {}).length > 0
            ? ` | meta: ${JSON.stringify(a.meta)}` : '';
        const age = Math.round((Date.now() - a.lastSeenAt) / 1000);
        const st = a.status || 'active';
        const term = a.terminal ? ` | ${a.terminal.type}:${a.terminal.paneId || '?'}` : '';
        return `- [${st}] ${a.label || 'unnamed'} | project: ${a.project || 'unbound'} | cwd: ${a.cwd} | last seen: ${age}s ago${term}${meta}`;
    }).join('\n');
    return textResult(`Agents (${agents.length}):\n${summary}`, { agents });
});
server.registerTool('orchestrator_get_agent', {
    description: 'Get full details for a specific agent session by its session ID.',
    inputSchema: zod_1.z.object({
        sessionId: zod_1.z.string().min(1).describe('The session ID of the agent to look up'),
    }),
}, async ({ sessionId }) => {
    const agents = readRegistry();
    const agent = agents.find(a => a.sessionId === sessionId);
    if (!agent) {
        return textResult(`Agent ${sessionId} not found.`);
    }
    return textResult(JSON.stringify(agent, null, 2), { agent });
});
server.registerTool('orchestrator_set_agent_meta', {
    description: 'Set arbitrary metadata on your agent entry (status, task, phase, or any custom data). Can also set/update terminal info (psmux/tmux pane, window, session). Creates entry if missing.',
    inputSchema: zod_1.z.object({
        meta: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).default({}).describe('Key-value metadata to merge into your agent entry'),
        terminal: zod_1.z.object({
            type: zod_1.z.string().describe('Terminal multiplexer type: psmux, tmux, vscode, raw'),
            paneId: zod_1.z.string().optional().describe('Pane identifier (e.g. %3 for tmux/psmux)'),
            windowId: zod_1.z.string().optional().describe('Window identifier'),
            sessionName: zod_1.z.string().optional().describe('Multiplexer session name'),
        }).optional().describe('Terminal/pane info for this agent session'),
    }),
}, async ({ meta, terminal }) => {
    const cwd = process.cwd();
    const sessionId = getOrCreateSessionId(cwd);
    if (meta && Object.keys(meta).length > 0) {
        updateRegistryMeta(sessionId, meta);
    }
    if (terminal) {
        // Write terminal info directly to registry
        const data = (() => {
            try {
                return JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
            }
            catch {
                return { agents: {}, updatedAt: Date.now() };
            }
        })();
        if (data.agents[sessionId]) {
            data.agents[sessionId].terminal = terminal;
            data.agents[sessionId].lastSeenAt = Date.now();
        }
        else {
            data.agents[sessionId] = {
                sessionId, origin: 'copilot-cli-plugin', cwd,
                registeredAt: Date.now(), lastSeenAt: Date.now(),
                status: 'active', terminal, meta: meta || {},
            };
        }
        data.updatedAt = Date.now();
        const tmp = REGISTRY_FILE + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
        fs.renameSync(tmp, REGISTRY_FILE);
    }
    const parts = [];
    if (meta && Object.keys(meta).length > 0) {
        parts.push(`meta: ${JSON.stringify(meta)}`);
    }
    if (terminal) {
        parts.push(`terminal: ${terminal.type}:${terminal.paneId || '?'} (session: ${terminal.sessionName || 'default'})`);
    }
    return textResult(`Updated agent ${sessionId}: ${parts.join(', ')}`);
});
server.registerTool('orchestrator_send', {
    description: 'Send a message to another agent session via psmux/tmux send-keys. The message is typed into the target terminal pane. Requires agents to be running inside psmux/tmux with terminal info in registry.',
    inputSchema: zod_1.z.object({
        sessionId: zod_1.z.string().min(1).describe('Target agent session ID'),
        message: zod_1.z.string().min(1).describe('Message to send (will be typed into the target pane followed by Enter)'),
    }),
}, async ({ sessionId, message }) => {
    const agents = readRegistry();
    const agent = agents.find((a) => a.sessionId === sessionId);
    if (!agent) {
        return textResult(`Agent "${sessionId}" not found in registry.`);
    }
    // Check terminal info (new format) or legacy meta.pane
    const terminal = agent.terminal;
    const meta = (agent.meta || {});
    const pane = terminal?.paneId || meta.pane;
    const muxType = terminal?.type || (process.platform === 'win32' ? 'psmux' : 'tmux');
    if (!pane) {
        return textResult(`Agent "${sessionId}" has no terminal pane ID. It may not be running inside psmux/tmux.`);
    }
    const mux = muxType === 'psmux' ? 'psmux' : 'tmux';
    const { execSync } = require('node:child_process');
    try {
        const escaped = message.replace(/"/g, '\\"');
        execSync(`${mux} send-keys -t ${pane} "${escaped}" Enter`, { timeout: 5000 });
        return textResult(`Sent to ${sessionId} (${mux} pane ${pane}): "${message}"`);
    }
    catch (err) {
        return textResult(`Failed to send to pane ${pane}: ${err.message}. Is ${mux} running?`);
    }
});
async function main() {
    const transport = new stdio_js_1.StdioServerTransport();
    await server.connect(transport);
}
main().catch(error => {
    console.error('[ContextManager MCP] fatal error:', error);
    process.exit(1);
});
