/**
 * Subagent Tool — launches autonomous subagent loops for complex delegated tasks.
 */

import * as vscode from 'vscode';
import { ExplanationCache } from '../cache';
import { ConfigurationManager } from '../config';
import { ProjectManager } from '../projects/ProjectManager';
import { SearchIndex } from '../search/SearchIndex';

type SubagentTaskType = 'executeTodo' | 'generateKnowledge' | 'refineKnowledge' | 'research' | 'analyzeCode';

interface ISubagentParams {
	/** The type of task to delegate. */
	task: SubagentTaskType;
	/** Detailed instructions for the subagent. */
	prompt: string;
	/** TODO ID (for executeTodo). */
	todoId?: string;
	/** Knowledge card ID (for refineKnowledge). */
	cardId?: string;
	/** Topic for generating a knowledge card (for generateKnowledge). */
	topic?: string;
}

/**
 * Run a standalone tool-calling loop without a ChatResponseStream.
 * The model sends requests with tool descriptions, we invoke tools, feed
 * results back, and loop until the model stops calling tools or we hit
 * the iteration cap.
 */
async function runSubagentLoop(
	model: vscode.LanguageModelChat,
	systemPrompt: string,
	userPrompt: string,
	tools: vscode.LanguageModelChatTool[],
	token: vscode.CancellationToken,
	maxIterations: number,
): Promise<string> {
	const messages: vscode.LanguageModelChatMessage[] = [
		vscode.LanguageModelChatMessage.User(systemPrompt),
		vscode.LanguageModelChatMessage.User(userPrompt),
	];

	let lastResponseText = '';

	for (let i = 0; i < maxIterations; i++) {
		if (token.isCancellationRequested) {
			return lastResponseText || 'Subagent cancelled.';
		}

		const response = await model.sendRequest(
			messages,
			{ tools: tools.length > 0 ? tools : undefined },
			token,
		);

		const toolCalls: vscode.LanguageModelToolCallPart[] = [];
		let responseText = '';

		for await (const part of response.stream) {
			if (part instanceof vscode.LanguageModelTextPart) {
				responseText += part.value;
			} else if (part instanceof vscode.LanguageModelToolCallPart) {
				toolCalls.push(part);
			}
		}

		lastResponseText = responseText;

		// Build assistant message content with both text and tool calls
		const assistantParts: (vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart)[] = [];
		if (responseText) {
			assistantParts.push(new vscode.LanguageModelTextPart(responseText));
		}
		assistantParts.push(...toolCalls);
		messages.push(vscode.LanguageModelChatMessage.Assistant(assistantParts));

		// If no tool calls, the model is done
		if (toolCalls.length === 0) {
			return responseText;
		}

		// Invoke ALL tools in parallel and feed results back
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

				return { callId: tc.callId, text: textContent || 'Tool executed successfully (no text output).' };
			} catch (err: unknown) {
				const msg = err instanceof Error ? err.message : String(err);
				return { callId: tc.callId, text: `Error invoking tool "${tc.name}": ${msg}` };
			}
		}));

		for (const tr of toolResults) {
			messages.push(vscode.LanguageModelChatMessage.User([
				new vscode.LanguageModelToolResultPart(tr.callId, [
					new vscode.LanguageModelTextPart(tr.text),
				]),
			]));
		}
	}

	return lastResponseText || 'Subagent reached maximum iteration limit without a final response.';
}

/**
 * Get the list of tools available to the subagent.
 * Includes all ContextManager tools (except the subagent itself to prevent
 * recursion), plus workspace search/read/terminal tools.
 */
function getSubagentTools(): vscode.LanguageModelChatTool[] {
	return vscode.lm.tools
		.filter(tool => {
			const name = tool.name.toLowerCase();
			// Exclude ourselves to prevent recursive subagent invocation
			if (name === 'contextmanager_runsubagent') {
				return false;
			}
			return (
				// All our tools (includes contextmanager_writefile)
				name.startsWith('contextmanager_') ||
				// Search tools
				name.includes('haystack') ||
				name.includes('grep') || name.includes('findtext') ||
				name.includes('semantic_search') ||
				name.includes('file_search') ||
				// Read tools
				name.includes('read') ||
				// Directory tools
				name.includes('listdir') || name.includes('list_dir') ||
				// Code navigation
				name.includes('list_code_usages') || name.includes('codeusages') ||
				// Terminal (for running tests, build, scripts)
				name.includes('terminal') || name.includes('run_in_terminal')
			);
		})
		.map(tool => ({
			name: tool.name,
			description: tool.description,
			inputSchema: tool.inputSchema as Record<string, unknown>,
		}));
}

export class SubagentTool implements vscode.LanguageModelTool<ISubagentParams> {
	constructor(
		private readonly projectManager: ProjectManager,
		private readonly cache: ExplanationCache,
		private readonly searchIndex?: SearchIndex,
	) {}

	async invoke(
		options: vscode.LanguageModelToolInvocationOptions<ISubagentParams>,
		token: vscode.CancellationToken,
	): Promise<vscode.LanguageModelToolResult> {
		const { task, prompt, todoId, cardId, topic } = options.input;

		if (!ConfigurationManager.subagentEnabled) {
			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart('Subagent tool is disabled. Enable it in settings: contextManager.subagent.enabled'),
			]);
		}

		// Validate task-specific parameters
		if (task === 'executeTodo' && !todoId) {
			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart('Task "executeTodo" requires a todoId parameter.'),
			]);
		}
		if (task === 'refineKnowledge' && !cardId) {
			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart('Task "refineKnowledge" requires a cardId parameter.'),
			]);
		}
		if (task === 'generateKnowledge' && !topic) {
			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart('Task "generateKnowledge" requires a topic parameter.'),
			]);
		}

		// Select a model
		const modelFamily = ConfigurationManager.subagentModelFamily;
		const selector: vscode.LanguageModelChatSelector = modelFamily
			? { family: modelFamily }
			: {};
		const models = await vscode.lm.selectChatModels(selector);
		if (models.length === 0) {
			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart('No language model available for subagent. Check your model settings.'),
			]);
		}
		const model = models[0];

		// Build system prompt based on task type
		const systemPrompt = this.buildSystemPrompt(task);

		// Build user prompt with relevant context
		const userPrompt = await this.buildUserPrompt(task, prompt, todoId, cardId, topic);

		// Get available tools for the subagent
		const tools = getSubagentTools();

		// Run the subagent loop
		const maxIterations = ConfigurationManager.subagentMaxIterations;
		let result: string;
		try {
			result = await runSubagentLoop(model, systemPrompt, userPrompt, tools, token, maxIterations);
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			result = `Subagent error: ${msg}`;
		}

		// Post-processing: apply side-effects based on task type
		await this.postProcess(task, result, todoId, cardId, topic);

		return new vscode.LanguageModelToolResult([
			new vscode.LanguageModelTextPart(result),
		]);
	}

	private buildSystemPrompt(task: SubagentTaskType): string {
		const base = [
			'You are an autonomous subagent for ContextManager.',
			'Use available tools to research and produce results. Work fast — minimize unnecessary tool calls.',
			'Provide a clear summary when done. Do NOT ask the user questions.',
		].join('\n');

		const taskInstructions: Record<SubagentTaskType, string> = {
			executeTodo: '\n\n## Execute TODO\nRead the TODO, research the codebase, describe changes needed, update status to done.',

			generateKnowledge: '\n\n## Generate Knowledge Card\nResearch the topic in the codebase. Output a structured knowledge card: overview, key patterns, file locations, gotchas.',

			refineKnowledge: '\n\n## Refine Knowledge Card\nRead existing card. Search for new info. Output the updated card content with improvements.',

			research: '\n\n## Research\nSearch and read the codebase to answer the question. Cite file paths. Be thorough but concise.',

			analyzeCode: '\n\n## Analyze Code\nExplore code structure, trace call chains, read files. Provide analysis with specific references.',
		};

		return base + (taskInstructions[task] || '');
	}

	private async buildUserPrompt(
		task: SubagentTaskType,
		prompt: string,
		todoId?: string,
		cardId?: string,
		topic?: string,
	): Promise<string> {
		const parts: string[] = [];

		// Add project context summary
		const activeProject = this.projectManager.getActiveProject();
		if (activeProject) {
			parts.push(`## Active Project: ${activeProject.name}`);
			parts.push(`Root: ${activeProject.rootPaths.join(', ')}`);

			const cards = this.projectManager.getKnowledgeCards(activeProject.id);
			if (cards.length > 0) {
				parts.push(`\nProject has ${cards.length} knowledge card(s) available.`);
			}
		}

		// Add task-specific context
		if (task === 'executeTodo' && todoId && activeProject) {
			const todos = this.projectManager.getTodosForProject(activeProject.id);
			const todo = todos.find((t: { id: string }) => t.id === todoId);
			if (todo) {
				parts.push(`\n## TODO to Execute`);
				parts.push(`- **ID:** ${todo.id}`);
				parts.push(`- **Title:** ${todo.title}`);
				parts.push(`- **Status:** ${todo.status}`);
				parts.push(`- **Priority:** ${todo.priority}`);
				if (todo.description) {
					parts.push(`- **Description:** ${todo.description}`);
				}
				if (todo.notes?.length) {
					parts.push(`- **Existing Notes:** ${todo.notes}`);
				}
			}
		}

		if (task === 'refineKnowledge' && cardId && activeProject) {
			const cards = this.projectManager.getKnowledgeCards(activeProject.id);
			const card = cards.find(c => c.id === cardId);
			if (card) {
				parts.push(`\n## Knowledge Card to Refine`);
				parts.push(`- **ID:** ${card.id}`);
				parts.push(`- **Title:** ${card.title}`);
				parts.push(`- **Category:** ${card.category}`);
				if (card.tags?.length) {
					parts.push(`- **Tags:** ${card.tags.join(', ')}`);
				}
				parts.push(`\n### Current Content:\n${card.content}`);
			}
		}

		if (task === 'generateKnowledge' && topic) {
			parts.push(`\n## Topic to Research: ${topic}`);
		}

		parts.push(`\n## Instructions\n${prompt}`);

		return parts.join('\n');
	}

	/**
	 * Post-processing after the subagent loop completes.
	 * Handles side-effects like TODO status updates and knowledge card creation.
	 */
	private async postProcess(
		task: SubagentTaskType,
		result: string,
		todoId?: string,
		cardId?: string,
		topic?: string,
	): Promise<void> {
		const activeProject = this.projectManager.getActiveProject();
		if (!activeProject) {
			return;
		}

		try {
			if (task === 'executeTodo' && todoId) {
				// Add a note to the TODO with the subagent result summary
				const summary = result.length > 500 ? result.substring(0, 497) + '...' : result;
				const todo = this.projectManager.getTodosForProject(activeProject.id).find(t => t.id === todoId);
				if (todo) {
					const existingNotes = todo.notes || '';
					const newNotes = existingNotes
						? `${existingNotes}\n\n[Subagent] ${summary}`
						: `[Subagent] ${summary}`;
					await this.projectManager.updateTodo(activeProject.id, todoId, { notes: newNotes });
				}
			}

			if (task === 'generateKnowledge' && topic) {
				// Create a knowledge card from the subagent's findings
				// Only if the subagent didn't already create one via the tool
				const cards = this.projectManager.getKnowledgeCards(activeProject.id);
				const existing = cards.find(c =>
					c.title.toLowerCase().includes(topic.toLowerCase()) &&
					(Date.now() - c.updated) < 60_000 // created within the last minute
				);
				if (!existing) {
					const cardContent = result.length > 5000 ? result.substring(0, 4997) + '...' : result;
					await this.projectManager.addKnowledgeCard(
						activeProject.id,
						topic,
						cardContent,
						'architecture',
						['auto-generated', 'subagent'],
					);
				}
			}

			if (task === 'refineKnowledge' && cardId) {
				const cards = this.projectManager.getKnowledgeCards(activeProject.id);
				const card = cards.find(c => c.id === cardId);
				if (card) {
					const recentlyUpdated = (Date.now() - card.updated) < 60_000;
					if (!recentlyUpdated) {
						const refinedContent = result.length > 5000 ? result.substring(0, 4997) + '...' : result;
						await this.projectManager.updateKnowledgeCard(activeProject.id, cardId, {
							content: refinedContent,
						});
					}
				}
			}
		} catch (_err) {
			// Post-processing is best-effort — don't fail the whole subagent result
		}
	}

	async prepareInvocation(
		options: vscode.LanguageModelToolInvocationPrepareOptions<ISubagentParams>,
		_token: vscode.CancellationToken,
	) {
		const task = options.input?.task ?? 'research';
		const messages: Record<string, string> = {
			executeTodo: `Launching subagent to execute TODO${options.input?.todoId ? ` "${options.input.todoId}"` : ''}...`,
			generateKnowledge: `Launching subagent to research "${options.input?.topic ?? 'topic'}" and generate a knowledge card...`,
			refineKnowledge: `Launching subagent to refine knowledge card${options.input?.cardId ? ` "${options.input.cardId}"` : ''}...`,
			research: 'Launching subagent to research the codebase...',
			analyzeCode: 'Launching subagent for code analysis...',
		};
		return {
			invocationMessage: messages[task] ?? `Launching subagent (${task})...`,
		};
	}
}
