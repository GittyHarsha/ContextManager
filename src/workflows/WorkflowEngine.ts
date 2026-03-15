/**
 * WorkflowEngine — executes user-defined CustomWorkflow definitions.
 *
 * Resolves {{template}} variables in the prompt, optionally calls the vscode.lm API,
 * and performs the configured output action (create, update, or append).
 *
 * Supports collection variables ({{cards.all}}, {{toolHints.all}}, etc.)
 * with a per-workflow maxItems cap, plus event-specific variables for
 * convention-learned and observation-created triggers.
 */

import * as vscode from 'vscode';
import type { ProjectManager } from '../projects/ProjectManager';
import type { CustomWorkflow, QueuedCardCandidate, KnowledgeCard, Convention, WorkflowRunRecord, WorkflowOutputAction } from '../projects/types';
import type { AutoCaptureService, Observation } from '../autoCapture';
import { ConfigurationManager } from '../config';

const WORKFLOW_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_ITEMS = 20;
const MAX_RUN_HISTORY = 15;
const TEMPLATE_ONLY_ACTIONS = new Set<WorkflowOutputAction>([
	'create-card-template',
	'update-card-template',
	'append-collector-template',
]);

// ── Context passed to a workflow run ────────────────────────────

export interface WorkflowContext {
	projectId: string;
	/** Queue item that triggered the workflow (auto-queue or manual). */
	queueItem?: QueuedCardCandidate;
	/** Card that the workflow targets (manual run on a card). */
	card?: KnowledgeCard;
	/** Convention that triggered the workflow (convention-learned event). */
	convention?: Convention;
	/** Observation that triggered the workflow (observation-created event). */
	observation?: Observation;
}

export interface WorkflowResult {
	success: boolean;
	/** ID of the card that was created or updated. */
	cardId?: string;
	/** Raw AI output text. */
	output?: string;
	error?: string;
}

// ── Template variable resolution ────────────────────────────────

function resolveTemplate(
	template: string,
	ctx: WorkflowContext,
	projectManager: ProjectManager,
	autoCapture: AutoCaptureService | undefined,
	maxItems: number,
): string {
	const project = projectManager.getProject(ctx.projectId);
	const q = ctx.queueItem;
	const c = ctx.card;
	const conv = ctx.convention;
	const obs = ctx.observation;

	// ── Scalar variables ────────────────────────────────────────
	const vars: Record<string, string> = {
		'queue.prompt': q?.prompt ?? '',
		'queue.response': q?.response ?? '',
		'queue.participant': q?.participant ?? '',
		'queue.toolCalls': q?.toolCalls?.map(tc =>
			`[${tc.toolName}] input: ${tc.input}\noutput: ${tc.output}`
		).join('\n\n') ?? '',
		'card.title': c?.title ?? '',
		'card.content': c?.content ?? '',
		'card.tags': c?.tags?.join(', ') ?? '',
		'project.name': project?.name ?? '',
		'project.description': project?.description ?? '',
		'project.conventions': (project?.conventions || [])
			.filter(cv => cv.enabled !== false)
			.map(cv => `- ${cv.title}: ${cv.content}`)
			.join('\n') || '(none)',
		// Event-specific: convention
		'convention.title': conv?.title ?? '',
		'convention.content': conv?.content ?? '',
		// Event-specific: observation
		'observation.summary': obs?.responseSummary ?? '',
		'observation.files': obs?.filesReferenced?.join(', ') ?? '',
	};

	// ── Collection variables (capped by maxItems) ───────────────
	if (project) {
		const allCards = project.knowledgeCards || [];
		const selectedIds = new Set(project.selectedCardIds || []);
		const selectedCards = allCards.filter(cd => selectedIds.has(cd.id));

		vars['cards.all'] = allCards.slice(0, maxItems).map(cd =>
			`### ${cd.title}\n${cd.content}\nTags: ${cd.tags?.join(', ') || '(none)'}`
		).join('\n\n') || '(none)';

		vars['cards.selected'] = selectedCards.slice(0, maxItems).map(cd =>
			`### ${cd.title}\n${cd.content}\nTags: ${cd.tags?.join(', ') || '(none)'}`
		).join('\n\n') || '(none)';

		vars['conventions.all'] = (project.conventions || [])
			.filter(cv => cv.enabled !== false)
			.slice(0, maxItems)
			.map(cv => `[${cv.category}] ${cv.title}: ${cv.content}`)
			.join('\n') || '(none)';

		vars['toolHints.all'] = (project.toolHints || [])
			.slice(0, maxItems)
			.map(th => `Tool: ${th.toolName} | Pattern: ${th.pattern} | Example: ${th.example}`)
			.join('\n') || '(none)';

		vars['workingNotes.all'] = (project.workingNotes || [])
			.filter(wn => wn.enabled !== false)
			.slice(0, maxItems)
			.map(wn => `Subject: ${wn.subject} | Insight: ${wn.insight} | Files: ${wn.relatedFiles.join(', ') || '(none)'}`)
			.join('\n') || '(none)';
	}

	// Observations come from AutoCaptureService, not Project
	if (autoCapture) {
		const recentObs = autoCapture.getRecentObservations(24 * 60 * 60 * 1000, ctx.projectId);
		vars['observations.recent'] = recentObs.slice(0, maxItems).map(o =>
			`[${new Date(o.timestamp).toLocaleTimeString()}] ${o.type} — ${o.prompt}\nSummary: ${o.responseSummary}\nFiles: ${o.filesReferenced.join(', ') || '(none)'}`
		).join('\n\n') || '(none)';
	} else {
		vars['observations.recent'] = '(observations unavailable)';
	}

	return template.replace(/\{\{(\w+\.\w+)\}\}/g, (match, key) => {
		return vars[key] ?? match;
	});
}

// ── Engine ──────────────────────────────────────────────────────

export class WorkflowEngine {
	private _autoCapture: AutoCaptureService | undefined;
	/** Per-project re-entrancy guard — prevents infinite loops from card-updated/card-created triggers
	 *  while allowing different projects' workflows to execute concurrently. */
	private _executingProjects = new Set<string>();

	constructor(private projectManager: ProjectManager) {}

	/** Set the AutoCaptureService reference (called from extension.ts after construction). */
	setAutoCapture(ac: AutoCaptureService): void {
		this._autoCapture = ac;
	}

	/**
	 * Execute a single workflow. Returns the result and updates the workflow's
	 * lastRun / lastRunStatus / runCount via ProjectManager.
	 */
	async execute(
		workflow: CustomWorkflow,
		ctx: WorkflowContext,
	): Promise<WorkflowResult> {
		const { projectId } = ctx;

		try {
			// 0. Auto-resolve target card into ctx.card when template uses {{card.}} vars
			if (!ctx.card && workflow.targetCardId && workflow.promptTemplate.includes('{{card.')) {
				const cards = this.projectManager.getKnowledgeCards(projectId);
				ctx.card = cards.find(c => c.id === workflow.targetCardId);
			}

			// 1. Resolve prompt template
			const maxItems = workflow.maxItems ?? DEFAULT_MAX_ITEMS;
			const prompt = resolveTemplate(workflow.promptTemplate, ctx, this.projectManager, this._autoCapture, maxItems);
			if (!prompt.trim()) {
				return this._fail(workflow, projectId, 'Resolved prompt is empty — check your template variables.');
			}

			// 2. Produce output text — either direct template expansion or AI output.
			const text = TEMPLATE_ONLY_ACTIONS.has(workflow.outputAction)
				? prompt.trim()
				: await this._generateAiOutput(prompt);
			if (!text) {
				return this._fail(
					workflow,
					projectId,
					TEMPLATE_ONLY_ACTIONS.has(workflow.outputAction)
						? 'Resolved template output is empty.'
						: 'Model returned empty response.'
				);
			}

			// 4b. Check skip pattern — if output matches, skip the output action
			if (workflow.skipPattern) {
				try {
					const skipRe = new RegExp(workflow.skipPattern, 'i');
					if (skipRe.test(text)) {
						console.log(`[WorkflowEngine] Workflow "${workflow.name}" output matched skip pattern — skipping output action.`);
						return this._recordRun(workflow, projectId, 'skipped', text, undefined);
					}
				} catch {
					console.warn(`[WorkflowEngine] Invalid skipPattern regex: ${workflow.skipPattern}`);
				}
			}

			// 5. Execute output action (with per-project re-entrancy guard)
			this._executingProjects.add(projectId);
			let result: WorkflowResult;
			try {
				result = await this._executeOutput(workflow, ctx, text);
			} finally {
				this._executingProjects.delete(projectId);
			}

			// 6. Record success
			return this._recordRun(workflow, projectId, 'success', text, result.cardId);
		} catch (err: any) {
			return this._fail(workflow, projectId, err?.message || String(err));
		}
	}

	private async _generateAiOutput(prompt: string): Promise<string> {
		const modelFamily = ConfigurationManager.workflowModelFamily;
		const selector: vscode.LanguageModelChatSelector = modelFamily ? { family: modelFamily } : {};
		const models = await vscode.lm.selectChatModels(selector);
		if (!models.length) {
			throw new Error(`No language model available${modelFamily ? ` (requested family: "${modelFamily}")` : ''}.`);
		}

		const messages = [
			vscode.LanguageModelChatMessage.User(
				'You are executing a user-defined workflow for a project knowledge manager. ' +
				'Follow the instructions precisely. Return the final card-ready content only. ' +
				'Markdown headings, lists, tables, and code blocks are allowed and preferred when they improve readability. ' +
				'Do not wrap the entire response in a JSON object or in outer markdown fences unless the prompt explicitly asks for that format.'
			),
			vscode.LanguageModelChatMessage.User(prompt),
		];

		const cts = new vscode.CancellationTokenSource();
		const response = await Promise.race([
			models[0].sendRequest(messages, {}, cts.token),
			new Promise<null>((_, reject) =>
				setTimeout(() => { cts.cancel(); reject(new Error('Workflow LLM timeout')); }, WORKFLOW_TIMEOUT_MS)
			),
		]);
		if (!response) {
			throw new Error('No response from model.');
		}

		let text = '';
		for await (const part of (response as any).stream ?? (response as any).text ?? []) {
			if (typeof part === 'string') { text += part; }
			else if (part?.value) { text += part.value; }
		}

		return text.trim();
	}

	// ── Auto-trigger: Queue item added ──────────────────────────

	async fireAutoQueue(projectId: string, queueItem: QueuedCardCandidate): Promise<void> {
		if (this._executingProjects.has(projectId)) { return; }
		const workflows = this.projectManager.getWorkflows(projectId);
		const eligible = workflows.filter(
			w => w.enabled && (w.trigger === 'auto-queue' || w.trigger === 'both')
		);
		if (!eligible.length) { return; }

		const matchText = `${queueItem.prompt ?? ''} ${queueItem.response ?? ''}`;
		console.log(`[WorkflowEngine] Firing ${eligible.length} auto-queue workflow(s)`);
		for (const wf of eligible) {
			if (!this._matchesTriggerFilter(wf, matchText)) { continue; }
			try {
				await this.execute(wf, { projectId, queueItem });
			} catch (err) {
				console.warn(`[WorkflowEngine] auto-queue workflow "${wf.name}" failed:`, err);
			}
		}
	}

	// ── Auto-trigger: Convention learned ─────────────────────────

	async fireConventionLearned(projectId: string, convention: Convention): Promise<void> {
		if (this._executingProjects.has(projectId)) { return; }
		const workflows = this.projectManager.getWorkflows(projectId);
		const eligible = workflows.filter(
			w => w.enabled && w.trigger === 'convention-learned'
		);
		if (!eligible.length) { return; }

		const matchText = `${convention.title ?? ''} ${convention.content ?? ''}`;
		console.log(`[WorkflowEngine] Firing ${eligible.length} convention-learned workflow(s)`);
		for (const wf of eligible) {
			if (!this._matchesTriggerFilter(wf, matchText)) { continue; }
			try {
				await this.execute(wf, { projectId, convention });
			} catch (err) {
				console.warn(`[WorkflowEngine] convention-learned workflow "${wf.name}" failed:`, err);
			}
		}
	}

	// ── Auto-trigger: Card created ──────────────────────────────

	async fireCardCreated(projectId: string, card: KnowledgeCard): Promise<void> {
		if (this._executingProjects.has(projectId)) { return; }
		const workflows = this.projectManager.getWorkflows(projectId);
		const eligible = workflows.filter(
			w => w.enabled && w.trigger === 'card-created'
		);
		if (!eligible.length) { return; }

		const matchText = `${card.title ?? ''} ${card.content ?? ''}`;
		console.log(`[WorkflowEngine] Firing ${eligible.length} card-created workflow(s)`);
		for (const wf of eligible) {
			if (!this._matchesTriggerFilter(wf, matchText)) { continue; }
			try {
				await this.execute(wf, { projectId, card });
			} catch (err) {
				console.warn(`[WorkflowEngine] card-created workflow "${wf.name}" failed:`, err);
			}
		}
	}

	// ── Auto-trigger: Card updated ──────────────────────────────

	async fireCardUpdated(projectId: string, card: KnowledgeCard): Promise<void> {
		if (this._executingProjects.has(projectId)) { return; }
		const workflows = this.projectManager.getWorkflows(projectId);
		const eligible = workflows.filter(
			w => w.enabled && w.trigger === 'card-updated'
		);
		if (!eligible.length) { return; }

		const matchText = `${card.title ?? ''} ${card.content ?? ''}`;
		console.log(`[WorkflowEngine] Firing ${eligible.length} card-updated workflow(s)`);
		for (const wf of eligible) {
			if (!this._matchesTriggerFilter(wf, matchText)) { continue; }
			try {
				await this.execute(wf, { projectId, card });
			} catch (err) {
				console.warn(`[WorkflowEngine] card-updated workflow "${wf.name}" failed:`, err);
			}
		}
	}

	// ── Auto-trigger: Observation created ───────────────────────

	async fireObservationCreated(projectId: string, observation: Observation): Promise<void> {
		if (this._executingProjects.has(projectId)) { return; }
		const workflows = this.projectManager.getWorkflows(projectId);
		const eligible = workflows.filter(
			w => w.enabled && w.trigger === 'observation-created'
		);
		if (!eligible.length) { return; }

		const matchText = `${observation.prompt ?? ''} ${observation.responseSummary ?? ''}`;
		console.log(`[WorkflowEngine] Firing ${eligible.length} observation-created workflow(s)`);
		for (const wf of eligible) {
			if (!this._matchesTriggerFilter(wf, matchText)) { continue; }
			try {
				await this.execute(wf, { projectId, observation });
			} catch (err) {
				console.warn(`[WorkflowEngine] observation-created workflow "${wf.name}" failed:`, err);
			}
		}
	}

	// ── Output Actions ──────────────────────────────────────────

	private async _executeOutput(
		workflow: CustomWorkflow,
		ctx: WorkflowContext,
		outputText: string,
	): Promise<WorkflowResult> {
		const { projectId } = ctx;

		switch (workflow.outputAction) {
			case 'create-card':
			case 'create-card-template': {
				const title = this._extractTitle(outputText, workflow.name);
				const tags = ['workflow', workflow.name.toLowerCase().replace(/\s+/g, '-')];
				const source = `Workflow: ${workflow.name}${workflow.outputAction.endsWith('-template') ? ' (template-only)' : ''}`;
				const card = await this.projectManager.addKnowledgeCard(
					projectId, title, outputText, 'note', tags, source,
				);
				return { success: true, cardId: card?.id, output: outputText };
			}

			case 'update-card':
			case 'update-card-template': {
				if (!workflow.targetCardId) {
					return { success: false, error: 'No target card specified for update.' };
				}
				const existing = this.projectManager.getKnowledgeCards(projectId)
					.find(c => c.id === workflow.targetCardId);
				if (!existing) {
					return { success: false, error: `Target card not found: ${workflow.targetCardId}` };
				}
				await this.projectManager.updateKnowledgeCard(projectId, workflow.targetCardId, {
					content: outputText,
					updated: Date.now(),
				});
				return { success: true, cardId: workflow.targetCardId, output: outputText };
			}

			case 'append-collector':
			case 'append-collector-template': {
				if (!workflow.targetCardId) {
					return { success: false, error: 'No collector card specified.' };
				}
				const collector = this.projectManager.getKnowledgeCards(projectId)
					.find(c => c.id === workflow.targetCardId);
				if (!collector) {
					return { success: false, error: `Collector card not found: ${workflow.targetCardId}` };
				}
				const timestamp = new Date().toLocaleString();
				const modeLabel = workflow.outputAction.endsWith('-template') ? 'template run' : 'Workflow run';
				const separator = `\n\n---\n_${modeLabel}: ${timestamp}_\n\n`;
				const newContent = collector.content
					? collector.content + separator + outputText
					: outputText;
				await this.projectManager.updateKnowledgeCard(projectId, workflow.targetCardId, {
					content: newContent,
					updated: Date.now(),
				});
				return { success: true, cardId: workflow.targetCardId, output: outputText };
			}

			default:
				return { success: false, error: `Unknown output action: ${workflow.outputAction}` };
		}
	}

	// ── Helpers ──────────────────────────────────────────────────

	/** Extract a short title from the first line of AI output. */
	private _extractTitle(text: string, fallback: string): string {
		const firstLine = text.split('\n')[0].replace(/^#+\s*/, '').trim();
		if (firstLine.length > 5 && firstLine.length < 120) { return firstLine; }
		return `${fallback} — ${new Date().toLocaleDateString()}`;
	}

	/** Check if the workflow's triggerFilter regex matches the input text. */
	private _matchesTriggerFilter(workflow: CustomWorkflow, text: string): boolean {
		if (!workflow.triggerFilter) { return true; }
		try {
			return new RegExp(workflow.triggerFilter, 'i').test(text);
		} catch {
			console.warn(`[WorkflowEngine] Invalid triggerFilter regex: ${workflow.triggerFilter}`);
			return true; // Don't block on bad regex
		}
	}

	/** Record a successful or skipped run with history. */
	private async _recordRun(
		workflow: CustomWorkflow,
		projectId: string,
		status: 'success' | 'skipped',
		output: string,
		cardId?: string,
	): Promise<WorkflowResult> {
		const record: WorkflowRunRecord = {
			timestamp: Date.now(),
			status,
			outputPreview: output.substring(0, 200),
		};
		const history = [...(workflow.runHistory || []), record].slice(-MAX_RUN_HISTORY);

		await this.projectManager.updateWorkflow(projectId, workflow.id, {
			lastRun: Date.now(),
			lastRunStatus: status,
			lastRunError: undefined,
			runCount: (workflow.runCount || 0) + 1,
			runHistory: history,
		});

		return { success: status === 'success', cardId, output };
	}

	/** Record a failure on the workflow and return an error result. */
	private async _fail(
		workflow: CustomWorkflow,
		projectId: string,
		error: string,
	): Promise<WorkflowResult> {
		console.warn(`[WorkflowEngine] Workflow "${workflow.name}" failed: ${error}`);
		const record: WorkflowRunRecord = {
			timestamp: Date.now(),
			status: 'error',
			error,
		};
		const history = [...(workflow.runHistory || []), record].slice(-MAX_RUN_HISTORY);

		await this.projectManager.updateWorkflow(projectId, workflow.id, {
			lastRun: Date.now(),
			lastRunStatus: 'error',
			lastRunError: error,
			runHistory: history,
		}).catch(() => {});
		return { success: false, error };
	}
}
