/**
 * Message handler for the dashboard webview.
 * Extracted from DashboardPanel constructor.
 */

import * as vscode from 'vscode';
import { ProjectManager } from '../projects/ProjectManager';
import { AutoCaptureService } from '../autoCapture';
import { ExplanationCache } from '../cache';
import { getCurrentBranch } from '../utils/gitUtils';
import { ConfigurationManager } from '../config';
import { exportCardsToFilesystem, importCardsFromDirectory } from '../fileSync';

// ─── Security: Command & Setting Allowlists ────────────────────

/** Explicit allowlist of valid webview message commands. */
const ALLOWED_COMMANDS = new Set([
	'setActiveProject', 'createProject', 'deleteProject', 'updateProjectContext',
	'webviewInteracting', 'webviewDraftState', 'setToolSharingConfig', 'updateSetting',
	'addTodo', 'updateTodo', 'deleteTodo', 'runTodoAgent',
	'continueWithPrompt', 'resumeTodo', 'viewTodoDetails', 'viewTodoHistory',
	'clearCacheEntry', 'editCacheEntry', 'clearAllCache', 'reexplain',
	'addKnowledgeCard', 'generateCardWithAI',
	'bindTrackedSession', 'rebindTrackedSession', 'dismissTrackedSession', 'forgetTrackedSession',
	'bulkAssignTrackedSessions', 'bulkDismissTrackedSessions', 'bulkForgetTrackedSessions',
	'addKnowledgeFolder', 'renameKnowledgeFolder', 'deleteKnowledgeFolder', 'moveKnowledgeCard',
	'toggleCardSelection', 'toggleCacheSelection',
	'deselectAllCards', 'smartSelectCards', 'deselectAllCacheEntries',
	'deleteKnowledgeCard', 'createCardFromSelection',
	'approveCandidate', 'rejectCandidate', 'editAndApproveCandidate', 'clearCardQueue',
	'approveCandidateWithEdits', 'bulkRejectCandidates', 'bulkQuickSave',
	'getTileData', 'getCompositionData', 'synthesizeCard', 'openFile',
	'distillQueue', 'approveDistilledCard',
	'askAboutSelection', 'createCardFromSelectionAI',
	'replaceCardSelection', 'deleteCardSelection', 'refineCardSelection',
	'saveToKnowledge', 'editKnowledgeCard', 'refineEntireCard',
	'updateConvention', 'deleteConvention', 'discardConvention',
	'discardWorkingNote', 'resetDiscardCount', 'toggleConventionSelection',
	'deleteToolHint', 'toggleToolHintSelection',
	'updateWorkingNote', 'promoteNoteToCard', 'deleteWorkingNote',
	'deleteObservation', 'distillObservations', 'clearObservationsBySource',
	'exportAll', 'importAll', 'exportProject', 'importProject',
	'exportCardsToFiles', 'importCardsFromDir',
	'runVscodeCommand',
	'mergeWorkbenchItems', 'mergeHealthDuplicates',
	'setPromptInjection', 'clearPromptInjection',
	'addWorkflow', 'updateWorkflow', 'deleteWorkflow', 'toggleWorkflow', 'runWorkflow',
]);

/**
 * Allowlist of setting keys that the webview is permitted to update.
 * Any key not in this set is silently rejected.
 */
const SETTING_ALLOWLIST = new Set([
	'showStatusBar', 'confirmDelete', 'maxKnowledgeCardsInContext',
	'prompts.globalInstructions',
	'prompts.distillObservations', 'prompts.distillQueue', 'prompts.synthesizeCard',
	'autoDistill.enabled', 'autoDistill.intervalMinutes', 'autoDistill.dedupThreshold',
	'saveAsCard.smartMerge',
	'intelligence.enableTieredInjection',
	'intelligence.tier1MaxTokens', 'intelligence.tier2MaxTokens',
	'intelligence.enableStalenessTracking',
	'intelligence.autoLearn', 'intelligence.autoLearn.useLLM',
	'intelligence.autoLearn.discardThreshold', 'intelligence.autoLearn.showInChat',
	'intelligence.autoLearn.modelFamily',
	'workflows.modelFamily', 'knowledgeCards.synthesisModelFamily',
	'intelligence.autoLearn.maxWorkingNotes', 'intelligence.autoLearn.maxToolHints',
	'intelligence.autoLearn.maxConventions',
	'intelligence.autoLearn.extractToolHints', 'intelligence.autoLearn.extractWorkingNotes',
	'intelligence.autoLearn.extractConventions',
	'intelligence.autoLearn.hintsPerRun', 'intelligence.autoLearn.notesPerRun',
	'intelligence.autoLearn.conventionsPerRun', 'intelligence.autoLearn.expiryDays',
	'tools.backgroundMode',
	'search.enableFTS', 'search.maxCardResults',
	'search.maxSearchResults', 'search.snippetTokens',
	'autoCapture.enabled', 'autoCapture.learnFromAllParticipants',
	'autoCapture.maxObservations',
	'sessionTracking.enabled',
	'hooks.sessionStart', 'hooks.postToolUse', 'hooks.preCompact', 'hooks.stop',
]);

/**
 * Validate an incoming webview message.
 * Returns `true` if the command is in the allowlist, `false` otherwise.
 */
function isAllowedCommand(msg: unknown): msg is Record<string, any> & { command: string } {
	if (!msg || typeof msg !== 'object' || !('command' in msg)) { return false; }
	const { command } = msg as { command: string };
	return typeof command === 'string' && ALLOWED_COMMANDS.has(command);
}

/**
 * Provides access to DashboardPanel internals needed by the message handler.
 */
export interface DashboardContext {
	projectManager: ProjectManager;
	cache: ExplanationCache;
	autoCapture?: AutoCaptureService;
	hookWatcher?: import('../hooks/HookWatcher').HookWatcher;
	postMessage(message: any): Thenable<boolean>;
	update(): void;
	setSuppressUpdate(value: boolean): void;
	setDraftProtection(value: boolean): void;
	endSuppression(): void;
}

/**
 * Before saving a queue candidate as a new card, check for similar existing cards
 * and prompt the user to choose between creating a new card or merging into one.
 * Returns { action: 'create' }, { action: 'merge', targetCardId }, or null (cancelled).
 */
async function _promptDuplicateAction(
	projectManager: ProjectManager,
	projectId: string,
	title: string,
	content: string
): Promise<{ action: 'create' } | { action: 'merge'; targetCardId: string } | null> {
	const similar = projectManager.findSimilarCardsForCandidate(projectId, title, content);
	if (similar.length === 0) {
		return { action: 'create' };
	}

	const createItem: vscode.QuickPickItem = {
		label: '$(add) Create new card',
		description: 'Save as a separate card',
		alwaysShow: true,
	};
	const mergeItems: vscode.QuickPickItem[] = similar.map(({ card, similarity }) => ({
		label: `$(files) Merge into: ${card.title}`,
		description: `${Math.round(similarity * 100)}% similar`,
		detail: card.content.slice(0, 120) + (card.content.length > 120 ? '…' : ''),
	}));

	const picked = await vscode.window.showQuickPick(
		[...mergeItems, createItem],
		{
			title: `⚠️ Similar cards found – merge recommended`,
			placeHolder: 'Merge into an existing card, or create a new one',
			ignoreFocusOut: true,
		}
	);

	if (!picked) { return null; }
	if (picked === createItem) { return { action: 'create' }; }
	const chosenIndex = mergeItems.indexOf(picked);
	if (chosenIndex < 0) { return { action: 'create' }; }
	return { action: 'merge', targetCardId: similar[chosenIndex].card.id };
}

/**
 * Opens a Copilot Chat session with the given query.
 * Prompts the user to choose between New Chat or Current Chat.
 * Returns false if the user cancelled.
 */
async function openInChatSession(query: string): Promise<boolean> {
	const choice = await vscode.window.showQuickPick(
		[
			{ label: '$(add) New Chat', description: 'Start a fresh chat session with this query', value: 'new' },
			{ label: '$(comment-discussion) Current Chat', description: 'Send to the currently active chat session', value: 'current' },
		],
		{ title: 'Open in Chat', placeHolder: 'Choose a chat session' }
	);
	if (!choice) { return false; }
	if (choice.value === 'new') {
		await vscode.commands.executeCommand('workbench.action.chat.newChat');
	}
	await vscode.commands.executeCommand('workbench.action.chat.open', { query, isPartialQuery: false });
	return true;
}

/**
 * Handle a single message from the dashboard webview.
 */
export async function handleWebviewMessage(message: any, ctx: DashboardContext): Promise<void> {
	// ── Validate command against allowlist ──
	if (!isAllowedCommand(message)) {
		console.warn(`[ContextManager] Rejected unknown webview command: ${String((message as any)?.command)}`);
		return;
	}

	const { projectManager, cache } = ctx;
	switch (message.command) {
					case 'bindTrackedSession': {
						if (!ctx.hookWatcher || typeof message.sessionId !== 'string' || typeof message.projectId !== 'string') { break; }
						const result = await ctx.hookWatcher.bindPendingSessionToProject(message.sessionId, message.projectId);
						const project = projectManager.getProject(message.projectId);
						if (project) {
							vscode.window.showInformationMessage(`Bound session to ${project.name} and backfilled ${result.backfilled} pending capture(s).`);
						}
						ctx.update();
						break;
					}

					case 'rebindTrackedSession': {
						if (!ctx.hookWatcher || typeof message.sessionId !== 'string' || typeof message.projectId !== 'string') { break; }
						await ctx.hookWatcher.rebindSessionToProjectFromNow(message.sessionId, message.projectId);
						const project = projectManager.getProject(message.projectId);
						if (project) {
							vscode.window.showInformationMessage(`Rebound session. New captures will route to ${project.name}.`);
						}
						ctx.update();
						break;
					}

					case 'dismissTrackedSession': {
						if (typeof message.sessionId !== 'string') { break; }
						await projectManager.dismissTrackedSession(message.sessionId);
						ctx.update();
						break;
					}

					case 'forgetTrackedSession': {
						if (typeof message.sessionId !== 'string') { break; }
						const choice = await vscode.window.showWarningMessage(
							'Delete this tracked session and remove any pending unassigned captures?',
							{ modal: true },
							'Delete Session',
						);
						if (choice !== 'Delete Session') { break; }
						await projectManager.forgetTrackedSession(message.sessionId, { removePendingEvents: true });
						ctx.update();
						break;
					}

					case 'bulkAssignTrackedSessions': {
						if (!ctx.hookWatcher || !Array.isArray(message.sessionIds) || typeof message.projectId !== 'string') { break; }
						const sessionIds = message.sessionIds.filter((sessionId: unknown): sessionId is string => typeof sessionId === 'string');
						if (sessionIds.length === 0) { break; }
						let rebound = 0;
						let newlyBound = 0;
						let backfilled = 0;
						for (const sessionId of sessionIds) {
							const tracked = projectManager.getTrackedSession(sessionId);
							const isBound = !!tracked?.bindingSegments?.some(segment => segment.endSequence === undefined);
							if (isBound) {
								await ctx.hookWatcher.rebindSessionToProjectFromNow(sessionId, message.projectId);
								rebound += 1;
							} else {
								const result = await ctx.hookWatcher.bindPendingSessionToProject(sessionId, message.projectId);
								backfilled += result.backfilled;
								newlyBound += 1;
							}
						}
						const project = projectManager.getProject(message.projectId);
						const projectName = project?.name || 'the selected project';
						vscode.window.showInformationMessage(`Updated ${sessionIds.length} session${sessionIds.length !== 1 ? 's' : ''} for ${projectName}${backfilled > 0 ? ` and imported ${backfilled} queued capture${backfilled !== 1 ? 's' : ''}` : ''}.`);
						ctx.update();
						break;
					}

					case 'bulkDismissTrackedSessions': {
						if (!Array.isArray(message.sessionIds)) { break; }
						const sessionIds = message.sessionIds.filter((sessionId: unknown): sessionId is string => typeof sessionId === 'string');
						for (const sessionId of sessionIds) {
							await projectManager.dismissTrackedSession(sessionId);
						}
						ctx.update();
						break;
					}

					case 'bulkForgetTrackedSessions': {
						if (!Array.isArray(message.sessionIds)) { break; }
						const sessionIds = message.sessionIds.filter((sessionId: unknown): sessionId is string => typeof sessionId === 'string');
						if (sessionIds.length === 0) { break; }
						const choice = await vscode.window.showWarningMessage(
							`Delete ${sessionIds.length} tracked session${sessionIds.length !== 1 ? 's' : ''} and remove pending unassigned captures?`,
							{ modal: true },
							'Delete Sessions',
						);
						if (choice !== 'Delete Sessions') { break; }
						for (const sessionId of sessionIds) {
							await projectManager.forgetTrackedSession(sessionId, { removePendingEvents: true });
						}
						ctx.update();
						break;
					}

					case 'runVscodeCommand':
						if (typeof message.commandId === 'string' && message.commandId.startsWith('contextManager.')) {
							await vscode.commands.executeCommand(message.commandId, ...(message.args || []));
						}
						break;

			case 'deleteObservation': {
				if (!ctx.autoCapture || !message.id) { break; }
				await ctx.autoCapture.deleteObservation(message.id);
				ctx.update();
				break;
			}

			case 'clearObservationsBySource': {
				if (!ctx.autoCapture || !message.source) { break; }
				await ctx.autoCapture.clearObservationsWhere(o => o.participant === message.source);
				ctx.update();
				break;
			}



			case 'distillObservations': {
				if (!ctx.autoCapture) {
					ctx.postMessage({ command: 'distillResult', error: 'Auto-capture not available.' });
					break;
				}
				const activeProject = projectManager.getActiveProject();
				if (!activeProject) {
					ctx.postMessage({ command: 'distillResult', error: 'No active project selected.' });
					break;
				}
				ctx.postMessage({ command: 'distillResult', status: 'loading' });
				try {
					const result = await ctx.autoCapture.distillObservations(message.maxObs ?? 40, activeProject.id);
					if (!result) {
						ctx.postMessage({ command: 'distillResult', error: 'Distillation returned no results. Try again with more observations.' });
					} else {
						ctx.postMessage({ command: 'distillResult', result });
					}
				} catch (err: any) {
					ctx.postMessage({ command: 'distillResult', error: err.message || 'Distillation failed.' });
				}
				break;
			}
					case 'setActiveProject':
						// Handle empty string as deselect
						await projectManager.setActiveProject(message.projectId || undefined);
						break;
					case 'createProject':
						const project = await projectManager.createProject(message.name);
						await projectManager.setActiveProject(project.id);
						break;
					case 'deleteProject':
						if (!message.projectId || !projectManager.getProject(message.projectId)) {
							vscode.window.showWarningMessage('Cannot delete: project not found.');
							break;
						}
						await projectManager.deleteProject(message.projectId);
						break;
					case 'updateProjectContext':
						await projectManager.updateProjectContext(message.projectId, message.context);
						break;
					case 'webviewInteracting':
						// Webview reports user is actively interacting with a form/input.
						// Suppress full re-renders to avoid destroying form state.
						if (message.interacting) {
							ctx.setSuppressUpdate(true);
						} else {
							ctx.endSuppression();
						}
						break;
					case 'webviewDraftState':
						ctx.setDraftProtection(!!message.hasDraft);
						break;
					case 'setToolSharingConfig':
						await projectManager.setToolSharingConfig(message.projectId, message.config);
						ctx.update();
						break;
					case 'updateSetting': {
						const settingKey = String(message.key || '');
						if (!SETTING_ALLOWLIST.has(settingKey)) {
							console.warn(`[ContextManager] Rejected disallowed setting key: ${settingKey}`);
							break;
						}
						const config = vscode.workspace.getConfiguration('contextManager');
						await config.update(settingKey, message.value, vscode.ConfigurationTarget.Global);
						// Don't re-render for settings - the value is already shown in the UI
						break;
					}
					case 'addTodo':
						await projectManager.addTodo(message.projectId, message.title, message.description);
						ctx.update();
						break;
					case 'updateTodo':
						await projectManager.updateTodo(message.projectId, message.todoId, message.updates);
						ctx.update();
						break;
					case 'deleteTodo': {
						if (!message.projectId || !message.todoId) { break; }
						const todoProject = projectManager.getProject(message.projectId);
						if (!todoProject?.todos?.some((t: any) => t.id === message.todoId)) {
							vscode.window.showWarningMessage('Cannot delete: TODO not found.');
							break;
						}
						const confirmDeleteTodo = await vscode.window.showWarningMessage(
							'Delete this TODO?',
							{ modal: true },
							'Delete'
						);
						if (confirmDeleteTodo === 'Delete') {
							await projectManager.deleteTodo(message.projectId, message.todoId);
							ctx.update();
						}
						break;
					}
					case 'runTodoAgent':
						// Run an existing TODO (not create a new one)
						await vscode.commands.executeCommand('workbench.action.chat.open', {
							query: `/todo run ${message.todoId}`,
							isPartialQuery: false
						});
						break;
					case 'continueWithPrompt':
						const todoToContinue = projectManager.getProject(message.projectId)?.todos.find(t => t.id === message.todoId);
						if (todoToContinue) {
							const customPrompt = await vscode.window.showInputBox({
								title: `Continue: ${todoToContinue.title}`,
								prompt: 'Add additional instructions (optional)',
								placeHolder: 'e.g., Focus on error handling, skip tests, use async/await...',
							});
							// customPrompt is undefined if cancelled, empty string if submitted without input
							if (customPrompt !== undefined) {
								const additionalInstructions = customPrompt ? ` Additional: ${customPrompt}` : '';
								await vscode.commands.executeCommand('workbench.action.chat.open', {
									query: `/todo run ${message.todoId}${additionalInstructions}`,
									isPartialQuery: false
								});
							}
						}
						break;
					case 'resumeTodo':
						// Resume a paused TODO
						await vscode.commands.executeCommand('workbench.action.chat.open', {
							query: `/todo resume ${message.todoId}`,
							isPartialQuery: false
						});
						break;
					case 'viewTodoDetails':
						// Show TODO details with smart resume context
						const todoDetails = projectManager.getProject(message.projectId)?.todos.find(t => t.id === message.todoId);
						if (todoDetails) {
							const latestRun = todoDetails.agentRuns?.[todoDetails.agentRuns.length - 1];
							
							// Build detailed view items for quick pick
							const items: vscode.QuickPickItem[] = [
								{ label: '$(info) Status', description: todoDetails.status, kind: vscode.QuickPickItemKind.Default },
								{ label: '$(tag) Priority', description: todoDetails.priority },
								{ label: '$(calendar) Created', description: new Date(todoDetails.created).toLocaleString() },
							];

							if (latestRun) {
								items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
								items.push({ label: '$(rocket) Agent Run', description: `${latestRun.status}` });

								if (latestRun.summary) {
									items.push({ 
										label: '$(note) Summary', 
										description: latestRun.summary.substring(0, 100),
										detail: latestRun.summary
									});
								}
							}

							items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
							items.push({ label: '$(play) Resume TODO', description: 'Continue agent work' });
							items.push({ label: '$(lightbulb) Extract Knowledge Cards', description: 'Save findings as knowledge' });
							items.push({ label: '$(history) View Full History', description: 'See complete conversation log' });
							items.push({ label: '$(copy) Copy TODO ID', description: message.todoId });

							const selected = await vscode.window.showQuickPick(items, {
								title: `TODO: ${todoDetails.title}`,
								placeHolder: todoDetails.description || 'Select an action'
							});

							if (selected?.label.includes('Resume')) {
								vscode.commands.executeCommand('workbench.action.chat.open', {
									query: `/todo resume ${message.todoId}`,
									isPartialQuery: false
								});
							} else if (selected?.label.includes('View Full History')) {
								// Show full conversation history in a new document
								if (latestRun?.conversationHistory?.length) {
									let historyText = `# TODO: ${todoDetails.title}\n`;
									historyText += `Run ID: ${latestRun.id}\n`;
									historyText += `Status: ${latestRun.status}\n`;
									historyText += `Started: ${new Date(latestRun.startTime).toLocaleString()}\n`;
									if (latestRun.endTime) {
										historyText += `Ended: ${new Date(latestRun.endTime).toLocaleString()}\n`;
									}
									historyText += `\n---\n\n`;

									// Add full conversation
									historyText += `## Full Conversation History\n\n`;
									for (let i = 0; i < latestRun.conversationHistory.length; i++) {
										const msg = latestRun.conversationHistory[i];
										historyText += `### ${msg.role.toUpperCase()} [${i + 1}]\n\n`;
										historyText += msg.content || '(no text content)';
										if (msg.toolCalls) {
											historyText += `\n\n**Tool Calls:**\n\`\`\`json\n${msg.toolCalls}\n\`\`\``;
										}
										if (msg.toolResults) {
											historyText += `\n\n**Tool Results:**\n\`\`\`json\n${msg.toolResults.substring(0, 2000)}${msg.toolResults.length > 2000 ? '...(truncated)' : ''}\n\`\`\``;
										}
										historyText += `\n\n---\n\n`;
									}

									// Open in a new untitled document
									const doc = await vscode.workspace.openTextDocument({
										content: historyText,
										language: 'markdown'
									});
									await vscode.window.showTextDocument(doc, { preview: true });
								} else {
									vscode.window.showInformationMessage('No conversation history available for this TODO.');
								}
							} else if (selected?.label.includes('Copy TODO ID')) {
								vscode.env.clipboard.writeText(message.todoId);
								vscode.window.showInformationMessage('TODO ID copied to clipboard');
							} else if (selected?.label.includes('Extract Knowledge Cards')) {
								// Show extractable items from the TODO
								if (!latestRun) {
									vscode.window.showInformationMessage('No agent run data to extract from.');
									break;
								}

								interface ExtractableItem extends vscode.QuickPickItem {
									itemType: 'summary' | 'finding' | 'response';
									content: string;
									source?: string;
									picked?: boolean;
								}

								const extractItems: ExtractableItem[] = [];

										// Add assistant responses from conversation history
										if (latestRun.conversationHistory?.length) {
											const assistantResponses: { content: string; firstLine: string }[] = [];
											for (const msg of latestRun.conversationHistory) {
												if (msg.role === 'assistant' && msg.content && msg.content.trim().length > 20) {
													const firstLine = msg.content.split('\n').find(l => l.trim().length > 20)?.trim() || msg.content.substring(0, 80);
													assistantResponses.push({ content: msg.content, firstLine });
												}
											}

											if (assistantResponses.length > 0) {
												const last = assistantResponses[assistantResponses.length - 1];
												extractItems.push({
													label: `$(star-full) Final Response`,
													description: last.firstLine.substring(0, 100) + (last.firstLine.length > 100 ? '...' : ''),
													itemType: 'response',
													content: last.content,
													source: `TODO: ${todoDetails.title}`,
													picked: true
												});
											}
										}

								if (extractItems.length === 0) {
									vscode.window.showInformationMessage('No extractable content found for this TODO run. Try running the TODO first.');
									break;
								}

								// Multi-select quick pick
								const selectedItems = await vscode.window.showQuickPick(extractItems, {
									title: 'Select items to save as Knowledge Cards',
									placeHolder: 'Select one or more items',
									canPickMany: true
								});

								if (!selectedItems || selectedItems.length === 0) {
									break;
								}

								// For each selected item, ask for category and create card
								const categories: vscode.QuickPickItem[] = [
									{ label: 'architecture', description: 'System design, structure' },
									{ label: 'pattern', description: 'Code patterns, conventions' },
									{ label: 'explanation', description: 'How something works' },
									{ label: 'note', description: 'General notes' },
									{ label: 'convention', description: 'Coding standards' },
									{ label: 'other', description: 'Miscellaneous' }
								];

								let cardsCreated = 0;
								for (const item of selectedItems) {
									// Ask for title
									const title = await vscode.window.showInputBox({
										title: `Knowledge Card ${cardsCreated + 1}/${selectedItems.length}`,
										prompt: 'Enter a title for this knowledge card',
										value: item.label.replace(/\$\([^)]+\)\s*/g, '').substring(0, 50)
									});

									if (title === undefined) {
										break; // User cancelled
									}

									// Ask for category
									const category = await vscode.window.showQuickPick(categories, {
										title: `Category for: ${title}`,
										placeHolder: 'Select a category'
									});

									if (!category) {
										break; // User cancelled
									}

									// Create the knowledge card
									await projectManager.addKnowledgeCard(
										message.projectId,
										title,
										item.content,
										category.label as 'architecture' | 'pattern' | 'convention' | 'explanation' | 'note' | 'other',
										[todoDetails.title.substring(0, 20)],
										item.source
									);
									cardsCreated++;
								}

								if (cardsCreated > 0) {
									vscode.window.showInformationMessage(`Created ${cardsCreated} knowledge card(s)`);
									ctx.update();
								}
							}
						}
						break;
					case 'viewTodoHistory':
						// Direct view of full conversation history
						const todoForHistory = projectManager.getProject(message.projectId)?.todos.find(t => t.id === message.todoId);
						if (todoForHistory) {
							const runForHistory = todoForHistory.agentRuns?.[todoForHistory.agentRuns.length - 1];
							if (runForHistory?.conversationHistory?.length) {
								let historyDoc = `# TODO: ${todoForHistory.title}\n`;
								historyDoc += `Run ID: ${runForHistory.id}\n`;
								historyDoc += `Status: ${runForHistory.status}\n`;
								historyDoc += `Started: ${new Date(runForHistory.startTime).toLocaleString()}\n`;
								if (runForHistory.endTime) {
									historyDoc += `Ended: ${new Date(runForHistory.endTime).toLocaleString()}\n`;
								}
								historyDoc += `\n---\n\n`;

								// Full conversation
								historyDoc += `## Full Conversation History\n\n`;
								for (let i = 0; i < runForHistory.conversationHistory.length; i++) {
									const msg = runForHistory.conversationHistory[i];
									historyDoc += `### ${msg.role.toUpperCase()} [${i + 1}]\n\n`;
									historyDoc += msg.content || '(no text content)';
									if (msg.toolCalls) {
										historyDoc += `\n\n**Tool Calls:**\n\`\`\`json\n${msg.toolCalls}\n\`\`\``;
									}
									if (msg.toolResults) {
										historyDoc += `\n\n**Tool Results:**\n\`\`\`json\n${msg.toolResults.substring(0, 2000)}${msg.toolResults.length > 2000 ? '...(truncated)' : ''}\n\`\`\``;
									}
									historyDoc += `\n\n---\n\n`;
								}

								const historyDocument = await vscode.workspace.openTextDocument({
									content: historyDoc,
									language: 'markdown'
								});
								await vscode.window.showTextDocument(historyDocument, { preview: true });
							} else {
								vscode.window.showInformationMessage('No conversation history available for this TODO.');
							}
						}
						break;
					case 'clearCacheEntry':
						cache.remove(message.entryId);
						ctx.update();
						break;
					case 'editCacheEntry': {
						const cacheUpdates: Record<string, string> = {};
						if (message.newName !== undefined) { cacheUpdates.symbolName = message.newName; }
						if (message.newContent !== undefined) { cacheUpdates.content = message.newContent; }
						if (Object.keys(cacheUpdates).length > 0) {
							cache.updateEntry(message.entryId, cacheUpdates);
							ctx.update();
						}
						break;
					}
					case 'clearAllCache':
						const confirmClearCache = await vscode.window.showWarningMessage(
							'Clear all cached explanations?',
							{ modal: true },
							'Clear All'
						);
						if (confirmClearCache === 'Clear All') {
							cache.clear();
							ctx.update();
						}
						break;
					case 'reexplain':
						const entry = cache.getAllEntries().find(c => c.id === message.entryId);
						if (entry) {
							await vscode.commands.executeCommand('workbench.action.chat.open', {
								query: `/${entry.type} ${entry.symbolName}`,
								isPartialQuery: false
							});
						}
						break;
					case 'addKnowledgeCard':
						await projectManager.addKnowledgeCard(
							message.projectId,
							message.title,
							message.content,
							message.category,
							message.tags,
							undefined,
							undefined,
							message.folderId,
							message.trackToolUsage === true
						);
						ctx.update();
						break;
					case 'addKnowledgeFolder':
						if (!message.projectId || !message.name) { break; }
						await projectManager.addKnowledgeFolder(message.projectId, message.name, message.parentFolderId || undefined);
						ctx.update();
						break;
					case 'renameKnowledgeFolder':
						if (!message.projectId || !message.folderId || !message.name) { break; }
						await projectManager.renameKnowledgeFolder(message.projectId, message.folderId, message.name);
						ctx.update();
						break;
					case 'deleteKnowledgeFolder':
						if (!message.projectId || !message.folderId) { break; }
						await projectManager.deleteKnowledgeFolder(message.projectId, message.folderId);
						ctx.update();
						break;
					case 'moveKnowledgeCard':
						if (!message.projectId || !message.cardId) { break; }
						await projectManager.moveKnowledgeCardToFolder(message.projectId, message.cardId, message.folderId || undefined);
						ctx.update();
						break;
					case 'generateCardWithAI': {
						// Prompt for topic, then open chat so the user sees the interaction.
						// Copilot will use the registered contextManager_saveKnowledgeCard tool via hooks.
						const cardTopic = await vscode.window.showInputBox({
							title: 'Generate Knowledge Card',
							prompt: 'What topic should the AI research and document?',
							placeHolder: 'e.g., How authentication works in this project, Error handling patterns used...',
						});
						if (cardTopic) {
							await vscode.commands.executeCommand('workbench.action.chat.open', {
								query: `Research the topic "${cardTopic}" in this codebase and save a knowledge card using the #contextManager_saveKnowledgeCard tool. Include code snippets, file paths, and specific details.`,
								isPartialQuery: false
							});
						}
						break;
					}
					case 'toggleCardSelection':
						await projectManager.toggleCardSelection(message.projectId, message.cardId);
						// Event-driven: updateProject fires onDidChangeProjects → debounced re-render
						break;
					case 'toggleCacheSelection':
						cache.toggleCacheSelection(message.entryId);
						// Event-driven: saveEntries fires onDidChangeCache → debounced re-render
						break;
					case 'deselectAllCards':
						await projectManager.deselectAllCards(message.projectId);
						break;
					case 'smartSelectCards':
						await vscode.commands.executeCommand('contextManager.smartSelect');
						break;
					case 'deselectAllCacheEntries':
						cache.deselectAllEntries(projectManager.getActiveProject()?.id);
						break;
					case 'deleteKnowledgeCard': {
						if (!message.projectId || !message.cardId) { break; }
						const cardProject = projectManager.getProject(message.projectId);
						if (!cardProject?.knowledgeCards?.some((c: any) => c.id === message.cardId)) {
							vscode.window.showWarningMessage('Cannot delete: knowledge card not found.');
							break;
						}
						const confirmDeleteCard = await vscode.window.showWarningMessage(
							'Delete this knowledge card?',
							{ modal: true },
							'Delete'
						);
						if (confirmDeleteCard === 'Delete') {
							await projectManager.deleteKnowledgeCard(message.projectId, message.cardId);
							ctx.update();
						}
						break;
					}
					case 'createCardFromSelection': {
						// Title comes from webview inline modal
						const selTitle = message.title;
						if (selTitle && message.projectId) {
							await projectManager.addKnowledgeCard(
								message.projectId,
								selTitle,
								message.selectedText,
								'note',
								[],
								message.sourceCardId ? `card:${message.sourceCardId}` : undefined
							);
							vscode.window.showInformationMessage(`Knowledge card "${selTitle}" created.`);
							ctx.update();
						}
						break;
					}
					case 'askAboutSelection': {
						let cardLabel = '';
						if (message.sourceCardId && message.projectId) {
							const proj = projectManager.getProject(message.projectId);
							const card = proj?.knowledgeCards?.find((c: any) => c.id === message.sourceCardId);
							if (card) { cardLabel = ` (from knowledge card "${card.title}" [id:${card.id}])`; }
						}
						const prefix = `Regarding this text${cardLabel}:\n\`\`\`\n${message.selectedText}\n\`\`\`\n`;
						await openInChatSession(prefix);
						break;
					}
					case 'createCardFromSelectionAI': {
						const selText = message.selectedText || '';
						const sourceCard = message.sourceCardId && message.projectId
							? projectManager.getProject(message.projectId)?.knowledgeCards?.find((c: any) => c.id === message.sourceCardId)
							: null;
						const sourceHint = sourceCard ? `\nSource card: "${sourceCard.title}"` : '';
						const aiCardQuery = `Create a knowledge card from this text.${sourceHint}\n\nSelected text:\n\`\`\`\n${selText}\n\`\`\`\n\nReturn a title, category (architecture|pattern|convention|explanation|note), content (markdown), and tags.`;
						await openInChatSession(aiCardQuery);
						break;
					}
					case 'replaceCardSelection': {
						// Replacement text comes from webview inline modal
						if (!message.projectId || !message.sourceCardId) { break; }
						const project = projectManager.getProject(message.projectId);
						const card = project?.knowledgeCards?.find((c: any) => c.id === message.sourceCardId);
						if (!card) { break; }
						const replacement = message.replacement;
						if (replacement !== undefined) {
							const newContent = card.content.split(message.selectedText).join(replacement);
							await projectManager.updateKnowledgeCard(message.projectId, message.sourceCardId, { content: newContent });
							vscode.window.showInformationMessage('Selection replaced.');
							ctx.update();
						}
						break;
					}
					case 'deleteCardSelection': {
						// Confirmation already done in webview inline modal
						if (!message.projectId || !message.sourceCardId || !message.confirmed) { break; }
						const delProject = projectManager.getProject(message.projectId);
						const delCard = delProject?.knowledgeCards?.find((c: any) => c.id === message.sourceCardId);
						if (!delCard) { break; }
						const newContent = delCard.content.split(message.selectedText).join('');
						await projectManager.updateKnowledgeCard(message.projectId, message.sourceCardId, { content: newContent });
						vscode.window.showInformationMessage('Selection deleted from card.');
						ctx.update();
						break;
					}
					case 'refineCardSelection': {
						if (!message.projectId || !message.sourceCardId || !message.instruction || !message.selectedText) { break; }
						const refSelCard = projectManager.getProject(message.projectId)?.knowledgeCards?.find((c: any) => c.id === message.sourceCardId);
						if (!refSelCard) { break; }
						const refSelQuery = `Refine this section of the knowledge card "${refSelCard.title}" [id:${refSelCard.id}].\n\nInstruction: ${message.instruction}\n\nSection to refine:\n\`\`\`\n${message.selectedText}\n\`\`\``;
						await openInChatSession(refSelQuery);
						break;
					}
					case 'saveToKnowledge':
						const cacheEntry = cache.getAllEntries().find(c => c.id === message.cacheEntryId);
						if (cacheEntry && message.projectId) {
							const title = await vscode.window.showInputBox({
								prompt: 'Title for the knowledge card',
								value: cacheEntry.symbolName,
								placeHolder: 'Enter a title…'
							});
							if (!title) break; // user cancelled
							await projectManager.createCardFromCache(
								message.projectId,
								title,
								cacheEntry.content,
								cacheEntry.filePath
							);
							vscode.window.showInformationMessage(
								`Saved "${title}" to knowledge cards`
							);
							ctx.update();
						}
						break;
					case 'editKnowledgeCard': {
						if (!message.projectId || !message.cardId) { break; }
						const existingCard = projectManager.getProject(message.projectId)?.knowledgeCards?.find((c: any) => c.id === message.cardId);
						if (!existingCard) {
							ctx.postMessage({ command: 'knowledgeCardSaveResult', success: false, message: 'Knowledge card not found.' });
							break;
						}
						if (typeof message.baseUpdated === 'number' && existingCard.updated !== message.baseUpdated) {
							const overwrite = await vscode.window.showWarningMessage(
								'This knowledge card changed in the background while you were editing. Overwrite it with your current draft?',
								{ modal: true },
								'Overwrite'
							);
							if (overwrite !== 'Overwrite') {
								ctx.postMessage({
									command: 'knowledgeCardSaveResult',
									success: false,
									conflict: true,
									updated: existingCard.updated,
									message: 'Card changed in the background. Your draft is still open.'
								});
								break;
							}
						}

						const cardUpdates: Record<string, any> = {};
						// Canvas editor sends title/content/category/tags directly
						if (message.title !== undefined) { cardUpdates.title = message.title; }
						if (message.content !== undefined) { cardUpdates.content = message.content; }
						if (message.category !== undefined) { cardUpdates.category = message.category; }
						if (message.tags !== undefined) { cardUpdates.tags = message.tags; }
						// Legacy inline-edit fields
						if (message.newTitle !== undefined) { cardUpdates.title = message.newTitle; }
						if (message.newContent !== undefined) { cardUpdates.content = message.newContent; }
						if (message.trackToolUsage !== undefined) { cardUpdates.trackToolUsage = message.trackToolUsage === true; }
						// Boolean flag toggles: pinned, archived, includeInContext, isGlobal
						if (message.pinned !== undefined) { cardUpdates.pinned = message.pinned === true; }
						if (message.archived !== undefined) { cardUpdates.archived = message.archived === true; }
						if (message.includeInContext !== undefined) { cardUpdates.includeInContext = message.includeInContext === true; }
						if (message.isGlobal !== undefined) { cardUpdates.isGlobal = message.isGlobal === true; }
						if (Object.keys(cardUpdates).length > 0) {
							const updatedCard = await projectManager.updateKnowledgeCard(
								message.projectId,
								message.cardId,
								cardUpdates
							);
							ctx.postMessage({
								command: 'knowledgeCardSaveResult',
								success: !!updatedCard,
								updated: updatedCard?.updated,
								message: updatedCard ? 'Saved.' : 'Save failed.'
							});
						} else {
							ctx.postMessage({ command: 'knowledgeCardSaveResult', success: false, message: 'No changes to save.' });
						}
						break;
					}
					case 'refineEntireCard': {
						if (!message.projectId || !message.cardId || !message.instruction) { break; }
						const refCard = projectManager.getProject(message.projectId)?.knowledgeCards?.find((c: any) => c.id === message.cardId);
						if (!refCard) { break; }
						const refEntireQuery = `Refine this knowledge card "${refCard.title}" [id:${refCard.id}].\n\nInstruction: ${message.instruction}\n\nCurrent content:\n\`\`\`markdown\n${refCard.content}\n\`\`\``;
						await openInChatSession(refEntireQuery);
						break;
					}
					case 'updateConvention': {
						if (!message.projectId) { break; }
						if (message.conventionId) {
							await projectManager.updateConvention(message.projectId, message.conventionId, message.updates);
						} else if (message.title && message.content) {
							await projectManager.addConvention(message.projectId, message.category || 'patterns', message.title, message.content, message.confidence || 'inferred', message.source || 'distilled from observations');
						}
						ctx.update();
						break;
					}
					case 'deleteConvention': {
						if (!message.projectId || !message.conventionId) { break; }
						await projectManager.removeConvention(message.projectId, message.conventionId);
						ctx.update();
						break;
					}
					case 'discardConvention': {
						// Delete the convention AND increment the discard counter for its category
						await projectManager.removeConvention(message.projectId, message.conventionId);
						if (message.category) {
							await projectManager.incrementDiscardCount(message.projectId, `convention:${message.category}`);
						}
						ctx.update();
						break;
					}
					case 'discardWorkingNote': {
						// Delete the note AND increment the discard counter
						await projectManager.removeWorkingNote(message.projectId, message.noteId);
						await projectManager.incrementDiscardCount(message.projectId, 'note:fileRelationship');
						ctx.update();
						break;
					}
					case 'resetDiscardCount': {
						if (message.key) {
							await projectManager.resetDiscardCount(message.projectId, message.key);
						}
						break;
					}
					case 'toggleConventionSelection': {
						if (message.projectId && message.conventionId) {
							await projectManager.toggleConventionSelection(message.projectId, message.conventionId);
						}
						break;
					}
					case 'deleteToolHint': {
						if (!message.projectId || !message.hintId) { break; }
						await projectManager.removeToolHint(message.projectId, message.hintId);
						ctx.update();
						break;
					}
					case 'toggleToolHintSelection': {
						if (message.projectId && message.hintId) {
							await projectManager.toggleToolHintSelection(message.projectId, message.hintId);
						}
						break;
					}
					case 'updateWorkingNote': {
						if (!message.projectId) { break; }
						if (message.noteId) {
							await projectManager.updateWorkingNote(message.projectId, message.noteId, message.updates);
						} else if (message.subject && message.insight) {
							await projectManager.addWorkingNote(message.projectId, message.subject, message.insight, message.relatedFiles || [], [], message.source || 'distilled from observations');
						}
						ctx.update();
						break;
					}
					case 'promoteNoteToCard': {
						const note = projectManager.getWorkingNotes(message.projectId).find(n => n.id === message.noteId);
						if (note) {
							await projectManager.addKnowledgeCard(
								message.projectId,
								note.subject,
								note.insight,
								'note',
								[],
								`Working note (promoted)`,
								note.relatedFiles,
							);
							vscode.window.showInformationMessage(`Promoted "${note.subject}" to knowledge card.`);
							ctx.update();
						}
						break;
					}
					case 'deleteWorkingNote': {
						if (!message.projectId || !message.noteId) { break; }
						await projectManager.removeWorkingNote(message.projectId, message.noteId);
						ctx.update();
						break;
					}
					case 'exportAll': {
						const allProjects = projectManager.getAllProjects();
						const allCache = cache.getAllEntries();
						const exportData = {
							version: 1,
							type: 'full' as const,
							exportedAt: new Date().toISOString(),
							projects: allProjects,
							cache: allCache,
						};
						const uri = await vscode.window.showSaveDialog({
							defaultUri: vscode.Uri.file(`context-manager-export-${new Date().toISOString().slice(0, 10)}.ctxmgr.json`),
							filters: { 'ContextManager Export': ['ctxmgr.json', 'json'] },
							title: 'Export All Data',
						});
						if (uri) {
							await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(exportData, null, 2), 'utf-8'));
							vscode.window.showInformationMessage(`Exported ${allProjects.length} project(s) and ${allCache.length} cache entries to ${uri.fsPath}`);
						}
						break;
					}
					case 'importAll': {
						const uris = await vscode.window.showOpenDialog({
							canSelectMany: false,
							filters: { 'ContextManager Export': ['ctxmgr.json', 'json'] },
							title: 'Import Data',
						});
						if (!uris || uris.length === 0) { break; }
						try {
							const raw = Buffer.from(await vscode.workspace.fs.readFile(uris[0])).toString('utf-8');
							const data = JSON.parse(raw);
							if (!data.version || !data.type) {
								vscode.window.showErrorMessage('Invalid export file: missing version or type field.');
								break;
							}
							if (data.type === 'project') {
								// Single project file used with Import All — treat as project import
								const importedProject = data.project;
								if (!importedProject || !importedProject.id) {
									vscode.window.showErrorMessage('Invalid project export file.');
									break;
								}
								const existing = projectManager.getProject(importedProject.id);
								if (existing) {
									const choice = await vscode.window.showQuickPick(
										['Overwrite existing', 'Import as copy', 'Cancel'],
										{ placeHolder: `Project "${existing.name}" already exists` }
									);
									if (!choice || choice === 'Cancel') { break; }
									if (choice === 'Import as copy') {
										importedProject.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
										importedProject.name = importedProject.name + ' (imported)';
									}
								}
								const projects = projectManager.getAllProjects().filter(p => p.id !== importedProject.id);
								projects.push(importedProject);
								await projectManager['storage'].saveProjects(projects);
								vscode.window.showInformationMessage(`Imported project "${importedProject.name}"`);
								ctx.update();
								break;
							}
							if (data.type !== 'full') {
								vscode.window.showErrorMessage(`Unknown export type: "${data.type}". Expected "full" or "project".`);
								break;
							}
							const importedProjects = data.projects || [];
							const importedCache = data.cache || [];
							const mode = await vscode.window.showQuickPick(
								['Merge with existing data', 'Replace all data'],
								{ placeHolder: `Import ${importedProjects.length} project(s) and ${importedCache.length} cache entries` }
							);
							if (!mode) { break; }
							if (mode === 'Replace all data') {
								const confirm = await vscode.window.showWarningMessage(
									'This will replace ALL existing projects and cache data. This cannot be undone.',
									{ modal: true },
									'Replace All'
								);
								if (confirm !== 'Replace All') { break; }
								await projectManager['storage'].saveProjects(importedProjects);
								cache.clear();
								for (const entry of importedCache) {
									cache.set(entry.key, entry.content, {
										symbolName: entry.symbolName,
										type: entry.type, projectId: entry.projectId,
										filePath: entry.filePath, lineNumber: entry.lineNumber,
										referenceFiles: entry.referenceFiles,
									});
								}
								vscode.window.showInformationMessage(`Replaced all data: ${importedProjects.length} project(s), ${importedCache.length} cache entries imported.`);
							} else {
								// Merge: add imported projects that don't already exist
								const existingProjects = projectManager.getAllProjects();
								const existingIds = new Set(existingProjects.map(p => p.id));
								let addedProjects = 0;
								for (const proj of importedProjects) {
									if (!existingIds.has(proj.id)) {
										existingProjects.push(proj);
										addedProjects++;
									}
								}
								await projectManager['storage'].saveProjects(existingProjects);
								// Merge cache: add entries that don't already exist
								const existingCacheIds = new Set(cache.getAllEntries().map(e => e.id));
								let addedCache = 0;
								for (const entry of importedCache) {
									if (!existingCacheIds.has(entry.id)) {
										cache.set(entry.key, entry.content, {
											symbolName: entry.symbolName,
											type: entry.type, projectId: entry.projectId,
											filePath: entry.filePath, lineNumber: entry.lineNumber,
											referenceFiles: entry.referenceFiles,
										});
										addedCache++;
									}
								}
								vscode.window.showInformationMessage(`Merged: ${addedProjects} new project(s), ${addedCache} new cache entries. (${importedProjects.length - addedProjects} project(s) and ${importedCache.length - addedCache} cache entries already existed.)`);
							}
							ctx.update();
						} catch (err: any) {
							vscode.window.showErrorMessage(`Import failed: ${err.message || err}`);
						}
						break;
					}
					case 'exportProject': {
						const proj = projectManager.getProject(message.projectId);
						if (!proj) {
							vscode.window.showWarningMessage('No project selected to export.');
							break;
						}
						const exportProjectData = {
							version: 1,
							type: 'project' as const,
							exportedAt: new Date().toISOString(),
							project: proj,
						};
						const safeName = proj.name.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
						const projUri = await vscode.window.showSaveDialog({
							defaultUri: vscode.Uri.file(`${safeName}.ctxmgr.json`),
							filters: { 'ContextManager Export': ['ctxmgr.json', 'json'] },
							title: `Export Project: ${proj.name}`,
						});
						if (projUri) {
							await vscode.workspace.fs.writeFile(projUri, Buffer.from(JSON.stringify(exportProjectData, null, 2), 'utf-8'));
							vscode.window.showInformationMessage(`Exported project "${proj.name}" (${proj.knowledgeCards?.length || 0} cards, ${proj.todos?.length || 0} TODOs)`);
						}
						break;
					}
					case 'importProject': {
						const projUris = await vscode.window.showOpenDialog({
							canSelectMany: false,
							filters: { 'ContextManager Export': ['ctxmgr.json', 'json'] },
							title: 'Import Project',
						});
						if (!projUris || projUris.length === 0) { break; }
						try {
							const rawProj = Buffer.from(await vscode.workspace.fs.readFile(projUris[0])).toString('utf-8');
							const projData = JSON.parse(rawProj);
							if (!projData.version) {
								vscode.window.showErrorMessage('Invalid export file: missing version field.');
								break;
							}
							let importedProj;
							if (projData.type === 'project') {
								importedProj = projData.project;
							} else if (projData.type === 'full' && projData.projects?.length > 0) {
								// Full export — let user pick which project to import
								const pick = await vscode.window.showQuickPick(
									projData.projects.map((p: any) => ({ label: p.name, description: `${p.knowledgeCards?.length || 0} cards, ${p.todos?.length || 0} TODOs`, project: p })),
									{ placeHolder: 'Select a project to import' }
								);
								if (!pick) { break; }
								importedProj = (pick as any).project;
							} else {
								vscode.window.showErrorMessage('No project data found in the file.');
								break;
							}
							if (!importedProj || !importedProj.id) {
								vscode.window.showErrorMessage('Invalid project data in the file.');
								break;
							}
							const existingProj = projectManager.getProject(importedProj.id);
							if (existingProj) {
								const choice = await vscode.window.showQuickPick(
									['Overwrite existing', 'Import as copy', 'Cancel'],
									{ placeHolder: `Project "${existingProj.name}" already exists` }
								);
								if (!choice || choice === 'Cancel') { break; }
								if (choice === 'Import as copy') {
									importedProj.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
									importedProj.name = importedProj.name + ' (imported)';
								}
							}
							const allProjs = projectManager.getAllProjects().filter(p => p.id !== importedProj.id);
							allProjs.push(importedProj);
							await projectManager['storage'].saveProjects(allProjs);
							vscode.window.showInformationMessage(`Imported project "${importedProj.name}" (${importedProj.knowledgeCards?.length || 0} cards, ${importedProj.todos?.length || 0} TODOs)`);
							ctx.update();
						} catch (err: any) {
							vscode.window.showErrorMessage(`Import failed: ${err.message || err}`);
						}
						break;
					}
					case 'exportCardsToFiles': {
						if (!message.projectId) { break; }
						const result = await exportCardsToFilesystem(projectManager, message.projectId);
						if (result) {
							vscode.window.showInformationMessage(`Exported ${result.exported} card(s) to ${result.dir}`);
						}
						break;
					}
					case 'importCardsFromDir': {
						if (!message.projectId) { break; }
						const importResult = await importCardsFromDirectory(projectManager, message.projectId);
						if (importResult) {
							vscode.window.showInformationMessage(`Imported ${importResult.imported} card(s), skipped ${importResult.skipped}.`);
							ctx.update();
						}
						break;
					}

				case 'distillQueue': {
					if (!ctx.autoCapture) {
						ctx.postMessage({ command: 'distillQueueResult', error: 'Auto-capture not available.' });
						break;
					}
					const activeProject = projectManager.getActiveProject();
					if (!activeProject) {
						ctx.postMessage({ command: 'distillQueueResult', error: 'No active project selected.' });
						break;
					}
					const allQueueItems = activeProject.cardQueue || [];
					const selectedIds: string[] | undefined = message.candidateIds;
					const queueItems = selectedIds?.length
						? allQueueItems.filter((c: any) => selectedIds.includes(c.id))
						: allQueueItems;
					if (!queueItems.length) {
						ctx.postMessage({ command: 'distillQueueResult', error: 'Queue is empty. Responses will be added automatically as you chat.' });
						break;
					}
					ctx.postMessage({ command: 'distillQueueResult', status: 'loading', total: queueItems.length });
					try {
						const cards = await ctx.autoCapture.distillQueue(queueItems);
						if (!cards || !cards.length) {
							ctx.postMessage({ command: 'distillQueueResult', error: 'No cards extracted. Try adding more responses or check model availability.' });
						} else {
							ctx.postMessage({ command: 'distillQueueResult', cards });
						}
					} catch (err: any) {
						ctx.postMessage({ command: 'distillQueueResult', error: err.message || 'Queue distillation failed.' });
					}
					break;
				}

								case 'approveDistilledCard': {
					if (!message.projectId || !message.title || !message.content) { break; }
					try {
						const dupAction = await _promptDuplicateAction(
							projectManager, message.projectId, message.title, message.content
						);
						if (!dupAction) { break; } // user cancelled

						if (dupAction.action === 'merge') {
							const targetCard = projectManager.getKnowledgeCards(message.projectId)
								.find(c => c.id === dupAction.targetCardId);
							if (targetCard) {
								const mergedContent = targetCard.content + '\n\n---\n**Merged from distill (' + new Date().toLocaleDateString() + '):**\n' + message.content;
								const updated = await projectManager.updateKnowledgeCard(
									message.projectId, dupAction.targetCardId, { content: mergedContent }
								);
								if (updated) {
									vscode.window.showInformationMessage('Merged into "' + updated.title + '".');
									ctx.update();
								}
							}
						} else {
							const card = await projectManager.addKnowledgeCard(
								message.projectId,
								message.title,
								message.content,
								(message.category as any) || 'note',
								[]
							);
							if (card) {
								vscode.window.showInformationMessage('Card "' + message.title + '" added to knowledge base.');
								ctx.update();
							} else {
								vscode.window.showErrorMessage('Failed to create card.');
							}
						}
					} catch (err: any) {
						vscode.window.showErrorMessage(`Error creating card: ${err.message}`);
					}
					break;
				}

				// ── Card Queue Commands ──

				case 'approveCandidate': {
					if (!message.projectId || !message.candidateId) { break; }
					const activeProject = projectManager.getProject(message.projectId);
					if (!activeProject) {
						vscode.window.showWarningMessage('Project not found.');
						break;
					}
					const candidate = activeProject.cardQueue?.find((c: any) => c.id === message.candidateId);
					if (!candidate) {
						vscode.window.showWarningMessage('Candidate not found.');
						break;
					}
					try {
						const overrides = message.overrides || {};
						const finalTitle = overrides.title || candidate.suggestedTitle;
						const finalContent = overrides.content || candidate.suggestedContent;

						const dupAction = await _promptDuplicateAction(
							projectManager, message.projectId, finalTitle, finalContent
						);
						if (!dupAction) { break; } // user cancelled

						if (dupAction.action === 'merge') {
							const merged = await projectManager.mergeCardFromQueue(
								message.projectId, message.candidateId, dupAction.targetCardId, overrides
							);
							if (merged) {
								vscode.window.showInformationMessage(`🔀 Merged into existing card "${merged.title}".`);
								ctx.update();
							} else {
								vscode.window.showErrorMessage('Failed to merge card.');
							}
						} else {
							const cardId = await projectManager.approveQueuedCard(
								message.projectId, message.candidateId, overrides
							);
							if (cardId) {
								vscode.window.showInformationMessage(
									`✅ Knowledge card "${finalTitle}" created from queue.`
								);
								ctx.update();
							} else {
								vscode.window.showErrorMessage('Failed to create card.');
							}
						}
					} catch (err: any) {
						vscode.window.showErrorMessage(`Error approving candidate: ${err.message}`);
					}
					break;
				}

				case 'rejectCandidate': {
					if (!message.projectId || !message.candidateId) { break; }
					try {
						await projectManager.rejectQueuedCard(message.projectId, message.candidateId);
						ctx.update();
					} catch (err: any) {
						vscode.window.showErrorMessage(`Error rejecting candidate: ${err.message}`);
					}
					break;
				}

				case 'editAndApproveCandidate': {
					if (!message.projectId || !message.candidateId) { break; }
					const activeProject = projectManager.getProject(message.projectId);
					if (!activeProject) {
						vscode.window.showWarningMessage('Project not found.');
						break;
					}
					const candidate = activeProject.cardQueue?.find((c: any) => c.id === message.candidateId);
					if (!candidate) {
						vscode.window.showWarningMessage('Candidate not found.');
						break;
					}

					// Show input boxes for editing
					const editedTitle = await vscode.window.showInputBox({
						prompt: 'Edit card title',
						value: candidate.suggestedTitle,
						validateInput: (val) => val.trim() ? null : 'Title cannot be empty'
					});
					if (!editedTitle) { break; } // User cancelled

					const editedCategory = await vscode.window.showQuickPick(
						['architecture', 'pattern', 'convention', 'explanation', 'note', 'other'],
						{
							placeHolder: 'Select category',
							title: 'Card Category',
						}
					);
					if (!editedCategory) { break; } // User cancelled

					// Check for duplicates before saving
					const dupAction = await _promptDuplicateAction(
						projectManager, message.projectId, editedTitle, candidate.suggestedContent
					);
					if (!dupAction) { break; } // User cancelled

					try {
						const overrides = {
							title: editedTitle,
							category: editedCategory as any,
							content: candidate.suggestedContent,
						};
						if (dupAction.action === 'merge') {
							const merged = await projectManager.mergeCardFromQueue(
								message.projectId, message.candidateId, dupAction.targetCardId, overrides
							);
							if (merged) {
								vscode.window.showInformationMessage(`🔀 Merged into existing card "${merged.title}".`);
								ctx.update();
							} else {
								vscode.window.showErrorMessage('Failed to merge card.');
							}
						} else {
							const cardId = await projectManager.approveQueuedCard(
								message.projectId, message.candidateId, overrides
							);
							if (cardId) {
								vscode.window.showInformationMessage(
									`✅ Knowledge card "${editedTitle}" created from queue.`
								);
								ctx.update();
							} else {
								vscode.window.showErrorMessage('Failed to create card.');
							}
						}
					} catch (err: any) {
						vscode.window.showErrorMessage(`Error approving edited candidate: ${err.message}`);
					}
					break;
				}

				// ── Card Canvas: New Handlers ──

				case 'getTileData': {
					if (!message.projectId || !message.tileId) { break; }
					const project = projectManager.getProject(message.projectId);
					if (!project) { break; }
					const { renderToolCallViewer, renderAnchorPills, renderSourceMaterial } = await import('./cardCanvas.js');
					let data: any = null;
					if (message.tileType === 'queue') {
						const candidate = project.cardQueue?.find((c: any) => c.id === message.tileId);
						if (candidate) {
							data = {
								isQueue: true,
								title: candidate.suggestedTitle || '',
								category: candidate.suggestedCategory || candidate.category || 'note',
								content: candidate.suggestedContent || candidate.response || '',
								tags: [],
								toolCallsHtml: renderToolCallViewer(candidate.toolCalls || [], false),
								sourceHtml: renderSourceMaterial([{
									title: 'Original Prompt/Response',
									prompt: candidate.prompt || '',
									response: candidate.response || '',
								}]),
								anchorsHtml: '',
							};
						}
					} else {
						const card = project.knowledgeCards?.find((c: any) => c.id === message.tileId);
						if (card) {
							data = {
								isQueue: false,
								title: card.title,
								category: card.category,
								content: card.content,
								baseUpdated: card.updated,
								tags: card.tags || [],
								isGlobal: !!card.isGlobal,
								toolCallsHtml: '',
								sourceHtml: '',
								anchorsHtml: renderAnchorPills(card.anchors || []),
							};
						}
					}
					if (data) {
						ctx.postMessage({ command: 'populateEditor', data });
					}
					break;
				}

				case 'getCompositionData': {
					if (!message.projectId || !message.selectedIds?.length) { break; }
					const project = projectManager.getProject(message.projectId);
					if (!project) { break; }
					const { renderToolCallEvidence, renderSourceMaterial } = await import('./cardCanvas.js');

					// Search BOTH queue AND saved cards (+ conventions, notes, hints)
					const candidates = (project.cardQueue || []).filter((c: any) => message.selectedIds.includes(c.id));
					const savedCards = (project.knowledgeCards || []).filter((c: any) => message.selectedIds.includes(c.id));
					const conventions = (project.conventions || []).filter((c: any) => message.selectedIds.includes(c.id));
					const notes = (project.workingNotes || []).filter((n: any) => message.selectedIds.includes(n.id));

					const sourceItems: Array<{ title: string; prompt: string; response: string }> = [];
					// Queue items have prompt/response
					for (const c of candidates) {
						sourceItems.push({
							title: c.suggestedTitle || 'Untitled',
							prompt: c.prompt || '',
							response: c.response || '',
						});
					}
					// Saved cards — show content as response
					for (const card of savedCards) {
						sourceItems.push({
							title: card.title,
							prompt: '',
							response: card.content || '',
						});
					}
					// Conventions
					for (const conv of conventions) {
						sourceItems.push({
							title: `[Convention] ${(conv as any).title}`,
							prompt: '',
							response: (conv as any).content || '',
						});
					}
					// Working notes
					for (const note of notes) {
						sourceItems.push({
							title: `[Note] ${(note as any).subject}`,
							prompt: '',
							response: (note as any).insight || '',
						});
					}

					const evidenceGroups = candidates
						.filter((c: any) => c.toolCalls?.length > 0)
						.map((c: any) => ({
							title: c.suggestedTitle || 'Untitled',
							toolCalls: c.toolCalls,
						}));

					// Gather all tags from selected saved cards
					const allTags = [...new Set(savedCards.flatMap((c: any) => c.tags || []))];

					const data = {
						isQueue: false,
						title: '',
						category: 'note',
						content: '',
						tags: allTags,
						toolCallsHtml: renderToolCallEvidence(evidenceGroups),
						sourceHtml: renderSourceMaterial(sourceItems),
						anchorsHtml: '',
					};
					ctx.postMessage({ command: 'populateEditor', data });
					break;
				}

				case 'approveCandidateWithEdits': {
					if (!message.projectId || !message.candidateId) { break; }
					try {
						const project = projectManager.getProject(message.projectId);
						const candidate = project?.cardQueue?.find((c: any) => c.id === message.candidateId);
						const { extractAnchorsFromToolCalls } = await import('./cardCanvas.js');
						const anchors = candidate?.toolCalls ? extractAnchorsFromToolCalls(candidate.toolCalls) : [];
						const overrides: any = {
							title: message.title,
							category: message.category,
							content: message.content,
							tags: message.tags,
						};
						if (anchors.length > 0) { overrides.anchors = anchors; }
						const cardId = await projectManager.approveQueuedCard(
							message.projectId, message.candidateId, overrides
						);
						if (cardId) {
							vscode.window.showInformationMessage(`✅ Knowledge card "${message.title}" created from queue.`);
							ctx.update();
						} else {
							vscode.window.showErrorMessage('Failed to create card.');
						}
					} catch (err: any) {
						vscode.window.showErrorMessage(`Error: ${err.message}`);
					}
					break;
				}

				case 'bulkRejectCandidates': {
					if (!message.projectId || !message.candidateIds?.length) { break; }
					try {
						for (const cid of message.candidateIds) {
							await projectManager.rejectQueuedCard(message.projectId, cid);
						}
						ctx.update();
					} catch (err: any) {
						vscode.window.showErrorMessage(`Error: ${err.message}`);
					}
					break;
				}

				case 'bulkQuickSave': {
					if (!message.projectId || !message.candidateIds?.length) { break; }
					let saved = 0;
					try {
						for (const cid of message.candidateIds) {
							const result = await projectManager.approveQueuedCard(message.projectId, cid);
							if (result) { saved++; }
						}
						vscode.window.showInformationMessage(`✅ ${saved} card${saved !== 1 ? 's' : ''} saved from queue.`);
						ctx.update();
					} catch (err: any) {
						vscode.window.showErrorMessage(`Error: ${err.message}`);
					}
					break;
				}

				case 'openFile': {
					if (!message.path) { break; }
					try {
						const filePath = message.path.replace(/:(\d+)(:\d+)?$/, '');
						const lineMatch = message.path.match(/:(\d+)/);
						const line = message.line || (lineMatch ? parseInt(lineMatch[1], 10) : 0);
						const uri = vscode.Uri.file(filePath);
						const doc = await vscode.workspace.openTextDocument(uri);
						const editor = await vscode.window.showTextDocument(doc, { preview: true });
						if (line > 0) {
							const position = new vscode.Position(line - 1, 0);
							editor.selection = new vscode.Selection(position, position);
							editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
						}
					} catch {
						// File may not exist
					}
					break;
				}

				case 'synthesizeCard': {
					if (!message.projectId || !message.candidateIds?.length) {
						ctx.postMessage({ command: 'aiDraftResult', data: null, error: 'No project or candidates selected' });
						break;
					}
					try {
						const project = projectManager.getProject(message.projectId);
						if (!project) {
							ctx.postMessage({ command: 'aiDraftResult', data: null, error: 'Project not found' });
							break;
						}
						// Gather source items from queue AND saved cards
						const queue = project.cardQueue || [];
						const saved = projectManager.getKnowledgeCards(message.projectId) || [];
						const items: Array<{ title?: string; prompt?: string; response?: string; content?: string; toolCalls?: any[] }> = [];
						for (const cid of message.candidateIds) {
							const qItem = queue.find((q: any) => q.id === cid);
							if (qItem) { items.push(qItem); continue; }
							const sItem = saved.find((s: any) => s.id === cid);
							if (sItem) { items.push(sItem); }
						}
						if (!items.length) {
							ctx.postMessage({ command: 'aiDraftResult', data: null, error: `None of the ${message.candidateIds.length} selected item(s) were found in the queue or saved cards` });
							break;
						}

						// Build LLM prompt
						const sourceMaterial = items.map((item, idx) => {
							const parts: string[] = [`[${idx + 1}]`];
							if (item.title) { parts.push(`Title: ${item.title}`); }
							if (item.prompt) { parts.push(`Prompt: ${item.prompt}`); }
							if (item.response) { parts.push(`Response: ${item.response}`); }
							if (item.content) { parts.push(`Content: ${item.content}`); }
							if (item.toolCalls?.length) {
								parts.push(`Tool Calls (${item.toolCalls.length}):`);
								for (const tc of item.toolCalls.slice(0, 10)) {
									parts.push(`  - ${tc.toolName || tc.name || 'unknown'}: ${JSON.stringify(tc.input || tc.arguments || '').substring(0, 300)}`);
									if (tc.output || tc.result) {
										parts.push(`    output: ${String(tc.output || tc.result).substring(0, 500)}`);
									}
								}
							}
							return parts.join('\n');
						}).join('\n\n---\n\n');

						const userHint = message.currentTitle || message.currentContent
							? `\nUser's current draft:\n  Title: ${message.currentTitle || '(none)'}\n  Content: ${message.currentContent || '(none)'}\nUse this as a hint for the topic/direction but generate a comprehensive card.\n`
							: '';

						const customPrompt = (message.customPrompt || '').trim();
						const customDirective = customPrompt
							? `\n## User's Custom Instructions\n${customPrompt}\nFollow the user's instructions above while still returning valid JSON.\n`
							: '';

						const defaultSynthPrompt = `You are synthesizing a knowledge card for a software project reference.

Create ONE comprehensive knowledge card that captures all important technical details.
Preserve code snippets, file paths, commands, exact values, and step-by-step instructions verbatim.
A developer reading this card alone should learn everything from it.

Return ONLY valid JSON:
{
  "title": "descriptive title (5-10 words)",
  "category": "architecture|pattern|convention|explanation|note",
  "content": "full markdown content — preserve code blocks, lists, and formatting",
  "tags": ["tag1", "tag2"]
}`;

						const synthInstructions = ConfigurationManager.getEffectivePrompt('synthesizeCard', defaultSynthPrompt);
						const llmPrompt = `${synthInstructions}\n${customDirective}\nSOURCE MATERIAL (${items.length} item${items.length !== 1 ? 's' : ''}):\n${sourceMaterial}\n${userHint}`;

						const modelFamily = ConfigurationManager.synthesisModelFamily;
						const selector: vscode.LanguageModelChatSelector = modelFamily ? { family: modelFamily } : {};
						const models = await vscode.lm.selectChatModels(selector);
						if (!models.length) {
							ctx.postMessage({ command: 'aiDraftResult', data: null, error: `No language model available${modelFamily ? ` (requested family: "${modelFamily}")` : ''}. Ensure Copilot Chat is active.` });
							break;
						}

						ctx.postMessage({ command: 'aiDraftProgress', phase: 'calling-model', detail: `Using ${models[0].name || 'LLM'}…` });

						const messages = [vscode.LanguageModelChatMessage.User(llmPrompt)];
						const response = await Promise.race([
							models[0].sendRequest(messages, { justification: 'ContextManager: synthesizing knowledge card from selected items' }, new vscode.CancellationTokenSource().token),
							new Promise<null>((_, reject) => setTimeout(() => reject(new Error('timeout')), 90_000)),
						]);
						if (!response) {
							ctx.postMessage({ command: 'aiDraftResult', data: null, error: 'LLM returned no response' });
							break;
						}

						ctx.postMessage({ command: 'aiDraftProgress', phase: 'streaming', detail: 'Receiving tokens…' });
						let text = '';
						let lastProgressAt = 0;
						for await (const part of (response as any).stream ?? (response as any).text ?? []) {
							if (typeof part === 'string') { text += part; }
							else if (part?.value) { text += part.value; }
							// Send progress every 500ms
							const now = Date.now();
							if (now - lastProgressAt > 500) {
								lastProgressAt = now;
								ctx.postMessage({ command: 'aiDraftProgress', phase: 'streaming', chars: text.length });
							}
						}
						ctx.postMessage({ command: 'aiDraftProgress', phase: 'parsing', detail: `Received ${text.length} chars, parsing…` });

						// Robust JSON extraction: try multiple strategies
						let parsed: any;
						const rawText = text.trim();
						// Strategy 1: strip markdown fences at boundaries
						let jsonText = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
						try {
							parsed = JSON.parse(jsonText);
						} catch {
							// Strategy 2: extract first { ... } block (handles preamble text from LLM)
							const braceMatch = rawText.match(/\{[\s\S]*\}/);
							if (braceMatch) {
								try {
									parsed = JSON.parse(braceMatch[0]);
								} catch {
									// Strategy 3: extract from fenced code block anywhere in response
									const fenceMatch = rawText.match(/```(?:json)?\s*\n?([\s\S]*?)```/i);
									if (fenceMatch) {
										parsed = JSON.parse(fenceMatch[1].trim());
									}
								}
							}
						}

						if (!parsed || typeof parsed !== 'object') {
							throw new Error(`Could not parse JSON from LLM response (${rawText.length} chars). First 200 chars: ${rawText.substring(0, 200)}`);
						}

						ctx.postMessage({
							command: 'aiDraftResult',
							data: {
								title: parsed.title || '',
								category: parsed.category || 'note',
								content: parsed.content || '',
								tags: Array.isArray(parsed.tags) ? parsed.tags : []
							}
						});
					} catch (err: any) {
						console.error('[ContextManager] synthesizeCard failed:', err);
						const errMsg = err?.message || String(err);
						ctx.postMessage({ command: 'aiDraftResult', data: null, error: errMsg });
					}
					break;
				}

				case 'clearCardQueue': {
					if (!message.projectId) { break; }
					const activeProject = projectManager.getProject(message.projectId);
					if (!activeProject || !activeProject.cardQueue?.length) {
						break;
					}
					const confirmClear = await vscode.window.showWarningMessage(
						`Clear all ${activeProject.cardQueue.length} pending card candidate(s)?`,
						{ modal: true },
						'Clear All'
					);
					if (confirmClear === 'Clear All') {
						try {
							await projectManager.clearCardQueue(message.projectId);
							vscode.window.showInformationMessage('Card queue cleared.');
							ctx.update();
						} catch (err: any) {
							vscode.window.showErrorMessage(`Error clearing queue: ${err.message}`);
						}
					}
					break;
				}

				case 'mergeWorkbenchItems': {
					if (!message.projectId || !message.items?.length || message.items.length < 2) { break; }
					try {
						const project = projectManager.getProject(message.projectId);
						if (!project) { break; }

						// Collect all selected items' content for merge
						const gathered: Array<{ title: string; content: string; tags: string[]; kind: string; id: string }> = [];
						for (const item of message.items) {
							if (item.kind === 'card') {
								const card = project.knowledgeCards?.find((c: any) => c.id === item.id);
								if (card) { gathered.push({ title: card.title, content: card.content, tags: card.tags || [], kind: 'card', id: card.id }); }
							} else if (item.kind === 'queue') {
								const q = project.cardQueue?.find((c: any) => c.id === item.id);
								if (q) { gathered.push({ title: q.suggestedTitle || 'Untitled', content: q.suggestedContent || q.response || '', tags: [], kind: 'queue', id: q.id }); }
							} else if (item.kind === 'convention') {
								const conv = project.conventions?.find((c: any) => c.id === item.id);
								if (conv) { gathered.push({ title: conv.title, content: conv.content, tags: [], kind: 'convention', id: conv.id }); }
							} else if (item.kind === 'note') {
								const note = project.workingNotes?.find((n: any) => n.id === item.id);
								if (note) { gathered.push({ title: note.subject, content: note.insight, tags: [], kind: 'note', id: note.id }); }
							} else if (item.kind === 'hint') {
								const hint = project.toolHints?.find((h: any) => h.id === item.id);
								if (hint) { gathered.push({ title: hint.toolName, content: hint.pattern + (hint.example ? '\\nExample: ' + hint.example : ''), tags: [], kind: 'hint', id: hint.id }); }
							}
						}

						if (gathered.length < 2) {
							vscode.window.showWarningMessage('Could not find enough items to merge.');
							break;
						}

						// Merge content: concatenate with headers
						const mergedTitle = gathered.map(g => g.title).join(' + ');
						const allTags = [...new Set(gathered.flatMap(g => g.tags))];
						const mergedContent = gathered.map(g =>
							`## ${g.title}\n\n${g.content}`
						).join('\n\n---\n\n');

						// Open in editor for user review before saving
						const { renderToolCallEvidence, renderSourceMaterial } = await import('./cardCanvas.js');
						const data = {
							isQueue: false,
							title: mergedTitle.substring(0, 100),
							category: 'note',
							content: mergedContent,
							tags: allTags,
							toolCallsHtml: '',
							sourceHtml: '',
							anchorsHtml: '',
						};
						ctx.postMessage({ command: 'populateEditor', data });
					} catch (err: any) {
						vscode.window.showErrorMessage(`Error merging items: ${err.message}`);
					}
					break;
				}

			case 'mergeHealthDuplicates': {
					if (!message.projectId || !message.cardAId || !message.cardBId) { break; }
					try {
						const project = projectManager.getProject(message.projectId);
						if (!project) { break; }
						const cardA = project.knowledgeCards?.find((c: any) => c.id === message.cardAId);
						const cardB = project.knowledgeCards?.find((c: any) => c.id === message.cardBId);
						if (!cardA || !cardB) {
							vscode.window.showWarningMessage('Could not find one or both cards to merge.');
							break;
						}

						const mergedTitle = `${cardA.title} + ${cardB.title}`.substring(0, 100);
						const allTags = [...new Set([...(cardA.tags || []), ...(cardB.tags || [])])];
						const mergedContent = `## ${cardA.title}\n\n${cardA.content}\n\n---\n\n## ${cardB.title}\n\n${cardB.content}`;

						const data = {
							isQueue: false,
							title: mergedTitle,
							category: cardA.category || cardB.category || 'note',
							content: mergedContent,
							tags: allTags,
							toolCallsHtml: '',
							sourceHtml: '',
							anchorsHtml: '',
						};
						ctx.postMessage({ command: 'populateEditor', data });

						// Switch to the workbench subtab so the editor is visible
						ctx.postMessage({ command: 'switchToSubtab', subtab: 'workbench' });
					} catch (err: any) {
						vscode.window.showErrorMessage(`Error merging duplicate cards: ${err.message}`);
					}
					break;
				}

			case 'setPromptInjection': {
				const activeProject = projectManager.getActiveProject();
				if (!activeProject) { break; }
				await projectManager.setPromptInjection(activeProject.id, {
					customInstruction: typeof message.customInstruction === 'string' ? message.customInstruction : '',
					includeFullContent: !!message.includeFullContent,
					includeProjectContext: !!message.includeProjectContext,
					oneShotMode: !!message.oneShotMode,
				});
				ctx.update();
				break;
			}

			case 'clearPromptInjection': {
				const activeProject = projectManager.getActiveProject();
				if (!activeProject) { break; }
				await projectManager.clearPromptInjection(activeProject.id);
				ctx.update();
				break;
			}

			// ─── Custom Workflows ─────────────────────────────────────

			case 'addWorkflow': {
				const activeProject = projectManager.getActiveProject();
				if (!activeProject) { break; }
				const { createWorkflow } = await import('../projects/types.js');
				const wf = createWorkflow(
					message.name || 'Untitled Workflow',
					message.promptTemplate || '',
					message.trigger || 'manual',
					message.outputAction || 'create-card',
					message.targetCardId || undefined,
					message.maxItems ?? 20,
					message.skipPattern || undefined,
					message.triggerFilter || undefined,
				);
				await projectManager.addWorkflow(activeProject.id, wf);
				ctx.update();
				break;
			}

			case 'updateWorkflow': {
				const activeProject = projectManager.getActiveProject();
				if (!activeProject || !message.workflowId) { break; }
				const updates: Record<string, any> = {};
				if (message.name !== undefined) { updates.name = message.name; }
				if (message.promptTemplate !== undefined) { updates.promptTemplate = message.promptTemplate; }
				if (message.trigger !== undefined) { updates.trigger = message.trigger; }
				if (message.outputAction !== undefined) { updates.outputAction = message.outputAction; }
				if (message.targetCardId !== undefined) { updates.targetCardId = message.targetCardId || undefined; }
				if (message.maxItems !== undefined) { updates.maxItems = message.maxItems; }
				if (message.skipPattern !== undefined) { updates.skipPattern = message.skipPattern || undefined; }
				if (message.triggerFilter !== undefined) { updates.triggerFilter = message.triggerFilter || undefined; }
				await projectManager.updateWorkflow(activeProject.id, message.workflowId, updates);
				ctx.update();
				break;
			}

			case 'deleteWorkflow': {
				const activeProject = projectManager.getActiveProject();
				if (!activeProject || !message.workflowId) { break; }
				await projectManager.removeWorkflow(activeProject.id, message.workflowId);
				ctx.update();
				break;
			}

			case 'toggleWorkflow': {
				const activeProject = projectManager.getActiveProject();
				if (!activeProject || !message.workflowId) { break; }
				await projectManager.updateWorkflow(activeProject.id, message.workflowId, {
					enabled: !!message.enabled,
				});
				ctx.update();
				break;
			}

			case 'runWorkflow': {
				const activeProject = projectManager.getActiveProject();
				if (!activeProject || !message.workflowId) { break; }
				const workflow = (activeProject.workflows || []).find(w => w.id === message.workflowId);
				if (!workflow) {
					vscode.window.showErrorMessage('Workflow not found.');
					break;
				}

				// Use singleton engine from ProjectManager (shared re-entrancy guard)
				const engine = projectManager.getWorkflowEngine();
				if (!engine) {
					vscode.window.showErrorMessage('Workflow engine not available.');
					break;
				}
				const wfCtx: import('../workflows/WorkflowEngine').WorkflowContext = {
					projectId: activeProject.id,
				};

				// If a source queue item or card was specified
				if (message.sourceType === 'queue-item' && message.sourceId) {
					wfCtx.queueItem = (activeProject.cardQueue || []).find(q => q.id === message.sourceId);
				} else if (message.sourceType === 'card' && message.sourceId) {
					wfCtx.card = (activeProject.knowledgeCards || []).find(c => c.id === message.sourceId);
				} else {
					// No specific source — pick the most recent queue item if the prompt references queue vars
					if (workflow.promptTemplate.includes('{{queue.') && (activeProject.cardQueue || []).length > 0) {
						wfCtx.queueItem = activeProject.cardQueue![activeProject.cardQueue!.length - 1];
					}
					// Pick target card if prompt references card vars
					if (workflow.promptTemplate.includes('{{card.') && workflow.targetCardId) {
						wfCtx.card = (activeProject.knowledgeCards || []).find(c => c.id === workflow.targetCardId);
					}
					// Pick latest convention if prompt references convention vars
					if (workflow.promptTemplate.includes('{{convention.') && (activeProject.conventions || []).length > 0) {
						const sorted = [...(activeProject.conventions || [])].sort((a, b) => b.updatedAt - a.updatedAt);
						wfCtx.convention = sorted[0];
					}
				}

				ctx.postMessage({ command: 'workflowRunning', workflowId: workflow.id });
				try {
					const result = await engine.execute(workflow, wfCtx);
					ctx.postMessage({
						command: 'workflowResult',
						workflowId: workflow.id,
						success: result.success,
						cardId: result.cardId,
						error: result.error,
					});
					if (result.success) {
						vscode.window.showInformationMessage(`Workflow "${workflow.name}" completed.`);
					} else {
						vscode.window.showWarningMessage(`Workflow "${workflow.name}": ${result.error}`);
					}
				} catch (err: any) {
					ctx.postMessage({
						command: 'workflowResult',
						workflowId: workflow.id,
						success: false,
						error: err?.message || String(err),
					});
					vscode.window.showErrorMessage(`Workflow "${workflow.name}" failed: ${err?.message}`);
				}
				ctx.update();
				break;
			}

	}
}
