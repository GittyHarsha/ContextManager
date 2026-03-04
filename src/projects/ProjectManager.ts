/**
 * ProjectManager - CRUD operations for projects and todos.
 * Emits events when data changes so UI can refresh.
 */

import * as vscode from 'vscode';
import { Project, Todo, KnowledgeCard, KnowledgeFolder, KnowledgeToolUsage, AgentRun, createProject, createTodo, createKnowledgeCard, createAgentRun, ProjectContext, ToolSharingConfig, DEFAULT_TOOL_SHARING_CONFIG, Convention, ToolHint, WorkingNote, createConvention, createToolHint, createWorkingNote, generateId, PromptInjection } from './types';
import { Storage } from './storage';
import { ExplanationCache } from '../cache';
import { ConfigurationManager } from '../config';
import type { SearchIndex } from '../search/SearchIndex';

export class ProjectManager extends vscode.Disposable {
	private storage: Storage;
	private _searchIndex: SearchIndex | undefined;
	private _onDidChangeProjects = new vscode.EventEmitter<void>();
	readonly onDidChangeProjects = this._onDidChangeProjects.event;

	private _onDidChangeActiveProject = new vscode.EventEmitter<Project | undefined>();
	readonly onDidChangeActiveProject = this._onDidChangeActiveProject.event;

	constructor(context: vscode.ExtensionContext) {
		super(() => {
			this._onDidChangeProjects.dispose();
			this._onDidChangeActiveProject.dispose();
		});
		this.storage = new Storage(context);
	}

	/** Attach the FTS4 search index for incremental updates on mutations. */
	setSearchIndex(index: SearchIndex): void {
		this._searchIndex = index;
	}

	// ============ Projects ============

	getAllProjects(): Project[] {
		return this.storage.getProjects();
	}

	getProject(projectId: string): Project | undefined {
		return this.getAllProjects().find(p => p.id === projectId);
	}

	getActiveProject(): Project | undefined {
		const activeId = this.storage.getActiveProjectId();
		if (!activeId) {
			return undefined;
		}
		return this.getProject(activeId);
	}

	async createProject(name: string, rootPaths?: string[]): Promise<Project> {
		const paths = rootPaths || this.getWorkspacePaths();
		const project = createProject(name, paths);
		
		const projects = this.getAllProjects();
		projects.push(project);
		await this.storage.saveProjects(projects);
		
		// Index project metadata in FTS
		this._searchIndex?.indexProject({
			id: project.id, name: project.name,
			description: project.description || '',
			goals: project.context.goals || '',
			conventions: project.context.conventions || '',
		});

		this._onDidChangeProjects.fire();
		return project;
	}

	async updateProject(projectId: string, updates: Partial<Project>): Promise<Project | undefined> {
		const projects = this.getAllProjects();
		const index = projects.findIndex(p => p.id === projectId);
		
		if (index < 0) {
			return undefined;
		}

		projects[index] = {
			...projects[index],
			...updates,
			lastAccessed: Date.now()
		};

		await this.storage.saveProjects(projects);
		this._onDidChangeProjects.fire();
		
		// If this is the active project, also fire that event
		if (this.storage.getActiveProjectId() === projectId) {
			this._onDidChangeActiveProject.fire(projects[index]);
		}

		return projects[index];
	}

	async deleteProject(projectId: string): Promise<void> {
		const projects = this.getAllProjects().filter(p => p.id !== projectId);
		await this.storage.saveProjects(projects);
		
		// Remove all indexed data for this project
		this._searchIndex?.removeProject(projectId);

		// Clear active if deleted
		if (this.storage.getActiveProjectId() === projectId) {
			await this.setActiveProject(undefined);
		}
		
		this._onDidChangeProjects.fire();
	}

	async setActiveProject(projectId: string | undefined): Promise<void> {
		await this.storage.setActiveProjectId(projectId);
		
		if (projectId) {
			// Update last accessed
			await this.updateProject(projectId, {});
		}
		
		this._onDidChangeActiveProject.fire(this.getActiveProject());
	}

	async updateProjectContext(projectId: string, context: Partial<ProjectContext>): Promise<void> {
		const project = this.getProject(projectId);
		if (!project) {
			return;
		}

		await this.updateProject(projectId, {
			context: {
				...project.context,
				...context
			}
		});

		// Re-index project metadata (goals/conventions may have changed)
		const updated = this.getProject(projectId);
		if (updated) {
			this._searchIndex?.indexProject({
				id: updated.id, name: updated.name,
				description: updated.description || '',
				goals: updated.context.goals || '',
				conventions: updated.context.conventions || '',
			});
		}
	}

	async setContextEnabled(projectId: string, enabled: boolean): Promise<void> {
		await this.updateProject(projectId, { contextEnabled: enabled });
	}

	isContextEnabled(projectId: string): boolean {
		const project = this.getProject(projectId);
		// Default to true for legacy projects without this field
		return project?.contextEnabled ?? true;
	}

	getToolSharingConfig(projectId: string): ToolSharingConfig {
		const project = this.getProject(projectId);
		return project?.toolSharingConfig ?? DEFAULT_TOOL_SHARING_CONFIG;
	}

	async setToolSharingConfig(projectId: string, config: Partial<ToolSharingConfig>): Promise<void> {
		const current = this.getToolSharingConfig(projectId);
		await this.updateProject(projectId, {
			toolSharingConfig: { ...current, ...config }
		});
	}

	// ============ Prompt Injection ============

	async setPromptInjection(projectId: string, injection: PromptInjection): Promise<void> {
		await this.updateProject(projectId, { promptInjection: injection });
	}

	async clearPromptInjection(projectId: string): Promise<void> {
		await this.updateProject(projectId, { promptInjection: undefined });
	}

	// ============ TODOs ============

	async addTodo(projectId: string, title: string, description?: string): Promise<Todo | undefined> {
		const project = this.getProject(projectId);
		if (!project) {
			return undefined;
		}

		const todo = createTodo(title, description);
		project.todos.push(todo);
		
		await this.updateProject(projectId, { todos: project.todos });

		// Index in FTS
		this._searchIndex?.indexTodo({
			id: todo.id, projectId,
			title: todo.title, description: todo.description || '',
			notes: todo.notes || '', status: todo.status, priority: todo.priority,
		});

		return todo;
	}

	async updateTodo(projectId: string, todoId: string, updates: Partial<Todo>): Promise<Todo | undefined> {
		const project = this.getProject(projectId);
		if (!project) {
			return undefined;
		}

		const todoIndex = project.todos.findIndex(t => t.id === todoId);
		if (todoIndex < 0) {
			return undefined;
		}

		project.todos[todoIndex] = {
			...project.todos[todoIndex],
			...updates
		};

		// If marking completed, set timestamp
		if (updates.status === 'completed' && !project.todos[todoIndex].completed) {
			project.todos[todoIndex].completed = Date.now();
		}

		await this.updateProject(projectId, { todos: project.todos });

		// Re-index in FTS
		const todo = project.todos[todoIndex];
		this._searchIndex?.indexTodo({
			id: todo.id, projectId,
			title: todo.title, description: todo.description || '',
			notes: todo.notes || '', status: todo.status, priority: todo.priority,
		});

		return todo;
	}

	async deleteTodo(projectId: string, todoId: string): Promise<void> {
		const project = this.getProject(projectId);
		if (!project) {
			return;
		}

		project.todos = project.todos.filter(t => t.id !== todoId);
		await this.updateProject(projectId, { todos: project.todos });

		// Remove from FTS
		this._searchIndex?.removeTodo(todoId);
	}

	getTodosForProject(projectId: string): Todo[] {
		return this.getProject(projectId)?.todos || [];
	}

	// ============ Agent Runs ============

	/**
	 * Start a new agent run for a TODO.
	 */
	async startAgentRun(projectId: string, todoId: string): Promise<AgentRun | undefined> {
		const project = this.getProject(projectId);
		if (!project) return undefined;

		const todo = project.todos.find(t => t.id === todoId);
		if (!todo) return undefined;

		// Create new run
		const run = createAgentRun(todoId);
		todo.agentRuns.push(run);
		todo.status = 'in-progress';

		await this.updateProject(projectId, { todos: project.todos });
		return run;
	}

	/**
	 * Get the latest (or active) run for a TODO.
	 */
	getLatestRun(projectId: string, todoId: string): AgentRun | undefined {
		const todo = this.getProject(projectId)?.todos.find(t => t.id === todoId);
		if (!todo || todo.agentRuns.length === 0) return undefined;
		return todo.agentRuns[todo.agentRuns.length - 1];
	}

	/**
	 * Get a specific run by ID.
	 */
	getAgentRun(projectId: string, todoId: string, runId: string): AgentRun | undefined {
		const todo = this.getProject(projectId)?.todos.find(t => t.id === todoId);
		return todo?.agentRuns.find(r => r.id === runId);
	}

	/**
	 * Update an agent run (used to save progress).
	 */
	async updateAgentRun(
		projectId: string, 
		todoId: string, 
		runId: string, 
		updates: Partial<AgentRun>
	): Promise<AgentRun | undefined> {
		const project = this.getProject(projectId);
		if (!project) return undefined;

		const todo = project.todos.find(t => t.id === todoId);
		if (!todo) return undefined;

		const runIndex = todo.agentRuns.findIndex(r => r.id === runId);
		if (runIndex < 0) return undefined;

		todo.agentRuns[runIndex] = {
			...todo.agentRuns[runIndex],
			...updates
		};

		await this.updateProject(projectId, { todos: project.todos });

		// Index new conversation messages in FTS
		if (updates.conversationHistory && this._searchIndex) {
			const history = updates.conversationHistory;
			for (let i = 0; i < history.length; i++) {
				const msg = history[i];
				if (msg.content?.trim()) {
					this._searchIndex.indexAgentMessage({
						id: `${runId}_msg${i}`,
						runId, todoId, projectId,
						role: msg.role, content: msg.content,
					});
				}
			}
		}

		return todo.agentRuns[runIndex];
	}

	/**
	 * Pause a running agent (marks as paused so it can be resumed).
	 */
	async pauseAgentRun(projectId: string, todoId: string, runId: string): Promise<void> {
		await this.updateAgentRun(projectId, todoId, runId, { status: 'paused' });
		// Set TODO back to pending since agent is not actively running
		await this.updateTodo(projectId, todoId, { status: 'pending' });
	}

	/**
	 * Complete an agent run.
	 */
	async completeAgentRun(
		projectId: string, 
		todoId: string, 
		runId: string,
	): Promise<void> {
		await this.updateAgentRun(projectId, todoId, runId, {
			status: 'completed',
			endTime: Date.now(),
		});
		// Mark TODO as completed
		await this.updateTodo(projectId, todoId, { status: 'completed' });
	}

	/**
	 * Mark agent run as failed.
	 */
	async failAgentRun(projectId: string, todoId: string, runId: string, error: string): Promise<void> {
		await this.updateAgentRun(projectId, todoId, runId, {
			status: 'failed',
			endTime: Date.now()
		});
		// Mark TODO as failed
		await this.updateTodo(projectId, todoId, { status: 'failed' });
	}

	// ============ Helpers ============

	private getWorkspacePaths(): string[] {
		return vscode.workspace.workspaceFolders?.map(f => f.uri.fsPath) || [];
	}

	// Load copilot-instructions.md for a project
	async loadCopilotInstructions(projectId: string): Promise<string | undefined> {
		const project = this.getProject(projectId);
		if (!project || project.rootPaths.length === 0) {
			return undefined;
		}

		const possiblePaths = [
			'.github/copilot-instructions.md',
			'copilot-instructions.md'
		];

		for (const rootPath of project.rootPaths) {
			for (const relativePath of possiblePaths) {
				try {
					const uri = vscode.Uri.joinPath(vscode.Uri.file(rootPath), relativePath);
					const doc = await vscode.workspace.openTextDocument(uri);
					return doc.getText();
				} catch {
					// File doesn't exist, try next
				}
			}
		}

		return undefined;
	}

	// Get full context for a project (for prompts)
	async getFullProjectContext(projectId: string, cache?: ExplanationCache, excludeCardIds?: Set<string>): Promise<string> {
		const project = this.getProject(projectId);
		if (!project) {
			return '';
		}

		const parts: string[] = [];

		parts.push(`## Project: ${project.name}`);
		
		if (project.description) {
			parts.push(`**Description:** ${project.description}`);
		}

		if (project.context.goals) {
			parts.push(`**Goals:** ${project.context.goals}`);
		}

		if (project.context.conventions) {
			parts.push(`**Conventions:** ${project.context.conventions}`);
		}

		if (project.context.keyFiles.length > 0) {
			parts.push(`**Key Files:** ${project.context.keyFiles.join(', ')}`);
		}

		// Load copilot instructions if not already cached
		if (!project.context.copilotInstructions) {
			const instructions = await this.loadCopilotInstructions(projectId);
			if (instructions) {
				await this.updateProjectContext(projectId, { copilotInstructions: instructions });
				parts.push(`**Project-Specific Instructions:**\n${instructions}`);
			}
		} else {
			parts.push(`**Project-Specific Instructions:**\n${project.context.copilotInstructions}`);
		}

		// Add selected knowledge cards — progressive disclosure with 3 tiers
		let selectedCards = this.getSelectedKnowledgeCards(projectId);
		if (excludeCardIds && excludeCardIds.size > 0) {
			selectedCards = selectedCards.filter(c => !excludeCardIds.has(c.id));
		}
		if (selectedCards.length > 0) {
			const maxCards = ConfigurationManager.maxKnowledgeCardsInContext || 10;
			const STALE_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
			const now = Date.now();

			// Sort by recency (most recently updated first) as relevance proxy
			selectedCards.sort((a, b) => (b.updated || 0) - (a.updated || 0));

			// Limit to configured max
			const injectedCards = selectedCards.slice(0, maxCards);

			// Track injection analytics (fire-and-forget)
			const injectedIds = injectedCards.map(c => c.id);
			this.incrementInjectionCounts(projectId, injectedIds).catch(() => {});
			const skippedCount = selectedCards.length - injectedCards.length;

			parts.push(`## Knowledge Cards (${injectedCards.length} injected${skippedCount > 0 ? `, ${skippedCount} skipped (over limit)` : ''})\nThe following knowledge cards are curated reference material for this project. Cards are ordered by recency. Large cards are summarized; expand with \`#searchCards\` if needed.`);

			for (let i = 0; i < injectedCards.length; i++) {
				const card = injectedCards[i];
				const isStale = (now - (card.updated || card.created || 0)) > STALE_THRESHOLD_MS;
				const staleTag = isStale ? ' ⚠️ STALE (>30 days)' : '';
				const tokenEstimate = Math.ceil((card.content || '').length / 4);

				// Tier 1 (first 3 cards): full content (up to 2000 tokens)
				// Tier 2 (cards 4-7): truncated to ~500 tokens
				// Tier 3 (cards 8+): metadata only (title + category + first line)
				let cardContent: string;
				let tierLabel: string;

				if (i < 3) {
					// Tier 1: full content, capped at ~8000 chars (~2000 tokens)
					if (tokenEstimate > 2000) {
						cardContent = card.content.substring(0, 8000) + '\n\n... (truncated — use `#searchCards` to read full content)';
						tierLabel = 'full, truncated';
					} else {
						cardContent = card.content;
						tierLabel = 'full';
					}
				} else if (i < 7) {
					// Tier 2: summary — first 500 chars (~125 tokens)
					if (tokenEstimate > 125) {
						cardContent = card.content.substring(0, 500).trimEnd() + '\n\n... (summary — use `#searchCards` for full content)';
						tierLabel = 'summary';
					} else {
						cardContent = card.content;
						tierLabel = 'full';
					}
				} else {
					// Tier 3: metadata only
					const firstLine = (card.content || '').split('\n').find(l => l.trim())?.substring(0, 120) || '';
					cardContent = `*${firstLine}${firstLine.length >= 120 ? '...' : ''}*\n\n(metadata only — use \`#searchCards "${card.title}"\` to read full content)`;
					tierLabel = 'metadata';
				}

				parts.push(`### ${card.title} [${card.category}]${staleTag} <${tierLabel}>\n${cardContent}`);

				// Tool usage (only for tier 1 cards)
				if (i < 3 && card.trackToolUsage && (card.toolUsages?.length || 0) > 0) {
					const topUsages = [...(card.toolUsages || [])]
						.sort((a, b) => (b.successCount - a.successCount) || (b.lastUsed - a.lastUsed))
						.slice(0, 5);
					parts.push(`#### Tool usage that worked for this card\n${topUsages.map(u => `- ${u.toolName}: ${u.pattern}${u.example ? ` (e.g., ${u.example})` : ''}`).join('\n')}`);
				}
			}
		}

		// Add selected cache entries
		if (cache) {
			const selectedCacheEntries = cache.getSelectedEntries(projectId);
			if (selectedCacheEntries.length > 0) {
				parts.push(`## Cached Explanations (${selectedCacheEntries.length} selected)\nThe following are previously generated explanations of code symbols that the user has selected as relevant context. Use them to understand the codebase without re-analyzing these symbols.`);
				for (const entry of selectedCacheEntries) {
					parts.push(`### ${entry.symbolName} [${entry.type}]${entry.filePath ? ` (${entry.filePath})` : ''}\n${entry.content}`);
				}
			}
		}

		return parts.join('\n\n');
	}

	/**
	 * Get all reference file paths from selected knowledge cards and cache entries (deduplicated).
	 */
	getReferenceFiles(projectId: string, cache?: ExplanationCache): string[] {
		const files = new Set<string>();

		// Collect from selected knowledge cards
		const selectedCards = this.getSelectedKnowledgeCards(projectId);
		for (const card of selectedCards) {
			if (card.referenceFiles) {
				card.referenceFiles.forEach(f => files.add(f));
			}
		}

		// Collect from selected cache entries
		if (cache) {
			const selectedCacheEntries = cache.getSelectedEntries(projectId);
			for (const entry of selectedCacheEntries) {
				if (entry.referenceFiles) {
					entry.referenceFiles.forEach(f => files.add(f));
				}
			}
		}

		return Array.from(files);
	}

	// ============ Knowledge Cards ============

	getKnowledgeCards(projectId: string): KnowledgeCard[] {
		const project = this.getProject(projectId);
		return project?.knowledgeCards || [];
	}

	getSelectedKnowledgeCards(projectId: string): KnowledgeCard[] {
		const project = this.getProject(projectId);
		if (!project) {
			return [];
		}
		return project.knowledgeCards.filter(card => 
			project.selectedCardIds.includes(card.id)
		);
	}

	/**
	 * Get all global cards across ALL projects (excluding archived).
	 * Avoids duplicates when the same card is already selected in the requesting project.
	 */
	getGlobalCards(excludeProjectId?: string): KnowledgeCard[] {
		const globals: KnowledgeCard[] = [];
		for (const project of this.getAllProjects()) {
			for (const card of project.knowledgeCards) {
				if (card.isGlobal && !card.archived) {
					// Tag with source project for attribution (add if not already set)
					if (excludeProjectId && project.id === excludeProjectId) { continue; }
					globals.push(card);
				}
			}
		}
		return globals;
	}

	getKnowledgeFolders(projectId: string): KnowledgeFolder[] {
		const project = this.getProject(projectId);
		return project?.knowledgeFolders || [];
	}

	/**
	 * Find the best-matching existing folder for a card based on its title, category, and tags.
	 * Uses keyword overlap between the card metadata and folder names.
	 * Returns the folder ID or undefined if no good match (→ stays in root).
	 */
	findBestFolder(projectId: string, title: string, category: string, tags: string[] = []): string | undefined {
		const folders = this.getKnowledgeFolders(projectId);
		if (folders.length === 0) { return undefined; }

		const words = `${title} ${category} ${tags.join(' ')}`.toLowerCase().split(/\s+/).filter(w => w.length > 2);
		if (words.length === 0) { return undefined; }

		let bestId: string | undefined;
		let bestScore = 0;

		for (const folder of folders) {
			const folderName = folder.name.toLowerCase();
			let score = 0;
			for (const word of words) {
				if (folderName.includes(word)) { score += 2; }
				if (word.includes(folderName) && folderName.length > 3) { score += 3; }
			}
			// Exact category match
			if (folderName === category.toLowerCase()) { score += 5; }
			// Partial category match
			if (folderName.includes(category.toLowerCase()) || category.toLowerCase().includes(folderName)) { score += 2; }

			if (score > bestScore) {
				bestScore = score;
				bestId = folder.id;
			}
		}

		return bestScore >= 2 ? bestId : undefined;
	}

	private getFolderDescendantIds(folders: KnowledgeFolder[], folderId: string): Set<string> {
		const ids = new Set<string>([folderId]);
		let changed = true;
		while (changed) {
			changed = false;
			for (const folder of folders) {
				if (!ids.has(folder.id) && folder.parentFolderId && ids.has(folder.parentFolderId)) {
					ids.add(folder.id);
					changed = true;
				}
			}
		}
		return ids;
	}

	async addKnowledgeFolder(projectId: string, name: string, parentFolderId?: string): Promise<KnowledgeFolder | undefined> {
		const project = this.getProject(projectId);
		if (!project) {
			return undefined;
		}

		const trimmed = name.trim();
		if (!trimmed) {
			return undefined;
		}

		const folders = [...(project.knowledgeFolders || [])];

		if (parentFolderId) {
			const parentExists = folders.some(f => f.id === parentFolderId);
			if (!parentExists) {
				return undefined;
			}
		}

		const existing = folders.find(f =>
			f.name.toLowerCase() === trimmed.toLowerCase() && (f.parentFolderId || '') === (parentFolderId || '')
		);
		if (existing) {
			return existing;
		}

		const folder: KnowledgeFolder = {
			id: generateId(),
			name: trimmed,
			parentFolderId: parentFolderId || undefined,
			created: Date.now(),
			updated: Date.now(),
		};

		folders.push(folder);
		await this.updateProject(projectId, { knowledgeFolders: folders });
		return folder;
	}

	async renameKnowledgeFolder(projectId: string, folderId: string, name: string): Promise<KnowledgeFolder | undefined> {
		const project = this.getProject(projectId);
		if (!project) {
			return undefined;
		}

		const trimmed = name.trim();
		if (!trimmed) {
			return undefined;
		}

		const folders = [...(project.knowledgeFolders || [])];
		const index = folders.findIndex(f => f.id === folderId);
		if (index < 0) {
			return undefined;
		}

		folders[index] = {
			...folders[index],
			name: trimmed,
			updated: Date.now(),
		};

		await this.updateProject(projectId, { knowledgeFolders: folders });
		return folders[index];
	}

	async deleteKnowledgeFolder(projectId: string, folderId: string): Promise<void> {
		const project = this.getProject(projectId);
		if (!project) {
			return;
		}

		const allFolders = project.knowledgeFolders || [];
		const deletedIds = this.getFolderDescendantIds(allFolders, folderId);
		const folders = allFolders.filter(f => !deletedIds.has(f.id));
		const knowledgeCards = (project.knowledgeCards || []).map(card =>
			(card.folderId && deletedIds.has(card.folderId)) ? { ...card, folderId: undefined, updated: Date.now() } : card
		);

		await this.updateProject(projectId, { knowledgeFolders: folders, knowledgeCards });
	}

	async moveKnowledgeCardToFolder(projectId: string, cardId: string, folderId?: string): Promise<KnowledgeCard | undefined> {
		const project = this.getProject(projectId);
		if (!project) {
			return undefined;
		}

		if (folderId) {
			const exists = (project.knowledgeFolders || []).some(f => f.id === folderId);
			if (!exists) {
				return undefined;
			}
		}

		return this.updateKnowledgeCard(projectId, cardId, { folderId: folderId || undefined });
	}

	async addKnowledgeCard(
		projectId: string,
		title: string,
		content: string,
		category: KnowledgeCard['category'] = 'note',
		tags: string[] = [],
		source?: string,
		referenceFiles?: string[],
		folderId?: string,
		trackToolUsage?: boolean,
		anchors?: import('./types').AnchorStub[],
	): Promise<KnowledgeCard | undefined> {
		const project = this.getProject(projectId);
		if (!project) {
			return undefined;
		}

		const knowledgeCards = [...(project.knowledgeCards || [])];

		// Deduplicate: update existing card with same title + category
		const existingIdx = knowledgeCards.findIndex(
			c => c.title.toLowerCase() === title.toLowerCase() && c.category === category
		);
		if (existingIdx >= 0) {
			knowledgeCards[existingIdx] = {
				...knowledgeCards[existingIdx],
				content, tags, source, referenceFiles,
				folderId: folderId ?? knowledgeCards[existingIdx].folderId,
				trackToolUsage: trackToolUsage ?? knowledgeCards[existingIdx].trackToolUsage,
				updated: Date.now(),
			};
			await this.updateProject(projectId, { knowledgeCards });
			return knowledgeCards[existingIdx];
		}

		const card = createKnowledgeCard(title, content, category, tags, source, referenceFiles, anchors);
		card.folderId = folderId;
		card.trackToolUsage = !!trackToolUsage;
		knowledgeCards.push(card);
		
		await this.updateProject(projectId, { knowledgeCards });

		// Index in FTS
		this._searchIndex?.indexCard({
			id: card.id, projectId,
			title: card.title, content: card.content,
			category: card.category, tags: card.tags?.join(', ') || '',
			source: card.source || '',
		});

		return card;
	}

	async addKnowledgeToolUsages(projectId: string, cardId: string, usages: KnowledgeToolUsage[]): Promise<KnowledgeCard | undefined> {
		if (!usages.length) {
			return this.getKnowledgeCards(projectId).find(c => c.id === cardId);
		}

		const project = this.getProject(projectId);
		if (!project) {
			return undefined;
		}

		const card = (project.knowledgeCards || []).find(c => c.id === cardId);
		if (!card || !card.trackToolUsage) {
			return card;
		}

		const merged = new Map<string, KnowledgeToolUsage>();
		for (const existing of card.toolUsages || []) {
			const key = `${existing.toolName}::${existing.pattern}`;
			merged.set(key, { ...existing });
		}

		for (const usage of usages) {
			const key = `${usage.toolName}::${usage.pattern}`;
			const existing = merged.get(key);
			if (existing) {
				existing.successCount += Math.max(1, usage.successCount || 1);
				existing.lastUsed = Math.max(existing.lastUsed || 0, usage.lastUsed || Date.now());
				if (!existing.example && usage.example) {
					existing.example = usage.example;
				}
			} else {
				merged.set(key, {
					toolName: usage.toolName,
					pattern: usage.pattern,
					example: usage.example,
					successCount: Math.max(1, usage.successCount || 1),
					lastUsed: usage.lastUsed || Date.now(),
				});
			}
		}

		const mergedList = Array.from(merged.values())
			.sort((a, b) => (b.successCount - a.successCount) || (b.lastUsed - a.lastUsed))
			.slice(0, 12);

		return this.updateKnowledgeCard(projectId, cardId, { toolUsages: mergedList });
	}

	async updateKnowledgeCard(
		projectId: string,
		cardId: string,
		updates: Partial<Omit<KnowledgeCard, 'id' | 'created'>>
	): Promise<KnowledgeCard | undefined> {
		const project = this.getProject(projectId);
		if (!project) {
			return undefined;
		}

		const cardIndex = (project.knowledgeCards || []).findIndex(c => c.id === cardId);
		if (cardIndex < 0) {
			return undefined;
		}

		const knowledgeCards = [...project.knowledgeCards];
		knowledgeCards[cardIndex] = {
			...knowledgeCards[cardIndex],
			...updates,
			updated: Date.now()
		};

		await this.updateProject(projectId, { knowledgeCards });

		// Re-index in FTS
		const card = knowledgeCards[cardIndex];
		this._searchIndex?.indexCard({
			id: card.id, projectId,
			title: card.title, content: card.content,
			category: card.category, tags: card.tags?.join(', ') || '',
			source: card.source || '',
		});

		return card;
	}

	async deleteKnowledgeCard(projectId: string, cardId: string): Promise<void> {
		const project = this.getProject(projectId);
		if (!project) {
			return;
		}

		const knowledgeCards = (project.knowledgeCards || []).filter(c => c.id !== cardId);
		const selectedCardIds = (project.selectedCardIds || []).filter(id => id !== cardId);
		
		await this.updateProject(projectId, { knowledgeCards, selectedCardIds });

		// Remove from FTS
		this._searchIndex?.removeCard(cardId);
	}

	async toggleCardSelection(projectId: string, cardId: string): Promise<boolean> {
		const project = this.getProject(projectId);
		if (!project) {
			return false;
		}

		const selectedCardIds = [...(project.selectedCardIds || [])];
		const index = selectedCardIds.indexOf(cardId);
		
		if (index >= 0) {
			selectedCardIds.splice(index, 1);
		} else {
			selectedCardIds.push(cardId);
			// Track selection analytics
			const card = (project.knowledgeCards || []).find(c => c.id === cardId);
			if (card) {
				card.selectionCount = (card.selectionCount || 0) + 1;
				card.lastSelectedAt = Date.now();
			}
		}

		await this.updateProject(projectId, { selectedCardIds, knowledgeCards: project.knowledgeCards });
		return index < 0; // Returns true if now selected
	}

	async setCardSelection(projectId: string, cardIds: string[]): Promise<void> {
		await this.updateProject(projectId, { selectedCardIds: cardIds });
	}

	// Create a knowledge card from a cached explanation
	async createCardFromCache(
		projectId: string,
		symbolName: string,
		explanation: string,
		filePath?: string
	): Promise<KnowledgeCard | undefined> {
		return this.addKnowledgeCard(
			projectId,
			`Explanation: ${symbolName}`,
			explanation,
			'explanation',
			[symbolName],
			filePath
		);
	}

	/**
	 * Increment injection count for cards that were injected into a prompt.
	 */
	async incrementInjectionCounts(projectId: string, cardIds: string[]): Promise<void> {
		const project = this.getProject(projectId);
		if (!project || !cardIds.length) { return; }

		let changed = false;
		for (const card of project.knowledgeCards || []) {
			if (cardIds.includes(card.id)) {
				card.injectionCount = (card.injectionCount || 0) + 1;
				changed = true;
			}
		}

		if (changed) {
			await this.updateProject(projectId, { knowledgeCards: project.knowledgeCards });
		}
	}

	/**
	 * Detect near-duplicate knowledge cards using Jaccard similarity on word sets.
	 * Returns pairs with similarity score ≥ threshold (default 0.4).
	 */
	detectDuplicateCards(projectId: string, threshold = 0.4): Array<{ cardA: KnowledgeCard; cardB: KnowledgeCard; similarity: number }> {
		const cards = this.getKnowledgeCards(projectId);
		if (cards.length < 2) { return []; }

		// Build word sets for each card (title + content, lowercased)
		const wordSets = cards.map(card => {
			const text = `${card.title} ${card.content}`.toLowerCase();
			const words = text.split(/\s+/).filter(w => w.length > 3);
			return new Set(words);
		});

		const duplicates: Array<{ cardA: KnowledgeCard; cardB: KnowledgeCard; similarity: number }> = [];

		for (let i = 0; i < cards.length; i++) {
			for (let j = i + 1; j < cards.length; j++) {
				const setA = wordSets[i];
				const setB = wordSets[j];

				// Jaccard similarity: |intersection| / |union|
				let intersection = 0;
				for (const word of setA) {
					if (setB.has(word)) { intersection++; }
				}
				const union = setA.size + setB.size - intersection;
				const similarity = union > 0 ? intersection / union : 0;

				if (similarity >= threshold) {
					duplicates.push({ cardA: cards[i], cardB: cards[j], similarity });
				}
			}
		}

		// Sort by similarity (highest first)
		duplicates.sort((a, b) => b.similarity - a.similarity);
		return duplicates;
	}

	/**
	 * Find existing cards similar to a candidate (title + content), using Jaccard similarity.
	 * Used before saving from queue to detect potential duplicates.
	 */
	findSimilarCardsForCandidate(
		projectId: string,
		title: string,
		content: string,
		threshold = 0.3
	): Array<{ card: KnowledgeCard; similarity: number }> {
		const cards = this.getKnowledgeCards(projectId).filter(c => !c.archived);
		if (cards.length === 0) { return []; }

		const candidateText = `${title} ${content}`.toLowerCase();
		const candidateWords = new Set(candidateText.split(/\s+/).filter(w => w.length > 3));
		if (candidateWords.size === 0) { return []; }

		const results: Array<{ card: KnowledgeCard; similarity: number }> = [];
		for (const card of cards) {
			const cardText = `${card.title} ${card.content}`.toLowerCase();
			const cardWords = new Set(cardText.split(/\s+/).filter(w => w.length > 3));
			let intersection = 0;
			for (const w of candidateWords) {
				if (cardWords.has(w)) { intersection++; }
			}
			const union = candidateWords.size + cardWords.size - intersection;
			const similarity = union > 0 ? intersection / union : 0;
			if (similarity >= threshold) {
				results.push({ card, similarity });
			}
		}
		results.sort((a, b) => b.similarity - a.similarity);
		return results.slice(0, 5); // Cap at 5 candidates shown in picker
	}

	/**
	 * Merge a queue candidate into an existing card: appends content, merges tags & tool usages, removes from queue.
	 */
	async mergeCardFromQueue(
		projectId: string,
		candidateId: string,
		targetCardId: string,
		overrides?: { title?: string; content?: string }
	): Promise<KnowledgeCard | undefined> {
		const project = this.getProject(projectId);
		if (!project) { return undefined; }

		const candidate = (project.cardQueue || []).find(c => c.id === candidateId);
		if (!candidate) { return undefined; }

		const targetCard = (project.knowledgeCards || []).find(c => c.id === targetCardId);
		if (!targetCard) { return undefined; }

		const newContent = overrides?.content || candidate.suggestedContent;
		const mergedContent = `${targetCard.content}\n\n---\n**Merged from queue (${new Date().toLocaleDateString()}):**\n${newContent}`;

		// Merge tags: union of target + candidate suggested category as tag
		const mergedTags = [...new Set([
			...(targetCard.tags || []),
			...(candidate.suggestedCategory ? [candidate.suggestedCategory] : []),
		])];

		// Merge tool usages: if candidate has tool calls, add them as tool usage patterns
		const mergedToolUsages = [...(targetCard.toolUsages || [])];
		if (candidate.toolCalls?.length) {
			for (const tc of candidate.toolCalls) {
				const existing = mergedToolUsages.find(u => u.toolName === tc.toolName);
				if (existing) {
					existing.successCount = (existing.successCount || 0) + 1;
					existing.lastUsed = Date.now();
				} else {
					mergedToolUsages.push({
						toolName: tc.toolName,
						pattern: tc.input?.substring(0, 200) || '',
						example: tc.output?.substring(0, 200) || '',
						successCount: 1,
						lastUsed: Date.now(),
					});
				}
			}
		}

		const updated = await this.updateKnowledgeCard(projectId, targetCardId, {
			content: mergedContent,
			tags: mergedTags,
			toolUsages: mergedToolUsages,
		});

		// Remove candidate from queue
		const updatedQueue = (project.cardQueue || []).filter(c => c.id !== candidateId);
		await this.updateProject(projectId, { cardQueue: updatedQueue });

		console.log(`[CardQueue] Merged candidate ${candidateId} into card ${targetCardId}`);
		return updated;
	}

	/**
	 * Get card health analytics for the active project.
	 */
	getCardHealthAnalytics(projectId: string): {
		totalCards: number;
		selectedCards: number;
		staleCards: KnowledgeCard[];
		neverUsedCards: KnowledgeCard[];
		topUsedCards: KnowledgeCard[];
		duplicates: Array<{ cardA: KnowledgeCard; cardB: KnowledgeCard; similarity: number }>;
	} {
		const cards = this.getKnowledgeCards(projectId);
		const selectedIds = new Set(this.getSelectedCardIds(projectId));
		const now = Date.now();
		const STALE_MS = 30 * 24 * 60 * 60 * 1000;

		const staleCards = cards.filter(c => (now - (c.updated || c.created || 0)) > STALE_MS);
		const neverUsedCards = cards.filter(c => !c.selectionCount && !c.injectionCount);
		const topUsedCards = [...cards]
			.filter(c => (c.injectionCount || 0) > 0)
			.sort((a, b) => (b.injectionCount || 0) - (a.injectionCount || 0))
			.slice(0, 5);
		const duplicates = this.detectDuplicateCards(projectId);

		return {
			totalCards: cards.length,
			selectedCards: selectedIds.size,
			staleCards,
			neverUsedCards,
			topUsedCards,
			duplicates,
		};
	}

	/**
	 * Get IDs of all selected knowledge cards for a project.
	 */
	getSelectedCardIds(projectId: string): string[] {
		const project = this.getProject(projectId);
		return project?.selectedCardIds || [];
	}

	/**
	 * Deselect all currently selected knowledge cards for a project.
	 * Used when auto-deselect after use is enabled.
	 */
	async deselectAllCards(projectId: string): Promise<void> {
		await this.updateProject(projectId, { selectedCardIds: [] });
	}

	// ============ Card Queue (Review & Approval) ============

	/**
	 * Get all queued card candidates for a project.
	 */
	getCardQueue(projectId: string): import('./types').QueuedCardCandidate[] {
		const project = this.getProject(projectId);
		return project?.cardQueue || [];
	}

	/**
	 * Add a candidate to the review queue.
	 * Caps at MAX_CARD_QUEUE_SIZE — drops the oldest entry when full.
	 */
	async addToCardQueue(
		projectId: string,
		candidate: import('./types').QueuedCardCandidate
	): Promise<void> {
		const project = this.getProject(projectId);
		if (!project) {
			console.log(`[CardQueue:DEBUG] addToCardQueue SKIP \u2014 project not found: ${projectId}`);
			return;
		}

		// Dedup: skip if an existing queue item has the same response (first 500 chars) OR same prompt
		const existing = project.cardQueue || [];
		const candidateFingerprint = (candidate.response || candidate.suggestedContent || '').substring(0, 500);
		const candidatePrompt = (candidate.prompt || '').substring(0, 300);
		if (candidateFingerprint.length > 50 || candidatePrompt.length > 20) {
			const isDup = existing.some(q => {
				// Match by response content
				if (candidateFingerprint.length > 50) {
					const qFingerprint = (q.response || q.suggestedContent || '').substring(0, 500);
					if (qFingerprint === candidateFingerprint) { return true; }
				}
				// Match by prompt text (same question = same card)
				if (candidatePrompt.length > 20) {
					const qPrompt = (q.prompt || '').substring(0, 300);
					if (qPrompt === candidatePrompt) { return true; }
				}
				return false;
			});
			if (isDup) {
				console.log(`[CardQueue:DEBUG] addToCardQueue SKIP — duplicate (participant=${candidate.participant})`);
				return;
			}
		}

		const maxSize = ConfigurationManager.cardQueueMaxSize;
		let queue = [...existing, candidate];
		if (queue.length > maxSize) {
			queue = queue.slice(queue.length - maxSize);
		}

		await this.updateProject(projectId, { cardQueue: queue });
		console.log(`[CardQueue:DEBUG] addToCardQueue ✅ — project="${project.name}" queue size now=${queue.length}`);
		this._onDidChangeProjects.fire();
	}

	/**
	 * Approve a queued candidate: create knowledge card and remove from queue.
	 * Returns the created card ID.
	 */
	async approveQueuedCard(
		projectId: string,
		candidateId: string,
		overrides?: { title?: string; category?: string; content?: string; tags?: string[]; anchors?: import('./types').AnchorStub[] }
	): Promise<string | undefined> {
		const project = this.getProject(projectId);
		if (!project) { return undefined; }

		const queue = project.cardQueue || [];
		const candidate = queue.find(c => c.id === candidateId);
		if (!candidate) { return undefined; }

		// Create the knowledge card
		const cardTitle = overrides?.title || candidate.suggestedTitle;
		const cardCategory = (overrides?.category || candidate.suggestedCategory) as any;
		const cardContent = overrides?.content || candidate.suggestedContent;
		const cardTags = overrides?.tags || [];
		const cardAnchors = overrides?.anchors;

		const source = `Chat conversation (${candidate.participant}) — auto-detected`;
		const card = await this.addKnowledgeCard(
			projectId,
			cardTitle,
			cardContent,
			cardCategory,
			cardTags,
			source,
			undefined, // referenceFiles
			undefined, // folderId
			undefined, // trackToolUsage
			cardAnchors,
		);

		if (!card) {
			console.error(`[CardQueue] Failed to create card for candidate ${candidateId}`);
			return undefined;
		}

		// Transfer tool call records to knowledge tool usages
		if (candidate.toolCalls?.length) {
			const toolUsages: import('./types').KnowledgeToolUsage[] = candidate.toolCalls.map(tc => ({
				toolName: tc.toolName,
				pattern: tc.input.substring(0, 200),
				example: tc.output.substring(0, 200),
				successCount: 1,
				lastUsed: Date.now(),
			}));
			await this.updateKnowledgeCard(projectId, card.id, {
				toolUsages, trackToolUsage: true
			});
		}

		// Remove from queue
		const updatedQueue = queue.filter(c => c.id !== candidateId);
		await this.updateProject(projectId, { cardQueue: updatedQueue });

		console.log(`[CardQueue] Approved candidate ${candidateId} → card ${card.id}`);
		return card.id;
	}

	/**
	 * Reject a queued candidate: remove from queue without creating a card.
	 */
	async rejectQueuedCard(projectId: string, candidateId: string): Promise<void> {
		const project = this.getProject(projectId);
		if (!project) { return; }

		const queue = project.cardQueue || [];
		const updatedQueue = queue.filter(c => c.id !== candidateId);

		await this.updateProject(projectId, { cardQueue: updatedQueue });
		console.log(`[CardQueue] Rejected candidate ${candidateId}`);
	}

	/**
	 * Clear all queued candidates for a project.
	 */
	async clearCardQueue(projectId: string): Promise<void> {
		await this.updateProject(projectId, { cardQueue: [] });
		console.log(`[CardQueue] Cleared all queued candidates for project ${projectId}`);
	}

	// ============ Auto-Learn Feedback (Discard Tracking) ============

	/**
	 * Get the discard count for a signal category key.
	 * Keys are like 'convention:naming', 'convention:architecture', 'note:fileRelationship'.
	 */
	getDiscardCount(projectId: string, key: string): number {
		const project = this.getProject(projectId);
		return project?.autoLearnDiscardCounts?.[key] ?? 0;
	}

	/**
	 * Increment the discard counter for a signal category.
	 * Called when the user explicitly discards an inferred item.
	 */
	async incrementDiscardCount(projectId: string, key: string): Promise<void> {
		const project = this.getProject(projectId);
		if (!project) { return; }
		const counts = { ...(project.autoLearnDiscardCounts || {}) };
		counts[key] = (counts[key] || 0) + 1;
		await this.updateProject(projectId, { autoLearnDiscardCounts: counts });
	}

	/**
	 * Reset discard counter for a category (called when user confirms an item of that type).
	 */
	async resetDiscardCount(projectId: string, key: string): Promise<void> {
		const project = this.getProject(projectId);
		if (!project) { return; }
		const counts = { ...(project.autoLearnDiscardCounts || {}) };
		if (counts[key]) {
			delete counts[key];
			await this.updateProject(projectId, { autoLearnDiscardCounts: counts });
		}
	}

	/**
	 * Check if a signal category is suppressed (discard count >= threshold).
	 */
	isSignalSuppressed(projectId: string, key: string, threshold: number): boolean {
		if (threshold <= 0) { return false; }
		return this.getDiscardCount(projectId, key) >= threshold;
	}

	// ============ Conventions ============

	getConventions(projectId: string): Convention[] {
		const project = this.getProject(projectId);
		return project?.conventions || [];
	}

	getSelectedConventionIds(projectId: string): string[] {
		const project = this.getProject(projectId);
		return project?.selectedConventionIds || [];
	}

	getSelectedConventions(projectId: string): Convention[] {
		const project = this.getProject(projectId);
		if (!project) { return []; }
		const selectedIds = new Set(project.selectedConventionIds || []);
		return (project.conventions || []).filter(c => selectedIds.has(c.id));
	}

	async toggleConventionSelection(projectId: string, conventionId: string): Promise<boolean> {
		const project = this.getProject(projectId);
		if (!project) { return false; }
		const selectedIds = [...(project.selectedConventionIds || [])];
		const index = selectedIds.indexOf(conventionId);
		if (index >= 0) { selectedIds.splice(index, 1); }
		else { selectedIds.push(conventionId); }
		await this.updateProject(projectId, { selectedConventionIds: selectedIds });
		return index < 0;
	}

	async addConvention(
		projectId: string,
		category: Convention['category'],
		title: string,
		content: string,
		confidence: Convention['confidence'] = 'observed',
		learnedFrom?: string,
	): Promise<Convention | undefined> {
		const project = this.getProject(projectId);
		if (!project) { return undefined; }
		const conventions = [...(project.conventions || [])];

		// Deduplicate using Jaccard similarity on title+content
		const SIMILARITY_THRESHOLD = ConfigurationManager.dedupThreshold;
		const candidateText = `${title} ${content}`;
		const existingIdx = conventions.findIndex(c => {
			if (c.category !== category) { return false; }
			const existingText = `${c.title} ${c.content}`;
			return this._jaccardSimilarity(candidateText, existingText) >= SIMILARITY_THRESHOLD;
		});
		
		if (existingIdx >= 0) {
			// Update existing convention
			conventions[existingIdx] = {
				...conventions[existingIdx],
				content, confidence, learnedFrom,
				updatedAt: Date.now(),
			};
			await this.updateProject(projectId, { conventions });
			this._searchIndex?.indexLearning({
				id: conventions[existingIdx].id, projectId, type: 'convention',
				subject: conventions[existingIdx].title, content: conventions[existingIdx].content,
				category: conventions[existingIdx].category, relatedFiles: '', relatedSymbols: '',
				confidence: conventions[existingIdx].confidence,
			});
			return conventions[existingIdx];
		}

		// New convention
		const convention = createConvention(category, title, content, confidence, learnedFrom);
		conventions.push(convention);
		await this.updateProject(projectId, { conventions });
		// Index in FTS
		this._searchIndex?.indexLearning({
			id: convention.id, projectId, type: 'convention',
			subject: convention.title, content: convention.content,
			category: convention.category, relatedFiles: '', relatedSymbols: '',
			confidence: convention.confidence,
		});
		return convention;
	}

	async updateConvention(
		projectId: string,
		conventionId: string,
		updates: Partial<Pick<Convention, 'title' | 'content' | 'confidence' | 'category' | 'enabled'>>,
	): Promise<boolean> {
		const project = this.getProject(projectId);
		if (!project) { return false; }
		const conventions = [...(project.conventions || [])];
		const idx = conventions.findIndex(c => c.id === conventionId);
		if (idx < 0) { return false; }
		conventions[idx] = { ...conventions[idx], ...updates, updatedAt: Date.now() };
		await this.updateProject(projectId, { conventions });
		return true;
	}

	async removeConvention(projectId: string, conventionId: string): Promise<void> {
		const project = this.getProject(projectId);
		if (!project) { return; }
		const conventions = (project.conventions || []).filter(c => c.id !== conventionId);
		await this.updateProject(projectId, { conventions });
		this._searchIndex?.removeLearning(conventionId);
	}

	// ============ Tool Hints ============

	getToolHints(projectId: string): ToolHint[] {
		const project = this.getProject(projectId);
		return project?.toolHints || [];
	}

	getSelectedToolHintIds(projectId: string): string[] {
		const project = this.getProject(projectId);
		return project?.selectedToolHintIds || [];
	}

	getSelectedToolHints(projectId: string): ToolHint[] {
		const project = this.getProject(projectId);
		if (!project) { return []; }
		const selectedIds = new Set(project.selectedToolHintIds || []);
		return (project.toolHints || []).filter(h => selectedIds.has(h.id));
	}

	async toggleToolHintSelection(projectId: string, hintId: string): Promise<boolean> {
		const project = this.getProject(projectId);
		if (!project) { return false; }
		const selectedIds = [...(project.selectedToolHintIds || [])];
		const index = selectedIds.indexOf(hintId);
		if (index >= 0) { selectedIds.splice(index, 1); }
		else { selectedIds.push(hintId); }
		await this.updateProject(projectId, { selectedToolHintIds: selectedIds });
		return index < 0;
	}

	async addToolHint(
		projectId: string,
		toolName: string,
		pattern: string,
		example: string,
		antiPattern?: string,
	): Promise<ToolHint | undefined> {
		const project = this.getProject(projectId);
		if (!project) { return undefined; }
		const toolHints = [...(project.toolHints || [])];

		// Deduplicate: update existing hint with same toolName + pattern
		const existingIdx = toolHints.findIndex(
			h => h.toolName === toolName && h.pattern.toLowerCase() === pattern.toLowerCase()
		);
		if (existingIdx >= 0) {
			toolHints[existingIdx] = {
				...toolHints[existingIdx],
				example, antiPattern,
				useCount: toolHints[existingIdx].useCount + 1,
				updatedAt: Date.now(),
			};
			await this.updateProject(projectId, { toolHints });
			return toolHints[existingIdx];
		}

		const hint = createToolHint(toolName, pattern, example, antiPattern);
		toolHints.push(hint);
		await this.updateProject(projectId, { toolHints });
		this._searchIndex?.indexLearning({
			id: hint.id, projectId, type: 'toolHint',
			subject: hint.toolName, content: `${hint.pattern} ${hint.example}`,
			category: 'tooling', relatedFiles: '', relatedSymbols: '',
			confidence: 'observed',
		});
		return hint;
	}

	async removeToolHint(projectId: string, hintId: string): Promise<void> {
		const project = this.getProject(projectId);
		if (!project) { return; }
		const toolHints = (project.toolHints || []).filter(h => h.id !== hintId);
		await this.updateProject(projectId, { toolHints });
		this._searchIndex?.removeLearning(hintId);
	}

	// ============ Working Notes ============

	getWorkingNotes(projectId: string): WorkingNote[] {
		const project = this.getProject(projectId);
		return project?.workingNotes || [];
	}

	async addWorkingNote(
		projectId: string,
		subject: string,
		insight: string,
		relatedFiles: string[] = [],
		relatedSymbols: string[] = [],
		discoveredWhile?: string,
	): Promise<WorkingNote | undefined> {
		const project = this.getProject(projectId);
		if (!project) { return undefined; }
		const workingNotes = [...(project.workingNotes || [])];

		// Deduplicate using Jaccard similarity on subject+insight
		const SIMILARITY_THRESHOLD = ConfigurationManager.dedupThreshold;
		const candidateText = `${subject} ${insight}`;
		const existingIdx = workingNotes.findIndex(n => {
			const existingText = `${n.subject} ${n.insight}`;
			return this._jaccardSimilarity(candidateText, existingText) >= SIMILARITY_THRESHOLD;
		});
		
		if (existingIdx >= 0) {
			// Update existing note
			workingNotes[existingIdx] = {
				...workingNotes[existingIdx],
				insight,
				relatedFiles: [...new Set([...workingNotes[existingIdx].relatedFiles, ...relatedFiles])],
				relatedSymbols: [...new Set([...workingNotes[existingIdx].relatedSymbols, ...relatedSymbols])],
				staleness: 'fresh' as const,
				updatedAt: Date.now(),
			};
			await this.updateProject(projectId, { workingNotes });
			this._searchIndex?.indexLearning({
				id: workingNotes[existingIdx].id, projectId, type: 'note',
				subject: workingNotes[existingIdx].subject, content: workingNotes[existingIdx].insight,
				category: '', relatedFiles: workingNotes[existingIdx].relatedFiles.join(' '),
				relatedSymbols: workingNotes[existingIdx].relatedSymbols.join(' '),
				confidence: workingNotes[existingIdx].confidence,
			});
			return workingNotes[existingIdx];
		}

		// New note
		const note = createWorkingNote(subject, insight, relatedFiles, relatedSymbols, discoveredWhile);
		workingNotes.push(note);
		await this.updateProject(projectId, { workingNotes });
		this._searchIndex?.indexLearning({
			id: note.id, projectId, type: 'note',
			subject: note.subject, content: note.insight,
			category: '', relatedFiles: note.relatedFiles.join(' '),
			relatedSymbols: note.relatedSymbols.join(' '),
			confidence: note.confidence,
		});
		return note;
	}

	async updateWorkingNote(
		projectId: string,
		noteId: string,
		updates: Partial<Pick<WorkingNote, 'insight' | 'confidence' | 'staleness' | 'relatedFiles' | 'relatedSymbols'>>,
	): Promise<boolean> {
		const project = this.getProject(projectId);
		if (!project) { return false; }
		const workingNotes = [...(project.workingNotes || [])];
		const idx = workingNotes.findIndex(n => n.id === noteId);
		if (idx < 0) { return false; }
		workingNotes[idx] = { ...workingNotes[idx], ...updates, updatedAt: Date.now() };
		await this.updateProject(projectId, { workingNotes });
		return true;
	}

	async removeWorkingNote(projectId: string, noteId: string): Promise<void> {
		const project = this.getProject(projectId);
		if (!project) { return; }
		const workingNotes = (project.workingNotes || []).filter(n => n.id !== noteId);
		await this.updateProject(projectId, { workingNotes });
		this._searchIndex?.removeLearning(noteId);
	}

	/**
	 * Check file mtimes against note.updatedAt to detect staleness.
	 * Returns true if any note changed staleness.
	 */
	async refreshStaleness(projectId: string): Promise<boolean> {
		if (!ConfigurationManager.intelligenceEnableStalenessTracking) { return false; }
		const project = this.getProject(projectId);
		if (!project) { return false; }
		const notes = project.workingNotes || [];
		if (notes.length === 0) { return false; }

		// Collect all unique relatedFiles and batch-stat them
		const allFiles = new Set<string>();
		for (const n of notes) {
			for (const f of n.relatedFiles) { allFiles.add(f); }
		}
		if (allFiles.size === 0) { return false; }

		// Resolve paths relative to project root
		const roots = project.rootPaths || [];
		const mtimeCache = new Map<string, number>();
		const statPromises: Promise<void>[] = [];
		for (const file of allFiles) {
			statPromises.push((async () => {
				// Try absolute first, then resolve against each root
				const candidates = file.match(/^[/\\]|^[a-zA-Z]:/) ? [file]
					: roots.map(r => vscode.Uri.joinPath(vscode.Uri.file(r), file));
				for (const candidate of candidates) {
					try {
						const uri = typeof candidate === 'string' ? vscode.Uri.file(candidate) : candidate;
						const stat = await vscode.workspace.fs.stat(uri);
						mtimeCache.set(file, stat.mtime);
						return;
					} catch { /* file not found, try next root */ }
				}
			})());
		}
		await Promise.all(statPromises);

		// Compare mtimes against note.updatedAt
		let changed = false;
		const updatedNotes = notes.map(n => {
			if (n.relatedFiles.length === 0) { return n; }
			const anyModified = n.relatedFiles.some(f => {
				const mtime = mtimeCache.get(f);
				return mtime !== undefined && mtime > n.updatedAt;
			});
			const newStaleness = anyModified ? 'possibly-stale' as const : 'fresh' as const;
			if (newStaleness !== n.staleness) {
				changed = true;
				return { ...n, staleness: newStaleness };
			}
			return n;
		});

		if (changed) {
			await this.updateProject(projectId, { workingNotes: updatedNotes });
		}
		return changed;
	}

	/**
	 * Query working notes by related files and/or keyword match.
	 */
	queryWorkingNotes(projectId: string, query?: string, files?: string[]): WorkingNote[] {
		const notes = this.getWorkingNotes(projectId);
		let filtered = notes;

		if (files && files.length > 0) {
			filtered = filtered.filter(n =>
				n.relatedFiles.some(rf => files!.some(f => rf.includes(f) || f.includes(rf)))
			);
		}

		if (query) {
			const q = query.toLowerCase();
			filtered = filtered.filter(n =>
				n.subject.toLowerCase().includes(q) ||
				n.insight.toLowerCase().includes(q) ||
				n.relatedSymbols.some(s => s.toLowerCase().includes(q))
			);
		}

		// Sort: fresh first, then by updatedAt desc
		filtered.sort((a, b) => {
			const stalenessOrder = { fresh: 0, 'possibly-stale': 1, stale: 2 };
			const sDiff = stalenessOrder[a.staleness] - stalenessOrder[b.staleness];
			if (sDiff !== 0) { return sDiff; }
			return b.updatedAt - a.updatedAt;
		});

		return filtered;
	}

	// ============ Project Intelligence String ============

	/**
	 * Build a tiered intelligence injection string within token budget.
	 * Tier 1: confirmed conventions + top tool hints (always)
	 * Tier 2: task-relevant working notes + observed conventions (when relevant)
	 */
	async getProjectIntelligenceString(
		projectId: string,
		prompt?: string,
		files?: string[],
	): Promise<string> {
		if (!ConfigurationManager.intelligenceEnableTieredInjection) { return ''; }

		const injectConventions = ConfigurationManager.intelligenceInjectConventions;
		const injectWorkingNotes = ConfigurationManager.intelligenceInjectWorkingNotes;
		const injectToolHints = ConfigurationManager.intelligenceInjectToolHints;
		const injectCards = ConfigurationManager.intelligenceInjectKnowledgeCards;

		const conventions = injectConventions ? this.getConventions(projectId) : [];
		const toolHints = injectToolHints ? this.getToolHints(projectId) : [];
		const workingNotes = injectWorkingNotes ? this.getWorkingNotes(projectId) : [];
		const allCards = injectCards ? this.getKnowledgeCards(projectId) : [];
		const enabledCards = allCards.filter(c => !c.archived && c.includeInContext !== false);

		if (conventions.length === 0 && toolHints.length === 0 && workingNotes.length === 0 && enabledCards.length === 0) {
			return '';
		}

		const parts: string[] = ['## Project Intelligence\n'];
		let tokenEstimate = 10;
		const tier1Max = ConfigurationManager.intelligenceTier1MaxTokens;
		const tier2Max = ConfigurationManager.intelligenceTier2MaxTokens;

		const project = this.getProject(projectId);

		// --- Tier 1a: Knowledge Cards (selected, or pinned) ---
		const selectedCardIds = new Set(project?.selectedCardIds || []);
		const hasCardSelection = selectedCardIds.size > 0;
		const tier1Cards = hasCardSelection
			? enabledCards.filter(c => selectedCardIds.has(c.id))
			: enabledCards.filter(c => c.pinned);
		if (tier1Cards.length > 0) {
			parts.push(`**Knowledge Cards${hasCardSelection ? ' (selected)' : ' (pinned)'}:**`);
			for (const card of tier1Cards) {
				const line = `\n### ${card.title} [${card.category}]\n${card.content}`;
				const lineTokens = Math.ceil(line.length / 4);
				if (tokenEstimate + lineTokens > tier1Max) { break; }
				parts.push(line);
				tokenEstimate += lineTokens;
			}
		}

		// --- Tier 1b: Inject SELECTED conventions, or ALL enabled conventions if none selected ---
		const selectedConvIds = new Set(project?.selectedConventionIds || []);
		const hasConvSelection = selectedConvIds.size > 0;
		const tier1Conventions = hasConvSelection
			? conventions.filter(c => selectedConvIds.has(c.id))
			: conventions.filter(c => (c as any).enabled !== false);
		if (tier1Conventions.length > 0) {
			parts.push(`**Conventions${hasConvSelection ? ' (selected)' : ''}:**`);
			for (const c of tier1Conventions) {
				const line = `- [${c.category}] ${c.title}: ${c.content}`;
				const lineTokens = Math.ceil(line.length / 4);
				if (tokenEstimate + lineTokens > tier1Max) { break; }
				parts.push(line);
				tokenEstimate += lineTokens;
			}
		}

		// Tool hints (selected only) — inject in Tier 1 when user has explicitly chosen hints
		const selectedHintIds = new Set(project?.selectedToolHintIds || []);
		const hasHintSelection = selectedHintIds.size > 0;
		if (hasHintSelection) {
			const tier1Hints = toolHints.filter(h => selectedHintIds.has(h.id));
			if (tier1Hints.length > 0) {
				parts.push(`\n**Tool hints (selected):**`);
				for (const h of tier1Hints) {
					const line = `- Search "${h.pattern}"${h.antiPattern ? ` not "${h.antiPattern}"` : ''} (${h.example})`;
					const lineTokens = Math.ceil(line.length / 4);
					if (tokenEstimate + lineTokens > tier1Max) { break; }
					parts.push(line);
					tokenEstimate += lineTokens;
				}
			}
		}

		// --- Tier 2: Task-relevant (BM25 ranked when FTS available, keyword fallback) ---
		// Tool hints (unselected) are injected here only when the prompt looks like codebase exploration
		const explorationKeywords = /\b(find|search|where|look|grep|locate|navigate|explore|which file|how does|how is|what is|defined|implemented|called|used|class|function|method|import|exports?|module|component|service)\b/i;
		const isExplorationPrompt = !!(prompt && explorationKeywords.test(prompt)) || !!(files && files.length > 0);
		if (prompt || files) {
			let tier2Tokens = 0;

			// Build a search query from the prompt + referenced file basenames
			const searchQuery = [
				prompt || '',
				...(files || []).map(f => f.split(/[\\/]/).pop() || ''),
			].join(' ').trim();

			// Try BM25 search first — properly ranked by relevance
			let bm25Injected = false;
			if (this._searchIndex?.isReady && searchQuery && ConfigurationManager.searchEnableFTS) {
				try {
					// Search knowledge cards (BM25, full content)
					const tier1CardIds = new Set(tier1Cards.map(c => c.id));
					const cardResults = await this._searchIndex.searchCards(projectId, searchQuery, 5);
					const relevantBm25Cards = cardResults.filter(r => !tier1CardIds.has(r.entityId));
					if (relevantBm25Cards.length > 0) {
						parts.push('\n**Relevant knowledge cards:**');
						for (const r of relevantBm25Cards) {
							const fullContent = (r.metadata as any).fullContent || r.snippet;
							const line = `\n### ${r.title} [${(r.metadata as any).category}]\n${fullContent}`;
							const lineTokens = Math.ceil(line.length / 4);
							if (tier2Tokens + lineTokens > tier2Max) { break; }
							parts.push(line);
							tier2Tokens += lineTokens;
						}
					}

					// Search conventions/notes/toolHints
					const bm25Results = await this._searchIndex.searchLearnings(
						projectId, searchQuery, ['note', 'convention', 'toolHint'], 5
					);
					if (bm25Results.length > 0) {
						bm25Injected = true;
						parts.push('\n**Relevant learnings (ranked):**');
						for (const r of bm25Results) {
							const typeIcon = r.metadata.type === 'note' ? '📌'
								: r.metadata.type === 'convention' ? '📏'
								: '🔧';
							const line = `- ${typeIcon} ${r.title}: ${r.snippet.slice(0, 400)}`;
							const lineTokens = Math.ceil(line.length / 4);
							if (tier2Tokens + lineTokens > tier2Max) { break; }
							parts.push(line);
							tier2Tokens += lineTokens;
						}
					}
// Tool hints (unselected) — inject when this looks like a codebase exploration prompt
				if (!hasHintSelection && isExplorationPrompt && toolHints.length > 0) {
					const autoHints = [...toolHints].sort((a, b) => b.useCount - a.useCount).slice(0, 5);
					parts.push('\n**Tool hints:**');
					for (const h of autoHints) {
						const line = `- Search "${h.pattern}"${h.antiPattern ? ` not "${h.antiPattern}"` : ''} (${h.example})`;
						const lineTokens = Math.ceil(line.length / 4);
						if (tier2Tokens + lineTokens > tier2Max) { break; }
						parts.push(line);
						tier2Tokens += lineTokens;
					}
				}

				// Mark BM25 as attempted even if only cards matched, so keyword fallback is skipped
					bm25Injected = bm25Injected || relevantBm25Cards.length > 0;
				} catch {
					// BM25 failed — fall through to keyword fallback
				}
			}

			// Keyword fallback when BM25 is unavailable or returned nothing
			if (!bm25Injected) {
				const promptLower = (prompt || '').toLowerCase();
				const promptWords = promptLower.split(/\s+/).filter(w => w.length > 3);

				// Relevant knowledge cards — keyword-matched, not already in Tier 1
				const tier1CardIds = new Set(tier1Cards.map(c => c.id));
				const relevantCards = enabledCards.filter(c => {
					if (tier1CardIds.has(c.id)) { return false; }
					const cText = `${c.title} ${c.content} ${c.category} ${(c.tags || []).join(' ')}`.toLowerCase();
					return promptWords.some(w => cText.includes(w));
				}).slice(0, 5);
				if (relevantCards.length > 0) {
					parts.push('\n**Relevant knowledge cards:**');
					for (const card of relevantCards) {
						const line = `\n### ${card.title} [${card.category}]\n${card.content}`;
						const lineTokens = Math.ceil(line.length / 4);
						if (tier2Tokens + lineTokens > tier2Max) { break; }
						parts.push(line);
						tier2Tokens += lineTokens;
					}
				}

				// Relevant working notes (file match + keyword match) — only enabled notes
				const relevantNotes = workingNotes.filter(n => {
					if ((n as any).enabled === false) { return false; }
					if (files && files.length > 0) {
						if (n.relatedFiles.some(rf => files!.some(f => rf.includes(f) || f.includes(rf)))) { return true; }
					}
					if (promptWords.length > 0) {
						const noteText = `${n.subject} ${n.insight} ${n.relatedSymbols.join(' ')}`.toLowerCase();
						if (promptWords.some(w => noteText.includes(w))) { return true; }
					}
					return false;
				}).slice(0, 3);

				if (relevantNotes.length > 0) {
					parts.push('\n**Relevant notes:**');
					for (const n of relevantNotes) {
						const staleTag = n.staleness !== 'fresh' ? ` ⚠️ ${n.staleness}` : '';
						const line = `- 📌 ${n.subject}: ${n.insight.slice(0, 400)}${n.insight.length > 400 ? '…' : ''}${staleTag}`;
						const lineTokens = Math.ceil(line.length / 4);
						if (tier2Tokens + lineTokens > tier2Max) { break; }
						parts.push(line);
						tier2Tokens += lineTokens;
					}
				}

				// Relevant conventions not already in Tier 1 — keyword-matched, enabled only
				const tier1Ids = new Set(tier1Conventions.map(c => c.id));
				const tier2Conventions = conventions.filter(c =>
					!tier1Ids.has(c.id) && (c as any).enabled !== false
				);
				const relevantTier2 = tier2Conventions.filter(c => {
					const cText = `${c.title} ${c.content} ${c.category}`.toLowerCase();
					return promptWords.some(w => cText.includes(w));
				}).slice(0, 5);

				if (relevantTier2.length > 0) {
					parts.push('\n**Additional relevant conventions:**');
					for (const c of relevantTier2) {
						const line = `- [${c.category}] ${c.title}: ${c.content}`;
						const lineTokens = Math.ceil(line.length / 4);
						if (tier2Tokens + lineTokens > tier2Max) { break; }
						parts.push(line);
						tier2Tokens += lineTokens;
					}
				}

				// Tool hints (unselected) — keyword fallback path
				if (!hasHintSelection && isExplorationPrompt && toolHints.length > 0) {
					const autoHints = [...toolHints].sort((a, b) => b.useCount - a.useCount).slice(0, 5);
					parts.push('\n**Tool hints:**');
					for (const h of autoHints) {
						const line = `- Search "${h.pattern}"${h.antiPattern ? ` not "${h.antiPattern}"` : ''} (${h.example})`;
						const lineTokens = Math.ceil(line.length / 4);
						if (tier2Tokens + lineTokens > tier2Max) { break; }
						parts.push(line);
						tier2Tokens += lineTokens;
					}
				}
			}
		}

		return parts.join('\n');
	}

	// ─── Deduplication Utility ──────────────────────────────────

	/**
	 * Calculate Jaccard similarity between two strings using word-level tokenization.
	 * Returns a value between 0 (no overlap) and 1 (identical).
	 * Normalizes text by lowercasing and removing punctuation.
	 */
	private _jaccardSimilarity(a: string, b: string): number {
		// Normalize: lowercase, remove punctuation, split into words
		const tokenize = (text: string): Set<string> => {
			const normalized = text.toLowerCase().replace(/[^\w\s]/g, ' ');
			const words = normalized.split(/\s+/).filter(w => w.length > 0);
			return new Set(words);
		};

		const setA = tokenize(a);
		const setB = tokenize(b);

		if (setA.size === 0 && setB.size === 0) { return 1; } // both empty → identical
		if (setA.size === 0 || setB.size === 0) { return 0; } // one empty → no overlap

		// Intersection: words in both sets
		let intersection = 0;
		for (const word of setA) {
			if (setB.has(word)) { intersection++; }
		}

		// Union: total unique words
		const union = setA.size + setB.size - intersection;

		return intersection / union;
	}

	/**
	 * Finds the most similar knowledge card in a project vs a given text.
	 * Returns the card and its similarity score, or undefined if none exceed the threshold.
	 */
	findSimilarKnowledgeCard(
		projectId: string,
		titleAndContent: string,
		threshold: number = 0.5,
	): { card: KnowledgeCard; similarity: number } | undefined {
		const project = this.getProject(projectId);
		if (!project) { return undefined; }

		let best: { card: KnowledgeCard; similarity: number } | undefined;
		for (const card of (project.knowledgeCards || [])) {
			const existing = `${card.title} ${card.content}`;
			const sim = this._jaccardSimilarity(titleAndContent, existing);
			if (sim >= threshold && (!best || sim > best.similarity)) {
				best = { card, similarity: sim };
			}
		}
		return best;
	}

}
