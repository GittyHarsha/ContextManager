/**
 * File-based sync for knowledge cards — git-tracked `.contextmanager/` directory.
 * Also handles markdown directory import.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { ProjectManager } from './projects/ProjectManager';
import { KnowledgeCard, KnowledgeFolder } from './projects/types';

// ─── Constants ──────────────────────────────────────────────────

const SYNC_DIR = '.contextmanager';
const CARDS_DIR = 'cards';
const META_FILE = '_meta.json';

// ─── Card ↔ Markdown Serialization ─────────────────────────────

function cardToMarkdown(card: KnowledgeCard, folderPath?: string): string {
	const frontmatter: Record<string, unknown> = {
		id: card.id,
		category: card.category,
		tags: card.tags?.length ? card.tags : undefined,
		created: new Date(card.created).toISOString(),
		updated: new Date(card.updated).toISOString(),
		source: card.source || undefined,
		folder: folderPath || undefined,
		trackToolUsage: card.trackToolUsage || undefined,
	};

	// Remove undefined keys
	const cleanFrontmatter = Object.fromEntries(
		Object.entries(frontmatter).filter(([, v]) => v !== undefined)
	);

	const yaml = Object.entries(cleanFrontmatter)
		.map(([k, v]) => {
			if (Array.isArray(v)) {
				return `${k}:\n${v.map(item => `  - ${item}`).join('\n')}`;
			}
			return `${k}: ${typeof v === 'string' && v.includes(':') ? `"${v}"` : v}`;
		})
		.join('\n');

	return `---\n${yaml}\n---\n\n# ${card.title}\n\n${card.content}\n`;
}

function markdownToCard(content: string, filename: string): Partial<KnowledgeCard> & { folder?: string } {
	const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
	const meta: Record<string, string | string[]> = {};

	if (frontmatterMatch) {
		const lines = frontmatterMatch[1].split('\n');
		let currentKey = '';
		for (const line of lines) {
			const kv = line.match(/^(\w+):\s*(.*)$/);
			if (kv) {
				currentKey = kv[1];
				const value = kv[2].trim().replace(/^"(.*)"$/, '$1');
				meta[currentKey] = value;
			} else if (line.match(/^\s+-\s+(.+)$/) && currentKey) {
				const item = line.match(/^\s+-\s+(.+)$/)?.[1] || '';
				if (!Array.isArray(meta[currentKey])) {
					meta[currentKey] = [];
				}
				(meta[currentKey] as string[]).push(item);
			}
		}
	}

	// Extract body after frontmatter
	const body = content.replace(/^---\n[\s\S]*?\n---\n/, '').trim();

	// Extract title from first H1 or use filename
	const titleMatch = body.match(/^#\s+(.+)$/m);
	const title = titleMatch?.[1]?.trim() || filename.replace(/\.md$/, '');
	const bodyContent = titleMatch
		? body.replace(/^#\s+.+\n*/, '').trim()
		: body;

	const validCategories = ['architecture', 'pattern', 'convention', 'explanation', 'note', 'other'];
	const category = validCategories.includes(meta.category as string)
		? meta.category as KnowledgeCard['category']
		: 'note';

	return {
		id: meta.id as string || undefined,
		title,
		content: bodyContent,
		category,
		tags: Array.isArray(meta.tags) ? meta.tags : (meta.tags as string)?.split(',').map(t => t.trim()).filter(Boolean) || [],
		source: meta.source as string || undefined,
		created: meta.created ? new Date(meta.created as string).getTime() : Date.now(),
		updated: meta.updated ? new Date(meta.updated as string).getTime() : Date.now(),
		trackToolUsage: meta.trackToolUsage === 'true',
		folder: meta.folder as string || undefined,
	};
}

// ─── Export to .contextmanager/ ─────────────────────────────────

export async function exportCardsToFilesystem(
	projectManager: ProjectManager,
	projectId: string,
): Promise<{ exported: number; dir: string } | undefined> {
	const project = projectManager.getProject(projectId);
	if (!project) { return undefined; }

	const rootPath = project.rootPaths?.[0];
	if (!rootPath) {
		vscode.window.showWarningMessage('Project has no root path. Cannot export to filesystem.');
		return undefined;
	}

	const baseDir = path.join(rootPath, SYNC_DIR, CARDS_DIR);
	const baseDirUri = vscode.Uri.file(baseDir);

	// Create directory structure
	await vscode.workspace.fs.createDirectory(baseDirUri);

	const folders = projectManager.getKnowledgeFolders(projectId);
	const folderById = new Map(folders.map(f => [f.id, f]));

	// Build folder paths
	const getFolderPath = (folderId?: string): string => {
		if (!folderId) { return ''; }
		const names: string[] = [];
		let current = folderById.get(folderId);
		while (current) {
			names.unshift(current.name);
			if (!current.parentFolderId || !folderById.has(current.parentFolderId)) { break; }
			current = folderById.get(current.parentFolderId);
		}
		return names.join('/');
	};

	// Create folder directories
	const createdDirs = new Set<string>();
	for (const folder of folders) {
		const folderPath = getFolderPath(folder.id);
		if (folderPath && !createdDirs.has(folderPath)) {
			await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.join(baseDir, folderPath)));
			createdDirs.add(folderPath);
		}
	}

	// Write cards
	const cards = projectManager.getKnowledgeCards(projectId);
	let exported = 0;

	for (const card of cards) {
		const folderPath = getFolderPath(card.folderId);
		const safeTitle = card.title.replace(/[^a-zA-Z0-9_\-\s]/g, '').replace(/\s+/g, '-').substring(0, 80).toLowerCase();
		const filename = `${safeTitle}.md`;
		const filePath = folderPath
			? path.join(baseDir, folderPath, filename)
			: path.join(baseDir, filename);

		const markdown = cardToMarkdown(card, folderPath || undefined);
		await vscode.workspace.fs.writeFile(vscode.Uri.file(filePath), Buffer.from(markdown, 'utf-8'));
		exported++;
	}

	// Write metadata file with folder structure
	const metaData = {
		projectId: project.id,
		projectName: project.name,
		exportedAt: new Date().toISOString(),
		folders: folders.map(f => ({
			id: f.id,
			name: f.name,
			parentFolderId: f.parentFolderId,
		})),
		cardCount: cards.length,
	};
	await vscode.workspace.fs.writeFile(
		vscode.Uri.file(path.join(baseDir, META_FILE)),
		Buffer.from(JSON.stringify(metaData, null, 2), 'utf-8'),
	);

	return { exported, dir: baseDir };
}

// ─── Import from markdown directory ─────────────────────────────

export async function importCardsFromDirectory(
	projectManager: ProjectManager,
	projectId: string,
	dirUri?: vscode.Uri,
): Promise<{ imported: number; skipped: number } | undefined> {
	if (!dirUri) {
		const uris = await vscode.window.showOpenDialog({
			canSelectFiles: false,
			canSelectFolders: true,
			canSelectMany: false,
			title: 'Select folder containing markdown files to import as knowledge cards',
		});
		if (!uris || uris.length === 0) { return undefined; }
		dirUri = uris[0];
	}

	// Recursively find all .md files
	const mdFiles = await findMarkdownFiles(dirUri);
	if (mdFiles.length === 0) {
		vscode.window.showInformationMessage('No .md files found in the selected directory.');
		return { imported: 0, skipped: 0 };
	}

	const existingCards = projectManager.getKnowledgeCards(projectId);
	const existingTitles = new Set(existingCards.map(c => c.title.toLowerCase()));

	let imported = 0;
	let skipped = 0;

	for (const fileUri of mdFiles) {
		try {
			const raw = Buffer.from(await vscode.workspace.fs.readFile(fileUri)).toString('utf-8');
			const filename = path.basename(fileUri.fsPath);

			// Skip metadata files
			if (filename === META_FILE || filename.startsWith('_')) { continue; }

			const parsed = markdownToCard(raw, filename);
			if (!parsed.title || !parsed.content) { skipped++; continue; }

			// Skip duplicates by title
			if (existingTitles.has(parsed.title.toLowerCase())) {
				skipped++;
				continue;
			}

			// Try to auto-assign folder
			const folderId = parsed.folder
				? await ensureFolderPath(projectManager, projectId, parsed.folder)
				: projectManager.findBestFolder(projectId, parsed.title, parsed.category || 'note', parsed.tags || []);

			await projectManager.addKnowledgeCard(
				projectId,
				parsed.title,
				parsed.content,
				parsed.category || 'note',
				parsed.tags || [],
				parsed.source,
				undefined,
				folderId,
				parsed.trackToolUsage,
			);

			existingTitles.add(parsed.title.toLowerCase());
			imported++;
		} catch {
			skipped++;
		}
	}

	return { imported, skipped };
}

async function findMarkdownFiles(dirUri: vscode.Uri): Promise<vscode.Uri[]> {
	const results: vscode.Uri[] = [];
	try {
		const entries = await vscode.workspace.fs.readDirectory(dirUri);
		for (const [name, type] of entries) {
			const childUri = vscode.Uri.joinPath(dirUri, name);
			if (type === vscode.FileType.File && name.endsWith('.md') && !name.startsWith('_')) {
				results.push(childUri);
			} else if (type === vscode.FileType.Directory && !name.startsWith('.')) {
				results.push(...await findMarkdownFiles(childUri));
			}
		}
	} catch { /* ignore unreadable dirs */ }
	return results;
}

async function ensureFolderPath(
	projectManager: ProjectManager,
	projectId: string,
	folderPath: string,
): Promise<string | undefined> {
	const segments = folderPath.split('/').filter(Boolean);
	if (segments.length === 0) { return undefined; }

	let parentId: string | undefined;
	for (const segment of segments) {
		const folders = projectManager.getKnowledgeFolders(projectId);
		const existing = folders.find(f =>
			f.name.toLowerCase() === segment.toLowerCase() &&
			(f.parentFolderId || '') === (parentId || '')
		);
		if (existing) {
			parentId = existing.id;
		} else {
			const created = await projectManager.addKnowledgeFolder(projectId, segment, parentId);
			parentId = created?.id;
		}
	}

	return parentId;
}


