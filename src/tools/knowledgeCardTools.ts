/**
 * Knowledge Card tools — save and edit knowledge cards in the active project.
 */

import * as vscode from 'vscode';
import { ConfigurationManager } from '../config';
import { ProjectManager } from '../projects/ProjectManager';

// ─── Interfaces ─────────────────────────────────────────────────

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
	/** Optional folder name to place card into. If omitted, auto-assigns to best matching folder. */
	folderName?: string;
}

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

// ─── Save Knowledge Card Tool ───────────────────────────────────

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

		const { title, content, category = 'note', tags = [], source, folderName } = options.input;

		if (!title?.trim()) {
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('title is required.')]);
		}
		if (!content?.trim()) {
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('content is required.')]);
		}

		// Resolve folder: explicit name → find/create, else auto-match
		let folderId: string | undefined;
		if (folderName?.trim()) {
			const folders = this.projectManager.getKnowledgeFolders(project.id);
			const match = folders.find(f => f.name.toLowerCase() === folderName.trim().toLowerCase());
			if (match) {
				folderId = match.id;
			} else {
				const created = await this.projectManager.addKnowledgeFolder(project.id, folderName.trim());
				folderId = created?.id;
			}
		} else {
			folderId = this.projectManager.findBestFolder(project.id, title, category, tags);
		}

		const card = await this.projectManager.addKnowledgeCard(
			project.id, title.trim(), content.trim(), category, tags, source, undefined, folderId
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

// ─── Get Knowledge Card Tool ──────────────────────────────────

interface IGetCardParams {
	/** ID of the knowledge card to retrieve. */
	id: string;
}

/**
 * Reads the full content of a knowledge card by ID.
 * Includes anchors (code stubs) and staleness check.
 */
export class GetCardTool implements vscode.LanguageModelTool<IGetCardParams> {
	constructor(private readonly projectManager: ProjectManager) {}

	async invoke(
		options: vscode.LanguageModelToolInvocationOptions<IGetCardParams>,
		_token: vscode.CancellationToken,
	): Promise<vscode.LanguageModelToolResult> {
		const project = this.projectManager.getActiveProject();
		if (!project) {
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(
				'No active project.'
			)]);
		}

		const id = options.input?.id?.trim();
		if (!id) {
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('id is required.')]);
		}

		const cards = this.projectManager.getKnowledgeCards(project.id);
		let card = cards.find(c => c.id === id);

		// If not found in active project, search global cards from other projects
		if (!card) {
			const globalCards = this.projectManager.getGlobalCards(project.id);
			card = globalCards.find(c => c.id === id);
		}

		if (!card) {
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(
				`No knowledge card found with ID "${id}" in project "${project.name}" or in global cards.`
			)]);
		}

		const parts: string[] = [];
		parts.push(`# ${card.title}`);
		parts.push(`**Category:** ${card.category} | **Tags:** ${card.tags.length ? card.tags.join(', ') : 'none'}`);
		if (card.pinned) { parts.push('**Status:** Pinned'); }
		if (card.source) { parts.push(`**Source:** ${card.source}`); }
		parts.push('');
		parts.push(card.content);

		// Anchors section
		if (card.anchors && card.anchors.length > 0) {
			parts.push('');
			parts.push('## Anchors (grounding code stubs)');
			const staleWarnings: string[] = [];
			for (const anchor of card.anchors) {
				const label = anchor.symbolName
					? `${anchor.filePath} :: ${anchor.symbolName}`
					: anchor.filePath;
				const lines = anchor.startLine && anchor.endLine
					? ` (L${anchor.startLine}-${anchor.endLine})`
					: '';
				parts.push(`### ${label}${lines}`);
				parts.push('```');
				parts.push(anchor.stubContent);
				parts.push('```');

				// Staleness check: see if the file still exists and content matches
				try {
					const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
					if (workspaceFolder) {
						const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, anchor.filePath);
						const doc = await vscode.workspace.openTextDocument(fileUri);
						const fileContent = doc.getText();
						const firstLine = anchor.stubContent.split('\n')[0].trim();
						if (firstLine && !fileContent.includes(firstLine)) {
							staleWarnings.push(`- **${label}**: stub content not found in current file — card may be stale`);
						}
					}
				} catch {
					staleWarnings.push(`- **${label}**: file not found — card may be stale`);
				}
			}

			if (staleWarnings.length > 0) {
				parts.push('');
				parts.push('## ⚠ Staleness Warnings');
				parts.push(...staleWarnings);
				parts.push('Consider re-verifying this card\'s accuracy with `#projectIntelligence retrospect`.');
			}
		}

		parts.push('');
		parts.push(`*Created: ${new Date(card.created).toLocaleString()} | ID: ${card.id}*`);

		return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(parts.join('\n'))]);
	}

	async prepareInvocation(
		options: vscode.LanguageModelToolInvocationPrepareOptions<IGetCardParams>,
		_token: vscode.CancellationToken,
	) {
		// Read-only — never requires confirmation, runs immediately like #projectContext
		const id = options.input?.id ?? 'card';
		return { invocationMessage: `Reading knowledge card "${id}"...` };
	}
}

// ─── Edit Knowledge Card Tool ─────────────────────────────────

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

// ─── Organize Knowledge Cards Tool ─────────────────────────────

interface IOrganizeKnowledgeCardsParams {
	/** Action to perform. */
	action: 'listFolders' | 'createFolder' | 'moveCard' | 'autoOrganize';
	/** Folder name (for createFolder). */
	folderName?: string;
	/** Parent folder name (for creating subfolders). */
	parentFolderName?: string;
	/** Card ID to move (for moveCard). */
	cardId?: string;
	/** Target folder name to move card into (for moveCard). Empty string = root. */
	targetFolderName?: string;
}

/**
 * Organizes knowledge cards into folders: list, create, move, or auto-organize all cards.
 */
export class OrganizeKnowledgeCardsTool implements vscode.LanguageModelTool<IOrganizeKnowledgeCardsParams> {
	constructor(private readonly projectManager: ProjectManager) {}

	async invoke(
		options: vscode.LanguageModelToolInvocationOptions<IOrganizeKnowledgeCardsParams>,
		_token: vscode.CancellationToken,
	): Promise<vscode.LanguageModelToolResult> {
		console.log('[ContextManager] organizeKnowledgeCards.invoke called', JSON.stringify(options?.input ?? null));
		try {
		const project = this.projectManager.getActiveProject();
		if (!project) {
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(
				'No active project. Create or select a project in the ContextManager dashboard first.'
			)]);
		}

		// Guard against missing/null input (some model runtimes omit input when schema has required fields)
		const action: IOrganizeKnowledgeCardsParams['action'] = options?.input?.action ?? 'listFolders';

		switch (action) {
			case 'listFolders': {
				const folders = this.projectManager.getKnowledgeFolders(project.id);
				const cards = this.projectManager.getKnowledgeCards(project.id);
				if (folders.length === 0) {
					return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(
						'No folders exist yet. Use action "createFolder" to create one.'
					)]);
				}
				const lines = folders.map(f => {
					const cardCount = cards.filter(c => c.folderId === f.id).length;
					const parent = f.parentFolderId ? folders.find(p => p.id === f.parentFolderId)?.name : null;
					return `- ${f.name} (${cardCount} cards)${parent ? ` [parent: ${parent}]` : ''} — ID: ${f.id}`;
				});
				const rootCards = cards.filter(c => !c.folderId || !folders.some(f => f.id === c.folderId));
				lines.push(`- Uncategorized (${rootCards.length} cards)`);
				return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(
					`## Knowledge Folders\n${lines.join('\n')}`
				)]);
			}

			case 'createFolder': {
				const name = options.input.folderName?.trim();
				if (!name) {
					return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('folderName is required.')]);
				}
				let parentId: string | undefined;
				if (options.input.parentFolderName?.trim()) {
					const folders = this.projectManager.getKnowledgeFolders(project.id);
					const parent = folders.find(f => f.name.toLowerCase() === options.input.parentFolderName!.trim().toLowerCase());
					parentId = parent?.id;
				}
				const folder = await this.projectManager.addKnowledgeFolder(project.id, name, parentId);
				if (!folder) {
					return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('Failed to create folder (may already exist).')]);
				}
				return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(
					`Folder created: "${folder.name}" (ID: ${folder.id})${parentId ? ' as subfolder' : ''}`
				)]);
			}

			case 'moveCard': {
				const cardId = options.input.cardId?.trim();
				if (!cardId) {
					return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('cardId is required.')]);
				}
				const targetName = (options.input.targetFolderName ?? '').trim();
				let folderId: string | undefined;
				if (targetName) {
					const folders = this.projectManager.getKnowledgeFolders(project.id);
					const match = folders.find(f => f.name.toLowerCase() === targetName.toLowerCase());
					if (!match) {
						// Auto-create the folder
						const created = await this.projectManager.addKnowledgeFolder(project.id, targetName);
						folderId = created?.id;
					} else {
						folderId = match.id;
					}
				}
				const moved = await this.projectManager.moveKnowledgeCardToFolder(project.id, cardId, folderId);
				if (!moved) {
					return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(`Card "${cardId}" not found.`)]);
				}
				return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(
					`Card "${moved.title}" moved to ${targetName || 'Uncategorized'}.`
				)]);
			}

			case 'autoOrganize': {
				const cards = this.projectManager.getKnowledgeCards(project.id);
				const folders = this.projectManager.getKnowledgeFolders(project.id);
				let movedCount = 0;
				const results: string[] = [];

				for (const card of cards) {
					if (card.folderId && folders.some(f => f.id === card.folderId)) {
						continue; // Already in a valid folder
					}
					const bestFolderId = this.projectManager.findBestFolder(project.id, card.title, card.category, card.tags);
					if (bestFolderId) {
						await this.projectManager.moveKnowledgeCardToFolder(project.id, card.id, bestFolderId);
						const folderName = folders.find(f => f.id === bestFolderId)?.name || 'unknown';
						results.push(`- "${card.title}" → ${folderName}`);
						movedCount++;
					}
				}

				if (movedCount === 0) {
					return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(
						'No cards could be auto-organized. Create relevant folders first, then try again.'
					)]);
				}
				return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(
					`## Auto-organized ${movedCount} card(s)\n${results.join('\n')}`
				)]);
			}

			default:
				return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(
					`Unknown action "${action}". Use: listFolders, createFolder, moveCard, autoOrganize.`
				)]);
		}
		} catch (err) {
			console.error('[ContextManager] organizeKnowledgeCards.invoke ERROR:', err);
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(
				`Error organizing knowledge cards: ${err}`
			)]);
		}
	}

	async prepareInvocation(
		options: vscode.LanguageModelToolInvocationPrepareOptions<IOrganizeKnowledgeCardsParams>,
		_token: vscode.CancellationToken,
	) {
		console.log('[ContextManager] organizeKnowledgeCards.prepareInvocation called');
		try {
			const action = options?.input?.action ?? 'organize';
			return { invocationMessage: `Organizing knowledge cards: ${action}...` };
		} catch (err) {
			console.error('[ContextManager] organizeKnowledgeCards.prepareInvocation ERROR:', err);
			return { invocationMessage: 'Organizing knowledge cards...' };
		}
	}
}
