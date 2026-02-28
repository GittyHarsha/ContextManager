/**
 * Language Model Tools that expose project context to all chat participants,
 * including Copilot's default handler. This allows knowledge cards and cached
 * explanations to be available even in normal (non-@ctx) queries.
 */

import * as vscode from 'vscode';
import { ExplanationCache } from './cache';
import { ConfigurationManager } from './config';
import { EmbeddingManager } from './embeddings';
import { ProjectManager } from './projects/ProjectManager';
import { DEFAULT_TOOL_SHARING_CONFIG } from './projects/types';
import { getCurrentBranch, getBoundedDiff, getLogRange, captureGitSnapshot } from './utils/gitUtils';
import { SearchIndex } from './search/SearchIndex';
import type { SearchEntityType } from './search/types';

// ─── Tool Stream Registry ───────────────────────────────────────
// Set by runToolCallingLoop before each loop so file tools can emit
// stream.textEdit() calls, showing the "N files changed" diff UI.
let _toolStream: vscode.ChatResponseStream | undefined;
export function setToolStream(stream: vscode.ChatResponseStream | undefined): void {
	_toolStream = stream;
}
function getToolStream(): vscode.ChatResponseStream | undefined {
	return _toolStream;
}

// ─── Project Context Tool ───────────────────────────────────────

interface IProjectContextParams {
	/** Optional: only return a specific section like 'cards', 'cache', or 'all' (default) */
	section?: string;
}

export class ProjectContextTool implements vscode.LanguageModelTool<IProjectContextParams> {
	constructor(
		private readonly projectManager: ProjectManager,
		private readonly cache: ExplanationCache,
	) {}

	async invoke(
		options: vscode.LanguageModelToolInvocationOptions<IProjectContextParams>,
		_token: vscode.CancellationToken
	): Promise<vscode.LanguageModelToolResult> {
		const activeProject = this.projectManager.getActiveProject();
		if (!activeProject) {
			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart('No active project in ContextManager. The user has not set up project context yet.')
			]);
		}

		if (!this.projectManager.isContextEnabled(activeProject.id)) {
			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart(`Project "${activeProject.name}" exists but context injection is disabled.`)
			]);
		}

		const toolConfig = activeProject.toolSharingConfig ?? DEFAULT_TOOL_SHARING_CONFIG;
		if (!toolConfig.enabled) {
			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart(`Project "${activeProject.name}" exists but #projectContext tool sharing is disabled by the user.`)
			]);
		}

		const section = options.input?.section || 'all';
		const parts: string[] = [];

		// Project metadata
		if ((section === 'all' || section === 'project') && toolConfig.shareProjectMeta) {
			parts.push(`## Project: ${activeProject.name}`);
			if (activeProject.description) {
				parts.push(`**Description:** ${activeProject.description}`);
			}
			if (activeProject.context.goals) {
				parts.push(`**Goals:** ${activeProject.context.goals}`);
			}
			if (activeProject.context.conventions) {
				parts.push(`**Conventions:** ${activeProject.context.conventions}`);
			}
			if (activeProject.context.keyFiles.length > 0) {
				parts.push(`**Key Files:** ${activeProject.context.keyFiles.join(', ')}`);
			}
		}

		// Knowledge cards
		if ((section === 'all' || section === 'cards') && toolConfig.shareKnowledgeCards) {
			const selectedCards = this.projectManager.getSelectedKnowledgeCards(activeProject.id);
			if (selectedCards.length > 0) {
				parts.push(`## Knowledge Cards (${selectedCards.length} selected)`);
				parts.push('The following knowledge cards have been curated by the user as important reference material.');
				for (const card of selectedCards) {
					parts.push(`### ${card.title} [${card.category}] (ID: ${card.id})\n${card.content}`);
				}
			} else {
				parts.push('No knowledge cards are currently selected for context injection.');
			}
		}

		// Cache entries
		if ((section === 'all' || section === 'cache') && toolConfig.shareCache) {
			const selectedCacheEntries = this.cache.getSelectedEntries(activeProject.id);
			if (selectedCacheEntries.length > 0) {
				parts.push(`## Cached Explanations (${selectedCacheEntries.length} selected)`);
				parts.push('The following are previously generated explanations of code symbols that the user has selected as relevant context.');
				for (const entry of selectedCacheEntries) {
					parts.push(`### ${entry.symbolName} [${entry.type}] (ID: ${entry.id})${entry.filePath ? ` (${entry.filePath})` : ''}\n${entry.content}`);
				}
			}
		}

		// TODOs
		if ((section === 'all' || section === 'todos') && toolConfig.shareTodos) {
			const pendingTodos = activeProject.todos.filter(t => t.status !== 'completed');
			if (pendingTodos.length > 0) {
				parts.push(`## Active TODOs (${pendingTodos.length})`);
				for (const todo of pendingTodos) {
					const priority = todo.priority ? ` [${todo.priority}]` : '';
					parts.push(`- ${todo.title}${priority}${todo.description && todo.description !== todo.title ? ': ' + todo.description : ''}`);
				}
			}
		}

		const context = parts.join('\n\n');
		return new vscode.LanguageModelToolResult([
			new vscode.LanguageModelTextPart(context || 'Project exists but no context is selected.')
		]);
	}

	async prepareInvocation(
		_options: vscode.LanguageModelToolInvocationPrepareOptions<IProjectContextParams>,
		_token: vscode.CancellationToken
	) {
		const activeProject = this.projectManager.getActiveProject();
		return {
			invocationMessage: activeProject
				? `Retrieving context from project "${activeProject.name}"...`
				: 'Checking for active project context...',
		};
	}
}

// ─── Todo Manager Tool ──────────────────────────────────────────

interface ITodoManagerParams {
	/** The action to perform on TODOs. */
	action: 'list' | 'create' | 'update' | 'complete' | 'delete';
	/** Title for a new TODO (required for 'create'). */
	title?: string;
	/** Description for a new TODO (optional for 'create', 'update'). */
	description?: string;
	/** The ID of the TODO to update/complete/delete. */
	todoId?: string;
	/** New status for 'update'. */
	status?: 'pending' | 'in-progress' | 'completed' | 'failed';
	/** New priority for 'create' or 'update'. */
	priority?: 'low' | 'medium' | 'high';
	/** Notes to attach (for 'create' or 'update'). */
	notes?: string;
	/** Filter: only return TODOs with this status (for 'list'). */
	filterStatus?: 'pending' | 'in-progress' | 'completed' | 'failed' | 'active';
}

export class TodoManagerTool implements vscode.LanguageModelTool<ITodoManagerParams> {
	constructor(
		private readonly projectManager: ProjectManager,
	) {}

	async invoke(
		options: vscode.LanguageModelToolInvocationOptions<ITodoManagerParams>,
		_token: vscode.CancellationToken
	): Promise<vscode.LanguageModelToolResult> {
		const activeProject = this.projectManager.getActiveProject();
		if (!activeProject) {
			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart('No active project in ContextManager. Cannot manage TODOs.')
			]);
		}

		const { action } = options.input;
		const projectId = activeProject.id;

		switch (action) {
			case 'list':
				return this.listTodos(projectId, activeProject.name, options.input.filterStatus);
			case 'create':
				return this.createTodo(projectId, activeProject.name, options.input);
			case 'update':
				return this.updateTodo(projectId, options.input);
			case 'complete':
				return this.completeTodo(projectId, options.input.todoId);
			case 'delete':
				return this.deleteTodo(projectId, options.input.todoId);
			default:
				return new vscode.LanguageModelToolResult([
					new vscode.LanguageModelTextPart(`Unknown action "${action}". Valid actions: list, create, update, complete, delete.`)
				]);
		}
	}

	private listTodos(
		projectId: string,
		projectName: string,
		filterStatus?: string,
	): vscode.LanguageModelToolResult {
		let todos = this.projectManager.getTodosForProject(projectId);

		if (filterStatus === 'active') {
			todos = todos.filter(t => t.status !== 'completed');
		} else if (filterStatus) {
			todos = todos.filter(t => t.status === filterStatus);
		}

		if (todos.length === 0) {
			const filterNote = filterStatus ? ` (filter: ${filterStatus})` : '';
			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart(`No TODOs found in project "${projectName}"${filterNote}.`)
			]);
		}

		const parts: string[] = [];
		const filterNote = filterStatus ? ` [${filterStatus}]` : '';
		parts.push(`## TODOs in "${projectName}"${filterNote} (${todos.length})\n`);

		for (const todo of todos) {
			const statusIcon = todo.status === 'completed' ? '✅'
				: todo.status === 'in-progress' ? '🔄'
				: todo.status === 'failed' ? '❌'
				: '⬜';
			const priority = todo.priority ? ` [${todo.priority}]` : '';
			parts.push(`${statusIcon} **${todo.title}**${priority} — \`${todo.id}\``);
			if (todo.description && todo.description !== todo.title) {
				parts.push(`  ${todo.description}`);
			}
			if (todo.notes) {
				parts.push(`  _Notes: ${todo.notes}_`);
			}
			parts.push(`  Status: ${todo.status} | Created: ${new Date(todo.created).toLocaleDateString()}`);
			parts.push('');
		}

		return new vscode.LanguageModelToolResult([
			new vscode.LanguageModelTextPart(parts.join('\n'))
		]);
	}

	private async createTodo(
		projectId: string,
		projectName: string,
		input: ITodoManagerParams,
	): Promise<vscode.LanguageModelToolResult> {
		if (!input.title?.trim()) {
			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart('Cannot create TODO: title is required.')
			]);
		}

		const todo = await this.projectManager.addTodo(projectId, input.title, input.description);
		if (!todo) {
			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart('Failed to create TODO — project not found.')
			]);
		}

		// Apply optional fields via update
		const updates: Record<string, unknown> = {};
		if (input.priority) { updates.priority = input.priority; }
		if (input.notes) { updates.notes = input.notes; }
		if (input.status && input.status !== 'pending') { updates.status = input.status; }

		if (Object.keys(updates).length > 0) {
			await this.projectManager.updateTodo(projectId, todo.id, updates);
		}

		return new vscode.LanguageModelToolResult([
			new vscode.LanguageModelTextPart(
				`✅ Created TODO in "${projectName}":\n` +
				`- **${todo.title}** (\`${todo.id}\`)\n` +
				(input.description ? `- Description: ${input.description}\n` : '') +
				(input.priority ? `- Priority: ${input.priority}\n` : '') +
				(input.notes ? `- Notes: ${input.notes}\n` : '')
			)
		]);
	}

	private async updateTodo(
		projectId: string,
		input: ITodoManagerParams,
	): Promise<vscode.LanguageModelToolResult> {
		if (!input.todoId) {
			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart('Cannot update TODO: todoId is required.')
			]);
		}

		const updates: Record<string, unknown> = {};
		if (input.title) { updates.title = input.title; }
		if (input.description) { updates.description = input.description; }
		if (input.status) { updates.status = input.status; }
		if (input.priority) { updates.priority = input.priority; }
		if (input.notes) { updates.notes = input.notes; }

		if (Object.keys(updates).length === 0) {
			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart('No fields provided to update.')
			]);
		}

		const updated = await this.projectManager.updateTodo(projectId, input.todoId, updates);
		if (!updated) {
			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart(`TODO "${input.todoId}" not found.`)
			]);
		}

		return new vscode.LanguageModelToolResult([
			new vscode.LanguageModelTextPart(
				`✅ Updated TODO **${updated.title}** (\`${updated.id}\`):\n` +
				Object.entries(updates).map(([k, v]) => `- ${k}: ${v}`).join('\n')
			)
		]);
	}

	private async completeTodo(
		projectId: string,
		todoId?: string,
	): Promise<vscode.LanguageModelToolResult> {
		if (!todoId) {
			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart('Cannot complete TODO: todoId is required.')
			]);
		}

		const updated = await this.projectManager.updateTodo(projectId, todoId, { status: 'completed' });
		if (!updated) {
			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart(`TODO "${todoId}" not found.`)
			]);
		}

		return new vscode.LanguageModelToolResult([
			new vscode.LanguageModelTextPart(`✅ Completed TODO: **${updated.title}** (\`${updated.id}\`)`)
		]);
	}

	private async deleteTodo(
		projectId: string,
		todoId?: string,
	): Promise<vscode.LanguageModelToolResult> {
		if (!todoId) {
			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart('Cannot delete TODO: todoId is required.')
			]);
		}

		// Get the title before deleting
		const todos = this.projectManager.getTodosForProject(projectId);
		const todo = todos.find(t => t.id === todoId);
		const title = todo?.title ?? todoId;

		await this.projectManager.deleteTodo(projectId, todoId);

		return new vscode.LanguageModelToolResult([
			new vscode.LanguageModelTextPart(`🗑️ Deleted TODO: **${title}** (\`${todoId}\`)`)
		]);
	}

	async prepareInvocation(
		options: vscode.LanguageModelToolInvocationPrepareOptions<ITodoManagerParams>,
		_token: vscode.CancellationToken
	) {
		const action = options.input?.action ?? 'list';
		const messages: Record<string, string> = {
			list: 'Listing project TODOs...',
			create: `Creating TODO: "${options.input?.title ?? '...'}"...`,
			update: `Updating TODO ${options.input?.todoId ?? '...'}...`,
			complete: `Completing TODO ${options.input?.todoId ?? '...'}...`,
			delete: `Deleting TODO ${options.input?.todoId ?? '...'}...`,
		};
		return {
			invocationMessage: messages[action] ?? `Managing TODOs (${action})...`,
		};
	}
}

// ─── Branch Session Tool ────────────────────────────────────────

interface IBranchSessionParams {
	/** The action to perform. */
	action: 'save' | 'resume' | 'list' | 'addBranch' | 'removeBranch' | 'checkpoint' | 'gitDiff' | 'delta';
	/** Branch name (required for addBranch, removeBranch; auto-detected otherwise). */
	branchName?: string;
	/** Task description for the current session (for 'save'). */
	task?: string;
	/** High-level goal (for 'save'). */
	goal?: string;
	/** Current state summary (for 'save' or 'checkpoint'). */
	currentState?: string;
	/** List of approaches tried (for 'save'). */
	approaches?: string[];
	/** Key decisions made (for 'save' or 'checkpoint'). */
	decisions?: string[];
	/** Next steps planned (for 'save' or 'checkpoint'). */
	nextSteps?: string[];
	/** Current blockers (for 'save' or 'checkpoint'). */
	blockers?: string[];
	/** Completed steps (for 'checkpoint' — appended to approaches). */
	completed?: string[];
	/** In-progress step (for 'checkpoint' — overwrites currentState). */
	inProgress?: string;
	/** Pending steps (for 'checkpoint' — overwrites nextSteps). */
	pending?: string[];
	/** Detail level for resume: 'brief' (~300 tokens) or 'full' (~800 tokens). */
	detail?: 'brief' | 'full';
	/** Git ref to diff from (for 'gitDiff', default 'main'). */
	ref1?: string;
	/** Git ref to diff to (for 'gitDiff', default 'HEAD'). */
	ref2?: string;
	/** Max files to show diffs for (for 'gitDiff', default 5). */
	maxFiles?: number;
}

export class BranchSessionTool implements vscode.LanguageModelTool<IBranchSessionParams> {
	constructor(
		private readonly projectManager: ProjectManager,
	) {}

	async invoke(
		options: vscode.LanguageModelToolInvocationOptions<IBranchSessionParams>,
		_token: vscode.CancellationToken
	): Promise<vscode.LanguageModelToolResult> {
		const activeProject = this.projectManager.getActiveProject();
		if (!activeProject) {
			return this.text('No active project in ContextManager. Cannot manage branch sessions.');
		}

		const { action } = options.input;
		const projectId = activeProject.id;

		switch (action) {
			case 'save':
				return this.saveSession(projectId, activeProject.rootPaths[0], options.input);
			case 'resume':
				return this.resumeSession(projectId, activeProject.rootPaths[0], options.input.branchName, options.input.detail);
			case 'list':
				return this.listBranches(projectId, activeProject.name);
			case 'addBranch':
				return this.addBranch(projectId, activeProject.rootPaths[0], options.input.branchName);
			case 'removeBranch':
				return this.removeBranch(projectId, options.input.branchName);
			case 'checkpoint':
				return this.checkpoint(projectId, activeProject.rootPaths[0], options.input);
			case 'gitDiff':
				return this.gitDiffAction(activeProject.rootPaths[0], options.input);
			case 'delta':
				return this.deltaAction(projectId, activeProject.rootPaths[0], options.input.branchName);
			default:
				return this.text(`Unknown action "${action}". Valid actions: save, resume, list, addBranch, removeBranch, checkpoint, gitDiff, delta.`);
		}
	}

	private text(msg: string): vscode.LanguageModelToolResult {
		return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(msg)]);
	}

	private async saveSession(
		projectId: string,
		rootPath: string | undefined,
		input: IBranchSessionParams,
	): Promise<vscode.LanguageModelToolResult> {
		// Auto-detect current branch if not specified
		let branchName = input.branchName;
		if (!branchName && rootPath) {
			branchName = await getCurrentBranch(rootPath) ?? undefined;
		}
		if (!branchName) {
			return this.text('Could not determine current branch. Please specify a branch name.');
		}

		const session = await this.projectManager.saveBranchSession(projectId, branchName, {
			task: input.task,
			goal: input.goal,
			currentState: input.currentState,
			approaches: input.approaches ?? [],
			decisions: input.decisions ?? [],
			nextSteps: input.nextSteps ?? [],
			blockers: input.blockers ?? [],
		});

		if (!session) {
			return this.text('Failed to save branch session — project not found.');
		}

		return this.text(
			`✅ Saved branch session for \`${branchName}\`\n` +
			`- **Session ID:** \`${session.id}\`\n` +
			(session.task ? `- **Task:** ${session.task}\n` : '') +
			`- **Changed files:** ${session.changedFiles.length}\n` +
			`- **Recent commits:** ${session.recentCommits.length}\n` +
			`- **Saved at:** ${new Date(session.createdAt).toLocaleString()}`
		);
	}

	private async resumeSession(
		projectId: string,
		rootPath: string | undefined,
		branchName?: string,
		detail: 'brief' | 'full' = 'brief',
	): Promise<vscode.LanguageModelToolResult> {
		if (!branchName && rootPath) {
			branchName = await getCurrentBranch(rootPath) ?? undefined;
		}
		if (!branchName) {
			return this.text('Could not determine current branch. Please specify a branch name.');
		}

		const session = this.projectManager.getLatestBranchSession(projectId, branchName);
		if (!session) {
			return this.text(`No saved sessions for branch \`${branchName}\`. Start a new session with the 'save' action.`);
		}

		const parts: string[] = [];
		parts.push(`## Resuming Branch Session: \`${branchName}\``);
		parts.push(`_Session from: ${new Date(session.updatedAt).toLocaleString()}_\n`);

		if (session.task) { parts.push(`**Task:** ${session.task}`); }

		if (detail === 'full' && session.goal) { parts.push(`**Goal:** ${session.goal}`); }

		if (detail === 'full' && session.approaches.length > 0) {
			parts.push(`\n**Approaches Tried:**`);
			session.approaches.forEach((a: string) => parts.push(`- ${a}`));
		}

		if (detail === 'full' && session.decisions.length > 0) {
			parts.push(`\n**Key Decisions:**`);
			session.decisions.forEach((d: string) => parts.push(`- ${d}`));
		}

		if (session.currentState) {
			parts.push(`\n**Current State:** ${session.currentState}`);
		}

		if (session.nextSteps.length > 0) {
			const steps = detail === 'brief' ? session.nextSteps.slice(0, 3) : session.nextSteps;
			parts.push(`\n**Next Steps:**`);
			steps.forEach((step: string, i: number) => parts.push(`${i + 1}. ${step}`));
			if (detail === 'brief' && session.nextSteps.length > 3) {
				parts.push(`_...and ${session.nextSteps.length - 3} more_`);
			}
		}

		if (session.blockers.length > 0) {
			parts.push(`\n**Blockers:**`);
			session.blockers.forEach((b: string) => parts.push(`- ⚠️ ${b}`));
		}

		if (detail === 'full' && session.changedFiles.length > 0) {
			parts.push(`\n**Changed Files (${session.changedFiles.length}):**`);
			session.changedFiles.slice(0, 20).forEach((f: string) => parts.push(`- ${f}`));
			if (session.changedFiles.length > 20) {
				parts.push(`_...and ${session.changedFiles.length - 20} more_`);
			}
		} else if (session.changedFiles.length > 0) {
			parts.push(`\n**Changed Files:** ${session.changedFiles.length} files`);
		}

		if (detail === 'full' && session.recentCommits.length > 0) {
			parts.push(`\n**Recent Commits (by ${session.author}):**`);
			session.recentCommits.slice(0, 10).forEach((c: string) => parts.push(`- ${c}`));
		} else if (session.recentCommits.length > 0) {
			parts.push(`**Recent Commits:** ${session.recentCommits.length} commits`);
		}

		return this.text(parts.join('\n'));
	}

	private listBranches(
		projectId: string,
		projectName: string,
	): vscode.LanguageModelToolResult {
		const branches = this.projectManager.getTrackedBranches(projectId);

		if (branches.length === 0) {
			return this.text(`No tracked branches in project "${projectName}". Use the 'addBranch' action to start tracking a branch.`);
		}

		const parts: string[] = [];
		parts.push(`## Tracked Branches in "${projectName}" (${branches.length})\n`);

		for (const branch of branches) {
			const sessionCount = branch.sessions.length;
			const lastActivity = branch.lastActivity
				? new Date(branch.lastActivity).toLocaleDateString()
				: 'Never';
			const latestTask = sessionCount > 0
				? branch.sessions[sessionCount - 1].task ?? 'No task set'
				: 'No sessions yet';

			parts.push(`### \`${branch.branchName}\``);
			parts.push(`- Sessions: ${sessionCount}`);
			parts.push(`- Last activity: ${lastActivity}`);
			parts.push(`- Latest task: ${latestTask}`);
			parts.push('');
		}

		return this.text(parts.join('\n'));
	}

	private async addBranch(
		projectId: string,
		rootPath: string | undefined,
		branchName?: string,
	): Promise<vscode.LanguageModelToolResult> {
		if (!branchName && rootPath) {
			branchName = await getCurrentBranch(rootPath) ?? undefined;
		}
		if (!branchName) {
			return this.text('Could not determine current branch. Please specify a branch name.');
		}

		const tracked = await this.projectManager.addTrackedBranch(projectId, branchName);
		if (!tracked) {
			return this.text('Failed to add tracked branch — project not found.');
		}

		return this.text(`✅ Now tracking branch \`${branchName}\`. Sessions will be saved and restored when you're on this branch.`);
	}

	private async removeBranch(
		projectId: string,
		branchName?: string,
	): Promise<vscode.LanguageModelToolResult> {
		if (!branchName) {
			return this.text('Please specify which branch to stop tracking.');
		}

		await this.projectManager.removeTrackedBranch(projectId, branchName);
		return this.text(`🗑️ Stopped tracking branch \`${branchName}\`. All session history for this branch has been removed.`);
	}

	private async checkpoint(
		projectId: string,
		rootPath: string | undefined,
		input: IBranchSessionParams,
	): Promise<vscode.LanguageModelToolResult> {
		let branchName = input.branchName;
		if (!branchName && rootPath) {
			branchName = await getCurrentBranch(rootPath) ?? undefined;
		}
		if (!branchName) {
			return this.text('Could not determine current branch.');
		}

		const latestSession = this.projectManager.getLatestBranchSession(projectId, branchName);

		// Build session data: merge checkpoint fields onto existing session
		const existing = latestSession || { approaches: [] as string[], decisions: [] as string[], nextSteps: [] as string[], blockers: [] as string[], task: '', currentState: '' };
		const approaches = [...existing.approaches, ...(input.completed || [])];
		const decisions = [...existing.decisions, ...(input.decisions || [])];
		const nextSteps = input.pending || input.nextSteps || existing.nextSteps;
		const currentState = input.inProgress || input.currentState || existing.currentState;
		const blockers = input.blockers || existing.blockers;

		const session = await this.projectManager.saveBranchSession(projectId, branchName, {
			task: input.task || existing.task,
			currentState,
			approaches,
			decisions,
			nextSteps,
			blockers,
		});

		if (!session) {
			return this.text('Failed to save checkpoint — project not found.');
		}

		const completedCount = input.completed?.length || 0;
		const pendingCount = nextSteps.length;
		return this.text(
			`✅ Checkpoint saved for \`${branchName}\`\n` +
			(completedCount > 0 ? `- **Completed:** ${completedCount} steps\n` : '') +
			(currentState ? `- **In Progress:** ${currentState}\n` : '') +
			`- **Pending:** ${pendingCount} steps\n` +
			`- **Decisions:** ${decisions.length} total`
		);
	}

	private async gitDiffAction(
		rootPath: string | undefined,
		input: IBranchSessionParams,
	): Promise<vscode.LanguageModelToolResult> {
		if (!rootPath) {
			return this.text('No workspace root path available.');
		}

		const ref1 = input.ref1 || 'main';
		const ref2 = input.ref2 || 'HEAD';
		const maxFiles = input.maxFiles || 5;

		const diff = await getBoundedDiff(rootPath, ref1, ref2, maxFiles);

		if (diff.totalFiles === 0) {
			return this.text(`No differences between \`${ref1}\` and \`${ref2}\`.`);
		}

		const parts: string[] = [];
		parts.push(`## Git Diff: \`${ref1}\`...\`${ref2}\``);
		parts.push(`**${diff.totalFiles} files changed** (+${diff.totalInsertions} / -${diff.totalDeletions})\n`);

		for (const file of diff.files) {
			parts.push(`### ${file.name} (+${file.additions} / -${file.deletions})`);
			parts.push('```');
			parts.push(file.preview);
			parts.push('```\n');
		}

		if (diff.remainingFiles.length > 0) {
			parts.push(`**${diff.remainingFiles.length} more files:** ${diff.remainingFiles.slice(0, 15).join(', ')}${diff.remainingFiles.length > 15 ? '...' : ''}`);
		}

		return this.text(parts.join('\n'));
	}

	private async deltaAction(
		projectId: string,
		rootPath: string | undefined,
		branchName?: string,
	): Promise<vscode.LanguageModelToolResult> {
		if (!branchName && rootPath) {
			branchName = await getCurrentBranch(rootPath) ?? undefined;
		}
		if (!branchName) {
			return this.text('Could not determine current branch.');
		}

		const session = this.projectManager.getLatestBranchSession(projectId, branchName);
		if (!session) {
			return this.text(`No saved session for branch \`${branchName}\`. Nothing to compute delta from.`);
		}

		const parts: string[] = [];
		parts.push(`## Delta Since Last Session Update`);

		const timeSince = Date.now() - session.updatedAt;
		const hours = Math.round(timeSince / (1000 * 60 * 60));
		const timeLabel = hours < 1 ? '<1h ago' : hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
		parts.push(`_Session last updated: ${new Date(session.updatedAt).toLocaleString()} (${timeLabel})_\n`);

		if (session.task) { parts.push(`**Task:** ${session.task}`); }
		if (session.currentState) { parts.push(`**State at last save:** ${session.currentState}`); }

		// Get commits since last session update
		if (rootPath) {
			const commits = await getLogRange(rootPath, session.updatedAt, Date.now(), 20);
			if (commits.length > 0) {
				parts.push(`\n**Commits since last session (${commits.length}):**`);
				for (const c of commits.slice(0, 15)) {
					parts.push(`- ${c}`);
				}
				if (commits.length > 15) {
					parts.push(`_...and ${commits.length - 15} more_`);
				}
			} else {
				parts.push('\n**No new commits since last session.**');
			}

			// Get current changed files and diff with session snapshot
			try {
				const snapshot = await captureGitSnapshot(rootPath, 15, ConfigurationManager.branchBaseBranch);
				if (snapshot) {
					const oldFiles = new Set(session.changedFiles);
					const newFiles = new Set(snapshot.changedFiles);
					const added = snapshot.changedFiles.filter(f => !oldFiles.has(f));
					const removed = session.changedFiles.filter(f => !newFiles.has(f));

					if (added.length > 0 || removed.length > 0) {
						parts.push(`\n**File changes since last session:**`);
						if (added.length > 0) {
							parts.push(`- ${added.length} new files: ${added.slice(0, 10).join(', ')}${added.length > 10 ? '...' : ''}`);
						}
						if (removed.length > 0) {
							parts.push(`- ${removed.length} files no longer changed: ${removed.slice(0, 10).join(', ')}${removed.length > 10 ? '...' : ''}`);
						}
					} else {
						parts.push('\n**No change in working tree files since last session.**');
					}
				}
			} catch { /* ignore */ }
		}

		// Pending work from session
		if (session.nextSteps.length > 0) {
			parts.push(`\n**Pending from last session:**`);
			for (const step of session.nextSteps) {
				parts.push(`- ⬜ ${step}`);
			}
		}
		if (session.blockers.length > 0) {
			parts.push(`\n**Blockers:**`);
			for (const b of session.blockers) {
				parts.push(`- ⚠️ ${b}`);
			}
		}

		parts.push(`\n---\n_Summary: ${timeLabel}_`);

		return this.text(parts.join('\n'));
	}

	async prepareInvocation(
		options: vscode.LanguageModelToolInvocationPrepareOptions<IBranchSessionParams>,
		_token: vscode.CancellationToken
	) {
		const action = options.input?.action ?? 'list';
		const messages: Record<string, string> = {
			save: 'Saving branch session...',
			resume: `Resuming branch session${options.input?.branchName ? ` for "${options.input.branchName}"` : ''}...`,
			list: 'Listing tracked branches...',
			addBranch: `Adding branch "${options.input?.branchName ?? 'current'}" to tracking...`,
			removeBranch: `Removing branch "${options.input?.branchName ?? '...'}" from tracking...`,
			checkpoint: 'Saving progress checkpoint...',
			gitDiff: `Getting bounded diff (${options.input?.ref1 || 'main'}...${options.input?.ref2 || 'HEAD'})...`,
			delta: 'Computing inter-session delta...',
		};
		return {
			invocationMessage: messages[action] ?? `Managing branch sessions (${action})...`,
		};
	}
}

// ─── Project Intelligence Tool ──────────────────────────────────

interface IProjectIntelligenceParams {
	action: 'learnConvention' | 'learnToolHint' | 'learnNote' | 'queryNotes' | 'searchLearnings' | 'listConventions' | 'updateConvention' | 'retrospect';
	// learnConvention
	category?: 'architecture' | 'naming' | 'patterns' | 'testing' | 'tooling' | 'pitfalls';
	title?: string;
	content?: string;
	confidence?: 'observed' | 'inferred';
	learnedFrom?: string;
	conventionId?: string;
	// learnToolHint
	toolName?: string;
	pattern?: string;
	antiPattern?: string;
	example?: string;
	// learnNote
	subject?: string;
	insight?: string;
	relatedFiles?: string[];
	relatedSymbols?: string[];
	discoveredWhile?: string;
	// queryNotes / searchLearnings
	query?: string;
	files?: string[];
	types?: ('convention' | 'toolHint' | 'note')[];
	limit?: number;
	// retrospect
	taskSummary?: string;
	whatWorked?: string[];
	whatDidntWork?: string[];
	newConventions?: Array<{ category: string; title: string; content: string }>;
	newToolHints?: Array<{ toolName: string; pattern: string; antiPattern?: string; example: string }>;
	knowledgeCards?: Array<{ title: string; content: string; category: string }>;
}

export class ProjectIntelligenceTool implements vscode.LanguageModelTool<IProjectIntelligenceParams> {
	constructor(
		private readonly projectManager: ProjectManager,
		private readonly searchIndex?: SearchIndex,
	) {}

	async invoke(
		options: vscode.LanguageModelToolInvocationOptions<IProjectIntelligenceParams>,
		_token: vscode.CancellationToken,
	): Promise<vscode.LanguageModelToolResult> {
		const activeProject = this.projectManager.getActiveProject();
		if (!activeProject) {
			return this.text('No active project in ContextManager.');
		}
		const projectId = activeProject.id;
		const { action } = options.input;

		switch (action) {
			case 'learnConvention': {
				const { category, title, content, confidence, learnedFrom } = options.input;
				if (!category || !title || !content) {
					return this.text('Missing required fields: category, title, content.');
				}
				// Cap confidence: AI can set 'observed' or 'inferred' only, never 'confirmed'
				const safeConfidence = (confidence === 'inferred' || confidence === 'observed') ? confidence : 'observed';
				const conv = await this.projectManager.addConvention(
					projectId, category, title, content, safeConfidence, learnedFrom
				);
				return this.text(conv
					? `✅ Convention learned: [${category}] "${title}" (${safeConfidence})`
					: 'Failed to save convention.'
				);
			}

			case 'updateConvention': {
				const { conventionId, title, content, confidence, category } = options.input;
				if (!conventionId) { return this.text('Missing conventionId.'); }
				const updates: any = {};
				if (title) { updates.title = title; }
				if (content) { updates.content = content; }
				if (confidence) { updates.confidence = confidence; }
				if (category) { updates.category = category; }
				const ok = await this.projectManager.updateConvention(projectId, conventionId, updates);
				return this.text(ok ? '✅ Convention updated.' : 'Convention not found.');
			}

			case 'listConventions': {
				const conventions = this.projectManager.getConventions(projectId);
				const filtered = options.input.confidence
					? conventions.filter(c => c.confidence === options.input.confidence)
					: conventions;
				if (filtered.length === 0) {
					return this.text('No conventions found.');
				}
				const lines = filtered.map(c =>
					`- [${c.category}] **${c.title}** (ID: ${c.id}): ${c.content.slice(0, 150)}${c.content.length > 150 ? '…' : ''} (${c.confidence})`
				);
				return this.text(`## Conventions (${filtered.length})\n${lines.join('\n')}`);
			}

			case 'learnToolHint': {
				const { toolName, pattern, example, antiPattern } = options.input;
				if (!toolName || !pattern || !example) {
					return this.text('Missing required fields: toolName, pattern, example.');
				}
				const hint = await this.projectManager.addToolHint(projectId, toolName, pattern, example, antiPattern);
				return this.text(hint
					? `✅ Tool hint learned: search "${pattern}"${antiPattern ? ` not "${antiPattern}"` : ''}`
					: 'Failed to save tool hint.'
				);
			}

			case 'learnNote': {
				const { subject, insight, relatedFiles, relatedSymbols, discoveredWhile } = options.input;
				if (!subject || !insight) {
					return this.text('Missing required fields: subject, insight.');
				}
				const note = await this.projectManager.addWorkingNote(
					projectId, subject, insight, relatedFiles || [], relatedSymbols || [], discoveredWhile
				);
				return this.text(note
					? `📌 Note saved: "${subject}" (${(relatedFiles || []).length} related files)`
					: 'Failed to save working note.'
				);
			}

			case 'queryNotes': {
				const notes = this.projectManager.queryWorkingNotes(
					projectId, options.input.query, options.input.files
				);
				if (notes.length === 0) {
					return this.text('No matching working notes found.');
				}
				const lines = notes.slice(0, options.input.limit || 10).map(n => {
					const stale = n.staleness !== 'fresh' ? ` ⚠️ ${n.staleness}` : '';
					return `### 📌 ${n.subject} (ID: ${n.id})${stale}\n${n.insight.slice(0, 300)}${n.insight.length > 300 ? '…' : ''}\n` +
						(n.relatedFiles.length > 0 ? `Files: ${n.relatedFiles.join(', ')}\n` : '') +
						(n.relatedSymbols.length > 0 ? `Symbols: ${n.relatedSymbols.join(', ')}\n` : '');
				});
				return this.text(`## Working Notes (${notes.length})\n${lines.join('\n')}`);
			}

			case 'searchLearnings': {
				const { query, types, limit } = options.input;
				if (!query) { return this.text('Missing required field: query.'); }
				if (!this.searchIndex) {
					// Fallback: keyword search on working notes
					const notes = this.projectManager.queryWorkingNotes(projectId, query);
					if (notes.length === 0) { return this.text('No matching learnings found (FTS not available).'); }
					const lines = notes.slice(0, limit || 10).map(n => `- 📌 ${n.subject} (ID: ${n.id}): ${n.insight.slice(0, 100)}…`);
					return this.text(`## Search Results\n${lines.join('\n')}`);
				}
				const results = await this.searchIndex.searchLearnings(projectId, query, types, limit || 10);
				if (results.length === 0) { return this.text(`No learnings found for "${query}".`); }
				const typeIcons: Record<string, string> = { convention: '🏗', toolHint: '🔧', note: '📌' };
				const lines = results.map(r =>
					`- ${typeIcons[r.metadata.type] || '•'} [${r.metadata.type}] **${r.title}**: ${r.snippet}`
				);
				return this.text(`## Learnings matching "${query}" (${results.length})\n${lines.join('\n')}`);
			}

			case 'retrospect': {
				const { taskSummary, whatWorked, whatDidntWork, newConventions, newToolHints, knowledgeCards } = options.input;
				const results: string[] = ['## 📋 Retrospective Processed\n'];

				// Save what worked/didn't work to the current branch session
				const rootPath = activeProject.rootPaths[0];
				if (rootPath) {
					const branch = await getCurrentBranch(rootPath);
					if (branch) {
						const latestSession = this.projectManager.getLatestBranchSession(projectId, branch);
						if (latestSession) {
							const approaches = [...latestSession.approaches, ...(whatWorked || [])];
							const decisions = [...latestSession.decisions, ...(whatDidntWork?.map(w => `❌ ${w}`) || [])];
							await this.projectManager.saveBranchSession(projectId, branch, {
								task: taskSummary || latestSession.task,
								currentState: taskSummary || latestSession.currentState,
								approaches,
								decisions,
								nextSteps: [], // Done
							});
							results.push(`- ✅ Session updated with ${whatWorked?.length || 0} successes, ${whatDidntWork?.length || 0} failures`);
						}
					}
				}

				// Save new conventions
				if (newConventions && newConventions.length > 0) {
					for (const c of newConventions) {
						await this.projectManager.addConvention(
							projectId,
							(c.category || 'patterns') as any,
							c.title, c.content, 'observed', taskSummary
						);
					}
					results.push(`- ✅ ${newConventions.length} convention(s) learned`);
				}

				// Save new tool hints
				if (newToolHints && newToolHints.length > 0) {
					for (const h of newToolHints) {
						await this.projectManager.addToolHint(projectId, h.toolName, h.pattern, h.example, h.antiPattern);
					}
					results.push(`- ✅ ${newToolHints.length} tool hint(s) saved`);
				}

				// Save knowledge cards
				if (knowledgeCards && knowledgeCards.length > 0) {
					for (const card of knowledgeCards) {
						await this.projectManager.addKnowledgeCard(
							projectId, card.title, card.content,
							(card.category || 'note') as any, [], taskSummary
						);
					}
					results.push(`- ✅ ${knowledgeCards.length} knowledge card(s) created`);
				}

				return this.text(results.join('\n'));
			}

			default:
				return this.text(`Unknown action "${action}".`);
		}
	}

	private text(msg: string): vscode.LanguageModelToolResult {
		return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(msg)]);
	}

	async prepareInvocation(
		options: vscode.LanguageModelToolInvocationPrepareOptions<IProjectIntelligenceParams>,
		_token: vscode.CancellationToken,
	) {
		const action = options.input?.action ?? 'queryNotes';
		const messages: Record<string, string> = {
			learnConvention: `Learning convention: "${options.input?.title || '...'}"`,
			learnToolHint: `Learning tool hint: "${options.input?.pattern || '...'}"`,
			learnNote: `Saving note: "${options.input?.subject || '...'}"`,
			queryNotes: `Querying working notes...`,
			searchLearnings: `Searching learnings for "${options.input?.query || '...'}"`,
			listConventions: 'Listing conventions...',
			updateConvention: 'Updating convention...',
			retrospect: 'Processing end-of-task retrospective...',
		};
		return {
			invocationMessage: messages[action] ?? `Project intelligence (${action})...`,
		};
	}
}

// ─── Subagent Tool ──────────────────────────────────────────────

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
				// The subagent should have refined the content in its response.
				// We add a note about the refinement but don't auto-overwrite the card
				// since the subagent may have used the manageTodos/knowledge tools directly.
				const cards = this.projectManager.getKnowledgeCards(activeProject.id);
				const card = cards.find(c => c.id === cardId);
				if (card) {
					// Check if card was recently updated (subagent may have updated it directly)
					const recentlyUpdated = (Date.now() - card.updated) < 60_000;
					if (!recentlyUpdated) {
						// Card wasn't updated by the subagent's tool calls, update it with the result
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

// ─── Write File Tool ────────────────────────────────────────────

interface IWriteFileParams {
	/** Absolute path to the file to create or overwrite. */
	filePath: string;
	/** Full content to write to the file. */
	content: string;
	/** If true, overwrites the file when it already exists. Default: true. */
	overwrite?: boolean;
}

/**
 * Creates or overwrites a file using vscode.workspace.fs.writeFile().
 * This uses the stable VS Code FileSystem API — guaranteed to write contents.
 */
export class WriteFileTool implements vscode.LanguageModelTool<IWriteFileParams> {
	async invoke(
		options: vscode.LanguageModelToolInvocationOptions<IWriteFileParams>,
		_token: vscode.CancellationToken,
	): Promise<vscode.LanguageModelToolResult> {
		const { filePath, content } = options.input;

		if (!filePath || typeof filePath !== 'string') {
			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart('Error: filePath is required and must be a string.'),
			]);
		}

		try {
			const uri = vscode.Uri.file(filePath);
			const text = content ?? '';

			// Emit stream.textEdit() BEFORE writing to disk so VS Code diffs
			// against the current buffer state, not the already-written content.
			try {
				const stream = getToolStream() as any;
				if (stream && typeof stream.textEdit === 'function') {
					const edit = vscode.TextEdit.replace(new vscode.Range(0, 0, 999999, 0), text);
					stream.textEdit(uri, [edit]);
					stream.textEdit(uri, true);
				}
			} catch { /* proposed API unavailable — ignore */ }

			// Always write to disk so follow-up tool reads see the new content.
			await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(text));

			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart(`Successfully wrote ${text.length} chars to: ${filePath}`),
			]);
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart(`Error writing file "${filePath}": ${msg}`),
			]);
		}
	}

	async prepareInvocation(
		options: vscode.LanguageModelToolInvocationPrepareOptions<IWriteFileParams>,
		_token: vscode.CancellationToken,
	) {
		const filePath = options.input?.filePath ?? 'file';
		const short = filePath.split(/[\\/]/).pop() ?? filePath;
		return {
			invocationMessage: `Writing file: ${short}`,
		};
	}
}

// ─── Replace String In File Tool ────────────────────────────────

interface IReplaceStringInFileParams {
	/** Absolute path to the file to edit. */
	filePath: string;
	/** The exact literal string to find and replace. Must uniquely identify the location. */
	oldString: string;
	/** The replacement string. */
	newString: string;
}

/**
 * Replaces the first occurrence of oldString with newString in a file.
 * Reads the file, does the replacement, then writes it back.
 */
export class ReplaceStringInFileTool implements vscode.LanguageModelTool<IReplaceStringInFileParams> {
	async invoke(
		options: vscode.LanguageModelToolInvocationOptions<IReplaceStringInFileParams>,
		_token: vscode.CancellationToken,
	): Promise<vscode.LanguageModelToolResult> {
		const { filePath, oldString, newString } = options.input;

		if (!filePath || typeof filePath !== 'string') {
			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart('Error: filePath is required.'),
			]);
		}
		if (oldString === undefined || oldString === null) {
			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart('Error: oldString is required.'),
			]);
		}

		try {
			const uri = vscode.Uri.file(filePath);
			const raw = await vscode.workspace.fs.readFile(uri);
			const text = new TextDecoder().decode(raw);

			if (!text.includes(oldString)) {
				return new vscode.LanguageModelToolResult([
					new vscode.LanguageModelTextPart(
						`Error: oldString not found in ${filePath}. ` +
						`Make sure it matches the file content exactly (including whitespace and indentation).`
					),
				]);
			}

			// Emit stream.textEdit() BEFORE writing to disk so VS Code diffs
			// against the current buffer state, not the already-written content.
			try {
				const stream = getToolStream() as any;
				if (stream && typeof stream.textEdit === 'function') {
					const matchIndex = text.indexOf(oldString);
					const before = text.substring(0, matchIndex);
					const beforeLines = before.split('\n');
					const startLine = beforeLines.length - 1;
					const startChar = beforeLines[beforeLines.length - 1].length;
					const oldLines = oldString.split('\n');
					const endLine = startLine + oldLines.length - 1;
					const endChar = oldLines.length === 1 ? startChar + oldString.length : oldLines[oldLines.length - 1].length;
					const range = new vscode.Range(startLine, startChar, endLine, endChar);
					stream.textEdit(uri, [vscode.TextEdit.replace(range, newString)]);
					stream.textEdit(uri, true);
				}
			} catch { /* proposed API unavailable — ignore */ }

			// Always write to disk immediately so subsequent tool calls can read the file.
			const updated = text.replace(oldString, newString);
			await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(updated));

			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart(`Successfully replaced string in: ${filePath}`),
			]);
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart(`Error editing file "${filePath}": ${msg}`),
			]);
		}
	}

	async prepareInvocation(
		options: vscode.LanguageModelToolInvocationPrepareOptions<IReplaceStringInFileParams>,
		_token: vscode.CancellationToken,
	) {
		const filePath = options.input?.filePath ?? 'file';
		const short = filePath.split(/[\\/]/).pop() ?? filePath;
		return {
			invocationMessage: `Editing file: ${short}`,
		};
	}
}

// ─── File System Operation Tools ───────────────────────────────

interface IFileStatParams { filePath: string; }
interface IRenameFileParams { sourcePath: string; targetPath: string; overwrite?: boolean; }
interface IDeleteFileParams { filePath: string; recursive?: boolean; useTrash?: boolean; }
interface ICopyFileParams { sourcePath: string; targetPath: string; overwrite?: boolean; }
interface ICreateDirectoryParams { dirPath: string; }

export class FileStatTool implements vscode.LanguageModelTool<IFileStatParams> {
	async invoke(options: vscode.LanguageModelToolInvocationOptions<IFileStatParams>, _token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
		try {
			const stat = await vscode.workspace.fs.stat(vscode.Uri.file(options.input.filePath));
			const typeStr = stat.type === vscode.FileType.Directory ? 'directory'
				: stat.type === vscode.FileType.File ? 'file'
				: stat.type === vscode.FileType.SymbolicLink ? 'symlink' : 'unknown';
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(
				`type: ${typeStr}\nsize: ${stat.size} bytes\nmtime: ${new Date(stat.mtime).toISOString()}`
			)]);
		} catch (err: unknown) {
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(
				`Error: ${err instanceof Error ? err.message : String(err)}`
			)]);
		}
	}
	async prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<IFileStatParams>) {
		return { invocationMessage: `Stat: ${options.input?.filePath?.split(/[\\/]/).pop() ?? 'file'}` };
	}
}

export class RenameFileTool implements vscode.LanguageModelTool<IRenameFileParams> {
	async invoke(options: vscode.LanguageModelToolInvocationOptions<IRenameFileParams>, _token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
		try {
			await vscode.workspace.fs.rename(vscode.Uri.file(options.input.sourcePath), vscode.Uri.file(options.input.targetPath), { overwrite: options.input.overwrite ?? false });
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(`Renamed: ${options.input.sourcePath} → ${options.input.targetPath}`)]);
		} catch (err: unknown) {
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(`Error: ${err instanceof Error ? err.message : String(err)}`)]);
		}
	}
	async prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<IRenameFileParams>) {
		return { invocationMessage: `Renaming: ${options.input?.sourcePath?.split(/[\\/]/).pop() ?? 'file'}` };
	}
}

export class DeleteFileTool implements vscode.LanguageModelTool<IDeleteFileParams> {
	async invoke(options: vscode.LanguageModelToolInvocationOptions<IDeleteFileParams>, _token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
		try {
			await vscode.workspace.fs.delete(vscode.Uri.file(options.input.filePath), { recursive: options.input.recursive ?? false, useTrash: options.input.useTrash ?? true });
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(`Deleted: ${options.input.filePath}`)]);
		} catch (err: unknown) {
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(`Error: ${err instanceof Error ? err.message : String(err)}`)]);
		}
	}
	async prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<IDeleteFileParams>) {
		return { invocationMessage: `Deleting: ${options.input?.filePath?.split(/[\\/]/).pop() ?? 'file'}` };
	}
}

export class CopyFileTool implements vscode.LanguageModelTool<ICopyFileParams> {
	async invoke(options: vscode.LanguageModelToolInvocationOptions<ICopyFileParams>, _token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
		try {
			await vscode.workspace.fs.copy(vscode.Uri.file(options.input.sourcePath), vscode.Uri.file(options.input.targetPath), { overwrite: options.input.overwrite ?? false });
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(`Copied: ${options.input.sourcePath} → ${options.input.targetPath}`)]);
		} catch (err: unknown) {
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(`Error: ${err instanceof Error ? err.message : String(err)}`)]);
		}
	}
	async prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<ICopyFileParams>) {
		return { invocationMessage: `Copying: ${options.input?.sourcePath?.split(/[\\/]/).pop() ?? 'file'}` };
	}
}

export class CreateDirectoryTool implements vscode.LanguageModelTool<ICreateDirectoryParams> {
	async invoke(options: vscode.LanguageModelToolInvocationOptions<ICreateDirectoryParams>, _token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
		try {
			await vscode.workspace.fs.createDirectory(vscode.Uri.file(options.input.dirPath));
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(`Created directory: ${options.input.dirPath}`)]);
		} catch (err: unknown) {
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(`Error: ${err instanceof Error ? err.message : String(err)}`)]);
		}
	}
	async prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<ICreateDirectoryParams>) {
		return { invocationMessage: `Creating directory: ${options.input?.dirPath?.split(/[\\/]/).pop() ?? 'dir'}` };
	}
}

// ─── Save Knowledge Card Tool ───────────────────────────────────

interface ISaveKnowledgeCardParams {
	/** Title of the knowledge card. */
	title: string;
	/** Full markdown content of the card. */
	content: string;
	/** Category for the card. Default: 'note'. */
	category?: 'architecture' | 'pattern' | 'convention' | 'explanation' | 'note' | 'other';
	/** Optional list of tags for discovery. */
	tags?: string[];
	/** Optional source reference (e.g. doc URL, file path). */
	source?: string;
}

/**
 * Silently saves a knowledge card to the active project without interrupting the chat session.
 * No confirmation required — runs in background.
 */
export class SaveKnowledgeCardTool implements vscode.LanguageModelTool<ISaveKnowledgeCardParams> {
	constructor(private readonly projectManager: ProjectManager) {}

	async invoke(
		options: vscode.LanguageModelToolInvocationOptions<ISaveKnowledgeCardParams>,
		_token: vscode.CancellationToken,
	): Promise<vscode.LanguageModelToolResult> {
		const project = this.projectManager.getActiveProject();
		if (!project) {
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(
				'No active project. Cannot save knowledge card.'
			)]);
		}

		const { title, content, category = 'note', tags = [], source } = options.input;

		if (!title?.trim()) {
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('title is required.')]);
		}
		if (!content?.trim()) {
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('content is required.')]);
		}

		const card = await this.projectManager.addKnowledgeCard(
			project.id, title.trim(), content.trim(), category, tags, source
		);

		if (!card) {
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('Failed to save knowledge card.')]);
		}

		return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(
			`Knowledge card saved: "${card.title}" (ID: ${card.id})\nProject: ${project.name} | Category: ${card.category}${card.tags?.length ? ` | Tags: ${card.tags.join(', ')}` : ''}`
		)]);
	}

	async prepareInvocation(
		options: vscode.LanguageModelToolInvocationPrepareOptions<ISaveKnowledgeCardParams>,
		_token: vscode.CancellationToken,
	) {
		const title = options.input?.title ?? 'knowledge card';
		const msg = `Saving knowledge card: "${title}"...`;
		if (ConfigurationManager.toolsBackgroundMode) {
			return { invocationMessage: msg };
		}
		return {
			invocationMessage: msg,
			confirmationMessages: {
				title: 'Save Knowledge Card',
				message: new vscode.MarkdownString(`Save knowledge card **"${title}"** to the active project?`),
			},
		};
	}
}

// ─── Save Cache Tool ─────────────────────────────────────────────

interface ISaveCacheParams {
	/** Symbol or concept name for this cache entry. */
	symbolName: string;
	/** The explanation/content to cache. */
	content: string;
	/** Type of cached content. Default: 'explain'. */
	type?: 'explain' | 'usage' | 'relationships';
	/** Optional file path the explanation relates to. */
	filePath?: string;
	/** Optional line number within filePath. */
	lineNumber?: number;
}

/**
 * Silently saves a code explanation or note to the cache without interrupting the chat session.
 * No confirmation required — runs in background.
 */
export class SaveCacheTool implements vscode.LanguageModelTool<ISaveCacheParams> {
	constructor(
		private readonly cache: ExplanationCache,
		private readonly projectManager: ProjectManager,
	) {}

	async invoke(
		options: vscode.LanguageModelToolInvocationOptions<ISaveCacheParams>,
		_token: vscode.CancellationToken,
	): Promise<vscode.LanguageModelToolResult> {
		const { symbolName, content, type = 'explain', filePath, lineNumber } = options.input;

		if (!symbolName?.trim()) {
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('symbolName is required.')]);
		}
		if (!content?.trim()) {
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('content is required.')]);
		}

		const project = this.projectManager.getActiveProject();
		const projectId = project?.id;
		const key = `${type}:${symbolName.trim()}`;

		this.cache.set(key, content.trim(), {
			symbolName: symbolName.trim(),
			type,
			filePath,
			lineNumber,
			projectId,
		});

		// Retrieve the entry to get its auto-generated ID
		const entry = this.cache.getEntry(key, projectId);

		return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(
			`Cached explanation for "${symbolName}" (type: ${type})${entry ? ` — ID: ${entry.id}` : ''}${project ? `\nProject: ${project.name}` : ''}`
		)]);
	}

	async prepareInvocation(
		options: vscode.LanguageModelToolInvocationPrepareOptions<ISaveCacheParams>,
		_token: vscode.CancellationToken,
	) {
		const sym = options.input?.symbolName ?? 'symbol';
		const msg = `Caching explanation for "${sym}"...`;
		if (ConfigurationManager.toolsBackgroundMode) {
			return { invocationMessage: msg };
		}
		return {
			invocationMessage: msg,
			confirmationMessages: {
				title: 'Save to Cache',
				message: new vscode.MarkdownString(`Cache explanation for **"${sym}"** (type: ${options.input?.type ?? 'explain'})?`),
			},
		};
	}
}

// ─── Search Cache Tool ───────────────────────────────────────────

interface ISearchCacheParams {
	/** Keyword or phrase to search for in cache entries. */
	query: string;
	/** Maximum results to return. Default 10. */
	limit?: number;
}

/**
 * Searches cached explanations by keyword/symbol name match.
 * Filters to the active project's cache.
 */
export class SearchCacheTool implements vscode.LanguageModelTool<ISearchCacheParams> {
	constructor(
		private readonly cache: ExplanationCache,
		private readonly projectManager: ProjectManager,
		private readonly searchIndex?: SearchIndex,
	) {}

	async invoke(
		options: vscode.LanguageModelToolInvocationOptions<ISearchCacheParams>,
		_token: vscode.CancellationToken,
	): Promise<vscode.LanguageModelToolResult> {
		const { query, limit = 10 } = options.input;

		if (!query?.trim()) {
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('query is required.')]);
		}

		const project = this.projectManager.getActiveProject();

		// Try FTS search first if available
		if (this.searchIndex?.isReady && ConfigurationManager.searchEnableFTS) {
			try {
				const results = await this.searchIndex.search(query, {
					entityTypes: ['cache'],
					projectId: project?.id,
					limit,
					snippetTokens: ConfigurationManager.searchSnippetTokens,
				});

				if (results.length > 0) {
					const parts: string[] = [`## Cache Search Results for: "${query}" (${results.length} found)\n`];
					for (const r of results) {
						const score = Math.abs(r.score).toFixed(2);
						parts.push(`### ${r.title} — relevance ${score}`);
						if (r.metadata.filePath) { parts.push(`File: ${r.metadata.filePath}`); }
						parts.push(`ID: ${r.entityId}`);
						if (r.snippet) { parts.push(`> ${r.snippet.replace(/\n/g, '\n> ')}`); }
						parts.push('');
					}
					return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(parts.join('\n'))]);
				}
			} catch { /* fall through to keyword search */ }
		}

		// Keyword fallback
		const entries = project
			? this.cache.getEntriesForProject(project.id)
			: this.cache.getAllEntries();

		const q = query.toLowerCase();
		const terms = q.split(/\s+/).filter(Boolean);

		const matched = entries
			.map(e => {
				const haystack = `${e.symbolName} ${e.content} ${e.filePath ?? ''}`.toLowerCase();
				const hits = terms.filter(t => haystack.includes(t)).length;
				return { e, hits };
			})
			.filter(x => x.hits > 0)
			.sort((a, b) => b.hits - a.hits)
			.slice(0, limit);

		if (matched.length === 0) {
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(
				`No cached entries found matching "${query}"${project ? ` in project "${project.name}"` : ''}.`
			)]);
		}

		const parts: string[] = [`## Cache Search Results for: "${query}" (${matched.length} found)\n`];
		for (const { e } of matched) {
			parts.push(`### ${e.symbolName} [${e.type}]`);
			if (e.filePath) { parts.push(`File: ${e.filePath}${e.lineNumber !== undefined ? `:${e.lineNumber}` : ''}`); }
			parts.push(`ID: ${e.id} | Cached: ${new Date(e.cachedAt).toLocaleDateString()}`);
			// Show a snippet (first 300 chars)
			const snippet = e.content.length > 300 ? e.content.substring(0, 297) + '...' : e.content;
			parts.push(`> ${snippet.replace(/\n/g, '\n> ')}`);
			parts.push('');
		}

		return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(parts.join('\n'))]);
	}

	async prepareInvocation(
		options: vscode.LanguageModelToolInvocationPrepareOptions<ISearchCacheParams>,
		_token: vscode.CancellationToken,
	) {
		const q = options.input?.query ?? '...';
		const msg = `Searching cache for "${q}"...`;
		if (ConfigurationManager.toolsBackgroundMode) {
			return { invocationMessage: msg };
		}
		return {
			invocationMessage: msg,
			confirmationMessages: {
				title: 'Search Cache',
				message: new vscode.MarkdownString(`Search cached explanations for **"${q}"**?`),
			},
		};
	}
}

// ─── Read Cache Tool ─────────────────────────────────────────────

interface IReadCacheParams {
	/** Cache entry ID (exact). */
	id?: string;
	/** Symbol name to look up (finds the most recent match). */
	symbolName?: string;
	/** Type filter when using symbolName. Optional. */
	type?: 'explain' | 'usage' | 'relationships';
}

/**
 * Reads a specific cache entry in full by its ID or symbol name.
 */
export class ReadCacheTool implements vscode.LanguageModelTool<IReadCacheParams> {
	constructor(
		private readonly cache: ExplanationCache,
		private readonly projectManager: ProjectManager,
	) {}

	async invoke(
		options: vscode.LanguageModelToolInvocationOptions<IReadCacheParams>,
		_token: vscode.CancellationToken,
	): Promise<vscode.LanguageModelToolResult> {
		const { id, symbolName, type } = options.input;

		if (!id && !symbolName) {
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(
				'Provide either id or symbolName to identify the cache entry.'
			)]);
		}

		let entry = id ? this.cache.getEntryById(id) : undefined;

		if (!entry && symbolName) {
			const project = this.projectManager.getActiveProject();
			const all = project
				? this.cache.getEntriesForProject(project.id)
				: this.cache.getAllEntries();

			const sym = symbolName.trim().toLowerCase();
			const candidates = all.filter(e =>
				e.symbolName.toLowerCase() === sym &&
				(type === undefined || e.type === type)
			);

			// Most recent first
			entry = candidates.sort((a, b) => b.cachedAt - a.cachedAt)[0];
		}

		if (!entry) {
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(
				id
					? `No cache entry found with ID "${id}".`
					: `No cache entry found for symbol "${symbolName}"${type ? ` (type: ${type})` : ''}.`
			)]);
		}

		const parts: string[] = [];
		parts.push(`## Cache Entry: ${entry.symbolName} [${entry.type}]`);
		parts.push(`**ID:** ${entry.id}`);
		if (entry.filePath) {
			parts.push(`**File:** ${entry.filePath}${entry.lineNumber !== undefined ? `:${entry.lineNumber}` : ''}`);
		}
		parts.push(`**Cached:** ${new Date(entry.cachedAt).toLocaleString()}`);
		if (entry.projectId) { parts.push(`**Project:** ${entry.projectId}`); }
		parts.push('');
		parts.push(entry.content);

		return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(parts.join('\n'))]);
	}

	async prepareInvocation(
		options: vscode.LanguageModelToolInvocationPrepareOptions<IReadCacheParams>,
		_token: vscode.CancellationToken,
	) {
		const label = options.input?.symbolName ?? options.input?.id ?? 'cache entry';
		const msg = `Reading cache: "${label}"...`;
		if (ConfigurationManager.toolsBackgroundMode) {
			return { invocationMessage: msg };
		}
		return {
			invocationMessage: msg,
			confirmationMessages: {
				title: 'Read Cache Entry',
				message: new vscode.MarkdownString(`Read cached entry for **"${label}"**?`),
			},
		};
	}
}

// ─── Edit Knowledge Card Tool ─────────────────────────────────────

interface IEditKnowledgeCardParams {
	/** ID of the knowledge card to edit. */
	id: string;
	/** New title. Omit to keep existing. */
	title?: string;
	/** New markdown content. Omit to keep existing. */
	content?: string;
	/** New category. Omit to keep existing. */
	category?: 'architecture' | 'pattern' | 'convention' | 'explanation' | 'note' | 'other';
	/** Replacement tag list. Omit to keep existing. */
	tags?: string[];
	/** New source reference. Omit to keep existing. */
	source?: string;
}

/**
 * Updates fields on an existing knowledge card in the active project.
 * Only supplied fields are changed; omitted fields are left as-is.
 */
export class EditKnowledgeCardTool implements vscode.LanguageModelTool<IEditKnowledgeCardParams> {
	constructor(private readonly projectManager: ProjectManager) {}

	async invoke(
		options: vscode.LanguageModelToolInvocationOptions<IEditKnowledgeCardParams>,
		_token: vscode.CancellationToken,
	): Promise<vscode.LanguageModelToolResult> {
		const project = this.projectManager.getActiveProject();
		if (!project) {
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(
				'No active project. Cannot edit knowledge card.'
			)]);
		}

		const { id, title, content, category, tags, source } = options.input;
		if (!id?.trim()) {
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('id is required.')]);
		}

		// Build updates — only include fields that were actually provided
		const updates: Record<string, unknown> = {};
		if (title !== undefined) { updates.title = title.trim(); }
		if (content !== undefined) { updates.content = content.trim(); }
		if (category !== undefined) { updates.category = category; }
		if (tags !== undefined) { updates.tags = tags; }
		if (source !== undefined) { updates.source = source; }

		if (Object.keys(updates).length === 0) {
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(
				'No fields to update. Provide at least one of: title, content, category, tags, source.'
			)]);
		}

		const updated = await this.projectManager.updateKnowledgeCard(project.id, id.trim(), updates);
		if (!updated) {
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(
				`No knowledge card found with ID "${id}" in project "${project.name}".`
			)]);
		}

		const changed = Object.keys(updates).join(', ');
		return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(
			`Knowledge card updated: "${updated.title}" (ID: ${updated.id})\nUpdated fields: ${changed}`
		)]);
	}

	async prepareInvocation(
		options: vscode.LanguageModelToolInvocationPrepareOptions<IEditKnowledgeCardParams>,
		_token: vscode.CancellationToken,
	) {
		const id = options.input?.id ?? 'card';
		const msg = `Editing knowledge card "${id}"...`;
		if (ConfigurationManager.toolsBackgroundMode) {
			return { invocationMessage: msg };
		}
		return {
			invocationMessage: msg,
			confirmationMessages: {
				title: 'Edit Knowledge Card',
				message: new vscode.MarkdownString(`Update knowledge card **"${id}"**?`),
			},
		};
	}
}

// ─── Edit Cache Tool ──────────────────────────────────────────────

interface IEditCacheParams {
	/** Cache entry ID to edit. */
	id: string;
	/** Replacement content. Omit to keep existing. */
	content?: string;
	/** Replacement symbol name. Omit to keep existing. */
	symbolName?: string;
}

/**
 * Updates an existing cache entry's content and/or symbol name.
 * Only supplied fields are changed.
 */
export class EditCacheTool implements vscode.LanguageModelTool<IEditCacheParams> {
	constructor(
		private readonly cache: ExplanationCache,
	) {}

	async invoke(
		options: vscode.LanguageModelToolInvocationOptions<IEditCacheParams>,
		_token: vscode.CancellationToken,
	): Promise<vscode.LanguageModelToolResult> {
		const { id, content, symbolName } = options.input;

		if (!id?.trim()) {
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('id is required.')]);
		}

		const entry = this.cache.getEntryById(id.trim());
		if (!entry) {
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(
				`No cache entry found with ID "${id}".`
			)]);
		}

		if (content === undefined && symbolName === undefined) {
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(
				'No fields to update. Provide at least one of: content, symbolName.'
			)]);
		}

		const updates: { content?: string; symbolName?: string } = {};
		if (content !== undefined) { updates.content = content.trim(); }
		if (symbolName !== undefined) { updates.symbolName = symbolName.trim(); }

		const ok = this.cache.updateEntry(id.trim(), updates);
		if (!ok) {
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(
				`Failed to update cache entry "${id}".`
			)]);
		}

		const changed = Object.keys(updates).join(', ');
		const sym = updates.symbolName ?? entry.symbolName;
		return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(
			`Cache entry updated: "${sym}" (ID: ${id})\nUpdated fields: ${changed}`
		)]);
	}

	async prepareInvocation(
		options: vscode.LanguageModelToolInvocationPrepareOptions<IEditCacheParams>,
		_token: vscode.CancellationToken,
	) {
		const id = options.input?.id ?? 'cache entry';
		const msg = `Editing cache entry "${id}"...`;
		if (ConfigurationManager.toolsBackgroundMode) {
			return { invocationMessage: msg };
		}
		return {
			invocationMessage: msg,
			confirmationMessages: {
				title: 'Edit Cache Entry',
				message: new vscode.MarkdownString(`Update cache entry **"${id}"**?`),
			},
		};
	}
}

// ─── Registration ───────────────────────────────────────────────

export function registerTools(
	context: vscode.ExtensionContext,
	projectManager: ProjectManager,
	cache: ExplanationCache,
	embeddingManager?: EmbeddingManager,
	searchIndex?: SearchIndex,
) {
	context.subscriptions.push(
		vscode.lm.registerTool(
			'contextManager_getProjectContext',
			new ProjectContextTool(projectManager, cache)
		)
	);

	// TODO tool removed — TODOs are user-managed only, not created by agents

	context.subscriptions.push(
		vscode.lm.registerTool(
			'contextManager_branchSession',
			new BranchSessionTool(projectManager)
		)
	);

	// Register project intelligence tool
	context.subscriptions.push(
		vscode.lm.registerTool(
			'contextManager_projectIntelligence',
			new ProjectIntelligenceTool(projectManager, searchIndex)
		)
	);

	if (embeddingManager) {
		context.subscriptions.push(
			vscode.lm.registerTool(
				'contextManager_semanticSearch',
				new SemanticSearchTool(projectManager, embeddingManager, searchIndex)
			)
		);
	}

	// Register cross-entity full-text search tool (requires FTS index)
	if (searchIndex) {
		context.subscriptions.push(
			vscode.lm.registerTool(
				'contextManager_fullTextSearch',
				new FullTextSearchTool(projectManager, searchIndex)
			)
		);
	}

	// Register file write tool — allows subagent and @ctx to create/overwrite files
	context.subscriptions.push(
		vscode.lm.registerTool(
			'contextManager_writeFile',
			new WriteFileTool()
		)
	);

	// Register file edit tool — allows subagent and @ctx to do targeted string replacement in files
	context.subscriptions.push(
		vscode.lm.registerTool(
			'contextManager_editFile',
			new ReplaceStringInFileTool()
		)
	);

	// Register file system operation tools
	context.subscriptions.push(vscode.lm.registerTool('contextManager_fileStat', new FileStatTool()));
	context.subscriptions.push(vscode.lm.registerTool('contextManager_renameFile', new RenameFileTool()));
	context.subscriptions.push(vscode.lm.registerTool('contextManager_deleteFile', new DeleteFileTool()));
	context.subscriptions.push(vscode.lm.registerTool('contextManager_copyFile', new CopyFileTool()));
	context.subscriptions.push(vscode.lm.registerTool('contextManager_createDirectory', new CreateDirectoryTool()));

	// Register subagent tool (conditionally based on setting)
	if (ConfigurationManager.subagentEnabled) {
		context.subscriptions.push(
			vscode.lm.registerTool(
				'contextManager_runSubagent',
				new SubagentTool(projectManager, cache, searchIndex)
			)
		);
	}

	// ─── Background knowledge & cache tools ─────────────────────────
	// These run silently (no confirmation dialog) so the chat session is
	// not interrupted while saving or reading project memory.

	context.subscriptions.push(
		vscode.lm.registerTool(
			'contextManager_saveKnowledgeCard',
			new SaveKnowledgeCardTool(projectManager)
		)
	);

	context.subscriptions.push(
		vscode.lm.registerTool(
			'contextManager_saveCache',
			new SaveCacheTool(cache, projectManager)
		)
	);

	context.subscriptions.push(
		vscode.lm.registerTool(
			'contextManager_searchCache',
			new SearchCacheTool(cache, projectManager, searchIndex)
		)
	);

	context.subscriptions.push(
		vscode.lm.registerTool(
			'contextManager_readCache',
			new ReadCacheTool(cache, projectManager)
		)
	);

	context.subscriptions.push(
		vscode.lm.registerTool(
			'contextManager_editKnowledgeCard',
			new EditKnowledgeCardTool(projectManager)
		)
	);

	context.subscriptions.push(
		vscode.lm.registerTool(
			'contextManager_editCache',
			new EditCacheTool(cache)
		)
	);
}

// ─── Semantic Search Tool ───────────────────────────────────────

interface ISemanticSearchParams {
	/** The natural-language query to search knowledge cards for. */
	query: string;
	/** Maximum number of results to return (default 5, max 10). */
	topK?: number;
	/** Whether to automatically select the matching cards for context injection. Default false. */
	autoSelect?: boolean;
}

export class SemanticSearchTool implements vscode.LanguageModelTool<ISemanticSearchParams> {
	constructor(
		private readonly projectManager: ProjectManager,
		private readonly embeddingManager: EmbeddingManager,
		private readonly searchIndex?: SearchIndex,
	) {}

	async invoke(
		options: vscode.LanguageModelToolInvocationOptions<ISemanticSearchParams>,
		token: vscode.CancellationToken
	): Promise<vscode.LanguageModelToolResult> {
		const activeProject = this.projectManager.getActiveProject();
		if (!activeProject) {
			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart('No active project. Cannot perform semantic search.')
			]);
		}

		if (!this.embeddingManager.isAvailable()) {
			// Fallback: use FTS5 BM25 search when embeddings aren't available
			return this.ftsOrKeywordFallback(activeProject.id, options.input.query, options.input?.topK);
		}

		const query = options.input.query;
		if (!query?.trim()) {
			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart('No query provided for semantic search.')
			]);
		}

		const topK = Math.min(Math.max(options.input?.topK ?? 5, 1), 10);

		try {
			const results = await this.embeddingManager.smartSelect(
				activeProject.id,
				query,
				topK,
				token
			);

			if (results.length === 0) {
				return new vscode.LanguageModelToolResult([
					new vscode.LanguageModelTextPart(`No knowledge cards found matching "${query}" in project "${activeProject.name}".`)
				]);
			}

			// Auto-select matching cards if requested
			if (options.input?.autoSelect) {
				const cardIds = results.map(r => r.card.id);
				await this.projectManager.setCardSelection(activeProject.id, cardIds);
			}

			const parts: string[] = [];
			parts.push(`## Semantic Search Results for: "${query}"`);
			parts.push(`Found ${results.length} relevant knowledge card(s) in project "${activeProject.name}":\n`);

			for (const { card, score } of results) {
				const pct = (score * 100).toFixed(1);
				parts.push(`### ${card.title} [${card.category}] (ID: ${card.id}) — ${pct}% match`);
				if (card.tags?.length) {
					parts.push(`**Tags:** ${card.tags.join(', ')}`);
				}
				parts.push(card.content);
				parts.push('');
			}

			if (options.input?.autoSelect) {
				parts.push(`_✅ ${results.length} card(s) auto-selected for context injection._`);
			}

			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart(parts.join('\n'))
			]);
		} catch (err: any) {
			// If embeddings fail at runtime, fall back to FTS5/keyword search
			return this.ftsOrKeywordFallback(activeProject.id, query, topK);
		}
	}

	/**
	 * BM25 full-text search fallback using SQLite FTS5.
	 * Falls back to simple keyword search if FTS is disabled or unavailable.
	 */
	private async ftsOrKeywordFallback(
		projectId: string,
		query: string,
		topK?: number,
	): Promise<vscode.LanguageModelToolResult> {
		const limit = Math.min(Math.max(topK ?? ConfigurationManager.searchMaxCardResults, 1), 20);

		// Try FTS5 BM25 search first
		if (this.searchIndex?.isReady && ConfigurationManager.searchEnableFTS) {
			try {
				const results = await this.searchIndex.searchCards(projectId, query, limit, ConfigurationManager.searchSnippetTokens);
				if (results.length > 0) {
					const parts: string[] = [];
					parts.push(`## Knowledge Card Search Results (BM25 ranked)`);
					parts.push(`Found ${results.length} card(s) matching "${query}":\n`);
					for (const result of results) {
						const score = Math.abs(result.score).toFixed(2);
						parts.push(`### ${result.title} [${result.metadata.category}] — relevance ${score}`);
						if (result.metadata.tags) {
							parts.push(`**Tags:** ${result.metadata.tags}`);
						}
						// Include full content if available, otherwise snippet
						parts.push(result.metadata.fullContent || result.snippet);
						parts.push('');
					}
					return new vscode.LanguageModelToolResult([
						new vscode.LanguageModelTextPart(parts.join('\n'))
					]);
				}
				// FTS returned 0 results — fall through to keyword fallback
			} catch {
				// FTS error — fall through to keyword fallback
			}
		}

		// Simple keyword fallback
		return this.keywordFallback(projectId, query, limit);
	}

	/**
	 * Simple keyword fallback when embeddings are unavailable.
	 * Searches card titles, content, tags, and category.
	 */
	private keywordFallback(
		projectId: string,
		query: string,
		limit: number,
	): vscode.LanguageModelToolResult {
		const cards = this.projectManager.getKnowledgeCards(projectId);
		const terms = query.toLowerCase().split(/\s+/).filter(Boolean);

		const scored = cards.map(card => {
			const text = `${card.title} ${card.category} ${card.tags?.join(' ') ?? ''} ${card.content}`.toLowerCase();
			let score = 0;
			for (const term of terms) {
				if (text.includes(term)) { score++; }
			}
			return { card, score };
		}).filter(r => r.score > 0);

		scored.sort((a, b) => b.score - a.score);
		const top = scored.slice(0, limit);

		if (top.length === 0) {
			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart(`No knowledge cards matched the query "${query}" (keyword fallback — embeddings unavailable).`)
			]);
		}

		const parts: string[] = [];
		parts.push(`## Knowledge Card Search Results (keyword fallback)`);
		parts.push(`Found ${top.length} card(s) matching "${query}":\n`);
		for (const { card, score } of top) {
			parts.push(`### ${card.title} [${card.category}] (ID: ${card.id}) — ${score}/${terms.length} terms matched`);
			if (card.tags?.length) {
				parts.push(`**Tags:** ${card.tags.join(', ')}`);
			}
			parts.push(card.content);
			parts.push('');
		}
		parts.push('_Note: Using keyword search. Enable experimental proposed APIs on VS Code Insiders for semantic (embedding-based) search._');

		return new vscode.LanguageModelToolResult([
			new vscode.LanguageModelTextPart(parts.join('\n'))
		]);
	}

	async prepareInvocation(
		options: vscode.LanguageModelToolInvocationPrepareOptions<ISemanticSearchParams>,
		_token: vscode.CancellationToken
	) {
		const query = options.input?.query || 'knowledge cards';
		return {
			invocationMessage: `Searching knowledge cards for "${query}"...`,
		};
	}
}

// ─── Full-Text Search Tool (Cross-Entity BM25) ─────────────────

interface IFullTextSearchParams {
	/** Natural-language search query. Supports quoted phrases for exact matching. */
	query: string;
	/** Filter to specific entity types. If omitted, searches all types. */
	entityTypes?: SearchEntityType[];
	/** Maximum results to return. Default 10, max 50. */
	limit?: number;
}

export class FullTextSearchTool implements vscode.LanguageModelTool<IFullTextSearchParams> {
	constructor(
		private readonly projectManager: ProjectManager,
		private readonly searchIndex: SearchIndex,
	) {}

	async invoke(
		options: vscode.LanguageModelToolInvocationOptions<IFullTextSearchParams>,
		_token: vscode.CancellationToken
	): Promise<vscode.LanguageModelToolResult> {
		if (!ConfigurationManager.searchEnableFTS) {
			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart('Full-text search is disabled. Enable it via `contextManager.search.enableFTS` setting.')
			]);
		}

		const query = options.input.query;
		if (!query?.trim()) {
			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart('No query provided for full-text search.')
			]);
		}

		const activeProject = this.projectManager.getActiveProject();

		const results = await this.searchIndex.search(query, {
			entityTypes: options.input.entityTypes,
			projectId: activeProject?.id,
			limit: options.input.limit ?? ConfigurationManager.searchMaxSearchResults,
			snippetTokens: ConfigurationManager.searchSnippetTokens,
		});

		if (results.length === 0) {
			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart(`No results found for "${query}" across all entity types.`)
			]);
		}

		// Format results grouped by entity type
		const parts: string[] = [];
		parts.push(`## Full-Text Search Results for: "${query}"`);
		parts.push(`Found ${results.length} result(s) across project memory:\n`);

		// Type display labels and icons
		const typeLabels: Record<string, string> = {
			card: '📝 Knowledge Card',
			todo: '☑️ TODO',
			cache: '💾 Cached Explanation',
			session: '🔀 Branch Session',
			agentMessage: '🤖 Agent Message',
			project: '📁 Project',
		};

		for (const result of results) {
			const typeLabel = typeLabels[result.entityType] || result.entityType;
			const score = Math.abs(result.score).toFixed(2);
			parts.push(`### [${typeLabel}] ${result.title} — relevance ${score}`);

			// Add type-specific metadata
			if (result.entityType === 'card' && result.metadata.category) {
				parts.push(`**Category:** ${result.metadata.category}${result.metadata.tags ? ` | **Tags:** ${result.metadata.tags}` : ''}`);
			} else if (result.entityType === 'todo') {
				parts.push(`**Status:** ${result.metadata.status} | **Priority:** ${result.metadata.priority}`);
			} else if (result.entityType === 'cache') {
				parts.push(`**Symbol:** ${result.title}${result.metadata.filePath ? ` | **File:** ${result.metadata.filePath}` : ''}`);
			} else if (result.entityType === 'session') {
				parts.push(`**Branch:** ${result.metadata.branchName}`);
			}

			// Snippet with highlighting
			if (result.snippet) {
				parts.push(`> ${result.snippet.replace(/\n/g, '\n> ')}`);
			}
			parts.push('');
		}

		return new vscode.LanguageModelToolResult([
			new vscode.LanguageModelTextPart(parts.join('\n'))
		]);
	}

	async prepareInvocation(
		options: vscode.LanguageModelToolInvocationPrepareOptions<IFullTextSearchParams>,
		_token: vscode.CancellationToken
	) {
		const query = options.input?.query || 'project memory';
		const typeFilter = options.input?.entityTypes?.length
			? ` (${options.input.entityTypes.join(', ')})`
			: '';
		return {
			invocationMessage: `Searching project memory for "${query}"${typeFilter}...`,
		};
	}
}
