/**
 * Chat participant entry — registers the @ctx participant and dispatches
 * slash commands to the appropriate handler modules.
 */

import * as vscode from 'vscode';
import { ExplanationCache } from '../cache';
import { ConfigurationManager } from '../config';
import { ProjectManager } from '../projects/ProjectManager';
import {
	ExplainerMetadata,
	AnalysisCommand,
} from '../prompts/index';
import {
	registerActionTracking,
	registerVariableProvider,
	registerChatHooks,
	registerChatSessionsProvider,
} from '../proposedApi';
import { runAutoLearn } from '../autoLearn';
import * as bgTasks from '../backgroundTasks';
import { setLastChatExchange } from '../backgroundTasks';
import type { AutoCaptureService } from '../autoCapture';

import {
	handleChat,
	handleAnalysis,
	handleDoc,
	handleContext,
	handleAdd,
	handleSave,
	handleKnowledge,
	handleRefine,
	handleDone,
	handleHandoff,
	handleAudit,
	handleMap,
	handleTodo,
} from './commands';

const PARTICIPANT_ID = 'context-manager.ctx';

// ─── Public API ─────────────────────────────────────────────────

export function registerChatParticipant(
	context: vscode.ExtensionContext,
	cache: ExplanationCache,
	projectManager: ProjectManager,
	autoCapture?: AutoCaptureService,
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
					`> \uD83D\uDCDA **Project:** ${activeProject.name} | ` +
					`${contextEnabled ? '\u2713' : '\u2717'} context | ` +
					`\uD83D\uDCDD ${selectedCards.length} cards | ` +
					`\uD83D\uDCBE ${selectedCacheEntries.length}/${totalCacheCount} cached\n\n`
				);
			} else {
				const globalCacheEntries = cache.getEntriesForProject(undefined);
				const selectedGlobalCache = cache.getSelectedEntries(undefined);
				stream.markdown(
					`> \uD83D\uDCA1 **Global Mode** | ` +
					`\uD83D\uDCBE ${selectedGlobalCache.length}/${globalCacheEntries.length} cached | ` +
					`[Create project](command:contextManager.createProject) for knowledge cards & TODOs\n\n`
				);
			}
		}

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
		if (handlerResult.toolCallsMetadata?.toolCallRounds?.length > 0) {
			const { toolCallRounds, toolCallResults } = handlerResult.toolCallsMetadata;
			const responseText = toolCallRounds.reduce((acc: string, r: any) => acc + (r.response || ''), '');
			const lastResponse = toolCallRounds.length > 0
				? (toolCallRounds[toolCallRounds.length - 1].response || '')
				: responseText;

			runAutoLearnBackground(
				toolCallRounds, toolCallResults as any,
				responseText, lastResponse, command, request.prompt, projectManager
			);

			// ── Auto-Capture: pipe tool call metadata into observations ──
			if (autoCapture) {
				autoCapture.captureToolCalls(
					command, request.prompt, toolCallRounds, toolCallResults as any
				).catch(() => { /* fire-and-forget */ });
			}
		}

		// ── Stash last exchange for background agent pickup ──
		const lastRoundResponse = handlerResult.toolCallsMetadata?.toolCallRounds?.length
			? handlerResult.toolCallsMetadata.toolCallRounds.reduce((acc: string, r: any) => acc + (r.response || ''), '')
			: '';
		if (lastRoundResponse || request.prompt) {
			setLastChatExchange([
				`User (/${command}): ${request.prompt}`,
				lastRoundResponse ? `Assistant: ${lastRoundResponse.substring(0, 3000)}${lastRoundResponse.length > 3000 ? '\u2026' : ''}` : '',
			].filter(Boolean).join('\n\n'));
		}

		return handlerResult;
	};

	const participant = vscode.chat.createChatParticipant(PARTICIPANT_ID, handler);
	participant.iconPath = new vscode.ThemeIcon('book');

	// ── Proposed API: wire up experimental features ──
	registerActionTracking(participant, projectManager);
	registerVariableProvider(participant, projectManager, cache);
	registerChatHooks(participant, context, projectManager, autoCapture);
	registerChatSessionsProvider(participant, context, projectManager);

	participant.followupProvider = {
		provideFollowups(result: ExplainerMetadata, _context: vscode.ChatContext, _token: vscode.CancellationToken) {
			const followups: vscode.ChatFollowup[] = [];
			const analysisCommands = ['explain', 'usage', 'relationships'];
			// Commands that produce substantive content that can be saved as knowledge cards
			// Excludes: 'add' (already adds content, circular), 'todo' (manages TODOs, not knowledge)
			const contentCommands = ['chat', 'save', 'explain', 'usage', 'relationships', 'knowledge', 'refine', 'done', 'handoff', 'audit', 'map', 'context', 'doc'];

			if (analysisCommands.includes(result.command)) {
				if (result.command !== 'usage') {
					followups.push({ prompt: 'explain the usage', label: 'Explain where this is used', command: 'usage' });
				}
				if (result.command !== 'relationships') {
					followups.push({ prompt: 'explain relationships', label: 'Show class relationships', command: 'relationships' });
				}
				if (ConfigurationManager.experimentalProposedApi) {
					followups.push({ prompt: '', label: '\uD83D\uDCDD Add doc comments (experimental)', command: 'doc' });
				}
			}

			// Save-as-card followups for all content-generating commands (if enabled)
			if (ConfigurationManager.saveAsCardFollowupsEnabled && contentCommands.includes(result.command)) {
				followups.push({ prompt: 'save this as a knowledge card', label: 'Save as Knowledge Card', command: 'save' });
				followups.push({ prompt: '', label: '\uD83D\uDCE5 Add last response as card', command: 'add' });
			}
			if (result.command === 'knowledge' || result.command === 'refine') {
				followups.push({ prompt: 'show current context', label: 'View Project Context', command: 'context' });
			}
			if (result.command === 'done') {
				followups.push({ prompt: '', label: '\uD83D\uDCCB Generate handoff document', command: 'handoff' });
			}
			if (result.command === 'handoff') {
				followups.push({ prompt: '', label: '\uD83D\uDCE5 Save handoff as card', command: 'add' });
			}
			if (result.command === 'map') {
				followups.push({ prompt: '', label: '\uD83D\uDD0D Audit knowledge freshness', command: 'audit' });
			}
			if (result.command === 'audit') {
				followups.push({ prompt: '', label: '\uD83D\uDCCB Generate handoff', command: 'handoff' });
			}

			return followups;
		}
	};

	context.subscriptions.push(participant);
}

// ─── Auto-Learn Background ─────────────────────────────────────

/**
 * Runs the auto-learn pipeline in the background, completely decoupled from
 * the main chat handler. The chat session returns its response immediately;
 * this function analyzes the tool call history + response text asynchronously
 * and shows results via a non-blocking notification toast.
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
	const roundsCopy = toolCallRounds;
	const resultsCopy = toolCallResults;

	runAutoLearn(
		roundsCopy, resultsCopy,
		responseText, lastResponse, command, promptText, projectManager
	).then(result => {
		const total = result.toolHintsCreated + result.workingNotesCreated + result.conventionsCreated;

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

		const parts: string[] = [];
		if (result.toolHintsCreated > 0) { parts.push(`${result.toolHintsCreated} tool hint${result.toolHintsCreated > 1 ? 's' : ''}`); }
		if (result.conventionsCreated > 0) { parts.push(`${result.conventionsCreated} convention${result.conventionsCreated > 1 ? 's' : ''}`); }
		if (result.workingNotesCreated > 0) { parts.push(`${result.workingNotesCreated} note${result.workingNotesCreated > 1 ? 's' : ''}`); }

		vscode.window.showInformationMessage(
			`\uD83D\uDCD6 Auto-learned: ${parts.join(', ')}`,
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
