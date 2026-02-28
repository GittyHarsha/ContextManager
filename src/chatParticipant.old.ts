/**
 * Chat participant handler — uses @vscode/prompt-tsx for proper prompt rendering
 * and tool calling following the official vscode-copilot-chat pattern.
 */
import { renderPrompt } from '@vscode/prompt-tsx';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ExplanationCache, generateCacheKey } from './cache';
import { ConfigurationManager } from './config';
import { ProjectManager } from './projects/ProjectManager';
import { AgentRun, SerializedMessage, Todo } from './projects/types';
import {
	ChatPrompt,
	AnalysisPrompt,
	KnowledgePrompt,
	RefineKnowledgePrompt,
	TodoPrompt,
	ToolCallRound,
	ToolResultMeta,
	ExplainerMetadata,
	AnalysisCommand,
} from './prompts/index';
import {
	registerActionTracking,
	registerVariableProvider,
	registerChatHooks,
	registerChatSessionsProvider,
	beginToolInvocation,
	updateToolInvocation,
	emitCodeblockUri,
	showQuestionCarousel,
	emitWarning,
	emitThinkingProgress,
	getMcpServerContextSection,
} from './proposedApi';
import { runAutoLearn } from './autoLearn';
import * as bgTasks from './backgroundTasks';
import { setLastChatExchange } from './backgroundTasks';

const PARTICIPANT_ID = 'context-manager.ctx';

// ─── Helpers ────────────────────────────────────────────────────

async function getCopilotInstructions(): Promise<string | undefined> {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders) { return undefined; }
	for (const folder of workspaceFolders) {
		const uri = vscode.Uri.joinPath(folder.uri, '.github/copilot-instructions.md');
		try {
			const doc = await vscode.workspace.openTextDocument(uri);
			return doc.getText();
		} catch { /* not found */ }
	}
	return undefined;
}

function getWorkspacePaths(projectManager: ProjectManager): string[] {
	const activeProject = projectManager.getActiveProject();
	if (activeProject?.rootPaths?.length) {
		return activeProject.rootPaths;
	}
	const folders = vscode.workspace.workspaceFolders;
	return folders?.map(f => f.uri.fsPath) ?? [];
}

async function getProjectContext(
	projectManager: ProjectManager,
	cache: ExplanationCache
): Promise<string> {
	const activeProject = projectManager.getActiveProject();
	if (!activeProject || !projectManager.isContextEnabled(activeProject.id)) {
		return '';
	}
	return await projectManager.getFullProjectContext(activeProject.id, cache) || '';
}

/**
 * Get branch context for prompt injection.
 * Returns the branch session context string if the current branch is tracked.
 */
async function getBranchContext(projectManager: ProjectManager): Promise<string> {
	const activeProject = projectManager.getActiveProject();
	if (!activeProject) { return ''; }
	return await projectManager.getBranchContextString(activeProject.id);
}

/**
 * Auto-save branch session after agent runs complete.
 * Captures current git state, the full task description, and optionally
 * extracts the last AI response as currentState.
 * If autoBootstrap is enabled and no session exists, creates the first one.
 */
async function autoSaveBranchSession(
	projectManager: ProjectManager,
	requestPrompt: string,
	chatContext?: vscode.ChatContext,
): Promise<void> {
	if (!ConfigurationManager.branchAutoCapture) { return; }
	const activeProject = projectManager.getActiveProject();
	if (!activeProject) { return; }

	const branchCtx = await projectManager.getActiveBranchContext(activeProject.id);

	if (!branchCtx || !branchCtx.session) {
		// Auto-bootstrap: create first session if setting enabled
		if (ConfigurationManager.branchAutoBootstrap && branchCtx?.branch) {
			await projectManager.saveBranchSession(activeProject.id, branchCtx.branch, {
				task: requestPrompt,
			});
		}
		return;
	}

	// Only update the latest existing session — never create a new one from auto-save.
	// New sessions are created by: auto-bootstrap (above), agent tool save/checkpoint, or manual save.
	const latestSession = projectManager.getLatestBranchSession(activeProject.id, branchCtx.branch);
	if (!latestSession) { return; }

	// Build session update
	const sessionUpdate: Partial<Record<string, any>> = {
		task: requestPrompt,
	};

	// If autoCaptureSessions enabled, extract last AI response as currentState
	if (ConfigurationManager.branchAutoCaptureSessions && chatContext) {
		for (let i = chatContext.history.length - 1; i >= 0; i--) {
			const turn = chatContext.history[i];
			if (turn instanceof vscode.ChatResponseTurn) {
				const textParts: string[] = [];
				for (const part of turn.response) {
					if (part instanceof vscode.ChatResponseMarkdownPart) {
						textParts.push(part.value.value);
					}
				}
				if (textParts.length > 0) {
					const fullResponse = textParts.join('');
					// Take first sentence, or first 500 chars
					const firstSentence = fullResponse.match(/^[^.!?\n]+[.!?]/)?.[0];
					sessionUpdate.currentState = firstSentence || (fullResponse.slice(0, 500) + (fullResponse.length > 500 ? '\u2026' : ''));
					break;
				}
			}
		}
	}

	await projectManager.saveBranchSession(activeProject.id, branchCtx.branch, sessionUpdate);
}

/**
 * Returns a focused set of tools for chat and analysis commands.
 * Includes search/read tools + our custom ContextManager tools,
 * but excludes unrelated extension tools that would bloat the token budget.
 * /todo uses vscode.lm.tools (ALL tools) for full autonomous capability.
 */
function getAgentTools(): vscode.LanguageModelToolInformation[] {
	return vscode.lm.tools.filter(tool => {
		const name = tool.name.toLowerCase();
		return (
			// Search tools
			name.includes('haystack') ||
			name.includes('grep') || name.includes('findtext') ||
			name.includes('semantic_search') ||
			name.includes('file_search') ||
			// Read tools
			name.includes('read') ||
			// Directory tools
			name.includes('listdir') || name.includes('list_dir') ||
			// Our own tools
			name.startsWith('contextmanager_') ||
			// Code navigation
			name.includes('list_code_usages') || name.includes('codeusages') ||
			// Terminal (for running tests, checking build)
			name.includes('terminal') || name.includes('run_in_terminal')
		);
	});
}

/**
 * Deselect all selected context (knowledge cards and cache entries) after use,
 * if the auto-deselect setting is enabled.
 */
async function deselectContextAfterUse(
	projectManager: ProjectManager,
	cache: ExplanationCache
): Promise<void> {
	if (!ConfigurationManager.contextAutoDeselectAfterUse) {
		return;
	}

	const activeProject = projectManager.getActiveProject();
	if (!activeProject) {
		return;
	}

	// Deselect all knowledge cards
	const selectedCards = projectManager.getSelectedCardIds(activeProject.id);
	if (selectedCards.length > 0) {
		await projectManager.deselectAllCards(activeProject.id);
	}

	// Deselect all cache entries
	const selectedCacheIds = cache.getSelectedEntryIds(activeProject.id);
	if (selectedCacheIds.length > 0) {
		cache.deselectAllEntries(activeProject.id);
	}
}

// ─── Generic tool-calling loop ──────────────────────────────────
// This is the core pattern from the official chat-sample.
// renderPrompt builds messages → sendRequest → collect tool calls →
// re-render prompt (which invokes tools during render) → loop.

interface ToolLoopOptions<P> {
	PromptComponent: any;
	promptProps: P;
	model: vscode.LanguageModelChat;
	tools: vscode.LanguageModelToolInformation[];
	stream: vscode.ChatResponseStream;
	token: vscode.CancellationToken;
	toolReferences?: vscode.ChatLanguageModelToolReference[];
	onIteration?: (iterationCount: number, toolCalls: vscode.LanguageModelToolCallPart[]) => Promise<void>;
}

interface ToolLoopResult {
	fullResponse: string;
	/** Only the final model response (after all tool calls are done) — no thinking tokens */
	lastResponse: string;
	toolCallRounds: ToolCallRound[];
	toolCallResults: Record<string, vscode.LanguageModelToolResult>;
}

const SAFETY_ITERATION_LIMIT = 200; // Only to prevent infinite loops from bugs

async function runToolCallingLoop<P>(options: ToolLoopOptions<P>): Promise<ToolLoopResult> {
	const {
		PromptComponent, model, tools, stream, token, onIteration,
	} = options;
	const { promptProps } = options;

	const toolCallRounds: ToolCallRound[] = [];
	const accumulatedToolResults: Record<string, vscode.LanguageModelToolResult> = {};
	const toolReferences = [...(options.toolReferences ?? [])];
	let fullResponse = '';
	let lastResponse = '';

	const sendOptions: vscode.LanguageModelChatRequestOptions = {
		justification: 'To answer your question about the codebase',
	};

	let referencesEmitted = false;

	for (let iteration = 0; iteration < SAFETY_ITERATION_LIMIT; iteration++) {
		// Check cancellation before each iteration
		if (token.isCancellationRequested) { break; }

		// 1. Render the prompt (this invokes tools from previous rounds during render)
		const result = await renderPrompt(
			PromptComponent,
			{
				...promptProps,
				toolCallRounds,
				toolCallResults: accumulatedToolResults,
			} as any,
			{ modelMaxPromptTokens: model.maxInputTokens },
			model,
		);

		const messages = result.messages;

		// Emit references from the rendered prompt (only once, deduplicated)
		if (!referencesEmitted) {
			const seen = new Set<string>();
			result.references.forEach(ref => {
				if (ref.anchor instanceof vscode.Uri || ref.anchor instanceof vscode.Location) {
					const key = ref.anchor instanceof vscode.Uri
						? ref.anchor.toString()
						: `${ref.anchor.uri.toString()}#${ref.anchor.range.start.line}`;
					if (!seen.has(key)) {
						seen.add(key);
						stream.reference(ref.anchor);
					}
				}
			});
			referencesEmitted = true;
		}

		// Collect tool result metadata from this render pass
		const toolResultMetadata = result.metadatas.getAll(ToolResultMeta);
		if (toolResultMetadata?.length) {
			toolResultMetadata.forEach(meta => accumulatedToolResults[meta.toolCallId] = meta.result);
		}

		// 2. Handle forced tool references (e.g. user explicitly picked a tool)
		const requestedTool = toolReferences.shift();
		if (requestedTool) {
			sendOptions.toolMode = vscode.LanguageModelChatToolMode.Required;
			sendOptions.tools = vscode.lm.tools.filter(t => t.name === requestedTool.name);
		} else {
			sendOptions.toolMode = undefined;
			sendOptions.tools = tools.length > 0 ? [...tools] : undefined;
		}

		// 3. Send request to the model
		const response = await model.sendRequest(messages, sendOptions, token);

		// 4. Stream text and collect tool calls
		const toolCalls: vscode.LanguageModelToolCallPart[] = [];
		let responseStr = '';

		for await (const part of response.stream) {
			if (part instanceof vscode.LanguageModelTextPart) {
				stream.markdown(part.value);
				responseStr += part.value;
			} else if (part instanceof vscode.LanguageModelToolCallPart) {
				toolCalls.push(part);
			}
		}

		fullResponse += responseStr;
		lastResponse = responseStr; // always overwrite — final iteration is the answer

		// Notify caller of iteration progress
		if (onIteration) {
			await onIteration(iteration, toolCalls);
		}

		// 5. If no tool calls, we're done
		if (!toolCalls.length) {
			break;
		}

		// 5b. Emit tool invocation progress (proposed API)
		for (const tc of toolCalls) {
			beginToolInvocation(stream, tc.name, tc.callId);
		}

		// 5c. Emit thinking progress to show the user what we're doing
		const toolNames = toolCalls.map(tc => tc.name.replace(/^contextManager_/, '').replace(/^haystack/i, 'search'));
		emitThinkingProgress(stream, `Round ${iteration + 1}: calling ${toolNames.join(', ')}...`);

		// 6. Record this round — next renderPrompt will invoke the tools
		toolCallRounds.push({ response: responseStr, toolCalls });
	}

	return { fullResponse, lastResponse, toolCallRounds, toolCallResults: accumulatedToolResults };
}

// ─── Main handler ───────────────────────────────────────────────

export function registerChatParticipant(
	context: vscode.ExtensionContext,
	cache: ExplanationCache,
	projectManager: ProjectManager
) {
	const handler: vscode.ChatRequestHandler = async (
		request: vscode.ChatRequest,
		chatContext: vscode.ChatContext,
		stream: vscode.ChatResponseStream,
		token: vscode.CancellationToken
	): Promise<ExplainerMetadata> => {

		const command = request.command || 'chat';
		const activeProject = projectManager.getActiveProject();

		// ── Banner ──
		if (command !== 'context') {
			if (activeProject) {
				const contextEnabled = projectManager.isContextEnabled(activeProject.id);
				const selectedCards = projectManager.getSelectedKnowledgeCards(activeProject.id);
				const selectedCacheEntries = cache.getSelectedEntries(activeProject.id);
				const totalCacheCount = cache.getEntriesForProject(activeProject.id).length;
				stream.markdown(
					`> 📚 **Project:** ${activeProject.name} | ` +
					`${contextEnabled ? '✓' : '✗'} context | ` +
					`📝 ${selectedCards.length} cards | ` +
					`💾 ${selectedCacheEntries.length}/${totalCacheCount} cached\n\n`
				);
			} else {
				const globalCacheEntries = cache.getEntriesForProject(undefined);
				const selectedGlobalCache = cache.getSelectedEntries(undefined);
				stream.markdown(
					`> 💡 **Global Mode** | ` +
					`💾 ${selectedGlobalCache.length}/${globalCacheEntries.length} cached | ` +
					`[Create project](command:contextManager.createProject) for knowledge cards & TODOs\n\n`
				);
			}
		}

		// ── Handle special followup actions ──

		// ── Route to handler ──
		let handlerResult: ExplainerMetadata;
		switch (command) {
			case 'context':
				handlerResult = await handleContext(stream, projectManager, cache);
				break;
			case 'todo':
				handlerResult = await handleTodo(request, chatContext, stream, token, projectManager, cache);
				break;
			case 'knowledge':
				handlerResult = await handleKnowledge(request, chatContext, stream, token, projectManager, cache);
				break;
			case 'refine':
				handlerResult = await handleRefine(request, chatContext, stream, token, projectManager, cache);
				break;
			case 'save':
				handlerResult = await handleSave(request, chatContext, stream, token, projectManager, cache);
				break;
			case 'add':
				handlerResult = await handleAdd(request, chatContext, stream, token, projectManager, cache);
				break;
			case 'done':
				handlerResult = await handleDone(request, chatContext, stream, token, projectManager, cache);
				break;
			case 'handoff':
				handlerResult = await handleHandoff(request, chatContext, stream, token, projectManager, cache);
				break;
			case 'audit':
				handlerResult = await handleAudit(request, chatContext, stream, token, projectManager, cache);
				break;
			case 'map':
				handlerResult = await handleMap(request, chatContext, stream, token, projectManager, cache);
				break;
			case 'doc':
				handlerResult = await handleDoc(request, chatContext, stream, token, projectManager, cache);
				break;
			case 'explain':
			case 'usage':
			case 'relationships':
				handlerResult = await handleAnalysis(command as AnalysisCommand, request, chatContext, stream, token, projectManager, cache);
				break;
			case 'chat':
			default:
				handlerResult = await handleChat(request, chatContext, stream, token, projectManager, cache);
				break;
		}

		// ── Auto-Learn Pipeline (fire-and-forget) ──
		// Runs completely in the background — the chat handler returns immediately.
		// A separate "audit agent" analyzes tool call history + response text to
		// extract learnings. The main chat session is never delayed or modified.
		if (handlerResult.toolCallsMetadata?.toolCallRounds?.length > 0) {
			const { toolCallRounds, toolCallResults } = handlerResult.toolCallsMetadata;
			const responseText = toolCallRounds.reduce((acc, r) => acc + (r.response || ''), '');
			const lastResponse = toolCallRounds.length > 0
				? (toolCallRounds[toolCallRounds.length - 1].response || '')
				: responseText;

			// Fire-and-forget: never awaited, never blocks the response
			runAutoLearnBackground(
				toolCallRounds, toolCallResults as any,
				responseText, lastResponse, command, request.prompt, projectManager
			);
		}

		// ── Stash last exchange for background agent pickup ──
		const lastRoundResponse = handlerResult.toolCallsMetadata?.toolCallRounds?.length
			? handlerResult.toolCallsMetadata.toolCallRounds.reduce((acc, r) => acc + (r.response || ''), '')
			: '';
		if (lastRoundResponse || request.prompt) {
			setLastChatExchange([
				`User (/${command}): ${request.prompt}`,
				lastRoundResponse ? `Assistant: ${lastRoundResponse.substring(0, 3000)}${lastRoundResponse.length > 3000 ? '…' : ''}` : '',
			].filter(Boolean).join('\n\n'));
		}

		return handlerResult;
	};

	const participant = vscode.chat.createChatParticipant(PARTICIPANT_ID, handler);
	participant.iconPath = new vscode.ThemeIcon('book');

	// ── Proposed API: wire up experimental features ──
	registerActionTracking(participant, projectManager);
	registerVariableProvider(participant, projectManager, cache);
	registerChatHooks(participant, context, projectManager);
	registerChatSessionsProvider(participant, context, projectManager);

	participant.followupProvider = {
		provideFollowups(result: ExplainerMetadata, _context: vscode.ChatContext, _token: vscode.CancellationToken) {
			const followups: vscode.ChatFollowup[] = [];
			const analysisCommands = ['explain', 'usage', 'relationships'];

			// Only show analysis followups after analysis commands
			if (analysisCommands.includes(result.command)) {
				if (result.command !== 'usage') {
					followups.push({ prompt: 'explain the usage', label: 'Explain where this is used', command: 'usage' });
				}
				if (result.command !== 'relationships') {
					followups.push({ prompt: 'explain relationships', label: 'Show class relationships', command: 'relationships' });
				}
				if (ConfigurationManager.experimentalProposedApi) {
					followups.push({ prompt: '', label: '📝 Add doc comments (experimental)', command: 'doc' });
				}
			}

			// Context-appropriate followups for other commands
			if (result.command === 'chat' || result.command === 'save') {
				followups.push({ prompt: 'save this as a knowledge card', label: 'Save as Knowledge Card', command: 'save' });
				followups.push({ prompt: '', label: '📥 Add last response as card', command: 'add' });
			}
			if (result.command === 'knowledge' || result.command === 'refine') {
				followups.push({ prompt: 'show current context', label: 'View Project Context', command: 'context' });
			}
			if (result.command === 'done') {
				followups.push({ prompt: '', label: '📋 Generate handoff document', command: 'handoff' });
			}
			if (result.command === 'handoff') {
				followups.push({ prompt: '', label: '📥 Save handoff as card', command: 'add' });
			}
			if (result.command === 'map') {
				followups.push({ prompt: '', label: '🔍 Audit knowledge freshness', command: 'audit' });
			}
			if (result.command === 'audit') {
				followups.push({ prompt: '', label: '📋 Generate handoff', command: 'handoff' });
			}

			return followups;
		}
	};

	context.subscriptions.push(participant);
}

// ─── /context ───────────────────────────────────────────────────

async function handleContext(
	stream: vscode.ChatResponseStream,
	projectManager: ProjectManager,
	cache: ExplanationCache,
): Promise<ExplainerMetadata> {
	const activeProject = projectManager.getActiveProject();
	if (!activeProject) {
		stream.markdown('# Global Mode\n\nCreate a project to organize knowledge cards, TODOs, and context.');
		return noToolsResult('context');
	}
	const contextEnabled = projectManager.isContextEnabled(activeProject.id);
	const fullContext = await projectManager.getFullProjectContext(activeProject.id, cache);
	const badge = contextEnabled ? '✅ Context is **enabled**' : '⚠️ Context is **disabled**';
	stream.markdown(`# Current Project Context\n\n${badge}\n\n${fullContext}`);

	// Append MCP server information if available (proposed API)
	const mcpSection = getMcpServerContextSection();
	if (mcpSection) {
		stream.markdown(`\n\n${mcpSection}`);
	}

	return noToolsResult('context');
}

// ─── /chat (default) ────────────────────────────────────────────

async function handleChat(
	request: vscode.ChatRequest,
	chatContext: vscode.ChatContext,
	stream: vscode.ChatResponseStream,
	token: vscode.CancellationToken,
	projectManager: ProjectManager,
	cache: ExplanationCache,
): Promise<ExplainerMetadata> {
	const copilotInstructions = await getCopilotInstructions();
	const projCtx = await getProjectContext(projectManager, cache);
	const branchCtx = await getBranchContext(projectManager);
	const activeProject = projectManager.getActiveProject();
	const referenceFiles = activeProject ? projectManager.getReferenceFiles(activeProject.id, cache) : [];

	// Build project intelligence injection (tiered: conventions, tool hints, relevant notes)
	const intelligenceCtx = activeProject
		? await projectManager.getProjectIntelligenceString(
			activeProject.id,
			request.prompt,
			// Extract file paths from chat references
			request.references?.filter(r => r.value instanceof vscode.Uri).map(r => (r.value as vscode.Uri).fsPath)
		)
		: '';

	const result = await runToolCallingLoop({
		PromptComponent: ChatPrompt,
		promptProps: {
			request,
			context: chatContext,
			projectContext: projCtx + (intelligenceCtx ? '\n\n' + intelligenceCtx : ''),
			branchContext: branchCtx,
			copilotInstructions,
			workspacePaths: getWorkspacePaths(projectManager),
			referenceFiles,
		},
		model: request.model,
		tools: getAgentTools(),
		stream,
		token,
		toolReferences: [...request.toolReferences],
	});

	// Auto-deselect context after use (fire-and-forget — never blocks the response)
	deselectContextAfterUse(projectManager, cache).catch(() => {});

	// Auto-save branch session (fire-and-forget — git snapshot runs in background)
	autoSaveBranchSession(projectManager, request.prompt, chatContext).catch(() => {});

	return makeResult('chat', result);
}

// ─── /explain, /usage, /relationships ───────────────────────────

async function handleAnalysis(
	command: AnalysisCommand,
	request: vscode.ChatRequest,
	chatContext: vscode.ChatContext,
	stream: vscode.ChatResponseStream,
	token: vscode.CancellationToken,
	projectManager: ProjectManager,
	cache: ExplanationCache,
): Promise<ExplainerMetadata> {
	const rawSymbol = request.prompt.trim();
	const cacheKey = generateCacheKey(command, rawSymbol, request.references);
	const activeProject = projectManager.getActiveProject();

	// If the prompt is multi-word (e.g. selected text), ask for a short title.
	// Single words auto-title without prompting.
	let symbol = rawSymbol;
	if (rawSymbol.split(/\s+/).length > 1) {
		const userTitle = await vscode.window.showInputBox({
			title: 'Name this cache entry',
			prompt: 'The selected text is long. Provide a short title for the cache entry.',
			value: rawSymbol.length > 60 ? rawSymbol.substring(0, 60) + '…' : rawSymbol,
			placeHolder: 'e.g. handleUserLogin flow',
		});
		if (userTitle?.trim()) {
			symbol = userTitle.trim();
		}
		// If dismissed, keep raw symbol
	}
	// Single word: use as-is (no prompt needed)

	// Check cache
	const cached = cache.get(cacheKey, activeProject?.id);
	if (cached) {
		stream.markdown('*📚 Cached explanation:*\n\n');
		stream.markdown(cached);
		return noToolsResult(command, true);
	}

	stream.progress(`Analyzing ${symbol}...`);
	emitThinkingProgress(stream, `Researching ${symbol} across the codebase...`);

	const copilotInstructions = await getCopilotInstructions();
	const projCtx = await getProjectContext(projectManager, cache);
	const referenceFiles = activeProject ? projectManager.getReferenceFiles(activeProject.id, cache) : [];

	const result = await runToolCallingLoop({
		PromptComponent: AnalysisPrompt,
		promptProps: {
			request,
			context: chatContext,
			command,
			symbol,
			projectContext: projCtx,
			copilotInstructions,
			workspacePaths: getWorkspacePaths(projectManager),
			referenceFiles,
		},
		model: request.model,
		tools: getAgentTools(),
		stream,
		token,
		toolReferences: [...request.toolReferences],
	});

	// Emit codeblockUri linking code blocks back to source files (proposed API)
	const firstRef = request.references?.[0];
	if (firstRef?.value instanceof vscode.Uri) {
		emitCodeblockUri(stream, firstRef.value);
	} else if (firstRef?.value instanceof vscode.Location) {
		emitCodeblockUri(stream, firstRef.value.uri);
	}

	// Cache the response
	if (result.fullResponse.trim()) {
		let filePath: string | undefined;
		let lineNumber: number | undefined;
		if (firstRef?.value instanceof vscode.Uri) {
			filePath = firstRef.value.fsPath;
		} else if (firstRef?.value instanceof vscode.Location) {
			filePath = firstRef.value.uri.fsPath;
			lineNumber = firstRef.value.range.start.line + 1;
		}
		cache.set(cacheKey, result.lastResponse || result.fullResponse, {
			symbolName: symbol,
			type: command,
			filePath,
			lineNumber,
			projectId: activeProject?.id,
		});
	}

	// Auto-deselect context after use (fire-and-forget)
	deselectContextAfterUse(projectManager, cache).catch(() => {});

	return makeResult(command, result);
}

// ─── /add ───────────────────────────────────────────────────────
// Saves the last AI response from chat history as a knowledge card.

async function handleAdd(
	request: vscode.ChatRequest,
	chatContext: vscode.ChatContext,
	stream: vscode.ChatResponseStream,
	token: vscode.CancellationToken,
	projectManager: ProjectManager,
	cache: ExplanationCache,
): Promise<ExplainerMetadata> {
	const activeProject = projectManager.getActiveProject();
	if (!activeProject) {
		stream.markdown('**Error:** No active project. Create or select a project first.');
		return noToolsResult('add');
	}

	// Find the last assistant response in chat history
	let lastResponse = '';
	for (let i = chatContext.history.length - 1; i >= 0; i--) {
		const turn = chatContext.history[i];
		if (turn instanceof vscode.ChatResponseTurn) {
			// Extract text from response parts
			const textParts: string[] = [];
			for (const part of turn.response) {
				if (part instanceof vscode.ChatResponseMarkdownPart) {
					textParts.push(part.value.value);
				}
			}
			if (textParts.length > 0) {
				lastResponse = textParts.join('');
				break;
			}
		}
	}

	if (!lastResponse.trim()) {
		stream.markdown('**No previous AI response found** in this chat session to save.');
		return noToolsResult('add');
	}

	// Use the user prompt as a hint for the title, or default
	const hint = request.prompt.trim();
	const defaultTitle = hint || 'Knowledge card from chat';

	const title = await vscode.window.showInputBox({
		title: 'Save Last Response as Knowledge Card',
		prompt: 'Title for the knowledge card',
		value: defaultTitle,
		placeHolder: 'Enter a concise title',
	});

	if (!title) {
		emitWarning(stream, '**Cancelled** — knowledge card not saved.');
		return noToolsResult('add');
	}

	const categories: vscode.QuickPickItem[] = [
		{ label: 'explanation', description: 'How something works' },
		{ label: 'pattern', description: 'Code patterns, conventions', picked: true },
		{ label: 'architecture', description: 'System design, structure' },
		{ label: 'convention', description: 'Coding standards' },
		{ label: 'note', description: 'General notes' },
		{ label: 'other', description: 'Miscellaneous' },
	];

	const categoryPick = await vscode.window.showQuickPick(categories, {
		title: 'Select category',
		placeHolder: 'Choose a category',
	});

	if (!categoryPick) {
		emitWarning(stream, '**Cancelled** — knowledge card not saved.');
		return noToolsResult('add');
	}

	await projectManager.addKnowledgeCard(
		activeProject.id,
		title,
		lastResponse.trim(),
		categoryPick.label as 'architecture' | 'pattern' | 'convention' | 'explanation' | 'note' | 'other',
		[],
		'Chat conversation (added via /add)',
	);

	stream.markdown(`✅ **Knowledge card created!** "${title}" has been added to your project from the last AI response.`);
	return noToolsResult('add');
}

// ─── /done ──────────────────────────────────────────────────────
// End-of-task retrospective: captures outcome, prompts agent for reflection.

async function handleDone(
	request: vscode.ChatRequest,
	chatContext: vscode.ChatContext,
	stream: vscode.ChatResponseStream,
	token: vscode.CancellationToken,
	projectManager: ProjectManager,
	cache: ExplanationCache,
): Promise<ExplainerMetadata> {
	const activeProject = projectManager.getActiveProject();
	if (!activeProject) {
		stream.markdown('**Error:** No active project. Create or select a project first.');
		return noToolsResult('done');
	}

	stream.progress('Processing end-of-task retrospective...');

	// Extract last AI response as the outcome
	let lastResponse = '';
	for (let i = chatContext.history.length - 1; i >= 0; i--) {
		const turn = chatContext.history[i];
		if (turn instanceof vscode.ChatResponseTurn) {
			const textParts: string[] = [];
			for (const part of turn.response) {
				if (part instanceof vscode.ChatResponseMarkdownPart) {
					textParts.push(part.value.value);
				}
			}
			if (textParts.length > 0) {
				lastResponse = textParts.join('');
				break;
			}
		}
	}

	const outcomeSummary = lastResponse
		? (lastResponse.match(/^[^.!?\\n]+[.!?]/)?.[0] || lastResponse.slice(0, 500))
		: 'Task completed';

	// Finalize branch session
	const branchCtx = await projectManager.getActiveBranchContext(activeProject.id);
	if (branchCtx?.session) {
		await projectManager.saveBranchSession(activeProject.id, branchCtx.branch, {
			task: branchCtx.session.task,
			currentState: outcomeSummary,
			nextSteps: [], // Done
		});
		stream.markdown(`✅ **Branch session finalized** for \`${branchCtx.branch}\`\n\n`);
	}

	// Prompt the agent to run retrospect
	stream.markdown(
		'---\n\n' +
		'**📋 End-of-Task Reflection**\n\n' +
		'Now reflect on this task and call the `contextManager_projectIntelligence` tool with `action: "retrospect"` to capture:\n' +
		'- `taskSummary`: One-line summary of what was accomplished\n' +
		'- `whatWorked`: Approaches and patterns that succeeded\n' +
		'- `whatDidntWork`: Dead ends, wrong assumptions\n' +
		'- `newConventions`: Codebase conventions discovered (category, title, content)\n' +
		'- `newToolHints`: Search terms or tool tricks that worked (toolName, pattern, antiPattern, example)\n' +
		'- `knowledgeCards`: Any findings worth saving as reference (title, content, category)\n'
	);

	// Use tool-calling loop so the agent can call retrospect
	const projCtx = await getProjectContext(projectManager, cache);
	const result = await runToolCallingLoop({
		PromptComponent: ChatPrompt,
		promptProps: {
			request: { ...request, prompt: `The user just completed a task and called /done. Reflect on the work done in this chat session. Call the contextManager_projectIntelligence tool with action "retrospect" to capture useful learnings. ${request.prompt}` },
			context: chatContext,
			projectContext: projCtx,
			branchContext: '',
			copilotInstructions: '',
			workspacePaths: getWorkspacePaths(projectManager),
			referenceFiles: [],
		},
		model: request.model,
		tools: getAgentTools(),
		stream,
		token,
		toolReferences: [...request.toolReferences],
	});

	return makeResult('done', result);
}

// ─── /handoff ───────────────────────────────────────────────────

async function handleHandoff(
	request: vscode.ChatRequest,
	chatContext: vscode.ChatContext,
	stream: vscode.ChatResponseStream,
	token: vscode.CancellationToken,
	projectManager: ProjectManager,
	cache: ExplanationCache,
): Promise<ExplainerMetadata> {
	const activeProject = projectManager.getActiveProject();
	if (!activeProject) {
		stream.markdown('**Error:** No active project. Create or select a project first.');
		return noToolsResult('handoff');
	}

	stream.progress('Assembling handoff context...');

	// ── Gather all project data ──
	const branchCtx = await projectManager.getActiveBranchContext(activeProject.id);
	const conventions = projectManager.getConventions(activeProject.id);
	const toolHints = projectManager.getToolHints(activeProject.id);
	const workingNotes = projectManager.getWorkingNotes(activeProject.id);
	const selectedCards = projectManager.getSelectedKnowledgeCards(activeProject.id);
	const allCards = projectManager.getKnowledgeCards(activeProject.id);

	// Build a structured context dump for the LLM
	const sections: string[] = [];

	// Branch session
	if (branchCtx?.session) {
		const s = branchCtx.session;
		sections.push([
			`## Current Branch: \`${branchCtx.branch}\``,
			`- **Task:** ${s.task || 'N/A'}`,
			s.goal ? `- **Goal:** ${s.goal}` : '',
			s.currentState ? `- **Current state:** ${s.currentState}` : '',
			s.approaches.length > 0 ? `- **Approaches tried:** ${s.approaches.join('; ')}` : '',
			s.decisions.length > 0 ? `- **Key decisions:** ${s.decisions.join('; ')}` : '',
			s.blockers.length > 0 ? `- **Blockers:** ${s.blockers.join('; ')}` : '',
			s.nextSteps.length > 0 ? `- **Next steps:** ${s.nextSteps.join('; ')}` : '',
			s.changedFiles.length > 0 ? `- **Changed files:** ${s.changedFiles.slice(0, 20).join(', ')}${s.changedFiles.length > 20 ? ` (+${s.changedFiles.length - 20} more)` : ''}` : '',
			s.recentCommits.length > 0 ? `- **Recent commits:**\n${s.recentCommits.slice(0, 10).map(c => `  - ${c}`).join('\n')}` : '',
		].filter(Boolean).join('\n'));
	}

	// Knowledge cards
	if (allCards.length > 0) {
		const cardSummaries = allCards.slice(0, 15).map(c =>
			`- **${c.title}** [${c.category}]: ${c.content.substring(0, 150).replace(/\n/g, ' ')}${c.content.length > 150 ? '…' : ''}`
		);
		sections.push(`## Knowledge Cards (${allCards.length})\n${cardSummaries.join('\n')}`);
	}

	// Conventions
	if (conventions.length > 0) {
		const enabled = conventions.filter(c => (c as any).enabled !== false);
		const disabled = conventions.filter(c => (c as any).enabled === false);
		const convLines = enabled.map(c => `- **[${c.category}] ${c.title}:** ${c.content.substring(0, 120)}`);
		if (disabled.length > 0) {
			convLines.push(`- _(${disabled.length} convention${disabled.length > 1 ? 's' : ''} disabled)_`);
		}
		sections.push(`## Conventions (${enabled.length} active)\n${convLines.join('\n')}`);
	}

	// Tool hints
	if (toolHints.length > 0) {
		const hintLines = toolHints.slice(0, 10).map(h =>
			`- Search "${h.pattern}"${h.antiPattern ? ` not "${h.antiPattern}"` : ''}`
		);
		sections.push(`## Tool Hints\n${hintLines.join('\n')}`);
	}

	// Working notes
	if (workingNotes.length > 0) {
		const fresh = workingNotes.filter(n => n.staleness === 'fresh');
		const noteLines = fresh.slice(0, 10).map(n =>
			`- **${n.subject}:** ${n.insight.substring(0, 120).replace(/\n/g, ' ')}`
		);
		sections.push(`## Working Notes (fresh)\n${noteLines.join('\n')}`);
	}

	const contextDump = sections.join('\n\n');
	const userInstructions = request.prompt.trim();

	const handoffPrompt = `The user called /handoff. Generate a **concise, actionable handoff document** for another engineer (or future-self) picking up this work.

${contextDump ? `Here is all the project intelligence data:\n\n${contextDump}\n\n` : ''}

## Your task
Synthesize the above into a well-structured handoff document with these sections:

1. **Summary** — What was being worked on (1-2 sentences)
2. **Current State** — Where things stand right now (what's done, what's in progress)
3. **Key Decisions** — Important architectural or design choices made and why
4. **Gotchas & Conventions** — Things the next person needs to know to avoid mistakes
5. **Next Steps** — Prioritized list of what to do next
6. **Relevant Files** — Key files to start with
7. **Search Tips** — How to find things in this codebase (tool hints)

Be concrete and specific. Reference actual file paths and code patterns.
${userInstructions ? `\n\nAdditional context from user: ${userInstructions}` : ''}`;

	const projCtx = await getProjectContext(projectManager, cache);

	const result = await runToolCallingLoop({
		PromptComponent: ChatPrompt,
		promptProps: {
			request: { ...request, prompt: handoffPrompt },
			context: chatContext,
			projectContext: projCtx,
			branchContext: '',
			copilotInstructions: '',
			workspacePaths: getWorkspacePaths(projectManager),
			referenceFiles: [],
		},
		model: request.model,
		tools: getAgentTools(),
		stream,
		token,
		toolReferences: [...request.toolReferences],
	});

	// Offer to save as a card
	stream.markdown('\n\n---\n');
	stream.button({ command: 'contextManager.openDashboard', title: '📋 Open Dashboard' });

	return makeResult('handoff', result);
}

// ─── /audit ─────────────────────────────────────────────────────

async function handleAudit(
	request: vscode.ChatRequest,
	_chatContext: vscode.ChatContext,
	stream: vscode.ChatResponseStream,
	token: vscode.CancellationToken,
	projectManager: ProjectManager,
	cache: ExplanationCache,
): Promise<ExplainerMetadata> {
	const activeProject = projectManager.getActiveProject();
	if (!activeProject) {
		stream.markdown('**Error:** No active project. Create or select a project first.');
		return noToolsResult('audit');
	}

	const allCards = projectManager.getKnowledgeCards(activeProject.id);
	const conventions = projectManager.getConventions(activeProject.id);
	const workingNotes = projectManager.getWorkingNotes(activeProject.id);

	if (allCards.length === 0 && conventions.length === 0 && workingNotes.length === 0) {
		stream.markdown('📋 **Nothing to audit.** No knowledge cards, conventions, or working notes exist yet.');
		return noToolsResult('audit');
	}

	stream.markdown('# 🔍 Knowledge Audit\n\n');
	stream.progress('Scanning for staleness...');

	// ── 1. Check knowledge cards for stale file references ──
	const staleCards: Array<{ card: typeof allCards[0]; missingFiles: string[] }> = [];
	const healthyCards: typeof allCards = [];

	for (const card of allCards) {
		if (token.isCancellationRequested) { break; }
		const refs = card.referenceFiles || [];
		if (refs.length === 0) {
			healthyCards.push(card);
			continue;
		}
		const missingFiles: string[] = [];
		for (const ref of refs) {
			try {
				await vscode.workspace.fs.stat(vscode.Uri.file(ref));
			} catch {
				missingFiles.push(ref);
			}
		}
		if (missingFiles.length > 0) {
			staleCards.push({ card, missingFiles });
		} else {
			healthyCards.push(card);
		}
	}

	// ── 2. Check working notes staleness ──
	const staleNotes = workingNotes.filter(n => n.staleness === 'stale' || n.staleness === 'possibly-stale');

	// ── 3. Check conventions — inferred ones pending review ──
	const pendingConventions = conventions.filter(c => c.confidence === 'inferred');

	// ── 4. Check for old cards (>30 days since updated) ──
	const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
	const oldCards = allCards.filter(c => c.updated < thirtyDaysAgo);

	// ── 5. Check for cards with content that mentions deleted patterns ──
	// (We'll let the LLM do deeper semantic audit if the user wants)

	// ── Render report ──
	stream.markdown('## Summary\n\n');
	stream.markdown(`| Category | Total | Issues |\n|---|---|---|\n`);
	stream.markdown(`| Knowledge Cards | ${allCards.length} | ${staleCards.length} with missing files, ${oldCards.length} older than 30 days |\n`);
	stream.markdown(`| Working Notes | ${workingNotes.length} | ${staleNotes.length} stale or possibly-stale |\n`);
	stream.markdown(`| Conventions | ${conventions.length} | ${pendingConventions.length} pending review |\n\n`);

	// Stale cards detail
	if (staleCards.length > 0) {
		stream.markdown('## ⚠️ Cards with Missing File References\n\n');
		stream.markdown('These cards reference files that no longer exist. The content may be outdated.\n\n');
		for (const { card, missingFiles } of staleCards) {
			stream.markdown(`- **${card.title}** [${card.category}]\n`);
			for (const f of missingFiles) {
				stream.markdown(`  - ❌ \`${f}\`\n`);
			}
		}
		stream.markdown('\n');
	}

	// Old cards
	if (oldCards.length > 0) {
		stream.markdown('## 📅 Cards Older Than 30 Days\n\n');
		stream.markdown('These may need a refresh. Use `/refine` to update them.\n\n');
		for (const card of oldCards.slice(0, 15)) {
			const age = Math.floor((Date.now() - card.updated) / (24 * 60 * 60 * 1000));
			stream.markdown(`- **${card.title}** — ${age} days old\n`);
		}
		if (oldCards.length > 15) {
			stream.markdown(`- _...and ${oldCards.length - 15} more_\n`);
		}
		stream.markdown('\n');
	}

	// Stale notes
	if (staleNotes.length > 0) {
		stream.markdown('## 📝 Stale Working Notes\n\n');
		for (const note of staleNotes) {
			const icon = note.staleness === 'stale' ? '🔴' : '⚠️';
			stream.markdown(`- ${icon} **${note.subject}** (${note.staleness})\n`);
		}
		stream.markdown('\n');
	}

	// Pending conventions
	if (pendingConventions.length > 0) {
		stream.markdown('## ⏳ Conventions Pending Review\n\n');
		for (const conv of pendingConventions) {
			stream.markdown(`- **[${conv.category}] ${conv.title}** — ${conv.content.substring(0, 100)}${conv.content.length > 100 ? '…' : ''}\n`);
		}
		stream.markdown('\n');
	}

	// Healthy summary
	if (staleCards.length === 0 && staleNotes.length === 0 && pendingConventions.length === 0 && oldCards.length === 0) {
		stream.markdown('✅ **All clear!** No staleness issues found.\n');
	}

	// Offer deeper AI audit if user asked
	const userPrompt = request.prompt.trim();
	if (userPrompt) {
		stream.markdown('\n---\n\n');
		stream.progress('Running deep audit with AI...');

		const auditContext = [
			`Knowledge cards: ${allCards.map(c => `"${c.title}" [${c.category}]`).join(', ')}`,
			staleCards.length > 0 ? `Stale cards: ${staleCards.map(s => s.card.title).join(', ')}` : '',
		].filter(Boolean).join('\n');

		const result = await runToolCallingLoop({
			PromptComponent: ChatPrompt,
			promptProps: {
				request: {
					...request,
					prompt: `The user ran /audit on their knowledge base. Here's the current state:\n\n${auditContext}\n\nUser's question: ${userPrompt}\n\nSearch the codebase to verify if any knowledge cards are outdated. Check if the patterns, file paths, and code described in the cards still match the actual code.`,
				},
				context: _chatContext,
				projectContext: await getProjectContext(projectManager, cache),
				branchContext: '',
				copilotInstructions: '',
				workspacePaths: getWorkspacePaths(projectManager),
				referenceFiles: [],
			},
			model: request.model,
			tools: getAgentTools(),
			stream,
			token,
			toolReferences: [...request.toolReferences],
		});

		return makeResult('audit', result);
	}

	stream.button({ command: 'contextManager.openDashboard', title: '📋 Open Dashboard' });
	return noToolsResult('audit');
}

// ─── /map ───────────────────────────────────────────────────────

async function handleMap(
	request: vscode.ChatRequest,
	chatContext: vscode.ChatContext,
	stream: vscode.ChatResponseStream,
	token: vscode.CancellationToken,
	projectManager: ProjectManager,
	cache: ExplanationCache,
): Promise<ExplainerMetadata> {
	const activeProject = projectManager.getActiveProject();
	if (!activeProject) {
		stream.markdown('**Error:** No active project. Create or select a project first.');
		return noToolsResult('map');
	}

	const target = request.prompt.trim();
	if (!target) {
		stream.markdown('**Error:** Please specify a module, directory, or area to map.\n\nExamples:\n- `@ctx /map src/auth` — map the authentication module\n- `@ctx /map the dashboard` — map the dashboard architecture\n- `@ctx /map data flow for branch sessions`');
		return noToolsResult('map');
	}

	stream.markdown(`# 🗺️ Architectural Map: ${target}\n\n`);
	stream.progress('Exploring codebase...');

	const projCtx = await getProjectContext(projectManager, cache);
	const referenceFiles = projectManager.getReferenceFiles(activeProject.id, cache);

	// Build intelligence context for this target
	const intelligenceCtx = await projectManager.getProjectIntelligenceString(
		activeProject.id, target, []
	);

	const mapPrompt = `The user called /map to get an architectural overview.

## Your task
Thoroughly explore the codebase area described below using tools, then generate a comprehensive architectural map.

### Target: ${target}

### Required sections in your output:

1. **Overview** — What this module/area does (1-2 sentences)
2. **Entry Points** — Public API, exported functions/classes, main files
3. **Architecture** — How the module is structured internally
4. **Key Components** — Important classes/functions with their roles (cite files)
5. **Data Flow** — How data moves through this area (inputs → processing → outputs)
6. **Dependencies** — What this area imports/depends on, and what depends on it
7. **Relationships Diagram** — A mermaid diagram showing key relationships:
   \`\`\`mermaid
   graph TD
     A[Component] --> B[Component]
   \`\`\`
8. **Gotchas & Conventions** — Things to watch out for in this area

### Rules
- Use tools extensively — search, read files, trace imports, find usages
- Be specific: cite file paths and line numbers
- Focus on the architecture, not line-by-line code explanation
- The diagram should capture the most important 5-15 components, not every file`;

	const result = await runToolCallingLoop({
		PromptComponent: ChatPrompt,
		promptProps: {
			request: { ...request, prompt: mapPrompt },
			context: chatContext,
			projectContext: projCtx + (intelligenceCtx ? '\n\n' + intelligenceCtx : ''),
			branchContext: '',
			copilotInstructions: '',
			workspacePaths: getWorkspacePaths(projectManager),
			referenceFiles,
		},
		model: request.model,
		tools: getAgentTools(),
		stream,
		token,
		toolReferences: [...request.toolReferences],
	});

	// Offer to save as knowledge card
	const answerText = result.lastResponse || result.fullResponse;
	if (answerText.trim()) {
		stream.markdown('\n\n---\n');

		const cardTitle = `Architecture: ${target.substring(0, 80)}`;
		const card = await projectManager.addKnowledgeCard(
			activeProject.id, cardTitle, answerText.trim(), 'architecture', [],
			`Generated by /map`,
		);
		if (card) {
			stream.markdown(`✅ **Saved as knowledge card:** "${cardTitle}"\n`);
		}
		stream.button({ command: 'contextManager.openDashboard', title: '📋 Open Dashboard' });
	}

	// Auto-deselect context after use (fire-and-forget)
	deselectContextAfterUse(projectManager, cache).catch(() => {});

	return makeResult('map', result);
}

// ─── /save ──────────────────────────────────────────────────────

async function handleSave(
	request: vscode.ChatRequest,
	chatContext: vscode.ChatContext,
	stream: vscode.ChatResponseStream,
	token: vscode.CancellationToken,
	projectManager: ProjectManager,
	cache: ExplanationCache,
): Promise<ExplainerMetadata> {
	const activeProject = projectManager.getActiveProject();
	if (!activeProject) {
		stream.markdown('**Error:** No active project. Create or select a project first.');
		return noToolsResult('save');
	}

	const userQuestion = request.prompt.trim();
	if (!userQuestion) {
		stream.markdown('**Error:** Please provide a question to answer and save.');
		return noToolsResult('save');
	}

	const copilotInstructions = await getCopilotInstructions();
	const projCtx = await getProjectContext(projectManager, cache);
	const referenceFiles = projectManager.getReferenceFiles(activeProject.id, cache);

	const result = await runToolCallingLoop({
		PromptComponent: ChatPrompt,
		promptProps: {
			request,
			context: chatContext,
			projectContext: projCtx,
			copilotInstructions,
			workspacePaths: getWorkspacePaths(projectManager),
			referenceFiles,
		},
		model: request.model,
		tools: getAgentTools(),
		stream,
		token,
		toolReferences: [...request.toolReferences],
	});

	// Save as knowledge card
	if (result.fullResponse.trim()) {
		stream.markdown('\n\n---\n\n');
		stream.progress('Saving as knowledge card...');

		// Try inline question carousel first (proposed API), fall back to modal dialogs
		const carouselAnswers = await showQuestionCarousel(stream, [
			{
				id: 'title',
				title: 'Knowledge Card Title',
				type: 'text',
				defaultValue: userQuestion.length > 60 ? userQuestion.substring(0, 60) + '...' : userQuestion,
				message: 'Enter a concise title for the knowledge card',
			},
			{
				id: 'category',
				title: 'Category',
				type: 'single',
				options: [
					{ id: 'explanation', label: 'Explanation', value: 'explanation' },
					{ id: 'pattern', label: 'Pattern', value: 'pattern' },
					{ id: 'architecture', label: 'Architecture', value: 'architecture' },
					{ id: 'convention', label: 'Convention', value: 'convention' },
					{ id: 'note', label: 'Note', value: 'note' },
					{ id: 'other', label: 'Other', value: 'other' },
				],
			},
		]);

		let title: string | undefined;
		let categoryLabel: string | undefined;

		if (carouselAnswers) {
			// Got answers from inline carousel
			title = carouselAnswers['title'] as string;
			categoryLabel = carouselAnswers['category'] as string;
		}

		// Fallback: modal dialogs if carousel not available or skipped
		if (!title) {
			const defaultTitle = userQuestion.length > 60 ? userQuestion.substring(0, 60) + '...' : userQuestion;
			title = await vscode.window.showInputBox({
				prompt: 'Title for knowledge card',
				value: defaultTitle,
				placeHolder: 'Enter a concise title',
			});
		}

		if (!title) {
			emitWarning(stream, '**Cancelled** — knowledge card not saved.');
			return makeResult('save', result);
		}

		if (!categoryLabel) {
			const categories: vscode.QuickPickItem[] = [
				{ label: 'explanation', description: 'How something works' },
				{ label: 'pattern', description: 'Code patterns, conventions', picked: true },
				{ label: 'architecture', description: 'System design, structure' },
				{ label: 'convention', description: 'Coding standards' },
				{ label: 'note', description: 'General notes' },
				{ label: 'other', description: 'Miscellaneous' },
			];

			const categoryPick = await vscode.window.showQuickPick(categories, {
				title: 'Select category',
				placeHolder: 'Choose a category',
			});

			if (!categoryPick) {
				emitWarning(stream, '**Cancelled** — knowledge card not saved.');
				return makeResult('save', result);
			}
			categoryLabel = categoryPick.label;
		}

		const cardContent = `## Question\n${userQuestion}\n\n## Answer\n${result.lastResponse}`;
		await projectManager.addKnowledgeCard(
			activeProject.id,
			title,
			cardContent,
			categoryLabel as 'architecture' | 'pattern' | 'convention' | 'explanation' | 'note' | 'other',
			[],
			'Chat conversation',
		);

		stream.markdown(`\n✅ **Knowledge card created!** "${title}" has been added to your project.`);
	}

	// Auto-deselect context after use (fire-and-forget)
	deselectContextAfterUse(projectManager, cache).catch(() => {});

	return makeResult('save', result);
}

// ─── /knowledge ─────────────────────────────────────────────────

async function handleKnowledge(
	request: vscode.ChatRequest,
	chatContext: vscode.ChatContext,
	stream: vscode.ChatResponseStream,
	token: vscode.CancellationToken,
	projectManager: ProjectManager,
	cache: ExplanationCache,
): Promise<ExplainerMetadata> {
	const activeProject = projectManager.getActiveProject();
	if (!activeProject) {
		stream.markdown('**Error:** No active project. Create or select a project first.');
		return noToolsResult('knowledge');
	}

	const topic = request.prompt.trim();
	if (!topic) {
		stream.markdown('**Error:** Please provide a topic.\n\nExample: `@ctx /knowledge How authentication works`');
		return noToolsResult('knowledge');
	}

	stream.markdown(`# Generating Knowledge Card\n\n**Topic:** ${topic}\n\n`);
	stream.progress('Researching...');

	const projCtx = await getProjectContext(projectManager, cache);
	const referenceFiles = activeProject ? projectManager.getReferenceFiles(activeProject.id, cache) : [];

	const result = await runToolCallingLoop({
		PromptComponent: KnowledgePrompt,
		promptProps: {
			request,
			context: chatContext,
			topic,
			projectContext: projCtx,
			workspacePaths: getWorkspacePaths(projectManager),
			referenceFiles,
		},
		model: request.model,
		tools: getAgentTools(),
		stream,
		token,
	});

	// Parse knowledge card from response
	// Use lastResponse (final answer only, no thinking tokens) for card content
	const answerText = result.lastResponse || result.fullResponse;
	const cardMatch = answerText.match(/---KNOWLEDGE_CARD_START---([\s\S]*?)---KNOWLEDGE_CARD_END---/);

	if (!cardMatch) {
		if (answerText.trim()) {
			stream.markdown('\n\n⚠️ Could not parse structured format. Creating card from response.');
			const card = await projectManager.addKnowledgeCard(
				activeProject.id, topic.substring(0, 100), answerText.trim(), 'note', []);
			if (card) {
				stream.markdown(`\n\n✅ **Knowledge card created:** ${card.title}`);
				stream.button({ command: 'contextManager.openDashboard', title: 'View in Dashboard' });
			}
		}
		return makeResult('knowledge', result);
	}

	const cardContent = cardMatch[1].trim();
	const titleMatch = cardContent.match(/^TITLE:\s*(.+)$/m);
	const categoryMatch = cardContent.match(/^CATEGORY:\s*(.+)$/m);
	const tagsMatch = cardContent.match(/^TAGS:\s*(.+)$/m);

	const title = titleMatch?.[1]?.trim() || topic.substring(0, 50);
	const categoryRaw = categoryMatch?.[1]?.trim().toLowerCase() || 'note';
	const validCategories = ['architecture', 'pattern', 'convention', 'explanation', 'note', 'other'];
	const category = validCategories.includes(categoryRaw) ? categoryRaw as any : 'note';
	const tags = tagsMatch?.[1]?.split(',').map(t => t.trim()).filter(t => t) || [];

	const contentStart = cardContent.indexOf('\n\n');
	const content = contentStart > 0 ? cardContent.substring(contentStart + 2).trim() : cardContent;

	const card = await projectManager.addKnowledgeCard(activeProject.id, title, content, category, tags);
	if (card) {
		stream.markdown(`\n\n---\n✅ **Knowledge card created!** "${title}"`);
	}

	// Auto-deselect context after use (fire-and-forget)
	deselectContextAfterUse(projectManager, cache).catch(() => {});

	return makeResult('knowledge', result);
}

// ─── /refine ────────────────────────────────────────────────────

async function handleRefine(
	request: vscode.ChatRequest,
	chatContext: vscode.ChatContext,
	stream: vscode.ChatResponseStream,
	token: vscode.CancellationToken,
	projectManager: ProjectManager,
	cache: ExplanationCache,
): Promise<ExplainerMetadata> {
	const activeProject = projectManager.getActiveProject();
	if (!activeProject) {
		stream.markdown('**Error:** No active project. Create or select a project first.');
		return noToolsResult('refine');
	}

	const input = request.prompt.trim();
	if (!input) {
		stream.markdown('**Usage:** `@ctx /refine <instructions>`\n\nA picker will appear to choose which card to refine.\n\nYou can also specify a card by title: `@ctx /refine [card title] your instructions here`');
		return noToolsResult('refine');
	}

	// Strategy: find which card to refine
	// 1. Try [id:xxx] prefix (used by dashboard actions) for exact ID lookup
	// 2. Fall back to title-prefix matching (case-insensitive)
	// 3. Show a picker if no match
	const allCards = projectManager.getKnowledgeCards(activeProject.id);

	let targetCard: typeof allCards[0] | undefined;
	let instructions = input;

	if (allCards.length === 0) {
		stream.markdown('**Error:** No knowledge cards exist in this project. Use `/knowledge` to create one first.');
		return noToolsResult('refine');
	}

	// Try matching by [id:xxx] prefix (dashboard sends this)
	const idPrefixMatch = input.match(/^\[id:([^\]]+)\]\s*(.*)$/s);
	if (idPrefixMatch) {
		const cardId = idPrefixMatch[1].trim();
		targetCard = allCards.find(c => c.id === cardId);
		instructions = idPrefixMatch[2].trim() || 'Improve and expand this knowledge card';
	}

	// Fall back to title-prefix matching (case-insensitive)
	if (!targetCard) {
		const lowerInput = input.toLowerCase();
		const titleMatch = allCards.find(c =>
			lowerInput.startsWith(c.title.toLowerCase())
		);

		if (titleMatch) {
			targetCard = titleMatch;
			instructions = input.substring(titleMatch.title.length).trim() || 'Improve and expand this knowledge card';
		}
	}  

	if (!targetCard) {
		// Show picker with all cards — sorted by most recently updated
		const sortedCards = [...allCards].sort((a, b) => b.updated - a.updated);
		const pick = await vscode.window.showQuickPick(
			sortedCards.map(c => ({
				label: c.title,
				description: `${c.category} · ${c.tags.join(', ') || 'no tags'}`,
				detail: c.content.substring(0, 100).replace(/\n/g, ' ') + '...',
				card: c,
			})),
			{ title: 'Which knowledge card to refine?', placeHolder: 'Select a card to edit with AI' }
		);
		if (!pick) {
			stream.markdown('⚠️ **Cancelled** — no card selected.');
			return noToolsResult('refine');
		}
		targetCard = (pick as any).card;
		instructions = input;
	}

	if (!targetCard) {
		stream.markdown('**Error:** Could not determine which card to refine.');
		return noToolsResult('refine');
	}

	stream.markdown(`# Refining Knowledge Card\n\n**Card:** ${targetCard.title}\n**Instructions:** ${instructions}\n\n`);
	stream.progress('Analyzing and refining...');

	// Exclude the target card from project context to avoid duplication (content is inlined in prompt)
	const projCtx = await projectManager.getFullProjectContext(activeProject.id, cache, new Set([targetCard.id])) || '';
	const referenceFiles = projectManager.getReferenceFiles(activeProject.id, cache);

	// Write card content to a temp .md file so the AI can read/edit it with workspace FS tools
	const tmpDir = os.tmpdir();
	const safeTitle = targetCard.title.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 60);
	const cardFilePath = path.join(tmpDir, `ctx-refine-${safeTitle}-${targetCard.id}.md`);
	await vscode.workspace.fs.writeFile(
		vscode.Uri.file(cardFilePath),
		new TextEncoder().encode(targetCard.content),
	);

	// Only provide tools the refine loop actually needs — minimises tool definitions
	// in the system prompt and prevents the model from calling irrelevant tools.
	// Prefer writeFile (one call for full refined content) over editFile (multiple round-trips).
	const refineTools = getAgentTools().filter(t => {
		const n = t.name;
		return n === 'contextManager_writeFile'
			|| n === 'contextManager_editKnowledgeCard';
	});

	const result = await runToolCallingLoop({
		PromptComponent: RefineKnowledgePrompt,
		promptProps: {
			request,
			context: chatContext,
			existingTitle: targetCard.title,
			cardFilePath,
			existingContent: targetCard.content,
			existingCategory: targetCard.category,
			existingTags: targetCard.tags,
			instructions,
			projectContext: projCtx,
			workspacePaths: getWorkspacePaths(projectManager),
			referenceFiles,
		},
		model: request.model,
		tools: refineTools,
		stream,
		token,
	});

	// Read the temp file back — the AI may have edited it via FS tools
	let updatedContent: string | undefined;
	try {
		const raw = await vscode.workspace.fs.readFile(vscode.Uri.file(cardFilePath));
		updatedContent = new TextDecoder().decode(raw).trim();
	} catch { /* file may have been deleted — ignore */ }

	// Clean up temp file
	try { await vscode.workspace.fs.delete(vscode.Uri.file(cardFilePath)); } catch { /* ignore */ }

	// Check if the AI edited the temp file content
	const tempFileChanged = updatedContent && updatedContent !== targetCard.content.trim();

	// Also check if the AI used contextManager_editKnowledgeCard directly
	const currentCard = projectManager.getKnowledgeCards(activeProject.id).find(c => c.id === targetCard.id);
	const cardEditedDirectly = currentCard && currentCard.content !== targetCard.content;

	// Parse optional metadata changes from the text response (EDIT_TITLE, EDIT_CATEGORY)
	const refineAnswer = result.lastResponse || result.fullResponse;
	const metaUpdates: Record<string, unknown> = {};
	const editTitleMatch = refineAnswer.match(/EDIT_TITLE:\s*(.+)/i);
	const editCategoryMatch = refineAnswer.match(/EDIT_CATEGORY:\s*(.+)/i);
	if (editTitleMatch) { metaUpdates.title = editTitleMatch[1].trim(); }
	if (editCategoryMatch) {
		const catRaw = editCategoryMatch[1].trim().toLowerCase();
		const validCats = ['architecture', 'pattern', 'convention', 'explanation', 'note', 'other'];
		if (validCats.includes(catRaw)) { metaUpdates.category = catRaw; }
	}

	if (tempFileChanged) {
		// AI edited the temp file — apply those changes + any metadata
		await projectManager.updateKnowledgeCard(activeProject.id, targetCard.id, {
			content: updatedContent,
			...metaUpdates,
		});
		const displayTitle = (metaUpdates.title as string) || targetCard.title;
		stream.markdown(`\n\n---\n✅ **Knowledge card refined!** "${displayTitle}"`);
		stream.button({ command: 'contextManager.openDashboard', title: 'View in Dashboard' });
	} else if (cardEditedDirectly) {
		// AI used contextManager_editKnowledgeCard directly — card already updated
		if (Object.keys(metaUpdates).length > 0) {
			await projectManager.updateKnowledgeCard(activeProject.id, targetCard.id, metaUpdates);
		}
		const displayTitle = currentCard.title || targetCard.title;
		stream.markdown(`\n\n---\n✅ **Knowledge card refined!** "${displayTitle}"`);
		stream.button({ command: 'contextManager.openDashboard', title: 'View in Dashboard' });
	} else if (Object.keys(metaUpdates).length > 0) {
		// Only metadata changed (title/category), no content edit
		await projectManager.updateKnowledgeCard(activeProject.id, targetCard.id, metaUpdates);
		stream.markdown(`\n\n---\n✅ **Card metadata updated!** ${Object.keys(metaUpdates).join(', ')} changed.`);
		stream.button({ command: 'contextManager.openDashboard', title: 'View in Dashboard' });
	} else {
		stream.markdown('\n\n⚠️ No changes were made to the card.');
	}

	// Auto-deselect context after use (fire-and-forget)
	deselectContextAfterUse(projectManager, cache).catch(() => {});

	return makeResult('refine', result);
}

// ─── /todo ──────────────────────────────────────────────────────

async function handleTodo(
	request: vscode.ChatRequest,
	chatContext: vscode.ChatContext,
	stream: vscode.ChatResponseStream,
	token: vscode.CancellationToken,
	projectManager: ProjectManager,
	cache: ExplanationCache,
): Promise<ExplainerMetadata> {
	const input = request.prompt.trim();
	const activeProject = projectManager.getActiveProject();

	if (!activeProject) {
		stream.markdown('**Error:** No active project. Create or select a project first.');
		return noToolsResult('todo');
	}

	const projectId = activeProject.id;

	// Parse input: "resume <id>", "run <id> [instructions]", or new description
	let todo: Todo | undefined;
	let agentRun: AgentRun | undefined;
	let isResume = false;
	let additionalInstructions = '';

	if (input.toLowerCase().startsWith('resume ')) {
		const todoId = input.substring(7).trim();
		todo = activeProject.todos.find(t => t.id === todoId);
		if (!todo) {
			stream.markdown(`**Error:** TODO "${todoId}" not found.\n`);
			activeProject.todos.forEach(t => stream.markdown(`- \`${t.id}\` — ${t.title} (${t.status})\n`));
			return noToolsResult('todo');
		}
		const latestRun = projectManager.getLatestRun(projectId, todo.id);
		if (latestRun && (latestRun.status === 'paused' || latestRun.status === 'running')) {
			agentRun = latestRun;
			isResume = true;
			stream.markdown(`**Resuming TODO:** ${todo.title}\n\n`);
		} else {
			agentRun = await projectManager.startAgentRun(projectId, todo.id);
			stream.markdown(`**Starting new run for:** ${todo.title}\n\n`);
		}
	} else if (input.toLowerCase().startsWith('run ')) {
		const rest = input.substring(4).trim();
		const spaceIdx = rest.indexOf(' ');
		const todoId = spaceIdx > 0 ? rest.substring(0, spaceIdx) : rest;
		additionalInstructions = spaceIdx > 0 ? rest.substring(spaceIdx + 1).trim() : '';

		todo = activeProject.todos.find(t => t.id === todoId);
		if (!todo) {
			stream.markdown(`**Error:** TODO "${todoId}" not found.\n`);
			activeProject.todos.forEach(t => stream.markdown(`- \`${t.id}\` — ${t.title} (${t.status})\n`));
			return noToolsResult('todo');
		}

		const latestRun = projectManager.getLatestRun(projectId, todo.id);
		if (latestRun && (latestRun.status === 'paused' || latestRun.status === 'running')) {
			agentRun = latestRun;
			isResume = true;
			stream.markdown(`**Resuming TODO:** ${todo.title}\n\n`);
		} else {
			agentRun = await projectManager.startAgentRun(projectId, todo.id);
			stream.markdown(`**Running TODO:** ${todo.title}\n\n`);
		}
	} else {
		todo = await projectManager.addTodo(projectId, input.substring(0, 100), input);
		if (!todo) {
			stream.markdown('**Error:** Failed to create TODO.');
			return noToolsResult('todo');
		}
		agentRun = await projectManager.startAgentRun(projectId, todo.id);
		stream.markdown(`**Created TODO:** ${todo.title}\n\n`);
	}

	if (!agentRun) {
		stream.markdown('**Error:** Failed to start agent run.');
		return noToolsResult('todo');
	}

	stream.markdown(`> 📝 **Project:** ${activeProject.name} | 🎯 **Run:** \`${agentRun.id}\`\n\n`);
	stream.progress('Working on TODO...');

	const projCtx = await getProjectContext(projectManager, cache);
	const referenceFiles = projectManager.getReferenceFiles(activeProject.id, cache);

	// /todo uses ALL tools, not just search/read
	const allTools = vscode.lm.tools;

	try {
		const result = await runToolCallingLoop({
			PromptComponent: TodoPrompt,
			promptProps: {
				request,
				context: chatContext,
				todo,
				projectContext: projCtx,
				workspacePaths: getWorkspacePaths(projectManager),
				referenceFiles,
				isResume,
				agentRun,
				additionalInstructions: additionalInstructions || undefined,
			},
			model: request.model,
			tools: [...allTools],
			stream,
			token,
		});

		// Build conversation history from tool call rounds for extraction/review
		const conversationHistory: SerializedMessage[] = [];
		for (const round of result.toolCallRounds) {
			if (round.response) {
				conversationHistory.push({
					role: 'assistant',
					content: round.response,
					toolCalls: JSON.stringify(round.toolCalls.map(tc => ({ name: tc.name, input: tc.input }))),
				});
			}
		}
		// Add the final response (after last tool round)
		const finalText = result.fullResponse.substring(
			result.toolCallRounds.reduce((len, r) => len + (r.response?.length || 0), 0)
		);
		if (finalText.trim()) {
			conversationHistory.push({ role: 'assistant', content: finalText.trim() });
		}

		// Save final state with full conversation history
		await projectManager.updateAgentRun(projectId, todo!.id, agentRun!.id, {
			conversationHistory,
			lastResponseText: result.lastResponse || result.fullResponse,
		});

		await projectManager.completeAgentRun(projectId, todo.id, agentRun.id);
		stream.markdown(`\n\n---\n✅ **TODO completed!**`);

		// Knowledge card handling: create new or refine existing linked card
		const contentToSave = result.lastResponse || result.fullResponse;
		if (contentToSave && contentToSave.trim().length > 20) {
			// Re-fetch the todo to get the latest state (it may have been updated during the run)
			const freshProject = projectManager.getProject(projectId);
			const freshTodo = freshProject?.todos.find(t => t.id === todo.id);
			const linkedCardId = freshTodo?.linkedKnowledgeCardId || todo.linkedKnowledgeCardId;
			const linkedCard = linkedCardId
				? projectManager.getKnowledgeCards(projectId).find(c => c.id === linkedCardId)
				: undefined;

			if (linkedCard) {
				// A knowledge card already exists from a previous run — offer to refine
				const action = await vscode.window.showQuickPick([
					{ label: '🔄 Refine existing card', description: `Update "${linkedCard.title}" with new findings`, value: 'refine' },
					{ label: '📝 Create new card', description: 'Create a separate knowledge card', value: 'new' },
					{ label: '➕ Append to card', description: `Add new findings to "${linkedCard.title}"`, value: 'append' },
					{ label: '⏭️ Skip', description: 'Don\'t save findings', value: 'skip' },
				], {
					title: `Knowledge card "${linkedCard.title}" already exists from a previous run`,
					placeHolder: 'How would you like to handle the findings?',
				});

				if (action?.value === 'refine') {
					// Merge old + new content: replace with new content since it's the latest
					await projectManager.updateKnowledgeCard(projectId, linkedCard.id, {
						content: contentToSave,
					});
					vscode.window.showInformationMessage(`Refined knowledge card: "${linkedCard.title}"`);
				} else if (action?.value === 'append') {
					const runNumber = todo.agentRuns.length;
					await projectManager.updateKnowledgeCard(projectId, linkedCard.id, {
						content: linkedCard.content + `\n\n---\n\n## Run ${runNumber} Findings\n\n` + contentToSave,
					});
					vscode.window.showInformationMessage(`Appended findings to: "${linkedCard.title}"`);
				} else if (action?.value === 'new') {
					const cardTitle = await vscode.window.showInputBox({
						title: 'Save as Knowledge Card',
						prompt: `Save the agent's findings from "${todo.title}" as a new knowledge card`,
						placeHolder: 'Enter a title, or press Escape to skip',
						value: `${todo.title} (run ${todo.agentRuns.length})`,
					});
					if (cardTitle) {
						const newCard = await projectManager.addKnowledgeCard(
							projectId, cardTitle, contentToSave, 'explanation',
							[todo.title.substring(0, 30)], `TODO: ${todo.title}`
						);
						if (newCard) {
							// Link the new card to this TODO
							await projectManager.updateTodo(projectId, todo.id, { linkedKnowledgeCardId: newCard.id });
							vscode.window.showInformationMessage(`Saved knowledge card: "${cardTitle}"`);
						}
					}
				}
				// 'skip' — do nothing
			} else {
				// No linked card yet — offer to create one
				const cardTitle = await vscode.window.showInputBox({
					title: 'Save as Knowledge Card?',
					prompt: `Save the agent's findings from "${todo.title}" as a knowledge card`,
					placeHolder: 'Enter a title, or press Escape to skip',
					value: todo.title,
				});
				if (cardTitle) {
					const newCard = await projectManager.addKnowledgeCard(
						projectId, cardTitle, contentToSave, 'explanation',
						[todo.title.substring(0, 30)], `TODO: ${todo.title}`
					);
					if (newCard) {
						// Link the new card to this TODO for future refinement
						await projectManager.updateTodo(projectId, todo.id, { linkedKnowledgeCardId: newCard.id });
						vscode.window.showInformationMessage(`Saved knowledge card: "${cardTitle}"`);
					}
				}
			}
		}

		// Auto-deselect context after use (fire-and-forget)
		deselectContextAfterUse(projectManager, cache).catch(() => {});

		return makeResult('todo', result);

	} catch (err) {
		if (err instanceof vscode.LanguageModelError) {
			stream.markdown(`\n\n⚠️ Error: ${err.message}`);
			await projectManager.failAgentRun(projectId, todo.id, agentRun.id, err.message);
		} else if (token.isCancellationRequested) {
			stream.markdown(`\n\n⚠️ **Cancelled.** Use \`@ctx /todo resume ${todo.id}\` to continue.`);
			await projectManager.pauseAgentRun(projectId, todo.id, agentRun.id);
		} else {
			await projectManager.failAgentRun(projectId, todo.id, agentRun.id, String(err));
			throw err;
		}
		return noToolsResult('todo');
	}
}

// ─── Result helpers ─────────────────────────────────────────────

// ─── /doc (Experimental — proposed API) ─────────────────────────

async function handleDoc(
	request: vscode.ChatRequest,
	_chatContext: vscode.ChatContext,
	stream: vscode.ChatResponseStream,
	token: vscode.CancellationToken,
	projectManager: ProjectManager,
	cache: ExplanationCache,
): Promise<ExplainerMetadata> {
	// Check if experimental API is enabled
	if (!ConfigurationManager.experimentalProposedApi) {
		stream.markdown(
			'⚠️ **Experimental Feature**\n\n' +
			'The `/doc` command uses proposed VS Code APIs to apply inline edits.\n\n' +
			'To enable it:\n' +
			'1. Open Settings → search for `contextManager.experimental.enableProposedApi`\n' +
			'2. Enable it\n' +
			'3. Make sure you\'re running a VS Code build that supports proposed APIs (e.g. Insiders)\n'
		);
		return noToolsResult('doc');
	}

	// Check if stream.textEdit is available at runtime
	if (typeof (stream as any).textEdit !== 'function') {
		stream.markdown(
			'⚠️ **Not Available**\n\n' +
			'`stream.textEdit()` is not available in this VS Code build.\n' +
			'The `/doc` command requires VS Code Insiders or a build with `chatParticipantAdditions` proposed API support.\n'
		);
		return noToolsResult('doc');
	}

	// Get the active editor and selection
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		stream.markdown('**Error:** No active editor. Open a file and select code to document.');
		return noToolsResult('doc');
	}

	const selection = editor.selection;
	const selectedText = editor.document.getText(selection);
	if (!selectedText.trim()) {
		stream.markdown('**Error:** No code selected. Select the code you want to add documentation to.');
		return noToolsResult('doc');
	}

	const fileUri = editor.document.uri;
	const fileName = fileUri.fsPath.split(/[\\/]/).pop() || 'file';
	const languageId = editor.document.languageId;
	const additionalInstructions = request.prompt.trim();

	stream.progress(`Generating documentation for selected code in ${fileName}...`);

	// Build the prompt
	const projCtx = await getProjectContext(projectManager, cache);
	const systemPrompt = [
		'You are an expert code documentation writer.',
		'Generate comprehensive, idiomatic documentation comments for the given code.',
		'Use the appropriate comment style for the language (e.g., JSDoc for JS/TS, docstrings for Python, XML docs for C#, Doxygen for C/C++).',
		'Include: purpose, parameters, return values, exceptions/errors where applicable.',
		'Return ONLY the documented version of the code — the original code with doc comments added. Do not include any markdown fences or explanation.',
		projCtx ? `\nProject context for reference:\n${projCtx}` : '',
		additionalInstructions ? `\nAdditional instructions: ${additionalInstructions}` : '',
	].filter(Boolean).join('\n');

	const messages = [
		vscode.LanguageModelChatMessage.User(systemPrompt),
		vscode.LanguageModelChatMessage.User(
			`Language: ${languageId}\nFile: ${fileName}\n\nCode to document:\n${selectedText}`
		),
	];

	// Call the model
	const response = await request.model.sendRequest(messages, {}, token);
	let documentedCode = '';
	for await (const chunk of response.text) {
		documentedCode += chunk;
	}

	// Strip any markdown fences the model might have added
	documentedCode = documentedCode.replace(/^```[\w]*\n?/, '').replace(/\n?```\s*$/, '');

	if (!documentedCode.trim()) {
		stream.markdown('**Error:** Failed to generate documentation. Try again with a different selection.');
		return noToolsResult('doc');
	}

	// Apply the edit via proposed API — shows inline diff
	const edit = vscode.TextEdit.replace(selection, documentedCode);
	(stream as any).textEdit(fileUri, edit);
	(stream as any).textEdit(fileUri, true); // signal done

	stream.markdown(`\n\n✅ Documentation generated for \`${fileName}\`. Review the inline diff above to accept or reject.`);

	return noToolsResult('doc');
}

// ─── Result helpers ─────────────────────────────────────────────

function makeResult(command: string, loopResult: ToolLoopResult): ExplainerMetadata {
	return {
		command,
		cached: false,
		toolCallsMetadata: {
			toolCallRounds: loopResult.toolCallRounds,
			toolCallResults: loopResult.toolCallResults,
		},
	};
}

function noToolsResult(command: string, cached = false): ExplainerMetadata {
	return {
		command,
		cached,
		toolCallsMetadata: {
			toolCallRounds: [],
			toolCallResults: {},
		},
	};
}

// ─── Auto-Learn Background Runner ───────────────────────────────

/**
 * Runs the auto-learn pipeline in the background, completely decoupled from
 * the main chat handler. The chat session returns its response immediately;
 * this function analyzes the tool call history + response text asynchronously
 * and shows results via a non-blocking notification toast.
 *
 * Think of this as a separate "audit agent" that has read-only access to
 * the chat session's history but never touches the chat stream.
 */
function runAutoLearnBackground(
	toolCallRounds: any[],
	toolCallResults: Record<string, any>,
	responseText: string,
	lastResponse: string,
	command: string,
	promptText: string,
	projectManager: ProjectManager,
): void {
	// Snapshot all data synchronously — then process fully async
	const roundsCopy = toolCallRounds;
	const resultsCopy = toolCallResults;

	runAutoLearn(
		roundsCopy, resultsCopy,
		responseText, lastResponse, command, promptText, projectManager
	).then(result => {
		const total = result.toolHintsCreated + result.workingNotesCreated + result.conventionsCreated;

		// Log to background task system for dashboard visibility
		if (total > 0) {
			const parts: string[] = [];
			if (result.toolHintsCreated > 0) { parts.push(`${result.toolHintsCreated} tool hint${result.toolHintsCreated > 1 ? 's' : ''}`); }
			if (result.conventionsCreated > 0) { parts.push(`${result.conventionsCreated} convention${result.conventionsCreated > 1 ? 's' : ''}`); }
			if (result.workingNotesCreated > 0) { parts.push(`${result.workingNotesCreated} note${result.workingNotesCreated > 1 ? 's' : ''}`); }

			bgTasks.logCompletedTask(
				'auto-learn',
				`Auto-learned: ${parts.join(', ')}`,
				`Extracted from /${command}: ${parts.join(', ')}` +
				(result.evicted > 0 ? ` (${result.evicted} old items evicted)` : ''),
				result.items.map(item => ({
					timestamp: Date.now(),
					type: 'text' as const,
					content: `${item.type}: ${item.title}`,
				})),
			);
		}

		if (total === 0 || !ConfigurationManager.autoLearnShowInChat) { return; }

		// Build a concise notification
		const parts: string[] = [];
		if (result.toolHintsCreated > 0) { parts.push(`${result.toolHintsCreated} tool hint${result.toolHintsCreated > 1 ? 's' : ''}`); }
		if (result.conventionsCreated > 0) { parts.push(`${result.conventionsCreated} convention${result.conventionsCreated > 1 ? 's' : ''}`); }
		if (result.workingNotesCreated > 0) { parts.push(`${result.workingNotesCreated} note${result.workingNotesCreated > 1 ? 's' : ''}`); }

		vscode.window.showInformationMessage(
			`📖 Auto-learned: ${parts.join(', ')}`,
			'Review in Dashboard'
		).then(choice => {
			if (choice === 'Review in Dashboard') {
				vscode.commands.executeCommand('contextManager.openDashboard');
			}
		});
	}).catch(err => {
		console.warn('[ContextManager] Auto-learn background processing failed:', err);
	});
}

