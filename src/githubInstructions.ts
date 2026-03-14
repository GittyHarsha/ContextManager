/**
 * GitHub Instructions Manager — manages .github/ files that integrate
 * ContextManager knowledge into VS Code's native instruction system.
 *
 * Responsibilities:
 * 1. Managed block in .github/copilot-instructions.md
 * 2. Per-architecture-card .instructions.md files in .github/instructions/
 * 3. knowledge-retrospect.prompt.md rewrite prompt
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { ProjectManager } from './projects/ProjectManager';
import type { KnowledgeCard } from './projects/types';

const MANAGED_BLOCK_START = '<!-- ContextManager:BEGIN -->';
const MANAGED_BLOCK_END = '<!-- ContextManager:END -->';

// Template for the retrospect prompt file
const RETROSPECT_PROMPT_TEMPLATE = `---
mode: agent
description: Run a knowledge retrospective — review and refresh auto-captured knowledge cards.
tools:
  - contextManager_getKnowledgeCardsByCategory
  - contextManager_getCard
  - contextManager_editKnowledgeCard
  - contextManager_projectIntelligence
---

# Knowledge Retrospective

Review the project's knowledge cards for accuracy and staleness.

1. Start by calling #knowledgeByCategory with detail="index" to get the card index (all cards across all categories).
2. For each card, call #getCard to read the full content and check anchors.
3. If a card has staleness warnings, verify the claims against the current code.
4. Use #editCard to update stale content, or #projectIntelligence retrospect to capture new learnings.

Focus on architecture and pattern cards first — these are most likely to drift as the codebase evolves.
`;

export class GitHubInstructionsManager {
	constructor(private readonly projectManager: ProjectManager) {}

	/** Fingerprint of cards+conventions from the last actual file write. */
	private _lastSyncedFingerprint = '';

	/** Compute a lightweight fingerprint of the data that drives the instruction files. */
	private _cardFingerprint(projectId: string): string {
		const cards = this.projectManager.getKnowledgeCards(projectId);
		const conventions = this.projectManager.getConventions(projectId);
		// Join ids+updated timestamps — changes only when cards/conventions are added, edited, deleted
		const cardSig = cards.map(c => `${c.id}:${c.updated || c.created}`).join(',');
		const convSig = conventions.map(c => `${c.id}:${c.updatedAt || ''}`).join(',');
		return `${projectId}|${cardSig}|${convSig}`;
	}

	/**
	 * Sync all .github/ instruction files for the active project.
	 * No-op when cards and conventions haven't changed since the last write.
	 */
	async syncInstructions(): Promise<void> {
		const project = this.projectManager.getActiveProject();
		if (!project || !project.rootPaths[0]) { return; }

		const fingerprint = this._cardFingerprint(project.id);
		if (fingerprint === this._lastSyncedFingerprint) {
			console.debug('[ContextManager] Instructions sync skipped — no card/convention changes');
			return;
		}

		const rootUri = vscode.Uri.file(project.rootPaths[0]);

		try {
			await this._syncManagedBlock(rootUri, project.id);
			this._lastSyncedFingerprint = fingerprint;
		} catch (err) {
			console.debug('[ContextManager] GitHub instructions sync failed:', err);
		}
	}

	/**
	 * Update the managed block in .github/copilot-instructions.md.
	 * Creates the file if it doesn't exist. Preserves user content outside the block.
	 */
	private async _syncManagedBlock(rootUri: vscode.Uri, projectId: string): Promise<void> {
		const filePath = vscode.Uri.joinPath(rootUri, '.github', 'copilot-instructions.md');

		// Minimal managed block — tool discovery + pinned cards
		const lines: string[] = [MANAGED_BLOCK_START];
		lines.push('');
		lines.push('## Project Knowledge (auto-managed by ContextManager)');
		lines.push('');
		lines.push('If multiple ContextManager projects exist, include `project="Exact Project Name"` (or exact project ID / root path) in LM tool calls.');
		lines.push('');
		lines.push('Use `#ctx` to search, list, and manage all project knowledge:');
		lines.push('- Search: `#ctx query="error handling"` or `#ctx project="ContextManager" query="auth" entityTypes=["convention","workingNote"]`');
		lines.push('- List all: `#ctx mode="list" type="conventions"` (also: `workingNotes`, `toolHints`, `cards`, `queue`)');
		lines.push('- Read card: `#ctx mode="getCard" id="<cardId>"` or `#getCard project="ContextManager" id="<cardId>"`');
		lines.push('- Review queue: `#ctx mode="getQueueItem" id="<candidateId>"`, `#ctx mode="approveQueueItem" id="<candidateId>"`, `#ctx mode="rejectQueueItem" id="<candidateId>"`');
		lines.push('- Distill or clear queue: `#ctx mode="distillQueue"` (optionally with `candidateIds=[...]`) or `#ctx mode="clearQueue"`');
		lines.push('- Learn: `#ctx mode="learn" learnType="convention" project="ContextManager" ...`');

		// Include pinned knowledge cards (user explicitly marked as important)
		const cards = this.projectManager.getKnowledgeCards(projectId);
		const pinnedCards = cards.filter(c => c.pinned && !c.archived && c.includeInContext !== false);
		if (pinnedCards.length > 0) {
			lines.push('');
			lines.push('### Knowledge Cards');
			lines.push('Use `#ctx mode="getCard" id="<id>"` to read full content.');
			for (const card of pinnedCards) {
				lines.push(`- **${card.title}** [${card.category}] — ID: ${card.id}`);
			}
		}

		lines.push('');
		lines.push(MANAGED_BLOCK_END);

		const managedContent = lines.join('\n');

		// Read existing file or create new
		let existingContent = '';
		try {
			const rawBytes = await vscode.workspace.fs.readFile(filePath);
			existingContent = new TextDecoder().decode(rawBytes);
		} catch {
			// File doesn't exist — create with managed block only
			await this._ensureDir(vscode.Uri.joinPath(rootUri, '.github'));
			const encoder = new TextEncoder();
			await vscode.workspace.fs.writeFile(filePath, encoder.encode(managedContent + '\n'));
			return;
		}

		// Replace existing managed block or append
		const startIdx = existingContent.indexOf(MANAGED_BLOCK_START);
		const endIdx = existingContent.indexOf(MANAGED_BLOCK_END);

		let newContent: string;
		if (startIdx !== -1 && endIdx !== -1) {
			// Replace existing block
			newContent = existingContent.substring(0, startIdx)
				+ managedContent
				+ existingContent.substring(endIdx + MANAGED_BLOCK_END.length);
		} else {
			// Append to end
			newContent = existingContent.trimEnd() + '\n\n' + managedContent + '\n';
		}

		const encoder = new TextEncoder();
		await vscode.workspace.fs.writeFile(filePath, encoder.encode(newContent));
	}

	/**
	 * Generate scoped .instructions.md files for architecture knowledge cards.
	 * Each architecture card with relatedFiles gets a scoped instruction file.
	 */
	private async _syncArchitectureInstructions(rootUri: vscode.Uri, projectId: string): Promise<void> {
		const cards = this.projectManager.getKnowledgeCards(projectId);
		const archCards = cards.filter(c =>
			c.category === 'architecture'
			&& !c.archived
			&& c.includeInContext !== false
			&& c.referenceFiles && c.referenceFiles.length > 0
		);

		const instructionsDir = vscode.Uri.joinPath(rootUri, '.github', 'instructions');
		await this._ensureDir(instructionsDir);

		// Track which files we generate so we can clean up stale ones
		const generatedFiles = new Set<string>();
		const encoder = new TextEncoder();

		for (const card of archCards) {
			const safeName = this._slugify(card.title);
			const fileName = `cm-${safeName}.instructions.md`;
			generatedFiles.add(fileName);

			const content = this._buildInstructionFile(card);
			const fileUri = vscode.Uri.joinPath(instructionsDir, fileName);
			await vscode.workspace.fs.writeFile(fileUri, encoder.encode(content));
		}

		// Clean up stale cm-*.instructions.md files
		try {
			const entries = await vscode.workspace.fs.readDirectory(instructionsDir);
			for (const [name, type] of entries) {
				if (type === vscode.FileType.File
					&& name.startsWith('cm-')
					&& name.endsWith('.instructions.md')
					&& !generatedFiles.has(name)
				) {
					await vscode.workspace.fs.delete(vscode.Uri.joinPath(instructionsDir, name));
				}
			}
		} catch { /* directory might not exist yet */ }
	}

	/**
	 * Build the content of a scoped .instructions.md file from an architecture card.
	 */
	private _buildInstructionFile(card: KnowledgeCard): string {
		const lines: string[] = [];

		// Scoping header — VS Code uses applyTo to scope instructions to relevant files
		if (card.referenceFiles && card.referenceFiles.length > 0) {
			const globs = card.referenceFiles.map((f: string) => {
				// Convert file paths to glob patterns
				if (f.includes('*')) { return f; }
				if (f.endsWith('/')) { return f + '**'; }
				// If it's a directory-like path, scope to all files under it
				const parsed = path.parse(f);
				if (!parsed.ext) { return f + '/**'; }
				return f;
			});
			lines.push('---');
			lines.push(`applyTo: "${globs.join(', ')}"`);
			lines.push('---');
			lines.push('');
		}

		lines.push(`# ${card.title}`);
		lines.push('');
		lines.push(`> Auto-generated by ContextManager from knowledge card \`${card.id}\``);
		lines.push('');
		lines.push(card.content);

		// Include anchors as code references
		if (card.anchors && card.anchors.length > 0) {
			lines.push('');
			lines.push('## Key Code Locations');
			for (const anchor of card.anchors) {
				const label = anchor.symbolName
					? `${anchor.filePath} :: ${anchor.symbolName}`
					: anchor.filePath;
				lines.push('');
				lines.push(`### ${label}`);
				lines.push('```');
				lines.push(anchor.stubContent);
				lines.push('```');
			}
		}

		return lines.join('\n') + '\n';
	}

	/**
	 * Ensure the knowledge-retrospect.prompt.md file exists.
	 */
	private async _ensureRetrospectPrompt(rootUri: vscode.Uri): Promise<void> {
		const promptsDir = vscode.Uri.joinPath(rootUri, '.github', 'prompts');
		const promptFile = vscode.Uri.joinPath(promptsDir, 'knowledge-retrospect.prompt.md');

		try {
			await vscode.workspace.fs.stat(promptFile);
			// File exists, don't overwrite
		} catch {
			// Create it
			await this._ensureDir(promptsDir);
			const encoder = new TextEncoder();
			await vscode.workspace.fs.writeFile(promptFile, encoder.encode(RETROSPECT_PROMPT_TEMPLATE));
		}
	}

	/**
	 * Write ~/.contextmanager/knowledge-index.txt for use by the PreCompact hook.
	 * The hook reads this file and injects its contents into Claude's context so that
	 * knowledge card references survive conversation compaction.
	 */
	private async _writeKnowledgeIndex(projectId: string): Promise<void> {
		const cmDirUri = vscode.Uri.file(path.join(os.homedir(), '.contextmanager'));
		const indexUri = vscode.Uri.joinPath(cmDirUri, 'knowledge-index.txt');

		const cards = this.projectManager.getKnowledgeCards(projectId);
		const enabledCards = cards.filter(c => c.includeInContext !== false && !c.archived);

		const lines: string[] = [
			`# ContextManager Knowledge Index`,
			`# Generated: ${new Date().toISOString()}`,
			`# ${enabledCards.length} of ${cards.length} cards included in context`,
			`# Use \`#getCard\` with the card ID to read full content.`,
			``,
		];

		if (enabledCards.length > 0) {
			const pinned = enabledCards.filter(c => c.pinned);
			const unpinned = enabledCards.filter(c => !c.pinned);
			for (const card of [...pinned, ...unpinned]) {
				const pin = card.pinned ? ' [pinned]' : '';
				lines.push(`- **${card.title}** [${card.category}]${pin} — ID: ${card.id}`);
			}
		}


		try {
			await this._ensureDir(cmDirUri);
			const encoder = new TextEncoder();
			await vscode.workspace.fs.writeFile(indexUri, encoder.encode(lines.join('\n')));
		} catch (err) {
			console.debug('[ContextManager] Failed to write knowledge-index.txt:', err);
		}
	}

	private _slugify(text: string): string {
		return text
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.substring(0, 50);
	}

	private async _ensureDir(dirUri: vscode.Uri): Promise<void> {
		try {
			await vscode.workspace.fs.stat(dirUri);
		} catch {
			await vscode.workspace.fs.createDirectory(dirUri);
		}
	}
}
