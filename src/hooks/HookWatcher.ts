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
import { AgentRegistry } from '../orchestrator/AgentRegistry';
import { MessageBus } from '../orchestrator/MessageBus';
import { ContextSync } from '../orchestrator/ContextSync';
import type { ProjectManager } from '../projects/ProjectManager';
import type { HookEventType, HookWriteIntent, KnowledgeCard, SessionOrigin } from '../projects/types';
import { ConfigurationManager } from '../config';
import type { WorkflowEngine } from '../workflows/WorkflowEngine';

// ── Paths ──────────────────────────────────────────────────────
export const CM_DIR         = path.join(os.homedir(), '.contextmanager');
export const QUEUE_FILE     = path.join(CM_DIR, 'hook-queue.jsonl');
export const SESSION_CTX    = path.join(CM_DIR, 'session-context.txt');
export const OFFSET_FILE    = path.join(CM_DIR, '.queue-offset');
export const SCRIPTS_DIR    = path.join(CM_DIR, 'scripts');

export interface HookEntry {
	hookType: HookEventType | string;
	timestamp: number;
	sessionId?: string;
	origin?: SessionOrigin;
	sequence?: number;
	participant?: string;
	prompt?: string;
	response?: string;
	cwd?: string;
	rootHint?: string;
	projectIdHint?: string;
	toolName?: string;
	toolInput?: unknown;
	toolResponse?: string;
	toolResultType?: 'success' | 'failure' | 'denied';
	reason?: string;
	error?: { message?: string; name?: string; stack?: string };
	writeIntent?: HookWriteIntent;
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

	// ── Orchestrator primitives ──
	readonly registry: AgentRegistry;
	readonly bus: MessageBus;
	readonly contextSync: ContextSync;

	constructor(
		private autoCapture: AutoCaptureService,
		private projectManager: ProjectManager,
		workflowEngine: WorkflowEngine,
	) {
		this._workflowEngine = workflowEngine;

		// Initialize orchestrator primitives
		this.registry = new AgentRegistry();
		this.bus = new MessageBus();
		this.contextSync = new ContextSync(this.registry, this.bus);

		this._ensureDir();
		this._loadOffset();
		this._startWatching();
		this._syncSessionContext();

		// Re-write session-context.txt when project changes
		projectManager.onDidChangeActiveProject(() => this._syncSessionContext());
		projectManager.onDidChangeProjects(() => this._syncSessionContext());

		// Re-sync when the injection toggle changes
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('contextManager.hooks.sessionStart')
				|| e.affectsConfiguration('contextManager.orchestrator')) {
				this._syncSessionContext();
			}
		});
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

	async bindPendingSessionToProject(sessionId: string, projectId: string): Promise<{ backfilled: number }> {
		const pending = this.projectManager.getPendingHookEvents(sessionId)
			.filter(event => event.status === 'pending')
			.sort((left, right) => left.sequence - right.sequence);
		const startSequence = pending[0]?.sequence;
		const session = await this.projectManager.bindSessionToProject(sessionId, projectId, { startSequence, reason: 'initial-bind' });
		if (!session) {
			return { backfilled: 0 };
		}

		let backfilled = 0;
		let lastSequence = 0;
		for (const event of pending) {
			await this._materializePendingHookEvent(event.eventType, event.payload, projectId);
			backfilled += 1;
			lastSequence = event.sequence;
		}

		if (backfilled > 0) {
			await this.projectManager.markPendingHookEventsBackfilled(sessionId, lastSequence);
		}

		return { backfilled };
	}

	async rebindSessionToProjectFromNow(sessionId: string, projectId: string): Promise<void> {
		await this.projectManager.bindSessionToProject(sessionId, projectId, { reason: 'rebind' });
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
		const origin = entry.origin || 'vscode-extension';

		// Skip PostToolUse entirely when disabled — avoids session churn + observations on every tool call
		if (hookType === 'PostToolUse' && !cfg.get('hooks.postToolUse', false)) { return; }

		// ── Orchestrator: heartbeat on every event ──
		const orchestratorEnabled = cfg.get<boolean>('orchestrator.enabled', true);
		if (orchestratorEnabled && entry.sessionId) {
			this.registry.heartbeat(entry.sessionId);
		}

		if (entry.sessionId && cfg.get<boolean>('sessionTracking.enabled', true)) {
			await this.projectManager.ensureTrackedSession(entry.sessionId, {
				origin,
				label: prompt?.trim() ? prompt.trim().replace(/\s+/g, ' ').slice(0, 60) : undefined,
				firstPromptSnippet: prompt?.trim() ? prompt.trim().replace(/\s+/g, ' ').slice(0, 160) : undefined,
				rootHint: entry.rootHint,
				cwd: entry.cwd,
				lastActivityAt: entry.timestamp,
				metadata: {
					lastHookType: hookType,
					participant,
				},
			}).catch(err => console.warn('[HookWatcher] ensureTrackedSession error:', err));
		}

		console.log(`[HookWatcher:DEBUG] _processEntry hookType=${hookType} participant=${participant} promptLen=${prompt.length} responseLen=${response.length}`);
		switch (hookType) {
			case 'SessionStart': {
				// ── Orchestrator: register agent on session start ──
				if (orchestratorEnabled && entry.sessionId) {
					this.registry.register(
						entry.sessionId,
						origin,
						entry.cwd || '',
						prompt?.trim() ? prompt.trim().replace(/\s+/g, ' ').slice(0, 60) : undefined,
					);
				}
				break;
			}

			case 'SessionEnd': {
				const projectId = await this._resolveProjectIdForHookEntry(entry, 'SessionEnd', {
					participant,
					reason: entry.reason || 'complete',
					cwd: entry.cwd,
				});
				if (!projectId) { return; }
				await this._captureSessionEndEvent(entry.reason || 'complete', participant, entry.cwd, projectId);
				break;
			}

			case 'Stop': {
				const stopEnabled = cfg.get('hooks.stop', true);
				console.log(`[HookWatcher:DEBUG] Stop entry — hooks.stop=${stopEnabled} hasPrompt=${!!prompt} hasResponse=${!!response} toolCalls=${(entry.toolCalls || []).length}`);
				if (!stopEnabled) { return; }
				if (!prompt && !response) { return; }
				const projectId = await this._resolveProjectIdForHookEntry(entry, 'Stop', {
					prompt,
					response,
					participant,
					toolCalls: entry.toolCalls,
				});
				if (!projectId) { return; }
				await this._captureStopEvent(prompt, response, participant, entry.toolCalls, projectId);
				break;
			}

			case 'PreCompact': {
				if (!cfg.get('hooks.preCompact', true)) { return; }
				const projectId = await this._resolveProjectIdForHookEntry(entry, 'PreCompact', {
					prompt,
					response,
					participant,
					turns: entry.turns,
				});
				if (!projectId) { return; }
				await this._capturePreCompactEvent(prompt, response, entry.turns, projectId);
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
					entry.toolResultType ? `Result Type: ${entry.toolResultType}` : '',
					inputStr ? `Input: ${inputStr}` : '',
					responseStr ? `Result: ${responseStr}` : '',
				].filter(Boolean).join('\n');
				const projectId = await this._resolveProjectIdForHookEntry(entry, 'PostToolUse', {
					participant,
					toolName,
					toolInput: inp,
					toolResultType: entry.toolResultType,
					toolResponse: responseStr,
					displayPrompt,
					summary,
				});
				if (!projectId) { return; }
				await this._capturePostToolUseEvent(displayPrompt, summary, projectId, toolName, inp);
				break;
			}

			case 'ErrorOccurred': {
				const errorPayload = entry.error || {};
				if (!errorPayload.message && !errorPayload.name && !errorPayload.stack) { return; }
				const projectId = await this._resolveProjectIdForHookEntry(entry, 'ErrorOccurred', {
					participant,
					error: errorPayload,
				});
				if (!projectId) { return; }
				await this._captureErrorEvent(errorPayload, participant, projectId);
				break;
			}

			case 'WriteIntent': {
				if (!entry.writeIntent) { return; }
				const projectId = await this._resolveProjectIdForHookEntry(entry, 'WriteIntent', {
					participant,
					writeIntent: entry.writeIntent,
				});
				if (!projectId) { return; }
				await this._materializeWriteIntent(entry.writeIntent, projectId);
				break;
			}

			default:
				break;
		}
	}

	private async _resolveProjectIdForHookEntry(entry: HookEntry, eventType: string, payload: unknown): Promise<string | undefined> {
		const sessionTrackingEnabled = vscode.workspace.getConfiguration('contextManager').get<boolean>('sessionTracking.enabled', true);

		if (!entry.sessionId || !sessionTrackingEnabled) {
			return this.projectManager.getActiveProject()?.id;
		}

		const prompt = typeof (payload as { prompt?: unknown })?.prompt === 'string'
			? ((payload as { prompt?: string }).prompt || '')
			: '';
		const participant = typeof (payload as { participant?: unknown })?.participant === 'string'
			? ((payload as { participant?: string }).participant || 'copilot')
			: 'copilot';
		const lastActivityAt = entry.timestamp || Date.now();
		const sequence = await this.projectManager.reserveSessionEventSequence(entry.sessionId, {
			origin: entry.origin || 'vscode-extension',
			label: prompt.trim() ? prompt.trim().replace(/\s+/g, ' ').slice(0, 60) : undefined,
			firstPromptSnippet: prompt.trim() ? prompt.trim().replace(/\s+/g, ' ').slice(0, 160) : undefined,
			rootHint: entry.rootHint,
			cwd: entry.cwd,
			lastActivityAt,
			metadata: {
				lastHookType: eventType,
				participant,
			},
		});

		const boundProject = this.projectManager.resolveProjectForSession(entry.sessionId, sequence);
		if (boundProject) {
			return boundProject.id;
		}

		const hintedProject = this._resolveProjectIdFromHints(entry);
		if (hintedProject) {
			return hintedProject;
		}

		const projects = this.projectManager.getAllProjects();
		if (projects.length === 1) {
			return projects[0].id;
		}

		await this.projectManager.addPendingHookEvent({
			sessionId: entry.sessionId,
			eventType,
			payload,
			sequence,
			origin: entry.origin || 'vscode-extension',
			projectIdHint: entry.projectIdHint,
			rootHint: entry.rootHint,
			label: prompt.trim() ? prompt.trim().replace(/\s+/g, ' ').slice(0, 60) : undefined,
			firstPromptSnippet: prompt.trim() ? prompt.trim().replace(/\s+/g, ' ').slice(0, 160) : undefined,
			cwd: entry.cwd,
			lastActivityAt,
			metadata: {
				lastHookType: eventType,
				participant,
			},
		});
		console.log(`[HookWatcher] Queued pending ${eventType} event for unbound session ${entry.sessionId}`);
		return undefined;
	}

	private async _materializePendingHookEvent(eventType: string, payload: unknown, projectId: string): Promise<void> {
		switch (eventType) {
			case 'Stop': {
				const stopPayload = payload as {
					prompt?: string;
					response?: string;
					participant?: string;
					toolCalls?: Array<{ toolName: string; input: string; output: string }>;
				};
				await this._captureStopEvent(
					stopPayload.prompt || '',
					stopPayload.response || '',
					stopPayload.participant || 'copilot',
					stopPayload.toolCalls,
					projectId,
					false,
				);
				break;
			}

			case 'PreCompact': {
				const compactPayload = payload as {
					prompt?: string;
					response?: string;
					turns?: Array<{ user: string; assistant: string }>;
				};
				await this._capturePreCompactEvent(
					compactPayload.prompt || '',
					compactPayload.response || '',
					compactPayload.turns,
					projectId,
				);
				break;
			}

			case 'PostToolUse': {
				const toolPayload = payload as { displayPrompt?: string; summary?: string; toolName?: string; toolInput?: Record<string, unknown> };
				if (!toolPayload.displayPrompt || !toolPayload.summary) { return; }
				await this._capturePostToolUseEvent(toolPayload.displayPrompt, toolPayload.summary, projectId, toolPayload.toolName, toolPayload.toolInput);
				break;
			}

			case 'SessionEnd': {
				const sessionPayload = payload as { reason?: string; participant?: string; cwd?: string };
				await this._captureSessionEndEvent(
					sessionPayload.reason || 'complete',
					sessionPayload.participant || 'copilot',
					sessionPayload.cwd,
					projectId,
				);
				break;
			}

			case 'ErrorOccurred': {
				const errorPayload = payload as { error?: { message?: string; name?: string; stack?: string }; participant?: string };
				await this._captureErrorEvent(errorPayload.error, errorPayload.participant || 'copilot', projectId);
				break;
			}

			case 'WriteIntent': {
				const writePayload = payload as { writeIntent?: HookWriteIntent };
				if (!writePayload.writeIntent) { return; }
				await this._materializeWriteIntent(writePayload.writeIntent, projectId);
				break;
			}

			default:
				break;
		}
	}

	private async _captureStopEvent(
		prompt: string,
		response: string,
		participant: string,
		toolCalls: Array<{ toolName: string; input: string; output: string }> | undefined,
		projectId: string,
		applyOneShotMode: boolean = true,
	): Promise<void> {
		await this.autoCapture.onModelResponse(prompt, response, `hook:${participant}`, { projectId });
		this._queueCardCandidate(prompt, response, participant, toolCalls, projectId).catch(() => {});
		if (applyOneShotMode) {
			this._deselectIfOneShot(projectId);
		}
	}

	private async _capturePreCompactEvent(
		prompt: string,
		response: string,
		turns: Array<{ user: string; assistant: string }> | undefined,
		projectId: string,
	): Promise<void> {
		if (Array.isArray(turns) && turns.length > 0) {
			const firstUser = turns[0]?.user || '';
			await this.autoCapture.onModelResponse(
				firstUser.substring(0, 300),
				`[PreCompact multi-turn: ${turns.length} turns processed]`,
				'hook:compact',
				{ projectId },
			);
			this.autoCapture.extractMultiTurnLearnings(turns, projectId).catch(e =>
				console.warn('[HookWatcher] multi-turn extraction error:', e));
			this.autoCapture.distillAndSaveBackground(projectId).catch(() => {});
			return;
		}

		if (!prompt && !response) { return; }
		await this.autoCapture.onModelResponse(prompt, response, 'hook:compact', { projectId });
		this.autoCapture.distillAndSaveBackground(projectId).catch(() => {});
	}

	private async _capturePostToolUseEvent(
		displayPrompt: string,
		summary: string,
		projectId: string,
		toolName?: string,
		toolInput?: Record<string, unknown>,
	): Promise<void> {
		const fileRef = toolInput
			? (toolInput.filePath ?? toolInput.path ?? toolInput.file ?? toolInput.dirPath)
			: undefined;
		const filesReferenced = typeof fileRef === 'string' ? [fileRef] : [];
		const toolCalls = toolName ? [{ name: toolName, input: toolInput ? JSON.stringify(toolInput).substring(0, 200) : undefined }] : undefined;
		await this.autoCapture.captureHookObservation(displayPrompt, summary, 'hook:tool', {
			projectId,
			type: 'change',
			filesReferenced,
			toolCalls,
		});
	}

	private async _captureSessionEndEvent(
		reason: string,
		participant: string,
		cwd: string | undefined,
		projectId: string,
	): Promise<void> {
		const promptText = `[session end] ${participant}`;
		const responseText = [
			'Session ended.',
			`Reason: ${reason}`,
			cwd ? `CWD: ${cwd}` : '',
		].filter(Boolean).join('\n');
		await this.autoCapture.captureHookObservation(promptText, responseText, 'hook:session', {
			projectId,
			type: 'change',
			filesReferenced: cwd ? [cwd] : [],
		});
	}

	private async _captureErrorEvent(
		error: { message?: string; name?: string; stack?: string } | undefined,
		participant: string,
		projectId: string,
	): Promise<void> {
		if (!error?.message && !error?.name && !error?.stack) { return; }
		const promptText = `[error] ${participant}`;
		const responseText = [
			error.name ? `Name: ${error.name}` : 'Agent error occurred.',
			error.message ? `Message: ${error.message}` : '',
			error.stack ? `Stack: ${error.stack.substring(0, 1200)}` : '',
		].filter(Boolean).join('\n');
		await this.autoCapture.captureHookObservation(promptText, responseText, 'hook:error', {
			projectId,
			type: 'bugfix',
		});
	}

	private async _materializeWriteIntent(intent: HookWriteIntent, projectId: string): Promise<void> {
		switch (intent.action) {
			case 'save-card': {
				if (!intent.title?.trim() || !intent.content?.trim()) { return; }
				const folderId = await this._resolveKnowledgeFolderId(
					projectId,
					intent.folderName,
					intent.parentFolderName,
					intent.createFolderIfMissing !== false,
				);
				await this.projectManager.addKnowledgeCard(
					projectId,
					intent.title.trim(),
					intent.content.trim(),
					intent.category || 'note',
					intent.tags || [],
					intent.source || 'external plugin write intent',
					undefined,
					folderId,
					intent.trackToolUsage,
				);
				break;
			}

			case 'learn-convention': {
				if (!intent.title?.trim() || !intent.content?.trim()) { return; }
				await this.projectManager.addConvention(
					projectId,
					intent.category,
					intent.title.trim(),
					intent.content.trim(),
					intent.confidence || 'observed',
					intent.learnedFrom || 'external plugin write intent',
				);
				break;
			}

			case 'learn-tool-hint': {
				if (!intent.toolName?.trim() || !intent.pattern?.trim() || !intent.example?.trim()) { return; }
				await this.projectManager.addToolHint(
					projectId,
					intent.toolName.trim(),
					intent.pattern.trim(),
					intent.example.trim(),
					intent.antiPattern?.trim(),
				);
				break;
			}

			case 'learn-working-note': {
				if (!intent.subject?.trim() || !intent.insight?.trim()) { return; }
				await this.projectManager.addWorkingNote(
					projectId,
					intent.subject.trim(),
					intent.insight.trim(),
					intent.relatedFiles || [],
					intent.relatedSymbols || [],
					intent.discoveredWhile || 'external plugin write intent',
				);
				break;
			}
		}
	}

	private async _resolveKnowledgeFolderId(
		projectId: string,
		folderName: string | undefined,
		parentFolderName: string | undefined,
		createFolderIfMissing: boolean,
	): Promise<string | undefined> {
		const normalizedFolder = folderName?.trim().toLowerCase();
		if (!normalizedFolder) {
			return undefined;
		}

		const folders = this.projectManager.getKnowledgeFolders(projectId);
		let parentFolderId: string | undefined;
		const normalizedParent = parentFolderName?.trim().toLowerCase();

		if (normalizedParent) {
			const parent = folders.find(folder => folder.name.toLowerCase() === normalizedParent);
			if (parent) {
				parentFolderId = parent.id;
			} else if (createFolderIfMissing) {
				const createdParent = await this.projectManager.addKnowledgeFolder(projectId, parentFolderName!.trim());
				parentFolderId = createdParent?.id;
			}
		}

		const existing = this.projectManager.getKnowledgeFolders(projectId).find(folder =>
			folder.name.toLowerCase() === normalizedFolder && (folder.parentFolderId || '') === (parentFolderId || '')
		);
		if (existing) {
			return existing.id;
		}

		if (!createFolderIfMissing) {
			return undefined;
		}

		const created = await this.projectManager.addKnowledgeFolder(projectId, folderName!.trim(), parentFolderId);
		return created?.id;
	}

	private _resolveProjectIdFromHints(entry: HookEntry): string | undefined {
		for (const candidate of [entry.projectIdHint, entry.rootHint]) {
			if (!candidate?.trim()) { continue; }
			const resolved = this.projectManager.resolveProjectTarget(candidate);
			if (resolved.status === 'resolved') {
				return resolved.project.id;
			}
		}

		return undefined;
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
		projectId?: string,
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

		const project = projectId
			? this.projectManager.getProject(projectId)
			: this.projectManager.getActiveProject();
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

	/** If one-shot mode is on, deselect all selected cards after a prompt completes. */
	private _deselectIfOneShot(projectId?: string): void {
		const project = projectId
			? this.projectManager.getProject(projectId)
			: this.projectManager.getActiveProject();
		if (!project) { return; }
		if (!project.promptInjection?.oneShotMode) { return; }
		const selectedCardIds = project.selectedCardIds || [];
		if (selectedCardIds.length === 0) { return; }

		// Bump injectionCount on each injected card
		const allCards = this.projectManager.getKnowledgeCards(project.id);
		for (const id of selectedCardIds) {
			const card = allCards.find((c: KnowledgeCard) => c.id === id);
			if (card) { card.injectionCount = (card.injectionCount || 0) + 1; }
		}

		// Deselect all and persist updated cards
		this.projectManager.updateProject(project.id, {
			selectedCardIds: [],
			knowledgeCards: allCards,
		}).catch(err => console.warn('[HookWatcher] one-shot deselect error:', err));
	}

	/** Write the current project's intelligence/session context so the SessionStart hook can inject it. */
	private _syncSessionContext(): void {
		// Check if injection is enabled (dashboard toggle)
		const injectionEnabled = vscode.workspace.getConfiguration('contextManager').get<boolean>('hooks.sessionStart', true);
		if (!injectionEnabled) {
			try { fs.writeFileSync(SESSION_CTX, ''); } catch {}
			return;
		}

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
		const includeProjectContext = injection?.includeProjectContext ?? false;
		const projectGoals = project.context.goals?.trim();
		const projectConventions = project.context.conventions?.trim();
		const projectKeyFiles = (project.context.keyFiles || [])
			.map(file => file.trim())
			.filter(Boolean);
		const hasProjectContext = includeProjectContext && !!(projectGoals || projectConventions || projectKeyFiles.length > 0);

		if (selectedCardIds.length > 0 || hasCustomInstruction || hasProjectContext) {
			lines.push('');
			lines.push('## Injected Context for This Session');

			if (hasCustomInstruction) {
				lines.push('');
				lines.push(injection!.customInstruction.trim());
			}

			if (hasProjectContext) {
				lines.push('');
				lines.push('### Project Context');
				lines.push('');
				if (projectGoals) {
					lines.push(`Goals: ${projectGoals}`);
				}
				if (projectConventions) {
					lines.push(`Conventions: ${projectConventions}`);
				}
				if (projectKeyFiles.length > 0) {
					lines.push('Key files:');
					for (const file of projectKeyFiles) {
						lines.push(`- ${file}`);
					}
				}
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

		// ── Orchestrator: inject fleet status + bus messages ──
		const activeProject = this.projectManager.getActiveProject();
		if (activeProject) {
			const orchLines = this.contextSync.generateOrchestratorContext(
				'vscode-session', // VS Code doesn't have a CLI session ID
				activeProject.id,
			);
			lines.push(...orchLines);
		}

		this.updateSessionContext(lines.join('\n'));
	}
}
