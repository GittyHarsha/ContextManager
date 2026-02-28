/**
 * Proposed API feature implementations for ContextManager.
 * All features are always-on — gated only by runtime availability checks.
 * If the VS Code build supports the API, it's used; otherwise graceful fallback.
 *
 * Features implemented:
 *  1. chatStatusItem — persistent status in chat panel
 *  2. languageModelSystem — System role for prompt messages
 *  3. onDidPerformAction — track user actions on responses
 *  4. questionCarousel — inline multi-question UI
 *  5. participantVariableProvider — custom #knowledgeCards, #cachedExplanations variables
 *  6. ChatResponseMultiDiffPart — multi-file diff views
 *  7. ChatResponseCodeblockUriPart — code blocks linked to files
 *  8. beginToolInvocation — rich tool progress streaming
 *  9. mcpServerDefinitions — discover MCP servers
 * 10. chatHooks — pre/post processing hooks
 * 11. languageModelToolSupportsModel — dynamic tool definitions
 * 12. chatSessionsProvider — TODO agent-run session history
 */

import * as vscode from 'vscode';
import { ProjectManager } from './projects/ProjectManager';
import { ExplanationCache } from './cache';
import { ConfigurationManager } from './config';

// ─── Helpers ────────────────────────────────────────────────────

function isApiAvailable(obj: any, method: string): boolean {
	return typeof obj?.[method] === 'function';
}

// ═══════════════════════════════════════════════════════════════
//  1. Chat Status Item
// ═══════════════════════════════════════════════════════════════

let chatStatusItem: vscode.ChatStatusItem | undefined;

/**
 * Create a persistent status item in the chat panel showing project stats.
 * Shows: project name, knowledge card count, cache count, TODO count.
 */
export function registerChatStatusItem(
	context: vscode.ExtensionContext,
	projectManager: ProjectManager,
	cache: ExplanationCache,
): void {
	try {
		if (!isApiAvailable(vscode.window, 'createChatStatusItem')) {
			console.log('[ContextManager] chatStatusItem API not available');
			return;
		}

		chatStatusItem = (vscode.window as any).createChatStatusItem('contextManager.status');
		chatStatusItem!.title = '$(book) ContextManager';

		const update = () => {
			if (!chatStatusItem) { return; }
			const project = projectManager.getActiveProject();
			if (project) {
				const cards = projectManager.getSelectedKnowledgeCards(project.id).length;
				const totalCards = projectManager.getKnowledgeCards(project.id).length;
				const cached = cache.getEntriesForProject(project.id).length;
				const todos = project.todos.filter(t => t.status !== 'completed').length;

				chatStatusItem.title = `$(book) ${project.name}`;
				chatStatusItem.description = `${cards}/${totalCards} cards · ${cached} cached · ${todos} TODOs`;
				chatStatusItem.detail = [
					`Project: ${project.name}`,
					project.description ? `Description: ${project.description}` : '',
					`Knowledge Cards: ${cards} selected of ${totalCards}`,
					`Cached Explanations: ${cached}`,
					`Pending TODOs: ${todos}`,
					`Context: ${projectManager.isContextEnabled(project.id) ? 'Enabled' : 'Disabled'}`,
				].filter(Boolean).join('\n');
				chatStatusItem.show();
			} else {
				chatStatusItem.title = '$(book) No Project';
				chatStatusItem.description = 'Create a project to get started';
				chatStatusItem.detail = 'Use @ctx /context or open the Dashboard to create a project';
				chatStatusItem.show();
			}
		};

		update();
		projectManager.onDidChangeActiveProject(() => update());
		projectManager.onDidChangeProjects(() => update());
		cache.onDidChangeCache(() => update());

		context.subscriptions.push({ dispose: () => chatStatusItem?.dispose() });

		console.log('[ContextManager] chatStatusItem registered');
	} catch (err) {
		console.warn('[ContextManager] Failed to register chatStatusItem:', err);
	}
}

// ═══════════════════════════════════════════════════════════════
//  2. System Messages (languageModelSystem)
// ═══════════════════════════════════════════════════════════════

/**
 * Create a system-role message if the API is available, otherwise
 * fall back to a User-role message with [SYSTEM] prefix.
 */
export function createSystemMessage(content: string): vscode.LanguageModelChatMessage {
	try {
		// System role = 3 in the proposed API
		if ((vscode.LanguageModelChatMessageRole as any).System !== undefined) {
			return new vscode.LanguageModelChatMessage(
				(vscode.LanguageModelChatMessageRole as any).System,
				content
			);
		}
	} catch { /* fallback */ }

	// Fallback: user message
	return vscode.LanguageModelChatMessage.User(`[SYSTEM INSTRUCTIONS]\n${content}`);
}

// ═══════════════════════════════════════════════════════════════
//  3. onDidPerformAction — Track User Actions
// ═══════════════════════════════════════════════════════════════

/**
 * Set up action tracking on the chat participant.
 * Logs copy/insert/apply/terminal actions for analytics and
 * optionally auto-saves applied code as knowledge cards.
 */
export function registerActionTracking(
	participant: vscode.ChatParticipant,
	projectManager: ProjectManager,
): void {
	try {
		const onAction = (participant as any).onDidPerformAction;
		if (!onAction) {
			console.log('[ContextManager] onDidPerformAction not available');
			return;
		}

		onAction.call(participant, (event: any) => {
			const action = event?.action;
			if (!action) { return; }

			const project = projectManager.getActiveProject();
			const projectName = project?.name || 'global';

			switch (action.kind) {
				case 'copy':
					console.log(`[ContextManager] User copied ${action.copiedCharacters}/${action.totalCharacters} chars (project: ${projectName})`);
					break;
				case 'insert':
					console.log(`[ContextManager] User inserted code block #${action.codeBlockIndex} (project: ${projectName})`);
					break;
				case 'apply':
					console.log(`[ContextManager] User applied code block #${action.codeBlockIndex} (project: ${projectName})`);
					break;
				case 'runInTerminal':
					console.log(`[ContextManager] User ran code block #${action.codeBlockIndex} in terminal (project: ${projectName})`);
					break;
				case 'followUp':
					console.log(`[ContextManager] User followed up with: ${action.followup?.prompt || '(empty)'}`);
					break;
				case 'command':
					console.log(`[ContextManager] User clicked command button: ${action.commandButton?.command?.command}`);
					break;
			}
		});

		console.log('[ContextManager] onDidPerformAction tracking registered');
	} catch (err) {
		console.warn('[ContextManager] Failed to register action tracking:', err);
	}
}

// ═══════════════════════════════════════════════════════════════
//  4. Question Carousel
// ═══════════════════════════════════════════════════════════════

/**
 * Show an inline question carousel in the chat response.
 * Returns the user's answers, or undefined if skipped/unavailable.
 */
export async function showQuestionCarousel(
	stream: vscode.ChatResponseStream,
	questions: Array<{
		id: string;
		title: string;
		type: 'text' | 'single' | 'multi';
		options?: Array<{ id: string; label: string; value: unknown }>;
		defaultValue?: string | string[];
		message?: string;
	}>,
	allowSkip = true,
): Promise<Record<string, unknown> | undefined> {
	if (!isApiAvailable(stream, 'questionCarousel')) {
		return undefined;
	}

	try {
		const typeMap: Record<string, number> = { text: 1, single: 2, multi: 3 };

		const chatQuestions = questions.map(q => {
			const opts = q.options?.map(o => ({
				id: o.id,
				label: o.label,
				value: o.value,
			}));

			// Use the ChatQuestion constructor
			const ChatQuestion = (vscode as any).ChatQuestion;
			const ChatQuestionType = (vscode as any).ChatQuestionType;

			if (ChatQuestion && ChatQuestionType) {
				return new ChatQuestion(q.id, typeMap[q.type] || 1, q.title, {
					message: q.message,
					options: opts,
					defaultValue: q.defaultValue,
				});
			}
			return { id: q.id, type: typeMap[q.type] || 1, title: q.title, options: opts, defaultValue: q.defaultValue };
		});

		return await (stream as any).questionCarousel(chatQuestions, allowSkip);
	} catch (err) {
		console.warn('[ContextManager] questionCarousel failed:', err);
		return undefined;
	}
}

// ═══════════════════════════════════════════════════════════════
//  5. Participant Variable Provider (#contextCard, #todoList, etc.)
// ═══════════════════════════════════════════════════════════════

/**
 * Register custom chat variables that users can reference with # syntax.
 * Provides: #knowledgeCards, #cachedExplanations, and individual #card:Title variables
 */
export function registerVariableProvider(
	participant: vscode.ChatParticipant,
	projectManager: ProjectManager,
	cache: ExplanationCache,
): void {
	try {
		if (!('participantVariableProvider' in participant)) {
			console.log('[ContextManager] participantVariableProvider not available on participant');
			return;
		}

		(participant as any).participantVariableProvider = {
			triggerCharacters: ['#'],
			provider: {
				async provideCompletionItems(query: string, _token: vscode.CancellationToken) {
					const items: any[] = [];
					const activeProject = projectManager.getActiveProject();
					const q = query.toLowerCase();

					// Static variables
					const staticVars = [
						{
							id: 'knowledgeCards',
							label: 'knowledgeCards',
							icon: new vscode.ThemeIcon('note'),
							detail: 'All selected knowledge cards',
							values: () => {
								if (!activeProject) { return [{ level: 1, value: 'No active project' }]; }
								const cards = projectManager.getSelectedKnowledgeCards(activeProject.id);
								if (!cards.length) { return [{ level: 1, value: 'No cards selected' }]; }
								const content = cards.map(c => `## ${c.title} [${c.category}]\n${c.content}`).join('\n\n');
								return [{ level: 3, value: content }];
							},
						},
						{
							id: 'cachedExplanations',
							label: 'cachedExplanations',
							icon: new vscode.ThemeIcon('archive'),
							detail: 'All selected cached explanations',
							values: () => {
								if (!activeProject) { return [{ level: 1, value: 'No active project' }]; }
								const entries = cache.getSelectedEntries(activeProject.id);
								if (!entries.length) { return [{ level: 1, value: 'No cache entries selected' }]; }
								const content = entries.map(e => `## ${e.symbolName} [${e.type}]\n${e.content}`).join('\n\n');
								return [{ level: 3, value: content }];
							},
						},
					];

					// Filter by query
					for (const v of staticVars) {
						if (!q || v.id.toLowerCase().includes(q) || v.label.toLowerCase().includes(q)) {
							const ChatCompletionItem = (vscode as any).ChatCompletionItem;
							if (ChatCompletionItem) {
								items.push(new ChatCompletionItem(v.id, v.label, v.values()));
								const last = items[items.length - 1];
								last.icon = v.icon;
								last.detail = v.detail;
								last.fullName = `ContextManager ${v.label}`;
							}
						}
					}

					// Dynamic: individual knowledge cards
					if (activeProject) {
						const cards = projectManager.getKnowledgeCards(activeProject.id);
						for (const card of cards) {
							const cardLabel = `card:${card.title}`;
							if (!q || cardLabel.toLowerCase().includes(q) || card.title.toLowerCase().includes(q)) {
								const ChatCompletionItem = (vscode as any).ChatCompletionItem;
								if (ChatCompletionItem) {
									const item = new ChatCompletionItem(
										`card-${card.id}`,
										cardLabel,
										[{ level: 3, value: card.content }]
									);
									item.icon = new vscode.ThemeIcon('note');
									item.detail = `[${card.category}] ${card.content.substring(0, 80)}...`;
									item.fullName = card.title;
									items.push(item);
								}
							}
						}
					}

					return items;
				},
			},
		};

		console.log('[ContextManager] participantVariableProvider registered');
	} catch (err) {
		console.warn('[ContextManager] Failed to register variable provider:', err);
	}
}

// ═══════════════════════════════════════════════════════════════
//  6 & 7. Code Block URI & Multi-Diff Parts
// ═══════════════════════════════════════════════════════════════

/**
 * Emit a codeblockUri linking a code block in the response to a source file.
 */
export function emitCodeblockUri(stream: vscode.ChatResponseStream, uri: vscode.Uri, isEdit = false): void {
	if (!isApiAvailable(stream, 'codeblockUri')) { return; }
	try {
		(stream as any).codeblockUri(uri, isEdit);
	} catch (err) {
		console.warn('[ContextManager] codeblockUri failed:', err);
	}
}

/**
 * Emit a reference2 with status information.
 */
export function emitReference2(
	stream: vscode.ChatResponseStream,
	value: vscode.Uri | vscode.Location | string,
	iconPath?: vscode.Uri | vscode.ThemeIcon,
	status?: { description: string; kind: number },
): void {
	if (!isApiAvailable(stream, 'reference2')) { return; }
	try {
		(stream as any).reference2(value, iconPath, status ? { status } : undefined);
	} catch { /* ignore */ }
}

// ═══════════════════════════════════════════════════════════════
//  8. Tool Invocation Streaming
// ═══════════════════════════════════════════════════════════════

/**
 * Begin a tool invocation progress indicator in the chat response.
 * Returns a unique toolCallId for later updates.
 */
export function beginToolInvocation(
	stream: vscode.ChatResponseStream,
	toolName: string,
	toolCallId: string,
): boolean {
	if (!isApiAvailable(stream, 'beginToolInvocation')) {
		return false;
	}
	try {
		(stream as any).beginToolInvocation(toolCallId, toolName);
		return true;
	} catch {
		return false;
	}
}

/**
 * Update an active tool invocation with new status data.
 */
export function updateToolInvocation(
	stream: vscode.ChatResponseStream,
	toolCallId: string,
	data: { partialInput?: unknown },
): void {
	if (!isApiAvailable(stream, 'updateToolInvocation')) { return; }
	try {
		(stream as any).updateToolInvocation(toolCallId, data);
	} catch { /* ignore */ }
}

// ═══════════════════════════════════════════════════════════════
//  9. MCP Server Definitions Discovery
// ═══════════════════════════════════════════════════════════════

/**
 * Get list of available MCP server definitions.
 * Can be surfaced in /context or dashboard.
 */
export function getMcpServerDefinitions(): Array<{ label: string }> {
	try {
		const defs = (vscode.lm as any).mcpServerDefinitions;
		if (Array.isArray(defs)) {
			return defs.map((d: any) => ({ label: d.label || 'Unknown' }));
		}
	} catch { /* ignore */ }
	return [];
}

/**
 * Register a listener for MCP server definition changes.
 */
export function onMcpServerDefinitionsChanged(callback: () => void): vscode.Disposable | undefined {
	try {
		const event = (vscode.lm as any).onDidChangeMcpServerDefinitions;
		if (event) {
			return event(callback);
		}
	} catch { /* ignore */ }
	return undefined;
}

// ═══════════════════════════════════════════════════════════════
// 10. Chat Hooks
// ═══════════════════════════════════════════════════════════════

/**
 * Register pre/post processing hooks on the chat participant.
 * - SessionStart: initialize session continuity, prepare context
 * - UserPromptSubmit: inject intelligence + session continuity context
 * - ModelResponse: capture exchange + auto-capture observations + card queue detection
 */
/** Stashed prompt from UserPromptSubmit hook — paired with ModelResponse */
let _lastSubmittedPrompt = '';
/** Stashed participant from UserPromptSubmit — used by ModelResponse */
let _lastSubmittedParticipant = '';

export function registerChatHooks(
	participant: vscode.ChatParticipant,
	context: vscode.ExtensionContext,
	projectManager: ProjectManager,
	autoCapture?: import('./autoCapture').AutoCaptureService,
): void {
	try {
		if (!('chatHooks' in participant)) {
			console.log('[ContextManager] chatHooks not available');
			return;
		}

		(participant as any).chatHooks = [
			{
				hookTypes: ['SessionStart'],
				command: {
					command: 'contextManager.experimental.onSessionStart',
					title: 'ContextManager Session Start Hook',
				},
			},
			{
				hookTypes: ['UserPromptSubmit'],
				command: {
					command: 'contextManager.experimental.onPromptSubmit',
					title: 'ContextManager Prompt Hook',
				},
			},
			{
				hookTypes: ['ModelResponse'],
				command: {
					command: 'contextManager.experimental.onModelResponse',
					title: 'ContextManager Response Hook',
				},
			},
		];

		// Register hook command handlers
		context.subscriptions.push(
			vscode.commands.registerCommand('contextManager.experimental.onSessionStart', async (_hookData: any) => {
				const project = projectManager.getActiveProject();
				console.log(`[ContextManager] Chat session started (project: ${project?.name || 'none'})`);

				return undefined; // no modification
			}),
			vscode.commands.registerCommand('contextManager.experimental.onPromptSubmit', async (hookData: any) => {
				const project = projectManager.getActiveProject();
				if (!project || !hookData?.prompt) {
					return undefined;
				}

				// Stash the user's prompt + participant for ModelResponse pairing
				_lastSubmittedPrompt = hookData.prompt;
				_lastSubmittedParticipant = hookData.participant || '';

				// Intelligence is now delivered via copilot-instructions.md managed block
				// and the #ctx tool — no per-prompt injection needed.
				return undefined;
			}),
			vscode.commands.registerCommand('contextManager.experimental.onModelResponse', (hookData: any) => {
				// Capture model response from ANY chat participant (including normal Copilot)
				// This gives the background agent context from the user's last interaction
				try {
					const { setLastChatExchange } = require('./backgroundTasks');
					const responseText = hookData?.response || hookData?.text || '';
					const promptText = _lastSubmittedPrompt || hookData?.prompt || '';
					const participant = _lastSubmittedParticipant || '';

					if (promptText || responseText) {
						const exchange = [
							promptText ? `User: ${promptText}` : '',
							responseText ? `Assistant: ${(typeof responseText === 'string'
								? responseText : JSON.stringify(responseText)).substring(0, 3000)}` : '',
						].filter(Boolean).join('\n\n');
						setLastChatExchange(exchange);
						console.log(`[ContextManager] ModelResponse captured (${exchange.length} chars)`);
					}

					// ── Auto-Capture: record observation + optional learning ──
					if (autoCapture && (promptText || responseText)) {
						const responseStr = typeof responseText === 'string'
							? responseText : JSON.stringify(responseText);
						autoCapture.onModelResponse(promptText, responseStr, participant)
							.catch(() => { /* fire-and-forget */ });
					}

					// Card queue capture is handled exclusively by HookWatcher (Stop hook)
					// which provides full untruncated response + tool calls.
					// ProposedApi ModelResponse is truncated by VS Code API (~2000 chars)
					// so we don't use it for card queue.

					_lastSubmittedPrompt = '';
					_lastSubmittedParticipant = '';
				} catch { /* non-critical */ }
				return undefined;
			}),
		);

		console.log('[ContextManager] chatHooks registered' +
			(autoCapture ? ' [auto-capture]' : ''));
	} catch (err) {
		console.warn('[ContextManager] Failed to register chat hooks:', err);
	}
}

// ═══════════════════════════════════════════════════════════════
// 11. Dynamic Tool Registration (languageModelToolSupportsModel)
// ═══════════════════════════════════════════════════════════════

/**
 * Register per-project dynamic tools that expose individual knowledge cards
 * and TODOs as separate tool definitions. These tools are model-aware.
 */
export function registerDynamicTools(
	context: vscode.ExtensionContext,
	projectManager: ProjectManager,
	cache: ExplanationCache,
): void {
	try {
		const registerToolDef = (vscode.lm as any).registerToolDefinition;
		if (!registerToolDef) {
			console.log('[ContextManager] registerToolDefinition not available');
			return;
		}

		const disposables: vscode.Disposable[] = [];

		const refreshTools = () => {
			// Dispose previous registrations
			disposables.forEach(d => d.dispose());
			disposables.length = 0;

			const project = projectManager.getActiveProject();
			if (!project) { return; }

			// Register a tool for getting knowledge cards by category
			const cardTool: any = {
				name: 'contextManager_getKnowledgeCardsByCategory',
				displayName: 'Get Knowledge Cards by Category',
			description: `Get knowledge cards from project "${project.name}" filtered by category. Available categories: architecture, pattern, convention, explanation, note, other. Supports three detail levels: "index" (titles+IDs only), "summary" (titles+first 500 chars), "full" (complete content).`,
			toolReferenceName: 'knowledgeByCategory',
			inputSchema: {
				type: 'object',
				properties: {
					category: {
						type: 'string',
						description: 'The category to filter by',
						enum: ['architecture', 'pattern', 'convention', 'explanation', 'note', 'other'],
					},
					detail: {
						type: 'string',
						description: 'Level of detail to return: "index" (titles+categories+IDs), "summary" (titles+first 500 chars), or "full" (complete content). Default: "full".',
						enum: ['index', 'summary', 'full'],
					},
				},
			},
		};

		try {
			const d = registerToolDef.call(vscode.lm, cardTool, {
				async invoke(options: any) {
					const category = options?.input?.category;
					const detail = options?.input?.detail || 'full';
					const cards = projectManager.getKnowledgeCards(project.id)
						.filter((c: any) => !category || c.category === category);
					
					if (cards.length === 0) {
						const text = `No knowledge cards found${category ? ` in category "${category}"` : ''}.`;
						return new vscode.LanguageModelToolResult([
							new vscode.LanguageModelTextPart(text),
						]);
					}

					let text = '';
					if (detail === 'index') {
						// Index mode: titles + categories + IDs only
						text = cards.map((c: any) => 
							`- **${c.title}** [${c.category}]${c.pinned ? ' [pinned]' : ''} — ID: \`${c.id}\``
						).join('\n');
					} else if (detail === 'summary') {
						// Summary mode: titles + first 500 characters
						text = cards.map((c: any) => {
							const summary = c.content.length > 500 
								? c.content.slice(0, 500) + '…' 
								: c.content;
							return `## ${c.title} [${c.category}]\n${summary}`;
						}).join('\n\n');
					} else {
						// Full mode: complete content (original behavior)
						text = cards.map((c: any) => `## ${c.title} [${c.category}]\n${c.content}`).join('\n\n');
					}

					return new vscode.LanguageModelToolResult([
						new vscode.LanguageModelTextPart(text),
					]);
				},
				async prepareInvocation() {
					return { invocationMessage: `Looking up knowledge cards...` };
				},
			});
			if (d) { disposables.push(d); }
			} catch { /* ignore */ }

			// Register a tool for getting TODO status
			const todoTool: any = {
				name: 'contextManager_getTodoStatus',
				displayName: 'Get TODO Status',
				description: `Get the status of all TODOs in project "${project.name}". Returns pending, in-progress, and completed items.`,
				toolReferenceName: 'todoStatus',
				inputSchema: {
					type: 'object',
					properties: {
						status: {
							type: 'string',
							description: 'Filter by status',
							enum: ['pending', 'in-progress', 'completed', 'all'],
						},
					},
				},
			};

			try {
				const d = registerToolDef.call(vscode.lm, todoTool, {
					async invoke(options: any) {
						const statusFilter = options?.input?.status || 'all';
						const todos = project.todos.filter((t: any) =>
							statusFilter === 'all' || t.status === statusFilter
						);
						const text = todos.length
							? todos.map((t: any) => {
								const icon = t.status === 'completed' ? '✅' : t.status === 'in-progress' ? '🔄' : '⬜';
								return `${icon} **${t.title}** [${t.priority || 'medium'}] — ${t.status}${t.description && t.description !== t.title ? '\n  ' + t.description : ''}`;
							}).join('\n')
							: 'No TODOs found.';
						return new vscode.LanguageModelToolResult([
							new vscode.LanguageModelTextPart(text),
						]);
					},
					async prepareInvocation() {
						return { invocationMessage: 'Checking TODO status...' };
					},
				});
				if (d) { disposables.push(d); }
			} catch { /* ignore */ }
		};

		// Initial registration and refresh on changes
		refreshTools();
		projectManager.onDidChangeActiveProject(() => refreshTools());
		projectManager.onDidChangeProjects(() => refreshTools());

		context.subscriptions.push({ dispose: () => disposables.forEach(d => d.dispose()) });

		console.log('[ContextManager] Dynamic tools registered');
	} catch (err) {
		console.warn('[ContextManager] Failed to register dynamic tools:', err);
	}
}

// ═══════════════════════════════════════════════════════════════
// 12. Chat Sessions Provider (TODO Agent Run & Branch Session History)
// ═══════════════════════════════════════════════════════════════

const CTX_SESSION_SCHEME = 'ctx-session';
const CTX_SESSION_TYPE = 'ctx-sessions';

/**
 * Register a chat session provider that surfaces TODO agent runs
 * and branch sessions as browsable session items in the chat sidebar.
 *
 * Uses v3 chatSessionsProvider API:
 *  - `chatSessions` contribution point in package.json
 *  - `registerChatSessionItemProvider(type, provider)` with `onDidChangeChatSessionItems`
 *  - `registerChatSessionContentProvider(scheme, contentProvider, participant)`
 *  - `ChatSessionItem.resource` (Uri) instead of `id` (string)
 *  - `ChatSessionItem.timing` for timestamps
 */
export function registerChatSessionsProvider(
	participant: vscode.ChatParticipant,
	context: vscode.ExtensionContext,
	projectManager: ProjectManager,
): void {
	try {
		const registerProvider = (vscode.chat as any).registerChatSessionItemProvider;
		if (!registerProvider) {
			console.log('[ContextManager] chatSessionsProvider API not available');
			return;
		}

		// Event emitter so we can signal the UI to refresh
		const _onDidChange = new vscode.EventEmitter<void>();

		// Refresh whenever projects change (new TODO runs, branch sessions, etc.)
		projectManager.onDidChangeProjects(() => _onDidChange.fire());

		// Status mapping (v3: Failed=0, Completed=1, InProgress=2)
		const statusMap: Record<string, number> = {
			'completed': 1,
			'failed': 0,
			'cancelled': 0,
			'running': 2,
			'paused': 2,
		};

		/**
		 * Build a deterministic URI for a session item.
		 * Format: ctx-session://<projectId>/<type>/<id>
		 */
		function makeUri(projectId: string, type: string, id: string): vscode.Uri {
			return vscode.Uri.from({ scheme: CTX_SESSION_SCHEME, authority: projectId, path: `/${type}/${id}` });
		}

		const provider = {
			onDidChangeChatSessionItems: _onDidChange.event,

			provideChatSessionItems(_token: vscode.CancellationToken) {
				const items: any[] = [];
				const allProjects = projectManager.getAllProjects();

				for (const project of allProjects) {
					// ── TODO Agent Runs ──
					for (const todo of project.todos) {
						if (!todo.agentRuns?.length) { continue; }
						const latestRun = todo.agentRuns[todo.agentRuns.length - 1];

						items.push({
							resource: makeUri(project.id, 'todo', todo.id),
							label: todo.title,
							description: `${project.name} · ${todo.agentRuns.length} run(s)`,
							tooltip: todo.description || todo.title,
							iconPath: new vscode.ThemeIcon(
								latestRun.status === 'completed' ? 'check' :
								latestRun.status === 'failed' ? 'error' :
								latestRun.status === 'running' ? 'sync~spin' : 'circle-outline'
							),
							status: statusMap[latestRun.status] ?? 2,
							timing: {
								created: todo.created,
								lastRequestStarted: latestRun.startTime,
								lastRequestEnded: latestRun.endTime,
							},
							metadata: {
								projectId: project.id,
								todoId: todo.id,
								runCount: todo.agentRuns.length,
								type: 'todo',
							},
						});
					}

					// ── Branch Sessions (removed) ──
				}

				// Sort by most recent activity
				items.sort((a: any, b: any) => {
					const aTime = a.timing?.lastRequestStarted || a.timing?.created || 0;
					const bTime = b.timing?.lastRequestStarted || b.timing?.created || 0;
					return bTime - aTime;
				});

				return items;
			},
		};

		context.subscriptions.push(
			registerProvider.call(vscode.chat, CTX_SESSION_TYPE, provider)
		);

		// Register content provider so clicking a session can open it
		const registerContentProvider = (vscode.chat as any).registerChatSessionContentProvider;
		if (registerContentProvider) {
			const contentProvider = {
				provideChatSessionContent(resource: vscode.Uri, _token: vscode.CancellationToken) {
					// Parse the URI to determine what to show
					const projectId = resource.authority;
					const pathParts = resource.path.split('/').filter(Boolean);
					const type = pathParts[0]; // 'todo' or 'branch'
					const id = pathParts[1];

					// Build a read-only session with the conversation history
					const history: any[] = [];

					if (type === 'todo') {
						const project = projectManager.getProject(projectId);
						const todo = project?.todos.find(t => t.id === id);
						if (todo?.agentRuns?.length) {
							const latestRun = todo.agentRuns[todo.agentRuns.length - 1];
							// Add the task as a request turn
							history.push(
								vscode.LanguageModelChatMessage.User(`/todo ${todo.title}${todo.description ? '\n\n' + todo.description : ''}`),
							);
							if (latestRun.lastResponseText) {
								history.push(
									vscode.LanguageModelChatMessage.Assistant(latestRun.lastResponseText),
								);
							}
						}
					} else if (type === 'branch') {
						// Branch sessions removed — no content to provide
					}

					return {
						history,
						requestHandler: undefined, // read-only
					};
				},
			};

			context.subscriptions.push(
				registerContentProvider.call(vscode.chat, CTX_SESSION_TYPE, contentProvider, participant)
			);
		}

		context.subscriptions.push(_onDidChange);
		console.log('[ContextManager] chatSessionsProvider v3 registered');
	} catch (err) {
		console.warn('[ContextManager] Failed to register chat sessions provider:', err);
	}
}

// ═══════════════════════════════════════════════════════════════
//  Token Usage Reporting
// ═══════════════════════════════════════════════════════════════

/**
 * Report token usage via stream.usage() if available.
 */
export function reportUsage(
	stream: vscode.ChatResponseStream,
	promptTokens: number,
	completionTokens: number,
): void {
	if (!isApiAvailable(stream, 'usage')) { return; }
	try {
		(stream as any).usage({ promptTokens, completionTokens });
	} catch { /* ignore */ }
}

// ═══════════════════════════════════════════════════════════════
//  Warning Part
// ═══════════════════════════════════════════════════════════════

/**
 * Emit a warning badge in the chat response if available,
 * otherwise fall back to markdown text.
 */
export function emitWarning(stream: vscode.ChatResponseStream, message: string): void {
	if (isApiAvailable(stream, 'warning')) {
		try {
			(stream as any).warning(message);
			return;
		} catch { /* fallback */ }
	}
	stream.markdown(`\n> ⚠️ ${message}\n\n`);
}

// ═══════════════════════════════════════════════════════════════
//  Thinking Progress
// ═══════════════════════════════════════════════════════════════

/**
 * Emit a thinking progress indicator if available.
 */
export function emitThinkingProgress(
	stream: vscode.ChatResponseStream,
	message: string,
): void {
	try {
		const ChatResponseThinkingProgressPart = (vscode as any).ChatResponseThinkingProgressPart;
		if (ChatResponseThinkingProgressPart && isApiAvailable(stream, 'push')) {
			(stream as any).push(new ChatResponseThinkingProgressPart(message));
		}
	} catch { /* ignore */ }
}

// ═══════════════════════════════════════════════════════════════
//  MCP Server Context for /context command
// ═══════════════════════════════════════════════════════════════

/**
 * Format MCP server information for display in /context.
 */
export function getMcpServerContextSection(): string {
	const servers = getMcpServerDefinitions();
	if (!servers.length) { return ''; }
	return `## MCP Servers (${servers.length})\n` +
		servers.map(s => `- ${s.label}`).join('\n');
}
