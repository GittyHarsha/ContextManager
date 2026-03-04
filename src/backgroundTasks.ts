/**
 * Background Task Manager — runs LLM agent loops outside the chat participant.
 *
 * Provides a task queue with live progress tracking visible in the dashboard.
 * Uses the same `runSubagentLoop` pattern (model.sendRequest + vscode.lm.invokeTool)
 * but renders output to the dashboard webview instead of the chat stream.
 *
 * Tasks are persisted in globalState so they survive window reloads.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { BackgroundTask, BackgroundTaskStatus, BackgroundTaskStep, BackgroundTaskType, createBackgroundTask } from './projects/types';
import { ConfigurationManager } from './config';
import { ProjectManager } from './projects/ProjectManager';
import { ExplanationCache } from './cache';

// ─── Events ─────────────────────────────────────────────────────

const _onDidChangeTasks = new vscode.EventEmitter<void>();

// ─── State ──────────────────────────────────────────────────────

let _tasks: BackgroundTask[] = [];
let _context: vscode.ExtensionContext;
let _projectManager: ProjectManager;
let _cache: ExplanationCache;
let _isRunning = false;
let _currentCancellation: vscode.CancellationTokenSource | null = null;

/** Counter for tool call ID deduplication */
let _toolCallIdCounter = 0;

const STORAGE_KEY = 'backgroundTasks'; // legacy globalState key (migration only)
const TASKS_FILE = 'backgroundTasks.json';
const MAX_PERSISTED_TASKS = 50;
const SAFETY_ITERATION_LIMIT = 200; // Matches chat participant

/** Stashed last chat exchange — available for background tasks to pick up. */
let _lastChatExchange = '';

/**
 * Store the last chat exchange so background tasks can reference it.
 * Called from chatHooks ModelResponse for Copilot sessions.
 */
export function setLastChatExchange(exchange: string): void {
	_lastChatExchange = exchange;
}

export function getLastChatExchange(): string {
	return _lastChatExchange;
}

// ─── Public API ─────────────────────────────────────────────────

export const onDidChangeTasks = _onDidChangeTasks.event;

export function initBackgroundTasks(
	context: vscode.ExtensionContext,
	projectManager: ProjectManager,
	cache: ExplanationCache,
): void {
	_context = context;
	_projectManager = projectManager;
	_cache = cache;
	// Load persisted tasks from disk; migrate from globalState on first run
	try {
		const storagePath = context.globalStorageUri.fsPath;
		const diskFile = path.join(storagePath, TASKS_FILE);
		let stored: BackgroundTask[];
		if (fs.existsSync(diskFile)) {
			stored = JSON.parse(fs.readFileSync(diskFile, 'utf8'));
		} else {
			// One-time migration
			stored = context.globalState.get<BackgroundTask[]>(STORAGE_KEY, []);
			if (!fs.existsSync(storagePath)) { fs.mkdirSync(storagePath, { recursive: true }); }
			fs.writeFileSync(diskFile, JSON.stringify(stored), 'utf8');
			context.globalState.update(STORAGE_KEY, undefined);
		}
		_tasks = stored.map(t => t.status === 'running' ? { ...t, status: 'failed' as const, error: 'Interrupted by reload' } : t);
	} catch {
		_tasks = [];
	}
	_persist();
}

export function getTasks(): BackgroundTask[] {
	return [..._tasks];
}

export function getTask(id: string): BackgroundTask | undefined {
	return _tasks.find(t => t.id === id);
}

export function getRunningTask(): BackgroundTask | undefined {
	return _tasks.find(t => t.status === 'running');
}

/**
 * Queue a new background task. If nothing is running, starts immediately.
 */
export function queueTask(
	type: BackgroundTaskType,
	title: string,
	prompt: string,
	chatContext?: string,
): BackgroundTask {
	// If no explicit context, pick up from last chat exchange
	const ctx = chatContext || _lastChatExchange || undefined;
	const task = createBackgroundTask(type, title, prompt, ctx);
	_tasks.unshift(task); // newest first
	_trimTasks();
	_persist();
	_onDidChangeTasks.fire();

	// Auto-start if idle
	if (!_isRunning) {
		_processQueue();
	}

	return task;
}

/**
 * Quick-log a completed background task (e.g., auto-learn result).
 * These don't go through the LLM loop — they're just recorded for visibility.
 */
export function logCompletedTask(
	type: BackgroundTaskType,
	title: string,
	result: string,
	steps: BackgroundTaskStep[] = [],
): BackgroundTask {
	const task = createBackgroundTask(type, title, '');
	task.status = 'completed';
	task.startedAt = task.createdAt;
	task.completedAt = Date.now();
	task.result = result;
	task.steps = steps;
	_tasks.unshift(task);
	_trimTasks();
	_persist();
	_onDidChangeTasks.fire();
	return task;
}

/**
 * Cancel the currently running task.
 */
export function cancelCurrentTask(): void {
	if (_currentCancellation) {
		_currentCancellation.cancel();
	}
}

/**
 * Remove a completed/failed/cancelled task from the list.
 */
export function removeTask(id: string): void {
	_tasks = _tasks.filter(t => t.id !== id);
	_persist();
	_onDidChangeTasks.fire();
}

/**
 * Clear all completed/failed tasks.
 */
export function clearCompletedTasks(): void {
	_tasks = _tasks.filter(t => t.status === 'running' || t.status === 'queued');
	_persist();
	_onDidChangeTasks.fire();
}

// ─── Queue Processor ────────────────────────────────────────────

async function _processQueue(): Promise<void> {
	if (_isRunning) { return; }

	const nextTask = _tasks.find(t => t.status === 'queued');
	if (!nextTask) { return; }

	_isRunning = true;
	nextTask.status = 'running';
	nextTask.startedAt = Date.now();
	_addStep(nextTask, 'thinking', 'Starting task...');
	_persist();
	_onDidChangeTasks.fire();

	_currentCancellation = new vscode.CancellationTokenSource();

	try {
		const result = await _executeTask(nextTask, _currentCancellation.token);
		nextTask.status = 'completed';
		nextTask.completedAt = Date.now();
		nextTask.result = result;
		_addStep(nextTask, 'text', 'Task completed.');
	} catch (err) {
		if (_currentCancellation.token.isCancellationRequested) {
			nextTask.status = 'cancelled';
			_addStep(nextTask, 'error', 'Task cancelled.');
		} else {
			nextTask.status = 'failed';
			nextTask.error = err instanceof Error ? err.message : String(err);
			_addStep(nextTask, 'error', `Failed: ${nextTask.error}`);
		}
	} finally {
		nextTask.completedAt = Date.now();
		_currentCancellation.dispose();
		_currentCancellation = null;
		_isRunning = false;
		_persist();
		_onDidChangeTasks.fire();

		// Process next in queue
		_processQueue();
	}
}

// ─── Task Execution (LLM Loop — parity with chat participant) ──

async function _executeTask(task: BackgroundTask, token: vscode.CancellationToken): Promise<string> {
	// ── 1. Select model ──
	const modelFamily = ConfigurationManager.autoLearnModelFamily;
	const selector: vscode.LanguageModelChatSelector = modelFamily ? { family: modelFamily } : {};
	const models = await vscode.lm.selectChatModels(selector);
	if (!models.length) {
		throw new Error('No language model available. Check your model settings.');
	}
	const model = models[0];
	_addStep(task, 'thinking', `Using model: ${model.name} (max ${model.maxInputTokens} input tokens)`);
	_onDidChangeTasks.fire();

	// ── 2. Get tools ──
	const tools = _getBackgroundTools();

	// ── 3. Build project context (same data the chat participant uses) ──
	const activeProject = _projectManager?.getActiveProject();
	let projectCtx = '';
	let branchCtx = '';
	let intelligenceCtx = '';

	if (activeProject && _projectManager.isContextEnabled(activeProject.id)) {
		try {
			projectCtx = await _projectManager.getFullProjectContext(activeProject.id, _cache) || '';
			intelligenceCtx = await _projectManager.getProjectIntelligenceString(
				activeProject.id, task.prompt, []
			) || '';
		} catch { /* non-critical */ }
	}

	// ── 4. Build messages ──
	const workspacePaths = vscode.workspace.workspaceFolders?.map(f => f.uri.fsPath) ?? [];

	const systemPrompt = `You are an autonomous codebase research and editing agent running in the background. You have full access to search, read, navigate, and edit the workspace using tools.

## Workspace Root Paths
${workspacePaths.map(p => `- ${p}`).join('\n')}
Use ONLY these paths when calling search and file tools. Do NOT use paths from project context that don't match these roots.

## Critical Rules
- FIRST read .github/copilot-instructions.md if it exists — it contains essential workspace conventions and file paths.
- ALWAYS use tools first. Do NOT answer from memory or assumptions.
- Search broadly: find definitions, usages, related files, imports, tests, and configuration.
- Read the actual code before making any claim — do not guess file contents.
- Keep exploring until you have comprehensive evidence.
- Cite specific file paths and line numbers for every claim.
- If your first search returns no results, try alternative terms or broader patterns.
- When searching, use the workspace root paths above — never guess paths.

## File Editing Rules — CRITICAL
When making code changes, use ONLY the VS Code built-in file editing tools:
- replace_string_in_file — replace existing text (read the file first to get exact content)
- insert_edit_into_file — insert new code at a location
- create_file — create a new file

NEVER use terminal commands to edit files. Forbidden: sed, awk, PowerShell Set-Content/Add-Content/(Get-Content) -replace, echo/cat redirects, or any shell-based text manipulation. Terminal is only for builds, tests, and installs.`;

	const contextSections = [
		projectCtx ? `## Project Context\n${projectCtx}` : '',
		branchCtx ? `## Branch Context\n${branchCtx}` : '',
		intelligenceCtx ? `## Learned Intelligence\n${intelligenceCtx}` : '',
		task.chatContext ? `## Previous Conversation\n${task.chatContext}` : '',
		`## Task\n${task.prompt}`,
	].filter(Boolean).join('\n\n');

	const messages: vscode.LanguageModelChatMessage[] = [
		vscode.LanguageModelChatMessage.User(`[SYSTEM INSTRUCTIONS]\n${systemPrompt}`),
		vscode.LanguageModelChatMessage.User(contextSections),
	];

	// ── 5. Request options ──
	const sendOptions: vscode.LanguageModelChatRequestOptions = {
		justification: 'To complete a background research task about the codebase',
		tools: tools.length > 0 ? tools : undefined,
	};

	// ── 6. Tool-calling loop ──
	let lastResponseText = '';
	const toolCallIdSet = new Set<string>();

	for (let iteration = 0; iteration < SAFETY_ITERATION_LIMIT; iteration++) {
		if (token.isCancellationRequested) {
			return lastResponseText || 'Task cancelled.';
		}

		// ── 6a. Prune old rounds if messages are too long ──
		const estimatedTokens = messages.reduce((sum, m) => {
			const content = m.content as any;
			if (typeof content === 'string') { return sum + content.length / 4; }
			if (Array.isArray(content)) {
				return sum + content.reduce((s: number, p: any) => {
					if (p instanceof vscode.LanguageModelTextPart) { return s + p.value.length / 4; }
					return s + 50;
				}, 0);
			}
			return sum + 50;
		}, 0);

		if (estimatedTokens > model.maxInputTokens * 0.8 && messages.length > 6) {
			const keepEnd = Math.max(6, messages.length - 8);
			const removed = messages.splice(2, keepEnd - 2);
			_addStep(task, 'thinking', `Pruned ${removed.length} old messages to fit context window`);
		}

		// ── 6b. Validate: remove orphaned tool results ──
		_validateToolMessages(messages);

		// ── 6c. Send request ──
		const response = await model.sendRequest(messages, sendOptions, token);

		// ── 6d. Stream response ──
		const toolCalls: vscode.LanguageModelToolCallPart[] = [];
		let responseText = '';

		for await (const part of response.stream) {
			if (part instanceof vscode.LanguageModelTextPart) {
				responseText += part.value;
			} else if (part instanceof vscode.LanguageModelToolCallPart) {
				// Deduplicate tool call IDs
				if (toolCallIdSet.has(part.callId)) {
					(part as any).callId = `${part.callId}__bg-${++_toolCallIdCounter}`;
				}
				toolCallIdSet.add(part.callId);
				toolCalls.push(part);
			}
		}

		lastResponseText = responseText;

		// ── 6e. Build assistant message ──
		const assistantParts: (vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart)[] = [];
		if (responseText) {
			assistantParts.push(new vscode.LanguageModelTextPart(responseText));
			_addStep(task, 'text', responseText.substring(0, 500) + (responseText.length > 500 ? '…' : ''));
			_onDidChangeTasks.fire();
		}
		assistantParts.push(...toolCalls);
		messages.push(vscode.LanguageModelChatMessage.Assistant(assistantParts));

		// ── 6f. If no tool calls → done ──
		if (toolCalls.length === 0) {
			return responseText;
		}

		// ── 6g. Log tool calls ──
		for (const tc of toolCalls) {
			const toolLabel = tc.name.replace(/^contextManager_/i, '').replace(/_/g, ' ');
			const inputStr = typeof tc.input === 'object' ? JSON.stringify(tc.input).substring(0, 120) : '';
			_addStep(task, 'tool-call', `${toolLabel}(${inputStr}${inputStr.length >= 120 ? '…' : ''})`);
		}
		_addStep(task, 'thinking', `Round ${iteration + 1}: calling ${toolCalls.length} tool${toolCalls.length > 1 ? 's' : ''}...`);
		_persist();
		_onDidChangeTasks.fire();

		// ── 6h. Invoke ALL tools in parallel ──
		const toolResults = await Promise.all(toolCalls.map(async (tc) => {
			try {
				const result = await vscode.lm.invokeTool(tc.name, {
					input: tc.input,
					toolInvocationToken: undefined,
				}, token);

				const textContent = result.content
					.filter((p): p is vscode.LanguageModelTextPart => p instanceof vscode.LanguageModelTextPart)
					.map(p => p.value)
					.join('\n');

				return { callId: tc.callId, text: textContent || 'Tool executed successfully (no output).' };
			} catch (err: unknown) {
				const msg = err instanceof Error ? err.message : String(err);
				return { callId: tc.callId, text: `Error invoking tool "${tc.name}": ${msg}` };
			}
		}));

		// ── 6i. Feed results back ──
		for (const tr of toolResults) {
			messages.push(vscode.LanguageModelChatMessage.User([
				new vscode.LanguageModelToolResultPart(tr.callId, [
					new vscode.LanguageModelTextPart(tr.text),
				]),
			]));
			const preview = tr.text.substring(0, 100);
			_addStep(task, 'tool-result', preview + (tr.text.length > 100 ? '…' : ''));
		}
		_persist();
		_onDidChangeTasks.fire();
	}

	return lastResponseText || 'Reached maximum iteration limit without a final response.';
}

// ─── Message Validation ─────────────────────────────────────────

/**
 * Remove orphaned tool-result messages that don't have a matching
 * tool call in the preceding assistant message.
 */
function _validateToolMessages(messages: vscode.LanguageModelChatMessage[]): void {
	const validCallIds = new Set<string>();
	for (const msg of messages) {
		const content = msg.content as any;
		if (msg.role === vscode.LanguageModelChatMessageRole.Assistant && Array.isArray(content)) {
			for (const part of content) {
				if (part instanceof vscode.LanguageModelToolCallPart) {
					validCallIds.add(part.callId);
				}
			}
		}
	}

	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		const content = msg.content as any;
		if (msg.role === vscode.LanguageModelChatMessageRole.User && Array.isArray(content)) {
			const hasOnlyToolResults = content.every((p: any) => p instanceof vscode.LanguageModelToolResultPart);
			if (hasOnlyToolResults && content.length > 0) {
				const hasOrphan = content.some((p: any) =>
					p instanceof vscode.LanguageModelToolResultPart && !validCallIds.has(p.callId)
				);
				if (hasOrphan) {
					messages.splice(i, 1);
				}
			}
		}
	}
}

// ─── Tool Discovery ─────────────────────────────────────────────

function _getBackgroundTools(): vscode.LanguageModelChatTool[] {
	return vscode.lm.tools
		.filter(tool => {
			const name = tool.name.toLowerCase();
			return (
				name.startsWith('contextmanager_') ||
				name.includes('haystack') ||
				name.includes('grep') || name.includes('findtext') ||
				name.includes('semantic_search') ||
				name.includes('file_search') ||
				name.includes('read') ||
				name.includes('listdir') || name.includes('list_dir') ||
				name.includes('list_code_usages') || name.includes('codeusages') ||
				name.includes('terminal') || name.includes('run_in_terminal')
			);
		})
		.map(tool => ({
			name: tool.name,
			description: tool.description,
			inputSchema: tool.inputSchema as Record<string, unknown>,
		}));
}

// ─── Helpers ────────────────────────────────────────────────────

function _addStep(task: BackgroundTask, type: BackgroundTaskStep['type'], content: string): void {
	task.steps.push({ timestamp: Date.now(), type, content });
	// Keep steps bounded
	if (task.steps.length > 200) {
		task.steps = task.steps.slice(-150);
	}
}

function _trimTasks(): void {
	// Keep only the newest MAX_PERSISTED_TASKS
	if (_tasks.length > MAX_PERSISTED_TASKS) {
		// Remove oldest completed/failed first
		const keepable = _tasks.filter(t => t.status === 'running' || t.status === 'queued');
		const rest = _tasks.filter(t => t.status !== 'running' && t.status !== 'queued');
		_tasks = [...keepable, ...rest.slice(0, MAX_PERSISTED_TASKS - keepable.length)];
	}
}

function _persist(): void {
	if (!_context) { return; }
	// Persist tasks to disk (trim step content to keep file small)
	const toStore = _tasks.slice(0, MAX_PERSISTED_TASKS).map(t => ({
		...t,
		steps: t.steps.slice(-30), // Only persist last 30 steps
	}));
	try {
		const storagePath = _context.globalStorageUri.fsPath;
		if (!fs.existsSync(storagePath)) { fs.mkdirSync(storagePath, { recursive: true }); }
		fs.writeFileSync(path.join(storagePath, TASKS_FILE), JSON.stringify(toStore), 'utf8');
	} catch (err) {
		console.error('[BackgroundTasks] Failed to persist tasks:', err);
	}
}
