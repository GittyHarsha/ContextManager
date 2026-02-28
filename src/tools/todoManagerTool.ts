/**
 * Todo Manager Tool — CRUD operations on TODOs.
 */

import * as vscode from 'vscode';
import { ProjectManager } from '../projects/ProjectManager';

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
