/**
 * Embeddings-based smart context selection for ContextManager.
 *
 * This module provides on-demand semantic search over knowledge cards using
 * VS Code's proposed `embeddings` API (LanguageModel embedding models).
 *
 * Architecture:
 *  - Card text → Copilot cloud (embedding model) → vector → stored locally in globalState
 *  - User query → Copilot cloud → query vector → cosine similarity (local) → top-K cards
 *
 * Gated behind `contextManager.experimental.enableProposedApi`.
 * Only runs when user explicitly triggers "Smart Select".
 */

import * as vscode from 'vscode';
import { ConfigurationManager } from './config';
import { ProjectManager } from './projects/ProjectManager';
import { KnowledgeCard } from './projects/types';

// ─── Types ──────────────────────────────────────────────────────

interface StoredEmbedding {
	cardId: string;
	vector: number[];
	contentHash: string;   // Hash of card content — recompute if changed
	model: string;         // Which embedding model was used
	timestamp: number;
}

interface EmbeddingStore {
	projectId: string;
	embeddings: StoredEmbedding[];
}

interface SmartSelectResult {
	card: KnowledgeCard;
	score: number;   // Cosine similarity 0–1
}

// ─── Constants ──────────────────────────────────────────────────

const STORAGE_KEY = 'contextManager.embeddings';  // legacy globalState key (migration only)
const EMBEDDINGS_FILE = 'embeddings.json';
const DEFAULT_TOP_K = 5;

// ─── Embedding Manager ─────────────────────────────────────────

export class EmbeddingManager implements vscode.Disposable {
	private stores: Map<string, EmbeddingStore> = new Map();
	private disposables: vscode.Disposable[] = [];

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly projectManager: ProjectManager,
	) {
		this.loadStores();
	}

	// ─── Public API ─────────────────────────────────────────────

	/**
	 * Check if the embeddings API is available at runtime.
	 */
	isAvailable(): boolean {
		try {
			const models = (vscode.lm as any).embeddingModels;
			return Array.isArray(models) && models.length > 0;
		} catch {
			return false;
		}
	}

	/**
	 * Get available embedding model names.
	 */
	getAvailableModels(): string[] {
		try {
			const models = (vscode.lm as any).embeddingModels;
			return Array.isArray(models) ? models : [];
		} catch {
			return [];
		}
	}

	/**
	 * Compute and store embeddings for all knowledge cards in a project.
	 * Skips cards whose content hasn't changed since last embedding.
	 */
	async embedProject(
		projectId: string,
		token?: vscode.CancellationToken,
	): Promise<{ embedded: number; skipped: number; total: number }> {
		const cards = this.projectManager.getKnowledgeCards(projectId);
		if (!cards.length) {
			return { embedded: 0, skipped: 0, total: 0 };
		}

		const model = this.selectModel();
		if (!model) {
			throw new Error('No embedding model available. Ensure GitHub Copilot is active.');
		}

		const store = this.getOrCreateStore(projectId);
		let embedded = 0;
		let skipped = 0;

		// Determine which cards need (re)embedding
		const toEmbed: KnowledgeCard[] = [];
		for (const card of cards) {
			const hash = this.hashContent(card);
			const existing = store.embeddings.find(e => e.cardId === card.id);
			if (existing && existing.contentHash === hash && existing.model === model) {
				skipped++;
			} else {
				toEmbed.push(card);
			}
		}

		if (toEmbed.length === 0) {
			return { embedded: 0, skipped, total: cards.length };
		}

		// Embed in batches of 20
		const BATCH_SIZE = 20;
		for (let i = 0; i < toEmbed.length; i += BATCH_SIZE) {
			if (token?.isCancellationRequested) { break; }

			const batch = toEmbed.slice(i, i + BATCH_SIZE);
			const texts = batch.map(c => this.cardToText(c));

			const embeddings = await (vscode.lm as any).computeEmbeddings(model, texts, token);

			for (let j = 0; j < batch.length; j++) {
				const card = batch[j];
				const embedding: any = Array.isArray(embeddings) ? embeddings[j] : embeddings;
				const vector: number[] = embedding?.values || embedding;

				if (!vector?.length) { continue; }

				// Upsert
				const hash = this.hashContent(card);
				const idx = store.embeddings.findIndex(e => e.cardId === card.id);
				const entry: StoredEmbedding = {
					cardId: card.id,
					vector,
					contentHash: hash,
					model,
					timestamp: Date.now(),
				};

				if (idx >= 0) {
					store.embeddings[idx] = entry;
				} else {
					store.embeddings.push(entry);
				}
				embedded++;
			}
		}

		// Prune embeddings for deleted cards
		const cardIds = new Set(cards.map(c => c.id));
		store.embeddings = store.embeddings.filter(e => cardIds.has(e.cardId));

		await this.saveStores();
		return { embedded, skipped, total: cards.length };
	}

	/**
	 * Smart-select: find the top-K most relevant knowledge cards for a query.
	 * Requires that embeddings have been computed first (calls embedProject if needed).
	 */
	async smartSelect(
		projectId: string,
		query: string,
		topK: number = DEFAULT_TOP_K,
		token?: vscode.CancellationToken,
	): Promise<SmartSelectResult[]> {
		const model = this.selectModel();
		if (!model) {
			throw new Error('No embedding model available.');
		}

		// Ensure cards are embedded
		const store = this.getOrCreateStore(projectId);
		const cards = this.projectManager.getKnowledgeCards(projectId);
		if (!cards.length) { return []; }

		// Auto-embed if needed
		const needsEmbedding = cards.some(c => {
			const hash = this.hashContent(c);
			const existing = store.embeddings.find(e => e.cardId === c.id);
			return !existing || existing.contentHash !== hash || existing.model !== model;
		});

		if (needsEmbedding) {
			await this.embedProject(projectId, token);
		}

		// Compute query embedding
		const queryEmbedding = await (vscode.lm as any).computeEmbeddings(model, query, token);
		const queryVector: number[] = queryEmbedding?.values || queryEmbedding;

		if (!queryVector?.length) {
			throw new Error('Failed to compute query embedding.');
		}

		// Compute cosine similarity for each card
		const results: SmartSelectResult[] = [];
		for (const card of cards) {
			const stored = store.embeddings.find(e => e.cardId === card.id);
			if (!stored) { continue; }

			const score = cosineSimilarity(queryVector, stored.vector);
			results.push({ card, score });
		}

		// Sort by similarity descending, return top-K
		results.sort((a, b) => b.score - a.score);
		return results.slice(0, topK);
	}

	/**
	 * Get embedding stats for a project.
	 */
	getStats(projectId: string): { totalCards: number; embeddedCards: number; model: string | null } {
		const cards = this.projectManager.getKnowledgeCards(projectId);
		const store = this.stores.get(projectId);
		const currentModel = this.selectModel();

		const embeddedCards = store
			? store.embeddings.filter(e => {
				const card = cards.find(c => c.id === e.cardId);
				return card && e.contentHash === this.hashContent(card) && e.model === (currentModel || e.model);
			}).length
			: 0;

		return {
			totalCards: cards.length,
			embeddedCards,
			model: currentModel,
		};
	}

	/**
	 * Clear stored embeddings for a project.
	 */
	async clearEmbeddings(projectId: string): Promise<void> {
		this.stores.delete(projectId);
		await this.saveStores();
	}

	dispose(): void {
		this.disposables.forEach(d => d.dispose());
	}

	// ─── Private ────────────────────────────────────────────────

	private selectModel(): string | null {
		try {
			const models = (vscode.lm as any).embeddingModels;
			if (Array.isArray(models) && models.length > 0) {
				return models[0];
			}
		} catch { /* ignore */ }
		return null;
	}

	private cardToText(card: KnowledgeCard): string {
		const parts = [
			`Title: ${card.title}`,
			`Category: ${card.category}`,
			card.tags.length ? `Tags: ${card.tags.join(', ')}` : '',
			'',
			card.content,
		];
		return parts.filter(p => p !== undefined).join('\n');
	}

	private hashContent(card: KnowledgeCard): string {
		// Simple hash: combine title + content + category + tags
		const str = `${card.title}|${card.category}|${card.tags.join(',')}|${card.content}`;
		let hash = 0;
		for (let i = 0; i < str.length; i++) {
			const chr = str.charCodeAt(i);
			hash = ((hash << 5) - hash) + chr;
			hash |= 0; // Convert to 32-bit integer
		}
		return hash.toString(36);
	}

	private getOrCreateStore(projectId: string): EmbeddingStore {
		let store = this.stores.get(projectId);
		if (!store) {
			store = { projectId, embeddings: [] };
			this.stores.set(projectId, store);
		}
		return store;
	}

	private get _storagePath(): string {
		return this.context.globalStorageUri.fsPath;
	}

	private loadStores(): void {
		try {
			const filePath = require('path').join(this._storagePath, EMBEDDINGS_FILE);
			const fs = require('fs') as typeof import('fs');
			if (fs.existsSync(filePath)) {
				// Load from disk (in-memory Map is the cache)
				const data = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, EmbeddingStore>;
				this.stores = new Map(Object.entries(data));
				return;
			}
			// One-time migration from globalState → disk
			const legacy = this.context.globalState.get<Record<string, EmbeddingStore>>(STORAGE_KEY, {});
			this.stores = new Map(Object.entries(legacy));
			if (Object.keys(legacy).length > 0) {
				this._flushToDisk();
				this.context.globalState.update(STORAGE_KEY, undefined);
			}
		} catch {
			this.stores = new Map();
		}
	}

	private _flushToDisk(): void {
		try {
			const fs = require('fs') as typeof import('fs');
			const storagePath = this._storagePath;
			if (!fs.existsSync(storagePath)) { fs.mkdirSync(storagePath, { recursive: true }); }
			const data: Record<string, EmbeddingStore> = {};
			for (const [key, val] of this.stores) { data[key] = val; }
			fs.writeFileSync(require('path').join(storagePath, EMBEDDINGS_FILE), JSON.stringify(data), 'utf8');
		} catch (err) {
			console.error('[EmbeddingManager] Failed to flush to disk:', err);
		}
	}

	private async saveStores(): Promise<void> {
		// Memory (this.stores) is the cache — just flush to disk
		this._flushToDisk();
	}
}

// ─── Math ───────────────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
	if (a.length !== b.length || a.length === 0) { return 0; }

	let dot = 0;
	let normA = 0;
	let normB = 0;

	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}

	const denominator = Math.sqrt(normA) * Math.sqrt(normB);
	return denominator === 0 ? 0 : dot / denominator;
}

// ─── Smart Select Command ───────────────────────────────────────

/**
 * Register the "Smart Select" command that lets users type a query
 * and auto-selects the most relevant knowledge cards.
 */
export function registerEmbeddingCommands(
	context: vscode.ExtensionContext,
	embeddingManager: EmbeddingManager,
	projectManager: ProjectManager,
): void {
	// Smart Select: query → find relevant cards → select them
	context.subscriptions.push(
		vscode.commands.registerCommand('contextManager.smartSelect', async () => {
			if (!embeddingManager.isAvailable()) {
				vscode.window.showWarningMessage(
					'Embedding models not available. Ensure GitHub Copilot is active and you\'re on VS Code Insiders.'
				);
				return;
			}

			const activeProject = projectManager.getActiveProject();
			if (!activeProject) {
				vscode.window.showWarningMessage('No active project. Create or select a project first.');
				return;
			}

			const cards = projectManager.getKnowledgeCards(activeProject.id);
			if (cards.length === 0) {
				vscode.window.showInformationMessage('No knowledge cards to search. Create some cards first.');
				return;
			}

			// Get the query from user
			const query = await vscode.window.showInputBox({
				title: 'Smart Select — Semantic Search',
				prompt: 'Describe what you\'re working on. The most relevant knowledge cards will be auto-selected.',
				placeHolder: 'e.g., authentication flow, database schema, error handling patterns...',
			});

			if (!query?.trim()) { return; }

			// Get top-K preference
			const maxCards = ConfigurationManager.maxKnowledgeCardsInContext;

			await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: 'Smart Select',
				cancellable: true,
			}, async (progress, token) => {
				progress.report({ message: 'Computing embeddings...' });

				try {
					const results = await embeddingManager.smartSelect(
						activeProject.id,
						query!.trim(),
						maxCards,
						token,
					);

					if (token.isCancellationRequested) { return; }

					if (results.length === 0) {
						vscode.window.showInformationMessage('No relevant cards found.');
						return;
					}

					// Show results and let user confirm
					const picks = results.map(r => ({
						label: `$(note) ${r.card.title}`,
						description: `${(r.score * 100).toFixed(0)}% match · ${r.card.category}`,
						detail: r.card.content.substring(0, 120).replace(/\n/g, ' ') + '...',
						picked: true,
						cardId: r.card.id,
					}));

					const selected = await vscode.window.showQuickPick(picks, {
						title: `Smart Select: ${results.length} relevant cards for "${query!.substring(0, 40)}..."`,
						placeHolder: 'Uncheck any cards you don\'t want selected',
						canPickMany: true,
					});

					if (!selected?.length) { return; }

					// Apply selection
					const selectedIds = selected.map(s => (s as any).cardId);
					await projectManager.setCardSelection(activeProject.id, selectedIds);

					vscode.window.showInformationMessage(
						`Selected ${selectedIds.length} knowledge card(s) based on: "${query!.substring(0, 50)}"`,
					);
				} catch (err: any) {
					vscode.window.showErrorMessage(`Smart Select failed: ${err.message}`);
				}
			});
		}),
	);

	// Embed Project: pre-compute embeddings for faster smart-select
	context.subscriptions.push(
		vscode.commands.registerCommand('contextManager.embedProject', async () => {
			if (!embeddingManager.isAvailable()) {
				vscode.window.showWarningMessage(
					'Embedding models not available. Ensure GitHub Copilot is active and you\'re on VS Code Insiders.'
				);
				return;
			}

			const activeProject = projectManager.getActiveProject();
			if (!activeProject) {
				vscode.window.showWarningMessage('No active project.');
				return;
			}

			await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: 'Embedding Knowledge Cards',
				cancellable: true,
			}, async (progress, token) => {
				const cards = projectManager.getKnowledgeCards(activeProject.id);
				progress.report({ message: `Processing ${cards.length} cards...` });

				try {
					const result = await embeddingManager.embedProject(activeProject.id, token);
					if (!token.isCancellationRequested) {
						vscode.window.showInformationMessage(
							`Embedded ${result.embedded} cards (${result.skipped} up-to-date, ${result.total} total).`
						);
					}
				} catch (err: any) {
					vscode.window.showErrorMessage(`Embedding failed: ${err.message}`);
				}
			});
		}),
	);

	// Clear embeddings
	context.subscriptions.push(
		vscode.commands.registerCommand('contextManager.clearEmbeddings', async () => {
			const activeProject = projectManager.getActiveProject();
			if (!activeProject) {
				vscode.window.showWarningMessage('No active project.');
				return;
			}

			await embeddingManager.clearEmbeddings(activeProject.id);
			vscode.window.showInformationMessage('Embeddings cleared for current project.');
		}),
	);
}
