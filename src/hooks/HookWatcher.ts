/**
 * HookWatcher — listens for captures written by VS Code agent hook scripts.
 *
 * Architecture:
 *   Hook scripts (capture.ps1 / capture.sh) run as VS Code agent hooks and
 *   append JSON-lines to ~/.contextmanager/hook-queue.jsonl.
 *   This service watches that file and ingests new entries into AutoCaptureService.
 *
 *   The capture script reads ~/.contextmanager/session-context.txt on every
 *   UserPromptSubmit hook and injects it as a systemMessage — so we write
 *   that file here whenever the active project or prompt injection config changes.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { AutoCaptureService } from '../autoCapture';
import type { ProjectManager } from '../projects/ProjectManager';
import type { KnowledgeCard } from '../projects/types';
import { ConfigurationManager } from '../config';
import type { WorkflowEngine } from '../workflows/WorkflowEngine';

// ── Paths ──────────────────────────────────────────────────────
export const CM_DIR         = path.join(os.homedir(), '.contextmanager');
export const QUEUE_FILE     = path.join(CM_DIR, 'hook-queue.jsonl');
export const SESSION_CTX    = path.join(CM_DIR, 'session-context.txt');
export const OFFSET_FILE    = path.join(CM_DIR, '.queue-offset');
export const SCRIPTS_DIR    = path.join(CM_DIR, 'scripts');

export interface HookEntry {
	hookType: string;
	timestamp: number;
	sessionId?: string;
	participant?: string;
	prompt?: string;
	response?: string;
	toolName?: string;
	toolInput?: unknown;
	toolResponse?: string;
	/** Tool calls captured from the transcript (VS Code Copilot path) */
	toolCalls?: Array<{ toolName: string; input: string; output: string }>;
	/** Multi-turn array for PreCompact v2 entries */
	turns?: Array<{ user: string; assistant: string }>;
}

export class HookWatcher implements vscode.Disposable {
	private watcher: fs.FSWatcher | undefined;
	private debounceTimer: NodeJS.Timeout | undefined;
	private lastOffset = 0;
	private readonly _statusEmitter = new vscode.EventEmitter<string>();
	readonly onStatusChange = this._statusEmitter.event;
	private _workflowEngine: WorkflowEngine;

	constructor(
		private autoCapture: AutoCaptureService,
		private projectManager: ProjectManager,
		workflowEngine: WorkflowEngine,
	) {
		this._workflowEngine = workflowEngine;
		this._ensureDir();
		this._loadOffset();
		this._startWatching();
		this._syncSessionContext();

		// Re-write session-context.txt when project changes
		projectManager.onDidChangeActiveProject(() => this._syncSessionContext());
		projectManager.onDidChangeProjects(() => this._syncSessionContext());
	}

	// ── Public ─────────────────────────────────────────────────

	/** Manually update the session context file (e.g. after session-continuity builds context). */
	updateSessionContext(text: string): void {
		try {
			this._ensureDir();
			fs.writeFileSync(SESSION_CTX, text, 'utf8');
		} catch (err) {
			console.warn('[HookWatcher] Failed to write session context:', err);
		}
	}

	/** Return status info for dashboard display. */
	getStatus(): { watching: boolean; queueFile: string; scriptsDir: string; lastOffset: number } {
		return {
			watching: !!this.watcher,
			queueFile: QUEUE_FILE,
			scriptsDir: SCRIPTS_DIR,
			lastOffset: this.lastOffset,
		};
	}

	dispose(): void {
		if (this.debounceTimer) { clearTimeout(this.debounceTimer); }
		if (this.watcher) { try { this.watcher.close(); } catch {} }
		this._statusEmitter.dispose();
	}

	// ── Private ────────────────────────────────────────────────

	private _ensureDir(): void {
		try { fs.mkdirSync(CM_DIR, { recursive: true }); } catch {}
	}

	private _loadOffset(): void {
		try {
			const raw = fs.readFileSync(OFFSET_FILE, 'utf8').trim();
			this.lastOffset = Math.max(0, parseInt(raw, 10) || 0);
			// Safety: if offset exceeds file size, snap to end (don't reprocess)
			try {
				const fileSize = fs.statSync(QUEUE_FILE).size;
				if (this.lastOffset > fileSize) {
					console.log(`[HookWatcher] Offset ${this.lastOffset} > file size ${fileSize}, snapping to end`);
					this.lastOffset = fileSize;
					this._saveOffset();
				}
			} catch { /* queue file may not exist yet */ }
		} catch {
			// No offset file — snap to end of queue file to avoid reprocessing history
			try {
				this.lastOffset = fs.statSync(QUEUE_FILE).size;
				this._saveOffset();
				console.log(`[HookWatcher] No offset file, starting at end: ${this.lastOffset}`);
			} catch {
				this.lastOffset = 0;
			}
		}
	}

	private _saveOffset(): void {
		try { fs.writeFileSync(OFFSET_FILE, String(this.lastOffset)); } catch {}
	}

	private _startWatching(): void {
		// Process any backlog immediately
		this._processQueue();

		try {
			// Ensure queue file exists
			if (!fs.existsSync(QUEUE_FILE)) {
				fs.writeFileSync(QUEUE_FILE, '');
			}
			this.watcher = fs.watch(QUEUE_FILE, () => {
				if (this.debounceTimer) { clearTimeout(this.debounceTimer); }
				this.debounceTimer = setTimeout(() => this._processQueue(), 400);
			});
			console.log('[HookWatcher] Watching', QUEUE_FILE);
		} catch (err) {
			console.warn('[HookWatcher] Could not watch queue file:', err);
		}
	}

	private _processQueue(): void {
		try {
			// Read as Buffer so byte-based offset slicing is correct
			// (String.slice uses char offset which diverges from byte offset on multi-byte chars)
			const rawBuf = fs.readFileSync(QUEUE_FILE);
			if (this.lastOffset >= rawBuf.length) { return; }
			const newBuf = rawBuf.slice(this.lastOffset);
			const newContent = newBuf.toString('utf8');
			if (!newContent.trim()) { return; }

			const lines = newContent.split('\n').filter(l => l.trim());
			console.log(`[HookWatcher:DEBUG] _processQueue \u2014 ${lines.length} new line(s) at offset ${this.lastOffset}/${rawBuf.length}`);
			for (const line of lines) {
				try {
					const entry = JSON.parse(line) as HookEntry;
					this._processEntry(entry).catch(e =>
						console.warn('[HookWatcher] processEntry error:', e));
				} catch { /* malformed line — skip */ }
			}

			this.lastOffset += newBuf.length;
			this._saveOffset();
			this._statusEmitter.fire('processed');
		} catch { /* queue file may not exist yet */ }
	}

	private async _processEntry(entry: HookEntry): Promise<void> {
		const { hookType, prompt = '', response = '', toolName = '', participant = 'copilot' } = entry;
		const cfg = vscode.workspace.getConfiguration('contextManager');

		console.log(`[HookWatcher:DEBUG] _processEntry hookType=${hookType} participant=${participant} promptLen=${prompt.length} responseLen=${response.length}`);
		switch (hookType) {
			case 'Stop': {
				const stopEnabled = cfg.get('hooks.stop', true);
				console.log(`[HookWatcher:DEBUG] Stop entry — hooks.stop=${stopEnabled} hasPrompt=${!!prompt} hasResponse=${!!response} toolCalls=${(entry.toolCalls || []).length}`);
				if (!stopEnabled) { return; }
				if (!prompt && !response) { return; }
				await this.autoCapture.onModelResponse(prompt, response, `hook:${participant}`);
				// Also queue for card distillation (with tool call evidence)
				this._queueCardCandidate(prompt, response, participant, entry.toolCalls).catch(() => {});
				break;
			}

			case 'PreCompact': {
				if (!cfg.get('hooks.preCompact', true)) { return; }

				// Multi-turn v2 path: entry.turns array present
				if (Array.isArray(entry.turns) && entry.turns.length > 0) {
					// Store one synthetic observation summarizing the batch
					const firstUser = entry.turns[0]?.user || '';
					await this.autoCapture.onModelResponse(
						firstUser.substring(0, 300),
						`[PreCompact multi-turn: ${entry.turns.length} turns processed]`,
						'hook:compact',
					);

					// Route to iterative multi-turn extraction
					const activeProject = this.projectManager.getActiveProject();
					if (activeProject) {
						this.autoCapture.extractMultiTurnLearnings(entry.turns, activeProject.id).catch(e =>
							console.warn('[HookWatcher] multi-turn extraction error:', e));

						// Fire-and-forget auto-distill at compaction checkpoint
						this.autoCapture.distillAndSaveBackground(activeProject.id).catch(() => {});
					}
				} else {
					// Legacy single-turn path
					if (!prompt && !response) { return; }
					await this.autoCapture.onModelResponse(prompt, response, 'hook:compact');

					// Fire-and-forget auto-distill
					const activeProject = this.projectManager.getActiveProject();
					if (activeProject) {
						this.autoCapture.distillAndSaveBackground(activeProject.id).catch(() => {});
					}
				}
				break;
			}

			case 'PostToolUse': {
				if (!cfg.get('hooks.postToolUse', true)) { return; }
				if (!toolName) { return; }
				// toolInput arrives as a JSON string from the capture script — parse it
				let inp: Record<string, unknown> | undefined;
				try {
					const raw = entry.toolInput;
					inp = typeof raw === 'string' ? JSON.parse(raw) : (raw as Record<string, unknown>);
				} catch { inp = undefined; }
				// Extract the most meaningful identifier from the tool input for display
				const detail = inp
					? (inp.filePath ?? inp.path ?? inp.query ?? inp.command ?? inp.symbolName ?? inp.pattern ?? inp.text ?? inp.url ?? inp.dirPath ?? '')
					: '';
				const detailStr = typeof detail === 'string' ? detail : JSON.stringify(detail);
				const displayPrompt = detailStr
					? `[${toolName}] ${detailStr.substring(0, 120)}`
					: `[tool call: ${toolName}]`;
				const inputStr = inp ? JSON.stringify(inp).substring(0, 400) : '';
				const responseStr = (entry.toolResponse || '').substring(0, 500);
				const summary = [
					`Tool: ${toolName}`,
					inputStr ? `Input: ${inputStr}` : '',
					responseStr ? `Result: ${responseStr}` : '',
				].filter(Boolean).join('\n');
				await this.autoCapture.onModelResponse(displayPrompt, summary, `hook:tool`);
				break;
			}

			default:
				break;
		}
	}

	/** Queue a response as a card candidate for later distillation. */
	/** Light cleanup of tool calls — drop broken/empty entries, cap oversized fields,
	 *  let the AI decide what's actually useful during synthesis. */
	private _filterToolCalls(
		toolCalls: Array<{ toolName: string; input: string; output: string }>,
	): Array<{ toolName: string; input: string; output: string }> {
		const MAX_INPUT = 2000;
		const MAX_OUTPUT = 4000;
		return toolCalls
			.filter(tc => {
				if (!tc.toolName) { return false; }
				if (!tc.input || tc.input === '{}' || tc.input === '""') { return false; }
				return true;
			})
			.map(tc => ({
				toolName: tc.toolName,
				input: tc.input && tc.input.length > MAX_INPUT ? tc.input.substring(0, MAX_INPUT) + '…[truncated]' : (tc.input || ''),
				output: tc.output && tc.output.length > MAX_OUTPUT ? tc.output.substring(0, MAX_OUTPUT) + '…[truncated]' : (tc.output || ''),
			}));
	}

	private async _queueCardCandidate(
		prompt: string,
		response: string,
		participant: string,
		toolCalls?: Array<{ toolName: string; input: string; output: string }>,
	): Promise<void> {
		console.log(`[HookWatcher/CardQueue:DEBUG] _queueCardCandidate — participant=${participant} responseLen=${response.length} toolCalls=${(toolCalls || []).length} enabled=${ConfigurationManager.cardQueueEnabled} minLen=${ConfigurationManager.cardQueueMinResponseLength}`);
		if (!ConfigurationManager.cardQueueEnabled) {
			console.log('[HookWatcher/CardQueue:DEBUG] SKIP — cardQueue disabled');
			return;
		}
		if (participant === 'contextManager') {
			console.log('[HookWatcher/CardQueue:DEBUG] SKIP — participant is contextManager');
			return;
		}
		if (response.length < ConfigurationManager.cardQueueMinResponseLength) {
			console.log(`[HookWatcher/CardQueue:DEBUG] SKIP — response too short: ${response.length} < ${ConfigurationManager.cardQueueMinResponseLength}`);
			return;
		}

		const project = this.projectManager.getActiveProject();
		if (!project) { return; }

		try {
			const { createQueuedCard } = await import('../projects/types.js');
			const rawTitle = prompt.trim().replace(/\s+/g, ' ');
			const suggestedTitle = rawTitle.length > 80
				? rawTitle.substring(0, 77) + '...'
				: rawTitle || 'Untitled';

			// Filter tool calls — keep only useful evidence for card synthesis
			const filtered = toolCalls ? this._filterToolCalls(toolCalls) : [];
			console.log(`[HookWatcher/CardQueue:DEBUG] toolCalls: ${(toolCalls || []).length} raw → ${filtered.length} after filter`);

			const candidate = createQueuedCard(
				prompt,
				response,
				participant,
				suggestedTitle,
				'note',
				response,
				'',
				1.0,
				filtered.length > 0 ? filtered : undefined,
			);

			await this.projectManager.addToCardQueue(project.id, candidate);
			console.log(`[HookWatcher/CardQueue] Queued: "${suggestedTitle}" (${response.length} chars, ${filtered.length} tool calls)`);

			// Fire auto-queue workflows (fire-and-forget)
			this._workflowEngine.fireAutoQueue(project.id, candidate).catch(err =>
				console.warn('[HookWatcher/Workflow] Auto-queue workflow error:', err)
			);
		} catch (err) {
			console.warn('[HookWatcher/CardQueue] Error queuing candidate:', err);
		}
	}

	/** Write the current project's intelligence/session context so the SessionStart hook can inject it. */
	private _syncSessionContext(): void {
		const project = this.projectManager.getActiveProject();
		if (!project) {
			try { fs.writeFileSync(SESSION_CTX, ''); } catch {}
			return;
		}

		// Minimal: project identification only.
		// Intelligence is delivered via copilot-instructions.md managed block and #ctx tool.
		const lines: string[] = [
			`[ContextManager — Project: ${project.name}]`,
			`Root: ${project.rootPaths?.[0] || 'unknown'}`,
		];

		// Prompt injection: Knowledge-tab-selected cards + custom instruction
		const injection = project.promptInjection;
		const selectedCardIds = project.selectedCardIds || [];
		const hasCustomInstruction = !!(injection?.customInstruction?.trim());
		const includeFullContent = injection?.includeFullContent ?? false;

		if (selectedCardIds.length > 0 || hasCustomInstruction) {
			lines.push('');
			lines.push('## Injected Context for This Session');

			if (hasCustomInstruction) {
				lines.push('');
				lines.push(injection!.customInstruction.trim());
			}

			if (selectedCardIds.length > 0) {
				const allCards = this.projectManager.getKnowledgeCards(project.id);
				const injectedCards = selectedCardIds
					.map(id => allCards.find((c: KnowledgeCard) => c.id === id))
					.filter((c): c is KnowledgeCard => !!c && !c.archived);

				if (injectedCards.length > 0) {
					lines.push('');
					if (includeFullContent) {
						for (const card of injectedCards) {
							lines.push(`### ${card.title} [${card.category}] — ID: ${card.id}`);
							lines.push('');
							lines.push(card.content);
							lines.push('');
						}
					} else {
						lines.push('Knowledge cards available for this session:');
						for (const card of injectedCards) {
							lines.push(`- **${card.title}** [${card.category}] — ID: \`${card.id}\``);
						}
					}
				}
			}
		}

		this.updateSessionContext(lines.join('\n'));
	}
}
