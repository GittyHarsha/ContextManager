/**
 * Workflow command handlers — /todo, /done, /handoff, /audit, /map.
 */

import * as vscode from 'vscode';
import { ExplanationCache } from '../../cache';
import { ProjectManager } from '../../projects/ProjectManager';
import { AgentRun, SerializedMessage, Todo } from '../../projects/types';
import {
	ChatPrompt,
	TodoPrompt,
	ExplainerMetadata,
} from '../../prompts/index';
import {
	getCopilotInstructions,
	getProjectContext,
	getWorkspacePaths,
	getAgentTools,
	deselectContextAfterUse,
	makeResult,
	noToolsResult,
} from '../helpers';
import { runToolCallingLoop } from '../toolCallingLoop';

// ─── /done ──────────────────────────────────────────────────────

export async function handleDone(
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

	// Prompt the agent to run retrospect
	stream.markdown(
		'---\n\n' +
		'**\uD83D\uDCCB End-of-Task Reflection**\n\n' +
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
		tools: getAgentTools, // function ref — refreshed per-iteration
		stream,
		token,
		toolReferences: [...request.toolReferences],
	});

	return makeResult('done', result);
}

// ─── /handoff ───────────────────────────────────────────────────

export async function handleHandoff(
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
	const conventions = projectManager.getConventions(activeProject.id);
	const toolHints = projectManager.getToolHints(activeProject.id);
	const workingNotes = projectManager.getWorkingNotes(activeProject.id);
	const selectedCards = projectManager.getSelectedKnowledgeCards(activeProject.id);
	const allCards = projectManager.getKnowledgeCards(activeProject.id);

	// Build a structured context dump for the LLM
	const sections: string[] = [];

	// Knowledge cards
	if (allCards.length > 0) {
		const cardSummaries = allCards.slice(0, 15).map(c =>
			`- **${c.title}** [${c.category}]: ${c.content.substring(0, 150).replace(/\n/g, ' ')}${c.content.length > 150 ? '\u2026' : ''}`
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

1. **Summary** \u2014 What was being worked on (1-2 sentences)
2. **Current State** \u2014 Where things stand right now (what's done, what's in progress)
3. **Key Decisions** \u2014 Important architectural or design choices made and why
4. **Gotchas & Conventions** \u2014 Things the next person needs to know to avoid mistakes
5. **Next Steps** \u2014 Prioritized list of what to do next
6. **Relevant Files** \u2014 Key files to start with
7. **Search Tips** \u2014 How to find things in this codebase (tool hints)

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
		tools: getAgentTools, // function ref — refreshed per-iteration
		stream,
		token,
		toolReferences: [...request.toolReferences],
	});

	// Offer to save as a card
	stream.markdown('\n\n---\n');
	stream.button({ command: 'contextManager.openDashboard', title: '\uD83D\uDCCB Open Dashboard' });

	return makeResult('handoff', result);
}

// ─── /audit ─────────────────────────────────────────────────────

export async function handleAudit(
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
		stream.markdown('\uD83D\uDCCB **Nothing to audit.** No knowledge cards, conventions, or working notes exist yet.');
		return noToolsResult('audit');
	}

	stream.markdown('# \uD83D\uDD0D Knowledge Audit\n\n');
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

	// ── Render report ──
	stream.markdown('## Summary\n\n');
	stream.markdown(`| Category | Total | Issues |\n|---|---|---|\n`);
	stream.markdown(`| Knowledge Cards | ${allCards.length} | ${staleCards.length} with missing files, ${oldCards.length} older than 30 days |\n`);
	stream.markdown(`| Working Notes | ${workingNotes.length} | ${staleNotes.length} stale or possibly-stale |\n`);
	stream.markdown(`| Conventions | ${conventions.length} | ${pendingConventions.length} pending review |\n\n`);

	// Stale cards detail
	if (staleCards.length > 0) {
		stream.markdown('## \u26A0\uFE0F Cards with Missing File References\n\n');
		stream.markdown('These cards reference files that no longer exist. The content may be outdated.\n\n');
		for (const { card, missingFiles } of staleCards) {
			stream.markdown(`- **${card.title}** [${card.category}]\n`);
			for (const f of missingFiles) {
				stream.markdown(`  - \u274C \`${f}\`\n`);
			}
		}
		stream.markdown('\n');
	}

	// Old cards
	if (oldCards.length > 0) {
		stream.markdown('## \uD83D\uDCC5 Cards Older Than 30 Days\n\n');
		stream.markdown('These may need a refresh. Use `/refine` to update them.\n\n');
		for (const card of oldCards.slice(0, 15)) {
			const age = Math.floor((Date.now() - card.updated) / (24 * 60 * 60 * 1000));
			stream.markdown(`- **${card.title}** \u2014 ${age} days old\n`);
		}
		if (oldCards.length > 15) {
			stream.markdown(`- _...and ${oldCards.length - 15} more_\n`);
		}
		stream.markdown('\n');
	}

	// Stale notes
	if (staleNotes.length > 0) {
		stream.markdown('## \uD83D\uDCDD Stale Working Notes\n\n');
		for (const note of staleNotes) {
			const icon = note.staleness === 'stale' ? '\uD83D\uDD34' : '\u26A0\uFE0F';
			stream.markdown(`- ${icon} **${note.subject}** (${note.staleness})\n`);
		}
		stream.markdown('\n');
	}

	// Pending conventions
	if (pendingConventions.length > 0) {
		stream.markdown('## \u23F3 Conventions Pending Review\n\n');
		for (const conv of pendingConventions) {
			stream.markdown(`- **[${conv.category}] ${conv.title}** \u2014 ${conv.content.substring(0, 100)}${conv.content.length > 100 ? '\u2026' : ''}\n`);
		}
		stream.markdown('\n');
	}

	// Healthy summary
	if (staleCards.length === 0 && staleNotes.length === 0 && pendingConventions.length === 0 && oldCards.length === 0) {
		stream.markdown('\u2705 **All clear!** No staleness issues found.\n');
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
			tools: getAgentTools, // function ref — refreshed per-iteration
			stream,
			token,
			toolReferences: [...request.toolReferences],
		});

		return makeResult('audit', result);
	}

	stream.button({ command: 'contextManager.openDashboard', title: '\uD83D\uDCCB Open Dashboard' });
	return noToolsResult('audit');
}

// ─── /map ───────────────────────────────────────────────────────

export async function handleMap(
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
		stream.markdown('**Error:** Please specify a module, directory, or area to map.\n\nExamples:\n- `@ctx /map src/auth` \u2014 map the authentication module\n- `@ctx /map the dashboard` \u2014 map the dashboard architecture\n- `@ctx /map data flow for branch sessions`');
		return noToolsResult('map');
	}

	stream.markdown(`# \uD83D\uDDFA\uFE0F Architectural Map: ${target}\n\n`);
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

1. **Overview** \u2014 What this module/area does (1-2 sentences)
2. **Entry Points** \u2014 Public API, exported functions/classes, main files
3. **Architecture** \u2014 How the module is structured internally
4. **Key Components** \u2014 Important classes/functions with their roles (cite files)
5. **Data Flow** \u2014 How data moves through this area (inputs \u2192 processing \u2192 outputs)
6. **Dependencies** \u2014 What this area imports/depends on, and what depends on it
7. **Relationships Diagram** \u2014 A mermaid diagram showing key relationships:
   \`\`\`mermaid
   graph TD
     A[Component] --> B[Component]
   \`\`\`
8. **Gotchas & Conventions** \u2014 Things to watch out for in this area

### Rules
- Use tools extensively \u2014 search, read files, trace imports, find usages
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
		tools: getAgentTools, // function ref — refreshed per-iteration
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
			stream.markdown(`\u2705 **Saved as knowledge card:** "${cardTitle}"\n`);
		}
		stream.button({ command: 'contextManager.openDashboard', title: '\uD83D\uDCCB Open Dashboard' });
	}

	// Auto-deselect context after use (fire-and-forget)
	deselectContextAfterUse(projectManager, cache).catch(() => {});

	return makeResult('map', result);
}

// ─── /todo ──────────────────────────────────────────────────────

export async function handleTodo(
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
			activeProject.todos.forEach(t => stream.markdown(`- \`${t.id}\` \u2014 ${t.title} (${t.status})\n`));
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
			activeProject.todos.forEach(t => stream.markdown(`- \`${t.id}\` \u2014 ${t.title} (${t.status})\n`));
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

	stream.markdown(`> \uD83D\uDCDD **Project:** ${activeProject.name} | \uD83C\uDFAF **Run:** \`${agentRun.id}\`\n\n`);
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
		stream.markdown(`\n\n---\n\u2705 **TODO completed!**`);

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
					{ label: '\uD83D\uDD04 Refine existing card', description: `Update "${linkedCard.title}" with new findings`, value: 'refine' },
					{ label: '\uD83D\uDCDD Create new card', description: 'Create a separate knowledge card', value: 'new' },
					{ label: '\u2795 Append to card', description: `Add new findings to "${linkedCard.title}"`, value: 'append' },
					{ label: '\u23ED\uFE0F Skip', description: 'Don\'t save findings', value: 'skip' },
				], {
					title: `Knowledge card "${linkedCard.title}" already exists from a previous run`,
					placeHolder: 'How would you like to handle the findings?',
				});

				if (action?.value === 'refine') {
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
			stream.markdown(`\n\n\u26A0\uFE0F Error: ${err.message}`);
			await projectManager.failAgentRun(projectId, todo.id, agentRun.id, err.message);
		} else if (token.isCancellationRequested) {
			stream.markdown(`\n\n\u26A0\uFE0F **Cancelled.** Use \`@ctx /todo resume ${todo.id}\` to continue.`);
			await projectManager.pauseAgentRun(projectId, todo.id, agentRun.id);
		} else {
			await projectManager.failAgentRun(projectId, todo.id, agentRun.id, String(err));
			throw err;
		}
		return noToolsResult('todo');
	}
}
