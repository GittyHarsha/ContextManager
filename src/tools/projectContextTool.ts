/**
 * Project Context Tool — exposes curated project context to all chat participants.
 */

import * as vscode from 'vscode';
import { ExplanationCache } from '../cache';
import { ProjectManager } from '../projects/ProjectManager';
import { DEFAULT_TOOL_SHARING_CONFIG } from '../projects/types';

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

		// Knowledge cards — index format (use GetCard tool to read full content)
		if ((section === 'all' || section === 'cards') && toolConfig.shareKnowledgeCards) {
			const selectedCards = this.projectManager.getSelectedKnowledgeCards(activeProject.id);
			// Filter: only includeInContext=true cards, exclude archived
			const visibleCards = selectedCards.filter(c => c.includeInContext !== false && !c.archived);

			// Also include global cards from OTHER projects
			const globalCards = this.projectManager.getGlobalCards(activeProject.id)
				.filter(c => !visibleCards.some(v => v.id === c.id));

			const allCards = [...visibleCards, ...globalCards];

			if (allCards.length > 0) {
				// Sort: pinned first, then by title
				const sorted = [...allCards].sort((a, b) => {
					if (a.pinned && !b.pinned) { return -1; }
					if (!a.pinned && b.pinned) { return 1; }
					return a.title.localeCompare(b.title);
				});
				parts.push(`## Knowledge Cards (${sorted.length} available)`);
				parts.push('Index of project knowledge cards. Use the #getCard tool with the card ID to read full content.');
				for (const card of sorted) {
					const pin = card.pinned ? ' [pinned]' : '';
					const global = card.isGlobal ? ' [global]' : '';
					const tags = card.tags.length > 0 ? ` (${card.tags.join(', ')})` : '';
					parts.push(`- **${card.title}** [${card.category}]${pin}${global}${tags} — ID: \`${card.id}\``);
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
