/**
 * Knowledge command handlers — /context, /add, /save, /knowledge, /refine.
 */

import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ExplanationCache } from '../../cache';
import { ProjectManager } from '../../projects/ProjectManager';
import {
	ChatPrompt,
	KnowledgePrompt,
	RefineKnowledgePrompt,
	ExplainerMetadata,
} from '../../prompts/index';
import {
	emitWarning,
	showQuestionCarousel,
	getMcpServerContextSection,
} from '../../proposedApi';
import {
	getCopilotInstructions,
	getProjectContext,
	getWorkspacePaths,
	getAgentTools,
	deselectContextAfterUse,
	makeResult,
	noToolsResult,
} from '../helpers';
import { runToolCallingLoop, ToolLoopResult } from '../toolCallingLoop';
import { KnowledgeToolUsage } from '../../projects/types';

function extractPatternFromToolInput(input: unknown): { pattern: string; example?: string } {
	if (input === undefined || input === null) {
		return { pattern: 'called without explicit arguments' };
	}

	if (typeof input === 'string') {
		const value = input.trim();
		return {
			pattern: value ? `input="${value.substring(0, 140)}"` : 'called with empty string input',
			example: value ? value.substring(0, 140) : undefined,
		};
	}

	if (typeof input !== 'object') {
		return { pattern: `input=${String(input)}` };
	}

	const obj = input as Record<string, unknown>;
	const preferredKeys = ['query', 'path', 'filePath', 'symbolName', 'command', 'title', 'url', 'topic', 'name'];
	for (const key of preferredKeys) {
		const raw = obj[key];
		if (typeof raw === 'string' && raw.trim()) {
			const value = raw.trim().substring(0, 140);
			return { pattern: `${key}="${value}"`, example: value };
		}
	}

	const summary = Object.entries(obj)
		.filter(([, value]) => value !== undefined && value !== null)
		.slice(0, 2)
		.map(([key, value]) => `${key}=${typeof value === 'string' ? `"${value.substring(0, 80)}"` : String(value)}`)
		.join(', ');

	return {
		pattern: summary || 'called with structured object input',
		example: summary || undefined,
	};
}

function extractToolUsages(result: ToolLoopResult): KnowledgeToolUsage[] {
	const merged = new Map<string, KnowledgeToolUsage>();
	const now = Date.now();

	for (const round of result.toolCallRounds || []) {
		for (const toolCall of round.toolCalls || []) {
			const toolName = toolCall.name.replace(/^contextManager_/, '');
			const { pattern, example } = extractPatternFromToolInput((toolCall as any).input);
			const key = `${toolName}::${pattern}`;
			const existing = merged.get(key);
			if (existing) {
				existing.successCount += 1;
				existing.lastUsed = now;
				if (!existing.example && example) {
					existing.example = example;
				}
			} else {
				merged.set(key, {
					toolName,
					pattern,
					example,
					successCount: 1,
					lastUsed: now,
				});
			}
		}
	}

	return Array.from(merged.values());
}

// ─── /context ───────────────────────────────────────────────────

export async function handleContext(
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
	const badge = contextEnabled ? '\u2705 Context is **enabled**' : '\u26A0\uFE0F Context is **disabled**';
	stream.markdown(`# Current Project Context\n\n${badge}\n\n${fullContext}`);

	// Show registered tools for diagnostics
	const ourTools = vscode.lm.tools.filter(t => t.name.toLowerCase().startsWith('contextmanager_'));
	const toolListMd = ourTools.map(t => `- \`${t.name}\``).join('\n');
	stream.markdown(`\n\n---\n## Registered Tools (${ourTools.length})\n${toolListMd}`);

	// Append MCP server information if available (proposed API)
	const mcpSection = getMcpServerContextSection();
	if (mcpSection) {
		stream.markdown(`\n\n${mcpSection}`);
	}

	return noToolsResult('context');
}

// ─── /add ───────────────────────────────────────────────────────
// Saves the last AI response from chat history as a knowledge card.

export async function handleAdd(
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
		emitWarning(stream, '**Cancelled** \u2014 knowledge card not saved.');
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
		emitWarning(stream, '**Cancelled** \u2014 knowledge card not saved.');
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

	stream.markdown(`\u2705 **Knowledge card created!** "${title}" has been added to your project from the last AI response.`);
	return noToolsResult('add');
}

// ─── /save ──────────────────────────────────────────────────────

export async function handleSave(
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
		tools: getAgentTools, // function ref — refreshed per-iteration
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
			emitWarning(stream, '**Cancelled** \u2014 knowledge card not saved.');
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
				emitWarning(stream, '**Cancelled** \u2014 knowledge card not saved.');
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

		stream.markdown(`\n\u2705 **Knowledge card created!** "${title}" has been added to your project.`);
	}

	// Auto-deselect context after use (fire-and-forget)
	deselectContextAfterUse(projectManager, cache).catch(() => {});

	return makeResult('save', result);
}

// ─── /knowledge ─────────────────────────────────────────────────

export async function handleKnowledge(
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
		tools: getAgentTools, // function ref — refreshed per-iteration
		stream,
		token,
	});

	// Parse knowledge card from response
	const answerText = result.lastResponse || result.fullResponse;
	const cardMatch = answerText.match(/---KNOWLEDGE_CARD_START---([\s\S]*?)---KNOWLEDGE_CARD_END---/);

	if (!cardMatch) {
		if (answerText.trim()) {
			stream.markdown('\n\n\u26A0\uFE0F Could not parse structured format. Creating card from response.');
			const fallbackTitle = topic.substring(0, 100);
			const card = await projectManager.addKnowledgeCard(
				activeProject.id, fallbackTitle, answerText.trim(), 'note', [],
				undefined, undefined,
				projectManager.findBestFolder(activeProject.id, fallbackTitle, 'note', []));
			if (card) {
				stream.markdown(`\n\n\u2705 **Knowledge card created:** ${card.title}`);
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

	const card = await projectManager.addKnowledgeCard(activeProject.id, title, content, category, tags,
		undefined, undefined,
		projectManager.findBestFolder(activeProject.id, title, category, tags));
	if (card) {
		if (card.trackToolUsage) {
			await projectManager.addKnowledgeToolUsages(activeProject.id, card.id, extractToolUsages(result));
		}
		stream.markdown(`\n\n---\n\u2705 **Knowledge card created!** "${title}"`);
	}

	// Auto-deselect context after use (fire-and-forget)
	deselectContextAfterUse(projectManager, cache).catch(() => {});

	return makeResult('knowledge', result);
}

// ─── /refine ────────────────────────────────────────────────────

export async function handleRefine(
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
				description: `${c.category} \u00B7 ${c.tags.join(', ') || 'no tags'}`,
				detail: c.content.substring(0, 100).replace(/\n/g, ' ') + '...',
				card: c,
			})),
			{ title: 'Which knowledge card to refine?', placeHolder: 'Select a card to edit with AI' }
		);
		if (!pick) {
			stream.markdown('\u26A0\uFE0F **Cancelled** \u2014 no card selected.');
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

	// Exclude the target card from project context to avoid duplication
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

	// Only provide tools the refine loop actually needs
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
			existingCardId: targetCard.id,
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

	// Parse optional metadata changes from the text response
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

	// Recover from wrong-ID tool calls: if the model produced full refined content
	// for editKnowledgeCard but used a bad id, apply that content to the known target card.
	let attemptedToolContent: string | undefined;
	for (let i = (result.toolCallRounds?.length || 0) - 1; i >= 0; i--) {
		const round = result.toolCallRounds[i];
		for (let j = (round.toolCalls?.length || 0) - 1; j >= 0; j--) {
			const tc = round.toolCalls[j];
			if (tc.name !== 'contextManager_editKnowledgeCard') { continue; }
			const input = (tc as any).input as Record<string, unknown> | undefined;
			const content = typeof input?.content === 'string' ? input.content.trim() : '';
			if (content) {
				attemptedToolContent = content;
				break;
			}
		}
		if (attemptedToolContent) { break; }
	}

	if (tempFileChanged) {
		await projectManager.updateKnowledgeCard(activeProject.id, targetCard.id, {
			content: updatedContent,
			...metaUpdates,
		});
		if (targetCard.trackToolUsage) {
			await projectManager.addKnowledgeToolUsages(activeProject.id, targetCard.id, extractToolUsages(result));
		}
		const displayTitle = (metaUpdates.title as string) || targetCard.title;
		stream.markdown(`\n\n---\n\u2705 **Knowledge card refined!** "${displayTitle}"`);
		stream.button({ command: 'contextManager.openDashboard', title: 'View in Dashboard' });
	} else if (cardEditedDirectly) {
		if (Object.keys(metaUpdates).length > 0) {
			await projectManager.updateKnowledgeCard(activeProject.id, targetCard.id, metaUpdates);
		}
		if (targetCard.trackToolUsage) {
			await projectManager.addKnowledgeToolUsages(activeProject.id, targetCard.id, extractToolUsages(result));
		}
		const displayTitle = currentCard.title || targetCard.title;
		stream.markdown(`\n\n---\n\u2705 **Knowledge card refined!** "${displayTitle}"`);
		stream.button({ command: 'contextManager.openDashboard', title: 'View in Dashboard' });
	} else if (Object.keys(metaUpdates).length > 0) {
		await projectManager.updateKnowledgeCard(activeProject.id, targetCard.id, metaUpdates);
		if (targetCard.trackToolUsage) {
			await projectManager.addKnowledgeToolUsages(activeProject.id, targetCard.id, extractToolUsages(result));
		}
		stream.markdown(`\n\n---\n\u2705 **Card metadata updated!** ${Object.keys(metaUpdates).join(', ')} changed.`);
		stream.button({ command: 'contextManager.openDashboard', title: 'View in Dashboard' });
	} else if (attemptedToolContent && attemptedToolContent !== targetCard.content.trim()) {
		await projectManager.updateKnowledgeCard(activeProject.id, targetCard.id, {
			content: attemptedToolContent,
		});
		if (targetCard.trackToolUsage) {
			await projectManager.addKnowledgeToolUsages(activeProject.id, targetCard.id, extractToolUsages(result));
		}
		stream.markdown(`\n\n---\n\u2705 **Knowledge card refined!** "${targetCard.title}" (recovered from invalid tool ID)`);
		stream.button({ command: 'contextManager.openDashboard', title: 'View in Dashboard' });
	} else {
		stream.progress('Retrying refine without tools...');
		try {
			const fallbackMessages = [
				vscode.LanguageModelChatMessage.User(
					'You are refining a knowledge card. Return ONLY the final refined markdown content with no commentary, no code fences, and no preamble.'
				),
				vscode.LanguageModelChatMessage.User(
					`Card title: ${targetCard.title}\nCategory: ${targetCard.category}\nTags: ${(targetCard.tags || []).join(', ') || 'none'}\n\nRefinement instructions:\n${instructions}\n\nCurrent content:\n${targetCard.content}`
				),
			];

			const fallbackResponse = await request.model.sendRequest(
				fallbackMessages,
				{ justification: 'Apply card refinement when tool calls are unavailable' },
				token,
			);

			let fallbackText = '';
			for await (const part of fallbackResponse.stream) {
				if (part instanceof vscode.LanguageModelTextPart) {
					fallbackText += part.value;
				}
			}

			let refinedContent = fallbackText.trim();
			refinedContent = refinedContent.replace(/^```(?:markdown)?\s*/i, '').replace(/```\s*$/i, '').trim();

			if (refinedContent && refinedContent !== targetCard.content.trim()) {
				await projectManager.updateKnowledgeCard(activeProject.id, targetCard.id, {
					content: refinedContent,
				});
				stream.markdown(`\n\n---\n\u2705 **Knowledge card refined!** "${targetCard.title}" (direct fallback applied)`);
				stream.button({ command: 'contextManager.openDashboard', title: 'View in Dashboard' });
			} else {
				stream.markdown('\n\n\u26A0\uFE0F No changes were made to the card.');
			}
		} catch {
			stream.markdown('\n\n\u26A0\uFE0F No changes were made to the card.');
		}
	}

	// Auto-deselect context after use (fire-and-forget)
	deselectContextAfterUse(projectManager, cache).catch(() => {});

	return makeResult('refine', result);
}
